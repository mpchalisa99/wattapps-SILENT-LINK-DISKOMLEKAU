import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface EphemeralPeerNode {
  peerId: string;
  callsign: string;
  nrp: string;
  unit: string;
  rank: string;
  role: string;
  publicKeyJwk?: JsonWebKey;
  fingerprint?: string;
  joinedAt: number;
  ws: WebSocket;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));

  // Zero-Data Retention Policy:
  // Keyed by WebSocket instance so multiple devices opening the app before QR scan never clobber each other
  const activeConnections = new Map<WebSocket, EphemeralPeerNode>();
  const ephemeralInvites = new Map<string, Record<string, unknown>>();

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'NOMINAL',
      protocol: 'WEBRTC-P2P-SIGNAL-RELAY',
      retentionPolicy: 'ZERO_DATA_RETENTION_RAM_ONLY',
      activeNodes: activeConnections.size,
      activeInvitesInRam: ephemeralInvites.size,
    });
  });

  // Register newly generated personnel QR/Barcode invite in volatile RAM
  app.post('/api/invite', (req, res) => {
    const cred = req.body;
    if (!cred || !cred.assignedPeerId) {
      res.status(400).json({ error: 'Invalid credential payload' });
      return;
    }
    ephemeralInvites.set(String(cred.assignedPeerId).toUpperCase(), cred);
    if (cred.credentialId) {
      ephemeralInvites.set(String(cred.credentialId).toUpperCase(), cred);
    }
    if (cred.nrp) {
      ephemeralInvites.set(`NRP-${String(cred.nrp).toUpperCase()}`, cred);
    }
    res.json({ ok: true, assignedPeerId: cred.assignedPeerId });
  });

  // Resolve compact QR Code / Barcode invite link when scanned by a smartphone
  app.get('/api/invite/:id', (req, res) => {
    const key = String(req.params.id || '').trim().toUpperCase();
    const found = ephemeralInvites.get(key);

    // Always attach the live Admin public key if an ADMIN node is currently online
    let liveAdmin: EphemeralPeerNode | null = null;
    for (const peer of activeConnections.values()) {
      if (peer.role === 'ADMIN' && peer.publicKeyJwk && peer.ws.readyState === WebSocket.OPEN) {
        liveAdmin = peer;
        break;
      }
    }

    if (found) {
      res.json({
        credential: {
          ...found,
          ...(liveAdmin
            ? {
                adminPeerId: liveAdmin.peerId,
                adminPublicKeyJwk: liveAdmin.publicKeyJwk,
                adminFingerprint: liveAdmin.fingerprint || found.adminFingerprint,
              }
            : {}),
        },
      });
      return;
    }

    if (liveAdmin) {
      res.json({
        partialAdmin: {
          adminPeerId: liveAdmin.peerId,
          adminCallsign: liveAdmin.callsign,
          adminPublicKeyJwk: liveAdmin.publicKeyJwk,
          adminFingerprint: liveAdmin.fingerprint || 'ECDH-P256-LIVE',
        },
      });
      return;
    }

    res.status(404).json({ error: 'Invite not found in volatile RAM' });
  });

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws-signal',
    maxPayload: 15 * 1024 * 1024, // 15MB max payload for E2EE images, documents & voice notes
  });

  const broadcastPeerList = () => {
    const peerDirectory = Array.from(activeConnections.values())
      .filter((p) => p.ws.readyState === WebSocket.OPEN)
      .map((p) => ({
        peerId: p.peerId,
        callsign: p.callsign,
        nrp: p.nrp,
        unit: p.unit,
        rank: p.rank,
        role: p.role,
        publicKeyJwk: p.publicKeyJwk,
        fingerprint: p.fingerprint,
        joinedAt: p.joinedAt,
      }));

    const payload = JSON.stringify({
      type: 'directory:sync',
      peers: peerDirectory,
      timestamp: Date.now(),
    });

    for (const peer of activeConnections.values()) {
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(payload);
      }
    }
  };

  // Locate all target peer sockets by exact peerId, fallback NRP match, or ADMIN role alias (excluding sender socket)
  const findTargetPeers = (
    targetPeerId: string,
    targetNrp: string | undefined,
    senderWs: WebSocket
  ): EphemeralPeerNode[] => {
    const matches: EphemeralPeerNode[] = [];
    const seenSockets = new Set<WebSocket>();

    // 1. Exact peerId match
    for (const peer of activeConnections.values()) {
      if (
        peer.ws !== senderWs &&
        peer.ws.readyState === WebSocket.OPEN &&
        peer.peerId === targetPeerId
      ) {
        matches.push(peer);
        seenSockets.add(peer.ws);
      }
    }

    // 2. Fallback NRP match
    if (matches.length === 0 && targetNrp) {
      for (const peer of activeConnections.values()) {
        if (
          peer.ws !== senderWs &&
          !seenSockets.has(peer.ws) &&
          peer.ws.readyState === WebSocket.OPEN &&
          peer.nrp === targetNrp
        ) {
          matches.push(peer);
          seenSockets.add(peer.ws);
        }
      }
    }

    // 3. Fallback Admin alias match (if Operative targets SLK-ADM-* or NRP 526316)
    if (
      matches.length === 0 &&
      (targetPeerId.startsWith('SLK-ADM-') ||
        targetPeerId.startsWith('ADM-') ||
        targetNrp === '526316')
    ) {
      for (const peer of activeConnections.values()) {
        if (
          peer.ws !== senderWs &&
          !seenSockets.has(peer.ws) &&
          peer.ws.readyState === WebSocket.OPEN &&
          peer.role === 'ADMIN'
        ) {
          matches.push(peer);
          seenSockets.add(peer.ws);
        }
      }
    }

    return matches;
  };

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === 'node:register' && data.peerId) {
          let assignedPeerId = String(data.peerId);

          // Check if another distinct socket already holds this exact peerId (e.g. a 2nd browser tab opening before QR scan)
          let hasCollision = false;
          for (const [otherWs, otherPeer] of activeConnections.entries()) {
            if (
              otherWs !== ws &&
              otherWs.readyState === WebSocket.OPEN &&
              otherPeer.peerId === assignedPeerId
            ) {
              hasCollision = true;
              break;
            }
          }

          if (hasCollision && assignedPeerId === 'SLK-ADM-526316-0001') {
            const suffix = Math.random().toString(16).slice(2, 6).toUpperCase();
            assignedPeerId = `SLK-ADM-526316-${suffix}`;
            ws.send(
              JSON.stringify({
                type: 'node:assigned-id',
                peerId: assignedPeerId,
              })
            );
          }

          activeConnections.set(ws, {
            peerId: assignedPeerId,
            callsign: data.callsign || `GARUDA-${assignedPeerId.slice(0, 4)}`,
            nrp: data.nrp || assignedPeerId.slice(-6),
            unit: data.unit || 'DISKOMLEKAU',
            rank: data.rank || 'OPS-NODE',
            role: data.role || 'OPERATIVE',
            publicKeyJwk: data.publicKeyJwk,
            fingerprint: data.fingerprint,
            joinedAt: Date.now(),
            ws,
          });

          // If an Admin registers or updates their key, update any stored RAM invites with Admin's latest live peerId & publicKeyJwk
          if (data.role === 'ADMIN' && data.publicKeyJwk) {
            for (const [k, inv] of ephemeralInvites.entries()) {
              ephemeralInvites.set(k, {
                ...inv,
                adminPeerId: assignedPeerId,
                adminPublicKeyJwk: data.publicKeyJwk,
                adminFingerprint: data.fingerprint,
              });
            }
          }

          broadcastPeerList();
          return;
        }

        const senderNode = activeConnections.get(ws);
        const senderPeerId = senderNode?.peerId || data.fromPeerId;

        // Broadcast ephemeral status updates or group messages to all other connected peers
        if (data.type === 'status:broadcast' || data.type === 'e2ee:group-packet') {
          const outbound = JSON.stringify({
            ...data,
            fromPeerId: senderPeerId,
            relayedAt: Date.now(),
          });
          for (const [otherWs, peer] of activeConnections.entries()) {
            if (otherWs !== ws && peer.ws.readyState === WebSocket.OPEN) {
              peer.ws.send(outbound);
            }
          }
          return;
        }

        // Pure WebRTC Signaling Relay (Offer, Answer, ICE Candidate, ICE Complete, ICE Restart) + E2EE Packet Relay + Call Signaling
        if (
          (data.type === 'webrtc:offer' ||
            data.type === 'webrtc:answer' ||
            data.type === 'webrtc:ice-candidate' ||
            data.type === 'webrtc:ice-complete' ||
            data.type === 'webrtc:ice-restart' ||
            data.type === 'webrtc:key-exchange' ||
            data.type === 'webrtc:disconnect-notify' ||
            data.type === 'e2ee:packet' ||
            data.type === 'e2ee:ack' ||
            data.type === 'call:invite' ||
            data.type === 'call:accept' ||
            data.type === 'call:reject' ||
            data.type === 'call:hangup' ||
            data.type === 'call:webrtc-offer' ||
            data.type === 'call:webrtc-answer' ||
            data.type === 'call:webrtc-ice' ||
            data.type === 'call:media-frame') &&
          data.targetPeerId
        ) {
          const targets = findTargetPeers(data.targetPeerId, data.targetNrp, ws);
          const payloadStr = JSON.stringify({
            ...data,
            fromPeerId: senderPeerId,
            relayedAt: Date.now(),
          });
          for (const target of targets) {
            if (target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(payloadStr);
            }
          }
        }
      } catch {
        // Ignore malformed packets to preserve signaling stability
      }
    });

    ws.on('close', () => {
      if (activeConnections.has(ws)) {
        activeConnections.delete(ws);
        broadcastPeerList();
      }
    });

    ws.on('error', () => {
      if (activeConnections.has(ws)) {
        activeConnections.delete(ws);
        broadcastPeerList();
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[SILENT LINK DISKOMLEKAU] Zero-Retention WebRTC Signaling Node listening on port ${PORT}`);
  });
}

startServer();
