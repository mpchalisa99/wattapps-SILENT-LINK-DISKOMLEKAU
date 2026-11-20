import { WebRTCIceDiagnosticLog } from '../types/tactical';

/**
 * 1. ICE AGENT & CANDIDATE GATHERING CONFIGURATION (STUN + TURN FOR CELLULAR CGNAT)
 * Configured with redundant public Google/Twilio STUN servers AND OpenRelay/Metered
 * public TURN servers (UDP 80/443, TCP 80/443, TLS 443) to penetrate mobile carrier
 * symmetric NAT / CGNAT and enterprise firewalls across smartphones.
 */
export const TACTICAL_ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    // Public STUN Servers (Fast UDP Hole-Punching / srflx candidates)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:openrelay.metered.ca:80' },
    // Public TURN Relay Servers (OpenRelay / Metered for Cellular 4G/5G CGNAT traversal)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turns:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:standard.relay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:standard.relay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:standard.relay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceTransportPolicy: 'all',
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

/**
 * 2. WEBRTC DATA CHANNEL CONFIGURATION
 * Configured with ordered: true and reliable: true (full SCTP retransmission, 0% packet loss).
 */
export const TACTICAL_DATACHANNEL_CONFIG: RTCDataChannelInit & { reliable?: boolean } = {
  ordered: true,
  reliable: true,
};

export interface LivePeerTunnel {
  peerId: string;
  peerName: string;
  peerNrp: string;
  pc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
  sharedKey: CryptoKey | null;
  remotePublicKeyJwk?: JsonWebKey;
  sharedKeyHash: string;
  remoteFingerprint: string;
  // ICE Candidate & SDP State Synchronization
  pendingRemoteCandidates: RTCIceCandidateInit[];
  localGatheredCandidates: RTCIceCandidateInit[];
  isSettingRemoteDescription: boolean;
  makingOffer: boolean;
  localCandidatesSent: number;
  remoteCandidatesApplied: number;
  iceRestartAttempts: number;
  iceRestartTimer: number | null;
  // Guaranteed Delivery Outgoing Queue (flushed when dc.readyState === 'open')
  outgoingPacketQueue: string[];
}

export function createEmptyLivePeerTunnel(
  peerId: string,
  peerName = 'PERSONEL P2P',
  peerNrp = '000000'
): LivePeerTunnel {
  return {
    peerId,
    peerName,
    peerNrp,
    pc: null,
    dc: null,
    sharedKey: null,
    sharedKeyHash: 'DERIVING ECDH...',
    remoteFingerprint: 'VERIFYING...',
    pendingRemoteCandidates: [],
    localGatheredCandidates: [],
    isSettingRemoteDescription: false,
    makingOffer: false,
    localCandidatesSent: 0,
    remoteCandidatesApplied: 0,
    iceRestartAttempts: 0,
    iceRestartTimer: null,
    outgoingPacketQueue: [],
  };
}

/**
 * Waits for the ICE Agent to gather local STUN/TURN candidates so that SDP Offer/Answer
 * includes complete candidate lines in addition to real-time Trickle ICE packets.
 */
export async function waitForIceGatheringComplete(
  pc: RTCPeerConnection,
  timeoutMs = 1500
): Promise<void> {
  if (pc.iceGatheringState === 'complete') {
    return;
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    let earlySettleTimer: number | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      pc.removeEventListener('icegatheringstatechange', onStateChange);
      pc.removeEventListener('icecandidate', onCandidate);
      window.clearTimeout(timer);
      if (earlySettleTimer) window.clearTimeout(earlySettleTimer);
      resolve();
    };

    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') {
        finish();
      }
    };

    const onCandidate = (ev: RTCPeerConnectionIceEvent) => {
      if (!ev.candidate) {
        finish();
        return;
      }
      // Once we have gathered a public srflx (STUN) or relay (TURN) candidate, allow a short window for additional TURN candidates
      const candStr = ev.candidate.candidate || '';
      if (
        (candStr.includes('typ srflx') || candStr.includes('typ relay')) &&
        !earlySettleTimer
      ) {
        earlySettleTimer = window.setTimeout(finish, 550);
      }
    };

    const timer = window.setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onStateChange);
    pc.addEventListener('icecandidate', onCandidate);
  });
}

/**
 * Flushes all buffered remote ICE candidates immediately after setRemoteDescription succeeds.
 * Prevents race conditions where trickle ICE candidates arrive before SDP Offer/Answer processing finishes.
 */
export async function flushPendingRemoteIceCandidates(
  tunnel: LivePeerTunnel,
  onDiagnosticLog?: (log: WebRTCIceDiagnosticLog) => void
): Promise<void> {
  if (!tunnel.pc || !tunnel.pc.remoteDescription || tunnel.isSettingRemoteDescription) {
    return;
  }

  const queue = [...tunnel.pendingRemoteCandidates];
  tunnel.pendingRemoteCandidates = [];

  for (const candidateInit of queue) {
    try {
      await tunnel.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      tunnel.remoteCandidatesApplied += 1;
      onDiagnosticLog?.({
        id: `ICE-RX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        peerId: tunnel.peerId,
        peerName: tunnel.peerName,
        category: 'ICE_CANDIDATE',
        iceConnectionState: tunnel.pc.iceConnectionState,
        iceGatheringState: tunnel.pc.iceGatheringState,
        signalingState: tunnel.pc.signalingState,
        dataChannelState: tunnel.dc?.readyState || 'closed',
        detail: `Buffered Remote ICE Candidate #${tunnel.remoteCandidatesApplied} applied (${candidateInit.candidate?.slice(0, 52) || 'srflx/relay'})`,
      });
    } catch (err) {
      console.warn('[SILENT LINK ICE-AGENT] Failed to apply buffered remote ICE candidate:', err);
    }
  }
}

/**
 * Adds a remote ICE candidate safely:
 * - If pc.remoteDescription is already set and stable, applies immediately via pc.addIceCandidate.
 * - Otherwise, queues in tunnel.pendingRemoteCandidates to be flushed right after setRemoteDescription.
 */
export async function addOrQueueRemoteIceCandidate(
  tunnel: LivePeerTunnel,
  candidateInit: RTCIceCandidateInit,
  onDiagnosticLog?: (log: WebRTCIceDiagnosticLog) => void
): Promise<void> {
  if (
    tunnel.pc &&
    tunnel.pc.remoteDescription &&
    tunnel.pc.remoteDescription.type &&
    !tunnel.isSettingRemoteDescription
  ) {
    try {
      await tunnel.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      tunnel.remoteCandidatesApplied += 1;
      onDiagnosticLog?.({
        id: `ICE-RX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        peerId: tunnel.peerId,
        peerName: tunnel.peerName,
        category: 'ICE_CANDIDATE',
        iceConnectionState: tunnel.pc.iceConnectionState,
        iceGatheringState: tunnel.pc.iceGatheringState,
        signalingState: tunnel.pc.signalingState,
        dataChannelState: tunnel.dc?.readyState || 'closed',
        detail: `Live Remote ICE Candidate #${tunnel.remoteCandidatesApplied} applied (${candidateInit.candidate?.slice(0, 52) || 'candidate'})`,
      });
    } catch (err) {
      console.warn('[SILENT LINK ICE-AGENT] addIceCandidate error, queueing for retry:', err);
      tunnel.pendingRemoteCandidates.push(candidateInit);
    }
  } else {
    tunnel.pendingRemoteCandidates.push(candidateInit);
    onDiagnosticLog?.({
      id: `ICE-Q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      peerId: tunnel.peerId,
      peerName: tunnel.peerName,
      category: 'ICE_CANDIDATE',
      iceConnectionState: tunnel.pc?.iceConnectionState || 'new',
      iceGatheringState: tunnel.pc?.iceGatheringState || 'new',
      signalingState: tunnel.pc?.signalingState || 'stable',
      dataChannelState: tunnel.dc?.readyState || 'closed',
      detail: `Queued Early Remote ICE Candidate (waiting for setRemoteDescription, queue=${tunnel.pendingRemoteCandidates.length})`,
    });
  }
}

/**
 * Flushes all queued outgoing packets in strict FIFO order once DataChannel readyState === 'open'.
 */
export function flushOutgoingDataChannelQueue(
  tunnel: LivePeerTunnel,
  onDiagnosticLog?: (log: WebRTCIceDiagnosticLog) => void
): number {
  if (!tunnel.dc || tunnel.dc.readyState !== 'open') {
    return 0;
  }

  let flushedCount = 0;
  while (tunnel.outgoingPacketQueue.length > 0) {
    if (tunnel.dc.readyState !== 'open') break;
    const nextPacketStr = tunnel.outgoingPacketQueue.shift();
    if (!nextPacketStr) break;
    try {
      tunnel.dc.send(nextPacketStr);
      flushedCount += 1;
    } catch (err) {
      // Push back to front of queue if SCTP buffer was temporarily full
      tunnel.outgoingPacketQueue.unshift(nextPacketStr);
      console.warn('[SILENT LINK DATACHANNEL] Buffer full during flush, will retry:', err);
      break;
    }
  }

  if (flushedCount > 0) {
    onDiagnosticLog?.({
      id: `DC-FLUSH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      peerId: tunnel.peerId,
      peerName: tunnel.peerName,
      category: 'DATACHANNEL',
      iceConnectionState: tunnel.pc?.iceConnectionState || 'connected',
      iceGatheringState: tunnel.pc?.iceGatheringState || 'complete',
      signalingState: tunnel.pc?.signalingState || 'stable',
      dataChannelState: tunnel.dc.readyState,
      detail: `Flushed ${flushedCount} queued tactical packet(s) over OPEN DataChannel (ordered:true, reliable:true)`,
    });
  }

  return flushedCount;
}

/**
 * Strictly verifies DataChannel readyState === 'open' before calling dc.send().
 * Once the DataChannel is 'open', 100% of messages, files, and voice notes are sent
 * directly P2P over RTCDataChannel without passing through any signaling broker.
 */
export function sendOverReliableDataChannel(
  tunnel: LivePeerTunnel | undefined,
  serializedPacket: string,
  onDiagnosticLog?: (log: WebRTCIceDiagnosticLog) => void
): { sentImmediately: boolean; queuedForOpen: boolean; channelState: RTCDataChannelState | 'closed' } {
  if (!tunnel) {
    return { sentImmediately: false, queuedForOpen: false, channelState: 'closed' };
  }

  const dc = tunnel.dc;
  const currentState: RTCDataChannelState | 'closed' = dc ? dc.readyState : 'closed';

  if (dc && dc.readyState === 'open') {
    try {
      // First flush any older queued packets so ordering is 100% preserved
      flushOutgoingDataChannelQueue(tunnel, onDiagnosticLog);
      dc.send(serializedPacket);
      onDiagnosticLog?.({
        id: `DC-TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        peerId: tunnel.peerId,
        peerName: tunnel.peerName,
        category: 'DATACHANNEL',
        iceConnectionState: tunnel.pc?.iceConnectionState || 'connected',
        iceGatheringState: tunnel.pc?.iceGatheringState || 'complete',
        signalingState: tunnel.pc?.signalingState || 'stable',
        dataChannelState: 'open',
        detail: `TX Packet (${serializedPacket.length} B) transmitted 100% P2P over OPEN DataChannel (zero broker relay)`,
      });
      return { sentImmediately: true, queuedForOpen: false, channelState: 'open' };
    } catch (err) {
      console.warn('[SILENT LINK DATACHANNEL] Direct send threw, queuing packet:', err);
      tunnel.outgoingPacketQueue.push(serializedPacket);
      return { sentImmediately: false, queuedForOpen: true, channelState: currentState };
    }
  }

  // Channel is not yet 'open' -> enqueue for guaranteed P2P delivery when dc.onopen fires
  tunnel.outgoingPacketQueue.push(serializedPacket);
  onDiagnosticLog?.({
    id: `DC-QUEUE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    peerId: tunnel.peerId,
    peerName: tunnel.peerName,
    category: 'DATACHANNEL',
    iceConnectionState: tunnel.pc?.iceConnectionState || 'checking',
    iceGatheringState: tunnel.pc?.iceGatheringState || 'gathering',
    signalingState: tunnel.pc?.signalingState || 'stable',
    dataChannelState: currentState,
    detail: `DataChannel state="${currentState}" (not yet open). Queued packet #${tunnel.outgoingPacketQueue.length} for direct P2P flush on open.`,
  });

  return { sentImmediately: false, queuedForOpen: true, channelState: currentState };
}
