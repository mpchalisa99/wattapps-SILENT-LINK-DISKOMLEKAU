import { Peer, DataConnection } from 'peerjs';
import { ProvisionedOperativeCredential } from '../types/tactical';
import { TACTICAL_ICE_CONFIG } from './webrtcPeerEngine';

/**
 * CROSS-DEVICE SERVERLESS SIGNALING ENGINE (MQTT OVER WSS + PEERJS CLOUD)
 * Designed for static/serverless Vercel deployments (https://wattapps-silent-link-diskomlekau.vercel.app)
 * where no local WebSocket backend exists.
 *
 * Transports:
 * 1. Public MQTT over WSS (wss://broker.emqx.io:8084/mqtt & wss://broker.hivemq.com:8884/mqtt)
 * 2. PeerJS Cloud Signaling (0.peerjs.com over WSS with STUN/TURN configuration)
 * 3. Optional Local /ws-signal (when running inside local dev server)
 *
 * Strictly used ONLY for temporary signaling (SDP Offer, SDP Answer, ICE Candidates, and Node Discovery).
 * Once RTCDataChannel is 'open', 100% of chat messages, files, and voice notes route directly P2P.
 */

const MQTT_BROKERS = [
  { name: 'EMQX-WSS', url: 'wss://broker.emqx.io:8084/mqtt' },
  { name: 'HIVEMQ-WSS', url: 'wss://broker.hivemq.com:8884/mqtt' },
];

const TOPIC_PREFIX = 'silentlink/diskomlekau/v3';
const TOPIC_BROADCAST = `${TOPIC_PREFIX}/broadcast`;
const TOPIC_PEER_WILDCARD = `${TOPIC_PREFIX}/peer/+`;
const TOPIC_NRP_WILDCARD = `${TOPIC_PREFIX}/nrp/+`;
const TOPIC_INVITE_WILDCARD = `${TOPIC_PREFIX}/invite/+`;

// In-memory cache of retained invites received from MQTT broker
const remoteBrokerInviteCache = new Map<string, ProvisionedOperativeCredential>();

export function getCachedBrokerInvite(inviteId: string): ProvisionedOperativeCredential | undefined {
  return remoteBrokerInviteCache.get(inviteId.trim().toUpperCase());
}

function sanitizePeerJsId(rawId: string): string {
  const clean = rawId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '-');
  return `SLK-V3-${clean}`;
}

function encodeMqttRemainingLength(length: number): number[] {
  const bytes: number[] = [];
  let rem = length;
  do {
    let encodedByte = rem % 128;
    rem = Math.floor(rem / 128);
    if (rem > 0) {
      encodedByte = encodedByte | 128;
    }
    bytes.push(encodedByte);
  } while (rem > 0);
  return bytes;
}

function decodeMqttRemainingLength(
  data: Uint8Array,
  offset: number
): { value: number; bytesUsed: number } | null {
  let multiplier = 1;
  let value = 0;
  let bytesUsed = 0;
  let encodedByte = 0;

  do {
    if (offset + bytesUsed >= data.length) {
      return null;
    }
    encodedByte = data[offset + bytesUsed];
    value += (encodedByte & 127) * multiplier;
    multiplier *= 128;
    bytesUsed += 1;
    if (multiplier > 128 * 128 * 128) {
      return null;
    }
  } while ((encodedByte & 128) !== 0);

  return { value, bytesUsed };
}

function encodeMqttUtf8(str: string): Uint8Array {
  const utf8 = new TextEncoder().encode(str);
  const out = new Uint8Array(2 + utf8.length);
  out[0] = (utf8.length >> 8) & 0xff;
  out[1] = utf8.length & 0xff;
  out.set(utf8, 2);
  return out;
}

function buildMqttConnectPacket(clientId: string, keepAliveSec = 25): Uint8Array {
  const protoName = encodeMqttUtf8('MQTT');
  const protoLevel = 4; // MQTT v3.1.1
  const connectFlags = 0x02; // Clean Session
  const keepAliveHi = (keepAliveSec >> 8) & 0xff;
  const keepAliveLo = keepAliveSec & 0xff;
  const clientIdBytes = encodeMqttUtf8(clientId);

  const bodyLen = protoName.length + 4 + clientIdBytes.length;
  const remLenBytes = encodeMqttRemainingLength(bodyLen);

  const packet = new Uint8Array(1 + remLenBytes.length + bodyLen);
  let idx = 0;
  packet[idx++] = 0x10; // CONNECT
  for (const b of remLenBytes) packet[idx++] = b;
  packet.set(protoName, idx);
  idx += protoName.length;
  packet[idx++] = protoLevel;
  packet[idx++] = connectFlags;
  packet[idx++] = keepAliveHi;
  packet[idx++] = keepAliveLo;
  packet.set(clientIdBytes, idx);
  return packet;
}

function buildMqttSubscribePacket(packetId: number, topics: string[]): Uint8Array {
  const topicChunks: Uint8Array[] = [];
  let payloadLen = 2; // packetId
  for (const t of topics) {
    const encodedTopic = encodeMqttUtf8(t);
    topicChunks.push(encodedTopic);
    payloadLen += encodedTopic.length + 1; // +1 for QoS byte
  }

  const remLenBytes = encodeMqttRemainingLength(payloadLen);
  const packet = new Uint8Array(1 + remLenBytes.length + payloadLen);
  let idx = 0;
  packet[idx++] = 0x82; // SUBSCRIBE (QoS 1 required by spec)
  for (const b of remLenBytes) packet[idx++] = b;
  packet[idx++] = (packetId >> 8) & 0xff;
  packet[idx++] = packetId & 0xff;

  for (const tc of topicChunks) {
    packet.set(tc, idx);
    idx += tc.length;
    packet[idx++] = 0x00; // Requested QoS 0
  }
  return packet;
}

function buildMqttPublishPacket(topic: string, payloadStr: string, retain = false): Uint8Array {
  const topicBytes = encodeMqttUtf8(topic);
  const payloadBytes = new TextEncoder().encode(payloadStr);
  const bodyLen = topicBytes.length + payloadBytes.length;
  const remLenBytes = encodeMqttRemainingLength(bodyLen);

  const packet = new Uint8Array(1 + remLenBytes.length + bodyLen);
  let idx = 0;
  packet[idx++] = retain ? 0x31 : 0x30; // PUBLISH QoS 0 + optional RETAIN flag
  for (const b of remLenBytes) packet[idx++] = b;
  packet.set(topicBytes, idx);
  idx += topicBytes.length;
  packet.set(payloadBytes, idx);
  return packet;
}

const MQTT_PINGREQ_PACKET = new Uint8Array([0xc0, 0x00]);

/**
 * Lightweight browser-native MQTT v3.1.1 over WSS connection
 */
class BrowserMqttWssConnection {
  public readonly name: string;
  private readonly url: string;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private isClosedByUser = false;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private packetIdSeq = 1;
  private onMessageCallback: (topic: string, payloadStr: string) => void;
  private onStateChangeCallback: () => void;

  constructor(
    name: string,
    url: string,
    onMessage: (topic: string, payloadStr: string) => void,
    onStateChange: () => void
  ) {
    this.name = name;
    this.url = url;
    this.onMessageCallback = onMessage;
    this.onStateChangeCallback = onStateChange;
    this.connect();
  }

  public get connected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    if (this.isClosedByUser) return;
    try {
      const ws = new WebSocket(this.url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        if (this.isClosedByUser) {
          ws.close();
          return;
        }
        const clientId = `slk_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36).slice(-4)}`;
        const connectPkt = buildMqttConnectPacket(clientId, 25);
        ws.send(connectPkt as unknown as BufferSource);
      };

      ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return;
        const incoming = new Uint8Array(ev.data);
        const merged = new Uint8Array(this.rxBuffer.length + incoming.length);
        merged.set(this.rxBuffer, 0);
        merged.set(incoming, this.rxBuffer.length);
        this.rxBuffer = merged;
        this.parseFrames();
      };

      ws.onerror = () => {
        // Handled in onclose
      };

      ws.onclose = () => {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        this.stopPing();
        if (wasConnected) {
          this.onStateChangeCallback();
        }
        if (!this.isClosedByUser) {
          this.reconnectTimer = window.setTimeout(() => this.connect(), 2500);
        }
      };
    } catch {
      if (!this.isClosedByUser) {
        this.reconnectTimer = window.setTimeout(() => this.connect(), 3000);
      }
    }
  }

  private parseFrames(): void {
    while (this.rxBuffer.length >= 2) {
      const headerByte = this.rxBuffer[0];
      const packetType = (headerByte >> 4) & 0x0f;
      const remInfo = decodeMqttRemainingLength(this.rxBuffer, 1);
      if (!remInfo) break; // Wait for more bytes

      const totalFrameLen = 1 + remInfo.bytesUsed + remInfo.value;
      if (this.rxBuffer.length < totalFrameLen) break; // Incomplete frame

      const bodyStart = 1 + remInfo.bytesUsed;
      const body = this.rxBuffer.subarray(bodyStart, totalFrameLen);
      this.rxBuffer = this.rxBuffer.subarray(totalFrameLen);

      if (packetType === 2) {
        // CONNACK
        const returnCode = body.length >= 2 ? body[1] : 255;
        if (returnCode === 0) {
          this.isConnected = true;
          this.subscribeDefaultTopics();
          this.startPing();
          this.onStateChangeCallback();
        }
      } else if (packetType === 3) {
        // PUBLISH
        if (body.length < 2) continue;
        const topicLen = (body[0] << 8) | body[1];
        if (body.length < 2 + topicLen) continue;
        const topic = new TextDecoder().decode(body.subarray(2, 2 + topicLen));
        const qos = (headerByte >> 1) & 0x03;
        const payloadOffset = 2 + topicLen + (qos > 0 ? 2 : 0);
        if (body.length < payloadOffset) continue;
        const payloadStr = new TextDecoder().decode(body.subarray(payloadOffset));
        this.onMessageCallback(topic, payloadStr);
      }
    }
  }

  private subscribeDefaultTopics(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const subPkt = buildMqttSubscribePacket(this.packetIdSeq++, [
      TOPIC_BROADCAST,
      TOPIC_PEER_WILDCARD,
      TOPIC_NRP_WILDCARD,
      TOPIC_INVITE_WILDCARD,
    ]);
    try {
      this.ws.send(subPkt as unknown as BufferSource);
    } catch {
      // Ignore
    }
  }

  public publish(topic: string, payloadStr: string, retain = false): boolean {
    if (!this.connected || !this.ws) return false;
    try {
      const pkt = buildMqttPublishPacket(topic, payloadStr, retain);
      this.ws.send(pkt as unknown as BufferSource);
      return true;
    } catch {
      return false;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      if (this.connected && this.ws) {
        try {
          this.ws.send(MQTT_PINGREQ_PACKET as unknown as BufferSource);
        } catch {
          // Ignore
        }
      }
    }, 18000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  public close(): void {
    this.isClosedByUser = true;
    this.stopPing();
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      // Ignore
    }
    this.ws = null;
    this.isConnected = false;
  }
}

export interface RemoteNodeDirectoryEntry {
  peerId: string;
  callsign: string;
  nrp: string;
  unit: string;
  rank: string;
  role?: string;
  publicKeyJwk?: JsonWebKey;
  fingerprint?: string;
  lastSeen: number;
}

/**
 * WebSocket-compatible Cross-Device Signaling Bus combining MQTT over WSS + PeerJS Cloud + optional local WS
 */
export class TacticalCrossDeviceSignalingSocket {
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;

  private mqttBrokers: BrowserMqttWssConnection[] = [];
  private peerJsInstance: Peer | null = null;
  private peerJsConnections = new Map<string, DataConnection>();
  private currentPeerJsId = '';
  private localWs: WebSocket | null = null;

  private localNodeMeta: RemoteNodeDirectoryEntry | null = null;
  private discoveredPeers = new Map<string, RemoteNodeDirectoryEntry>();
  private processedSignalNonces = new Set<string>();
  private outgoingSignalQueue: string[] = [];
  private wasOpen = false;
  private isDestroyed = false;
  private presenceTimer: number | null = null;

  constructor() {
    this.initTransports();
  }

  public get readyState(): number {
    const mqttUp = this.mqttBrokers.some((b) => b.connected);
    const peerJsUp = Boolean(this.peerJsInstance && !this.peerJsInstance.destroyed && !this.peerJsInstance.disconnected);
    const localWsUp = this.localWs?.readyState === WebSocket.OPEN;
    return mqttUp || peerJsUp || localWsUp ? WebSocket.OPEN : WebSocket.CONNECTING;
  }

  public getActiveTransportLabels(): string[] {
    const labels: string[] = [];
    for (const b of this.mqttBrokers) {
      if (b.connected) labels.push(b.name);
    }
    if (this.peerJsInstance && !this.peerJsInstance.destroyed && !this.peerJsInstance.disconnected) {
      labels.push('PEERJS');
    }
    if (this.localWs?.readyState === WebSocket.OPEN) {
      labels.push('LOCAL-WS');
    }
    return labels;
  }

  private initTransports(): void {
    // 1. Connect to Public MQTT over WSS Brokers (Primary Cross-Device Signaling for Vercel)
    for (const brokerCfg of MQTT_BROKERS) {
      const conn = new BrowserMqttWssConnection(
        brokerCfg.name,
        brokerCfg.url,
        (topic, payloadStr) => this.handleIncomingMqttMessage(topic, payloadStr),
        () => this.evaluateConnectionState()
      );
      this.mqttBrokers.push(conn);
    }

    // 2. Connect to Local /ws-signal ONLY if not on .vercel.app (for AI Studio preview environment)
    if (
      typeof window !== 'undefined' &&
      !window.location.hostname.endsWith('.vercel.app')
    ) {
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${window.location.host}/ws-signal`);
        this.localWs = ws;
        ws.onopen = () => this.evaluateConnectionState();
        ws.onclose = () => this.evaluateConnectionState();
        ws.onerror = () => {};
        ws.onmessage = (ev) => {
          if (typeof ev.data === 'string') {
            this.handleRawIncomingSignalJson(ev.data, 'LOCAL-WS');
          }
        };
      } catch {
        // Ignore if local ws unavailable
      }
    }

    // Periodic re-announcement so newly joined mobile peers on cellular networks stay synchronized
    this.presenceTimer = window.setInterval(() => {
      if (this.localNodeMeta && this.readyState === WebSocket.OPEN) {
        this.publishMqttPacket(TOPIC_BROADCAST, {
          type: 'node:announce',
          fromPeerId: this.localNodeMeta.peerId,
          node: this.localNodeMeta,
        });
      }
    }, 12000);
  }

  private ensurePeerJsInitialized(peerId: string): void {
    if (!peerId || this.isDestroyed) return;
    const targetPeerJsId = sanitizePeerJsId(peerId);
    if (this.currentPeerJsId === targetPeerJsId && this.peerJsInstance && !this.peerJsInstance.destroyed) {
      return;
    }

    if (this.peerJsInstance) {
      try {
        this.peerJsInstance.destroy();
      } catch {
        // Ignore
      }
      this.peerJsInstance = null;
    }

    this.currentPeerJsId = targetPeerJsId;
    try {
      const peer = new Peer(targetPeerJsId, {
        secure: true,
        config: TACTICAL_ICE_CONFIG,
      });
      this.peerJsInstance = peer;

      peer.on('open', () => {
        this.evaluateConnectionState();
      });

      peer.on('connection', (conn) => {
        this.setupPeerJsDataConnection(conn);
      });

      peer.on('disconnected', () => {
        if (!this.isDestroyed && !peer.destroyed) {
          try {
            peer.reconnect();
          } catch {
            // Ignore
          }
        }
        this.evaluateConnectionState();
      });

      peer.on('error', () => {
        // If ID already taken on PeerJS cloud, MQTT WSS still handles 100% of signaling seamlessly
      });
    } catch {
      // Fallback to MQTT WSS
    }
  }

  private setupPeerJsDataConnection(conn: DataConnection): void {
    conn.on('open', () => {
      this.peerJsConnections.set(conn.peer, conn);
      // Exchange our node presence immediately over PeerJS connection
      if (this.localNodeMeta) {
        try {
          conn.send(
            JSON.stringify({
              _sigId: `SIG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              type: 'node:announce',
              fromPeerId: this.localNodeMeta.peerId,
              node: this.localNodeMeta,
            })
          );
        } catch {
          // Ignore
        }
      }
    });

    conn.on('data', (data) => {
      if (typeof data === 'string') {
        this.handleRawIncomingSignalJson(data, 'PEERJS');
      } else if (data && typeof data === 'object') {
        this.handleRawIncomingSignalJson(JSON.stringify(data), 'PEERJS');
      }
    });

    conn.on('close', () => {
      this.peerJsConnections.delete(conn.peer);
    });
  }

  private sendViaPeerJs(targetPeerId: string, jsonPayload: string): void {
    if (!this.peerJsInstance || this.peerJsInstance.destroyed || !targetPeerId) return;
    const remotePeerJsId = sanitizePeerJsId(targetPeerId);
    if (remotePeerJsId === this.currentPeerJsId) return;

    const existing = this.peerJsConnections.get(remotePeerJsId);
    if (existing && existing.open) {
      try {
        existing.send(jsonPayload);
        return;
      } catch {
        // Reconnect below
      }
    }

    try {
      const conn = this.peerJsInstance.connect(remotePeerJsId, {
        reliable: true,
      });
      this.setupPeerJsDataConnection(conn);
      conn.on('open', () => {
        try {
          conn.send(jsonPayload);
        } catch {
          // Ignore
        }
      });
    } catch {
      // Ignore PeerJS dial error (MQTT WSS handles primary delivery)
    }
  }

  private evaluateConnectionState(): void {
    const isNowOpen = this.readyState === WebSocket.OPEN;
    if (isNowOpen && !this.wasOpen) {
      this.wasOpen = true;
      this.flushOutgoingQueue();
      this.onopen?.();
    } else if (!isNowOpen && this.wasOpen) {
      this.wasOpen = false;
      this.onclose?.();
    } else if (isNowOpen) {
      this.flushOutgoingQueue();
    }
  }

  private flushOutgoingQueue(): void {
    if (this.readyState !== WebSocket.OPEN) return;
    while (this.outgoingSignalQueue.length > 0) {
      const next = this.outgoingSignalQueue.shift();
      if (next) {
        this.dispatchSignalJson(next);
      }
    }
  }

  private publishMqttPacket(topic: string, obj: Record<string, unknown>, retain = false): void {
    const enriched = {
      _sigId:
        (obj._sigId as string) ||
        `SIG-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      ...obj,
    };
    const serialized = JSON.stringify(enriched);
    for (const broker of this.mqttBrokers) {
      if (broker.connected) {
        broker.publish(topic, serialized, retain);
      }
    }
  }

  /**
   * Publishes an Admin-provisioned Operative Credential to a retained MQTT topic
   * so any client smartphone scanning ?join=SLK-ID-... can retrieve the Admin's live Public Key & Peer ID.
   */
  public publishRetainedInvite(cred: ProvisionedOperativeCredential): void {
    const cleanId = cred.assignedPeerId.trim().toUpperCase();
    remoteBrokerInviteCache.set(cleanId, cred);
    this.publishMqttPacket(
      `${TOPIC_PREFIX}/invite/${cleanId}`,
      {
        type: 'invite:retained',
        inviteId: cleanId,
        credential: cred,
      },
      true
    );
  }

  public send(rawJsonString: string): void {
    if (this.readyState !== WebSocket.OPEN) {
      this.outgoingSignalQueue.push(rawJsonString);
      return;
    }
    this.dispatchSignalJson(rawJsonString);
  }

  private dispatchSignalJson(rawJsonString: string): void {
    try {
      const parsed = JSON.parse(rawJsonString);
      const sigId =
        parsed._sigId ||
        `SIG-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const myPeerId = this.localNodeMeta?.peerId || parsed.peerId || parsed.fromPeerId || '';
      const myNrp = this.localNodeMeta?.nrp || parsed.nrp || parsed.fromNrp || '';

      const outgoingObj = {
        ...parsed,
        _sigId: sigId,
        fromPeerId: parsed.fromPeerId || myPeerId,
        fromNrp: parsed.fromNrp || myNrp,
      };
      const serialized = JSON.stringify(outgoingObj);

      // Forward to local dev WS if connected
      if (this.localWs && this.localWs.readyState === WebSocket.OPEN) {
        try {
          this.localWs.send(rawJsonString);
        } catch {
          // Ignore
        }
      }

      // Handle node:register -> update local identity, initialize PeerJS ID, broadcast presence & discover peers
      if (parsed.type === 'node:register' && parsed.peerId) {
        this.localNodeMeta = {
          peerId: String(parsed.peerId),
          callsign: String(parsed.callsign || 'PERSONEL'),
          nrp: String(parsed.nrp || '000000'),
          unit: String(parsed.unit || 'DISKOMLEKAU'),
          rank: String(parsed.rank || 'Personel Aktif'),
          role: String(parsed.role || 'OPERATIVE'),
          publicKeyJwk: parsed.publicKeyJwk,
          fingerprint: parsed.fingerprint,
          lastSeen: Date.now(),
        };

        this.ensurePeerJsInitialized(this.localNodeMeta.peerId);

        // Broadcast our registration + discovery request to all nodes on MQTT WSS
        this.publishMqttPacket(TOPIC_BROADCAST, {
          ...outgoingObj,
          type: 'node:register',
          requestReply: true,
          node: this.localNodeMeta,
        });
        return;
      }

      if (parsed.type === 'node:ping') {
        if (this.localNodeMeta) {
          this.publishMqttPacket(TOPIC_BROADCAST, {
            type: 'node:announce',
            fromPeerId: this.localNodeMeta.peerId,
            node: this.localNodeMeta,
          });
        }
        return;
      }

      // Targeted peer message (webrtc:offer, webrtc:answer, webrtc:ice-candidate, call:*, etc.)
      if (parsed.targetPeerId) {
        const targetId = String(parsed.targetPeerId).trim();
        this.publishMqttPacket(`${TOPIC_PREFIX}/peer/${targetId}`, outgoingObj);
        this.sendViaPeerJs(targetId, serialized);
      }

      // Also publish to targetNrp topic if provided so Admin/Operative matches by NRP even if ID suffix differs
      if (parsed.targetNrp) {
        const targetNrp = String(parsed.targetNrp).trim();
        this.publishMqttPacket(`${TOPIC_PREFIX}/nrp/${targetNrp}`, outgoingObj);
      }

      // Broadcast packets (status:broadcast, e2ee:group-packet, etc.)
      if (!parsed.targetPeerId && !parsed.targetNrp) {
        this.publishMqttPacket(TOPIC_BROADCAST, outgoingObj);
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  private handleIncomingMqttMessage(topic: string, payloadStr: string): void {
    // Check if it's a retained invite credential topic
    if (topic.startsWith(`${TOPIC_PREFIX}/invite/`)) {
      try {
        const data = JSON.parse(payloadStr);
        if (data && data.inviteId && data.credential) {
          remoteBrokerInviteCache.set(
            String(data.inviteId).toUpperCase(),
            data.credential as ProvisionedOperativeCredential
          );
        }
      } catch {
        // Ignore
      }
      return;
    }

    this.handleRawIncomingSignalJson(payloadStr, 'MQTT-WSS');
  }

  private handleRawIncomingSignalJson(rawJson: string, source: string): void {
    try {
      const msg = JSON.parse(rawJson);
      if (!msg || typeof msg !== 'object') return;

      // Deduplicate packets received across redundant MQTT brokers + PeerJS
      if (msg._sigId) {
        if (this.processedSignalNonces.has(msg._sigId)) {
          return;
        }
        this.processedSignalNonces.add(msg._sigId);
        if (this.processedSignalNonces.size > 1500) {
          const first = this.processedSignalNonces.values().next().value;
          if (first) this.processedSignalNonces.delete(first);
        }
      }

      const myPeerId = this.localNodeMeta?.peerId;
      const myNrp = this.localNodeMeta?.nrp;

      // Ignore our own echoed packets from MQTT broadcast
      if (myPeerId && msg.fromPeerId === myPeerId && source !== 'LOCAL-WS') {
        return;
      }

      // Check if targeted message is meant for us (by targetPeerId or targetNrp)
      if (msg.targetPeerId && myPeerId && msg.targetPeerId !== myPeerId) {
        const matchesMyNrp = Boolean(msg.targetNrp && myNrp && msg.targetNrp === myNrp);
        if (!matchesMyNrp) {
          return;
        }
      }

      // Handle Serverless Peer Discovery (node:register & node:announce)
      if (
        (msg.type === 'node:register' || msg.type === 'node:announce') &&
        (msg.node || msg.peerId)
      ) {
        const remoteNode: RemoteNodeDirectoryEntry = msg.node || {
          peerId: String(msg.peerId || msg.fromPeerId),
          callsign: String(msg.callsign || 'PERSONEL'),
          nrp: String(msg.nrp || '000000'),
          unit: String(msg.unit || 'DISKOMLEKAU'),
          rank: String(msg.rank || 'Personel Aktif'),
          role: String(msg.role || 'OPERATIVE'),
          publicKeyJwk: msg.publicKeyJwk,
          fingerprint: msg.fingerprint,
          lastSeen: Date.now(),
        };

        if (remoteNode.peerId && remoteNode.peerId !== myPeerId) {
          this.discoveredPeers.set(remoteNode.peerId, {
            ...remoteNode,
            lastSeen: Date.now(),
          });

          // If the remote node just registered and requested a reply, unicast our node:announce back to them immediately
          if (msg.type === 'node:register' && msg.requestReply && this.localNodeMeta) {
            const replyPacket = {
              _sigId: `SIG-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              type: 'node:announce',
              fromPeerId: this.localNodeMeta.peerId,
              targetPeerId: remoteNode.peerId,
              node: this.localNodeMeta,
            };
            this.publishMqttPacket(
              `${TOPIC_PREFIX}/peer/${remoteNode.peerId}`,
              replyPacket
            );
            this.sendViaPeerJs(remoteNode.peerId, JSON.stringify(replyPacket));
          }

          // Emit synthesized directory:sync event to App.tsx so ECDH key derivation & WebRTC auto-dial trigger immediately
          this.emitSyntheticDirectorySync();
        }
        return;
      }

      // If an incoming WebRTC Offer carries sender metadata, also register them in discoveredPeers so contact list stays synced
      if (msg.type === 'webrtc:offer' && msg.fromPeerId && msg.publicKeyJwk) {
        const existing = this.discoveredPeers.get(msg.fromPeerId);
        this.discoveredPeers.set(msg.fromPeerId, {
          peerId: msg.fromPeerId,
          callsign: msg.fromCallsign || existing?.callsign || `PERSONEL ${msg.fromNrp || ''}`,
          nrp: msg.fromNrp || existing?.nrp || msg.fromPeerId.split('-')[2] || '000000',
          unit: msg.fromUnit || existing?.unit || 'SATKOM DISKOMLEKAU',
          rank: msg.fromRank || existing?.rank || 'Personel Aktif',
          publicKeyJwk: msg.publicKeyJwk,
          lastSeen: Date.now(),
        });
        this.emitSyntheticDirectorySync();
      }

      // Forward signaling message to App.tsx onmessage handler
      this.onmessage?.({ data: JSON.stringify(msg) });
    } catch {
      // Ignore malformed signaling payload
    }
  }

  private emitSyntheticDirectorySync(): void {
    const peersArray = Array.from(this.discoveredPeers.values());
    this.onmessage?.({
      data: JSON.stringify({
        type: 'directory:sync',
        peers: peersArray,
      }),
    });
  }

  public close(): void {
    this.isDestroyed = true;
    if (this.presenceTimer) {
      window.clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    for (const b of this.mqttBrokers) {
      b.close();
    }
    this.mqttBrokers = [];
    this.peerJsConnections.forEach((c) => {
      try {
        c.close();
      } catch {
        // Ignore
      }
    });
    this.peerJsConnections.clear();
    if (this.peerJsInstance) {
      try {
        this.peerJsInstance.destroy();
      } catch {
        // Ignore
      }
      this.peerJsInstance = null;
    }
    try {
      this.localWs?.close();
    } catch {
      // Ignore
    }
    this.localWs = null;
  }
}
