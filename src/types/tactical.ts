export type DeviceRole = 'ADMIN' | 'OPERATIVE';

export type ConnectionState = 'DISCONNECTED' | 'HANDSHAKING' | 'CONNECTED' | 'DEGRADED';

export type MessageStatus = 'ENCRYPTING' | 'SENT' | 'DELIVERED' | 'VERIFIED';

export type MessageKind = 'text' | 'image' | 'document' | 'voice' | 'system';

export type PeerMode = 'loopback-webrtc' | 'live-peer';

export interface ProvisionedOperativeCredential {
  credentialId: string;
  personnelName: string;
  nrp: string;
  unit: string;
  rank: string;
  assignedPeerId: string;
  adminPeerId: string;
  adminCallsign: string;
  adminPublicKeyJwk: JsonWebKey;
  adminSigningPublicKeyJwk: JsonWebKey;
  adminFingerprint: string;
  issuedAt: number;
  signatureHex: string;
  encryptedToken: string;
  deepLinkUrl: string;
}

export interface TacticalContact {
  peerId: string;
  personnelName: string;
  nrp: string;
  callsign: string;
  unit: string;
  rank: string;
  frequency: string;
  sector: string;
  mode: PeerMode;
  isGroup?: boolean;
  avatarColor?: string;
  connectionState: ConnectionState;
  iceState: RTCIceConnectionState | 'new';
  dataChannelState: RTCDataChannelState | 'closed';
  remoteFingerprint: string;
  sharedKeyHash: string;
  latencyMs: number;
  unreadCount: number;
  lastMessagePreview: string;
  lastActivityTime: number;
  provisionedByAdmin: boolean;
  autoResponderProfile?: string;
}

export interface FileAttachmentMeta {
  fileName: string;
  fileSize: number;
  mimeType: string;
  dataUrl: string;
  chunkCount: number;
}

export interface VoiceNoteMeta {
  durationSec: number;
  mimeType: string;
  audioDataUrl: string;
  byteSize: number;
  waveform: number[];
}

export interface EncryptedMessage {
  id: string;
  contactPeerId: string;
  senderPeerId: string;
  senderCallsign: string;
  senderNrp: string;
  timestamp: number;
  kind: MessageKind;
  plaintext: string;
  ciphertextPreview: string;
  ivHex: string;
  sha256Hash: string;
  byteLength: number;
  status: MessageStatus;
  transport: string;
  fileMeta?: FileAttachmentMeta;
  voiceMeta?: VoiceNoteMeta;
}

export interface CryptoPacketLog {
  id: string;
  timestamp: number;
  direction: 'TX' | 'RX' | 'KEY_EXCHANGE' | 'PROVISION';
  peerCallsign: string;
  cipherSuite: string;
  ivHex: string;
  sha256Short: string;
  bytes: number;
  transport: string;
}

export interface LocalNodeIdentity {
  peerId: string;
  role: DeviceRole;
  personnelName: string;
  nrp: string;
  callsign: string;
  unit: string;
  rank: string;
  publicKeyJwk: JsonWebKey | null;
  privateKey: CryptoKey | null;
  signingPublicKeyJwk: JsonWebKey | null;
  signingPrivateKey: CryptoKey | null;
  fingerprint: string;
  sessionStartedAt: number;
  authorizedByAdminFingerprint?: string;
}

export interface WebRTCIceDiagnosticLog {
  id: string;
  timestamp: number;
  peerId: string;
  peerName: string;
  category: 'ICE_STATE' | 'ICE_CANDIDATE' | 'SDP_HANDSHAKE' | 'DATACHANNEL' | 'ICE_RESTART';
  iceConnectionState: RTCIceConnectionState | 'new';
  iceGatheringState: RTCIceGatheringState | 'new';
  signalingState: RTCSignalingState | 'stable';
  dataChannelState: RTCDataChannelState | 'closed';
  detail: string;
}

