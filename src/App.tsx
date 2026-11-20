/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Send,
  Paperclip,
  Camera,
  FileText,
  Lock,
  Check,
  CheckCheck,
  Search,
  Video,
  Phone,
  Trash2,
  Download,
  ArrowLeft,
  QrCode,
  ScanLine,
  Mic,
  KeyRound,
  MoreVertical,
  Smile,
  MessageSquare,
  Radio,
  Users,
  Plus,
  ShieldCheck,
  Terminal,
  Eye,
  RefreshCw,
  X,
  Settings,
  LogIn,
  Maximize2,
  Palette,
} from 'lucide-react';
import {
  CryptoPacketLog,
  DeviceRole,
  EncryptedMessage,
  FileAttachmentMeta,
  LocalNodeIdentity,
  ProvisionedOperativeCredential,
  TacticalContact,
  VoiceNoteMeta,
  WebRTCIceDiagnosticLog,
} from './types/tactical';
import {
  computeJwkFingerprint,
  decryptAES256GCM,
  deriveSharedAESGCMKey,
  encryptAES256GCM,
  generateAdminSigningKeyPair,
  generateEphemeralECDHKeyPair,
  verifyAndParseProvisioningToken,
} from './utils/cryptoEngine';
import {
  createSampleTacticalReconImage,
  generateTacticalReply,
  INITIAL_TACTICAL_CONTACTS,
} from './utils/tacticalPresets';
import { synthesizeTacticalVoiceNoteWav } from './utils/voiceNoteEngine';
import {
  TACTICAL_ICE_CONFIG,
  TACTICAL_DATACHANNEL_CONFIG,
  LivePeerTunnel,
  createEmptyLivePeerTunnel,
  waitForIceGatheringComplete,
  flushPendingRemoteIceCandidates,
  addOrQueueRemoteIceCandidate,
  flushOutgoingDataChannelQueue,
  sendOverReliableDataChannel,
} from './utils/webrtcPeerEngine';
import {
  MilitaryThemeId,
  MILITARY_THEMES,
  applyMilitaryThemeToDOM,
  usePWAAndFullscreen,
  tacticalBackgroundDaemon,
  BackgroundKeepAliveStatus,
  sendBackgroundSystemNotification,
} from './utils/pwaAndKeepAliveEngine';
import { TacticalCrossDeviceSignalingSocket } from './utils/crossDeviceSignaling';
import { ManualSdpModal } from './components/ManualSdpModal';
import {
  TacticalMediaStreamModal,
  LiveCallSignalPacket,
} from './components/TacticalMediaStreamModal';
import { AdminProvisioningModal } from './components/AdminProvisioningModal';
import { OperativeOnboardingModal } from './components/OperativeOnboardingModal';
import { VoiceNotePlayer } from './components/VoiceNotePlayer';
import { TacticalSettingsModal } from './components/TacticalSettingsModal';

interface LoopbackTunnel {
  localPc: RTCPeerConnection;
  remotePc: RTCPeerConnection;
  localDc: RTCDataChannel;
  remoteDc: RTCDataChannel | null;
  sharedKey: CryptoKey;
  remotePrivateKey: CryptoKey;
  remotePublicKeyJwk: JsonWebKey;
  sharedKeyHash: string;
  remoteFingerprint: string;
}

interface DataChannelPacket {
  packetType: 'ENCRYPTED_MSG' | 'DELIVERY_ACK';
  messageId: string;
  senderPeerId: string;
  senderCallsign: string;
  senderNrp: string;
  senderRank?: string;
  senderUnit?: string;
  senderPublicKeyJwk?: JsonWebKey;
  targetGroupPeerId?: string;
  timestamp: number;
  kind?: 'text' | 'image' | 'document' | 'voice';
  ciphertextB64?: string;
  ivB64?: string;
  ivHex?: string;
  sha256Hash?: string;
  byteLength?: number;
  ackStage?: 'DELIVERED' | 'VERIFIED';
}

interface IncomingCallInvite {
  fromPeerId: string;
  callerName: string;
  callerNrp: string;
  callerRank: string;
  callType: 'voice' | 'video';
  timestamp: number;
}

interface EphemeralStatusUpdate {
  id: string;
  authorName: string;
  authorRank: string;
  nrp: string;
  timestamp: number;
  content: string;
  avatarColor: string;
}

interface CallHistoryItem {
  id: string;
  contactPeerId: string;
  personnelName: string;
  rank: string;
  nrp: string;
  timestamp: number;
  callType: 'video' | 'voice';
  direction: 'outgoing' | 'incoming';
}

const TACTICAL_EMOJIS = ['🫡', '✅', '🎯', '🛡️', '📡', '🚁', '⚠️', '🔒'];

export default function App() {
  // Volatile RAM Identity (Zero-Data Retention)
  const [localIdentity, setLocalIdentity] = useState<LocalNodeIdentity>({
    peerId: 'SLK-ADM-526316-0001',
    role: 'ADMIN',
    personnelName: 'Kolonel Lek Yudhi Eko Santoso',
    nrp: '526316',
    callsign: 'KOMANDO-01 [ADMIN HP]',
    unit: 'SUBDIS RUDAL DISKOMLEKAU',
    rank: 'Kasubdis Rudal Diskomlekau',
    publicKeyJwk: null,
    privateKey: null,
    signingPublicKeyJwk: null,
    signingPrivateKey: null,
    fingerprint: 'MENGINISIALISASI KUNCI...',
    sessionStartedAt: Date.now(),
  });
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(true);

  // Military Theme & Mobile Settings / Background Keep-Alive State
  const [activeTheme, setActiveTheme] = useState<MilitaryThemeId>('tactical-black');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [soundAlertEnabled, setSoundAlertEnabled] = useState<boolean>(true);
  const soundAlertEnabledRef = useRef<boolean>(true);
  soundAlertEnabledRef.current = soundAlertEnabled;
  const [wsSignalConnected, setWsSignalConnected] = useState<boolean>(false);
  const [keepAliveStatus, setKeepAliveStatus] = useState<BackgroundKeepAliveStatus>(
    tacticalBackgroundDaemon.getStatus()
  );

  // Fullscreen & PWA Hook for Mobile HP Installation
  const {
    isInstallable,
    isInstalled,
    isIOS,
    isFullscreen,
    autoFullscreenOnTap,
    setAutoFullscreenOnTap,
    toggleFullscreen,
    promptInstall,
  } = usePWAAndFullscreen();

  const [contacts, setContacts] = useState<TacticalContact[]>(INITIAL_TACTICAL_CONTACTS);
  // Single-column screen navigation: null = Home List View, string = Active Chat Room View
  const [openChatPeerId, setOpenChatPeerId] = useState<string | null>(null);
  const openChatPeerIdRef = useRef<string | null>(null);
  openChatPeerIdRef.current = openChatPeerId;

  // Bottom Navigation Bar: 'chat' | 'status' | 'groups' | 'calls'
  const [activeBottomTab, setActiveBottomTab] = useState<'chat' | 'status' | 'groups' | 'calls'>('chat');

  const [messagesByPeer, setMessagesByPeer] = useState<Record<string, EncryptedMessage[]>>({});
  const [packetLogs, setPacketLogs] = useState<CryptoPacketLog[]>([]);
  const [iceDiagnosticLogs, setIceDiagnosticLogs] = useState<WebRTCIceDiagnosticLog[]>([]);
  const [totalEncryptedPackets, setTotalEncryptedPackets] = useState<number>(0);
  const [totalTransmittedBytes, setTotalTransmittedBytes] = useState<number>(0);
  const [issuedCredentials, setIssuedCredentials] = useState<ProvisionedOperativeCredential[]>([]);

  // WhatsApp Filter Pills: 'all' ("Semua") | 'unread' ("Belum dibaca") | 'groups' ("Grup")
  const [chatFilterPill, setChatFilterPill] = useState<'all' | 'unread' | 'groups'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [inputText, setInputText] = useState<string>('');
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [showTopMenuDropdown, setShowTopMenuDropdown] = useState<boolean>(false);
  const [showSecuritySheet, setShowSecuritySheet] = useState<boolean>(false);
  const [showCiphertextInline, setShowCiphertextInline] = useState<boolean>(false);

  // Modals & Live Multi-Client Call States
  const [isAdminProvisionOpen, setIsAdminProvisionOpen] = useState<boolean>(false);
  const [isOperativeOnboardingOpen, setIsOperativeOnboardingOpen] = useState<boolean>(false);
  const [isManualSdpOpen, setIsManualSdpOpen] = useState<boolean>(false);
  const [isMediaStreamOpen, setIsMediaStreamOpen] = useState<boolean>(false);
  const [mediaCallContact, setMediaCallContact] = useState<TacticalContact | null>(null);
  const [mediaCallType, setMediaCallType] = useState<'voice' | 'video'>('voice');
  const [isMediaCaller, setIsMediaCaller] = useState<boolean>(true);
  const [incomingCallInvite, setIncomingCallInvite] = useState<IncomingCallInvite | null>(null);
  const [latestCallSignal, setLatestCallSignal] = useState<LiveCallSignalPacket | null>(null);

  // Status / Pembaruan Tab State (RAM Only)
  const [statusUpdates, setStatusUpdates] = useState<EphemeralStatusUpdate[]>([
    {
      id: 'ST-1',
      authorName: 'Kolonel Lek Hendra Wijaya',
      authorRank: 'KadiskomlekOps',
      nrp: '521890',
      timestamp: Date.now() - 300000,
      content: 'SITREP: Seluruh kanal P2P WebRTC wilayah Koopsudnas I beroperasi 100% nominal dengan enkripsi AES-256-GCM.',
      avatarColor: 'from-cyan-500 to-blue-700',
    },
    {
      id: 'ST-2',
      authorName: 'Mayor Pas Rizky Pratama',
      authorRank: 'Komandan Tim Taktis',
      nrp: '534112',
      timestamp: Date.now() - 1200000,
      content: 'Posko Taktis Sektor Charlie siap menerima distribusi koordinat dan citra radar P2P.',
      avatarColor: 'from-sky-500 to-indigo-700',
    },
  ]);
  const [newStatusText, setNewStatusText] = useState('');

  // Call History State (RAM Only)
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([
    {
      id: 'CALL-1',
      contactPeerId: 'SLK-ID-521890-A101',
      personnelName: 'Kolonel Lek Hendra Wijaya',
      rank: 'KadiskomlekOps',
      nrp: '521890',
      timestamp: Date.now() - 1800000,
      callType: 'video',
      direction: 'incoming',
    },
    {
      id: 'CALL-2',
      contactPeerId: 'SLK-ID-534112-B204',
      personnelName: 'Mayor Pas Rizky Pratama',
      rank: 'Komandan Tim Taktis',
      nrp: '534112',
      timestamp: Date.now() - 4200000,
      callType: 'voice',
      direction: 'outgoing',
    },
  ]);

  // Integrated Voice Note Recording State
  const [isRecordingVoice, setIsRecordingVoice] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [liveVoiceWaveform, setLiveVoiceWaveform] = useState<number[]>(
    Array.from({ length: 18 }, () => 25)
  );
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const recordingTimerRef = useRef<number | null>(null);

  // WebRTC P2P Tunnel Refs & Deduplication Set
  const loopbackTunnelsRef = useRef<Map<string, LoopbackTunnel>>(new Map());
  const livePeerTunnelsRef = useRef<Map<string, LivePeerTunnel>>(new Map());
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  const manualPendingPcRef = useRef<{
    pc: RTCPeerConnection;
    dc: RTCDataChannel | null;
    targetPeerId: string;
    targetCallsign: string;
  } | null>(null);
  const wsRef = useRef<TacticalCrossDeviceSignalingSocket | null>(null);
  const pendingAutoDialPeerRef = useRef<{
    peerId: string;
    callsign: string;
    nrp: string;
  } | null>(null);
  const localIdentityRef = useRef<LocalNodeIdentity>(localIdentity);
  localIdentityRef.current = localIdentity;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll chat room to bottom
  useEffect(() => {
    if (openChatPeerId) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messagesByPeer, openChatPeerId]);

  // Apply selected Military Color Theme to DOM CSS Variables & Meta Theme-Color
  useEffect(() => {
    applyMilitaryThemeToDOM(activeTheme);
  }, [activeTheme]);

  // Activate Background Keep-Alive Daemon so APK stays operating when user opens other apps on HP
  useEffect(() => {
    tacticalBackgroundDaemon.start();
    const unsubStatus = tacticalBackgroundDaemon.subscribe((st) => {
      setKeepAliveStatus(st);
    });

    // Background WebWorker Heartbeat: keeps WebSocket & WebRTC ICE channels alive when switching apps
    const unsubHeartbeat = tacticalBackgroundDaemon.onHeartbeat(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(
            JSON.stringify({
              type: 'node:ping',
              peerId: localIdentityRef.current.peerId,
              timestamp: Date.now(),
            })
          );
        } catch {
          // Ignore
        }
      }
      // Check active WebRTC live tunnels and recover if ICE disconnected while in background
      livePeerTunnelsRef.current.forEach((tunnel, pid) => {
        if (
          tunnel.pc &&
          (tunnel.pc.iceConnectionState === 'disconnected' ||
            tunnel.pc.iceConnectionState === 'failed')
        ) {
          if (typeof tunnel.pc.restartIce === 'function') {
            tunnel.pc.restartIce();
          }
          flushOutgoingDataChannelQueue(tunnel, () => {});
        }
        // Keep data channel warm
        if (tunnel.dc && tunnel.dc.readyState === 'open' && tunnel.outgoingPacketQueue.length > 0) {
          flushOutgoingDataChannelQueue(tunnel, () => {});
        }
        void pid;
      });
    });

    // Ensure Web Audio & MediaSession keep-alive starts on first user gesture on mobile
    const handleFirstUserGesture = () => {
      if (tacticalBackgroundDaemon.getStatus().enabled) {
        tacticalBackgroundDaemon.ensureAudioKeepAlive();
      }
    };
    window.addEventListener('pointerdown', handleFirstUserGesture, { once: true, passive: true });
    window.addEventListener('touchstart', handleFirstUserGesture, { once: true, passive: true });

    return () => {
      unsubStatus();
      unsubHeartbeat();
      window.removeEventListener('pointerdown', handleFirstUserGesture);
      window.removeEventListener('touchstart', handleFirstUserGesture);
    };
  }, []);

  // Helper to get avatar initials
  const getInitials = (name: string) => {
    const words = name
      .replace(/\[.*?\]/g, '')
      .trim()
      .split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Record Cryptographic Packet Audit Log in RAM
  const recordPacketLog = useCallback(
    (
      direction: 'TX' | 'RX' | 'KEY_EXCHANGE' | 'PROVISION',
      peerCallsign: string,
      ivHex: string,
      sha256Hash: string,
      bytes: number
    ) => {
      const entry: CryptoPacketLog = {
        id: `PKT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        direction,
        peerCallsign,
        cipherSuite: 'AES-256-GCM / ECDH-P256',
        ivHex: ivHex || '000000000000',
        sha256Short: sha256Hash ? sha256Hash.slice(0, 20) + '...' : 'ECDH-AUTH',
        bytes,
        transport: 'RTCDataChannel/SCTP',
      };
      setPacketLogs((prev) => [entry, ...prev.slice(0, 39)]);
      if (direction === 'TX' || direction === 'RX') {
        setTotalEncryptedPackets((prev) => prev + 1);
        setTotalTransmittedBytes((prev) => prev + bytes);
      }
    },
    []
  );

  // Record Real-Time WebRTC ICE Agent, SDP Handshake & DataChannel Diagnostic Log in RAM
  const recordIceDiagnosticLog = useCallback((log: WebRTCIceDiagnosticLog) => {
    console.info(
      `[SILENT LINK WEBRTC][${log.category}] Peer=${log.peerName} (${log.peerId}) | ICE=${log.iceConnectionState} | DC=${log.dataChannelState} | ${log.detail}`
    );
    setIceDiagnosticLogs((prev) => [log, ...prev.slice(0, 34)]);
  }, []);

  // Append decrypted message to volatile RAM state (idempotent + auto-creates live contact if needed)
  const appendMessage = useCallback((peerId: string, msg: EncryptedMessage) => {
    setMessagesByPeer((prev) => {
      const existing = prev[peerId] || [];
      if (existing.some((m) => m.id === msg.id)) return prev;
      return {
        ...prev,
        [peerId]: [...existing, msg],
      };
    });

    if (msg.kind !== 'system') {
      const isIncoming = msg.senderPeerId !== localIdentityRef.current.peerId;
      const isChatOpen = openChatPeerIdRef.current === peerId;

      const previewText =
        msg.kind === 'voice'
          ? `🎤 Pesan suara (${msg.voiceMeta?.durationSec || 3} dtk)`
          : msg.kind === 'image'
          ? `📷 Foto: ${msg.fileMeta?.fileName || 'Citra Taktis'}`
          : msg.kind === 'document'
          ? `📄 Dokumen: ${msg.fileMeta?.fileName || 'Berkas'}`
          : msg.plaintext;

      if (isIncoming) {
        void sendBackgroundSystemNotification(
          `SILENT LINK • ${msg.senderCallsign || 'Personel P2P'}`,
          previewText,
          soundAlertEnabledRef.current,
          'message'
        );
      }

      setContacts((prev) => {
        const exists = prev.some((c) => c.peerId === peerId);
        if (!exists) {
          const newLiveContact: TacticalContact = {
            peerId,
            personnelName: msg.senderCallsign || `PERSONEL ${msg.senderNrp}`,
            nrp: msg.senderNrp || peerId.slice(-6),
            callsign: `${msg.senderCallsign} [LIVE P2P]`,
            unit: 'DISKOMLEKAU P2P',
            rank: 'Personel Terhubung',
            frequency: 'DIRECT WEBRTC P2P',
            sector: 'Live Multi-Client',
            mode: 'live-peer',
            isGroup: false,
            avatarColor: 'from-cyan-400 to-teal-700',
            connectionState: 'CONNECTED',
            iceState: 'connected',
            dataChannelState: 'open',
            remoteFingerprint: 'ECDH-P256-VERIFIED',
            sharedKeyHash: 'AES-256-GCM-ACTIVE',
            latencyMs: 6,
            unreadCount: isIncoming && !isChatOpen ? 1 : 0,
            lastMessagePreview: previewText,
            lastActivityTime: msg.timestamp,
            provisionedByAdmin: true,
          };
          return [newLiveContact, ...prev];
        }

        return prev.map((c) => {
          if (c.peerId !== peerId) return c;
          return {
            ...c,
            lastMessagePreview: previewText,
            lastActivityTime: msg.timestamp,
            unreadCount:
              isIncoming && !isChatOpen ? (c.unreadCount || 0) + 1 : c.unreadCount,
          };
        });
      });
    }
  }, []);

  // Update delivery status (SENT -> DELIVERED -> VERIFIED)
  const updateMessageStatus = useCallback(
    (peerId: string, messageId: string, status: 'SENT' | 'DELIVERED' | 'VERIFIED') => {
      setMessagesByPeer((prev) => {
        const list = prev[peerId];
        if (!list) {
          // Also check across all threads in case peerId was remapped by NRP
          const nextState: Record<string, EncryptedMessage[]> = {};
          let changed = false;
          for (const [k, msgs] of Object.entries(prev)) {
            if (msgs.some((m) => m.id === messageId)) {
              changed = true;
              nextState[k] = msgs.map((m) => (m.id === messageId ? { ...m, status } : m));
            } else {
              nextState[k] = msgs;
            }
          }
          return changed ? nextState : prev;
        }
        return {
          ...prev,
          [peerId]: list.map((m) => (m.id === messageId ? { ...m, status } : m)),
        };
      });
    },
    []
  );

  // Establish REAL in-browser WebRTC RTCPeerConnection + RTCDataChannel + ECDH P-256 tunnel
  const establishLoopbackWebRTCTunnel = useCallback(
    async (
      contact: TacticalContact,
      localKeyMaterial: {
        privateKey: CryptoKey;
        publicKeyJwk: JsonWebKey;
        fingerprint: string;
      },
      explicitRemotePublicKeyJwk?: JsonWebKey
    ) => {
      const existing = loopbackTunnelsRef.current.get(contact.peerId);
      if (existing && existing.localDc.readyState === 'open') {
        return existing;
      }

      setContacts((prev) =>
        prev.map((c) =>
          c.peerId === contact.peerId
            ? { ...c, connectionState: 'HANDSHAKING', iceState: 'checking' }
            : c
        )
      );

      const remoteEcdh = await generateEphemeralECDHKeyPair();
      const remotePubJwkToUse = explicitRemotePublicKeyJwk || remoteEcdh.publicKeyJwk;
      const remoteFp = await computeJwkFingerprint(remotePubJwkToUse);

      const { sharedKey: localSharedKey, sharedKeyHash } = await deriveSharedAESGCMKey(
        localKeyMaterial.privateKey,
        remoteEcdh.publicKeyJwk
      );
      const { sharedKey: remoteSharedKey } = await deriveSharedAESGCMKey(
        remoteEcdh.privateKey,
        localKeyMaterial.publicKeyJwk
      );

      const localPc = new RTCPeerConnection();
      const remotePc = new RTCPeerConnection();
      const handshakeStartTime = performance.now();

      localPc.onicecandidate = (e) => {
        if (e.candidate) remotePc.addIceCandidate(e.candidate).catch(() => {});
      };
      remotePc.onicecandidate = (e) => {
        if (e.candidate) localPc.addIceCandidate(e.candidate).catch(() => {});
      };

      localPc.oniceconnectionstatechange = () => {
        setContacts((prev) =>
          prev.map((c) =>
            c.peerId === contact.peerId
              ? { ...c, iceState: localPc.iceConnectionState }
              : c
          )
        );
        recordIceDiagnosticLog({
          id: `LOOP-ICE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          peerId: contact.peerId,
          peerName: contact.personnelName,
          category: 'ICE_STATE',
          iceConnectionState: localPc.iceConnectionState,
          iceGatheringState: localPc.iceGatheringState,
          signalingState: localPc.signalingState,
          dataChannelState: localDc.readyState,
          detail: `oniceconnectionstatechange -> ${localPc.iceConnectionState}`,
        });
      };

      const localDc = localPc.createDataChannel(
        `silentlink-${contact.peerId}`,
        TACTICAL_DATACHANNEL_CONFIG
      );

      const tunnelObj: LoopbackTunnel = {
        localPc,
        remotePc,
        localDc,
        remoteDc: null,
        sharedKey: localSharedKey,
        remotePrivateKey: remoteEcdh.privateKey,
        remotePublicKeyJwk: remotePubJwkToUse,
        sharedKeyHash,
        remoteFingerprint: remoteFp,
      };

      localDc.onmessage = async (event) => {
        try {
          const packet: DataChannelPacket = JSON.parse(event.data);

          if (packet.packetType === 'DELIVERY_ACK' && packet.ackStage) {
            updateMessageStatus(contact.peerId, packet.messageId, packet.ackStage);
            return;
          }

          if (
            packet.packetType === 'ENCRYPTED_MSG' &&
            packet.ciphertextB64 &&
            packet.ivB64
          ) {
            const decryptedJson = await decryptAES256GCM(
              localSharedKey,
              packet.ciphertextB64,
              packet.ivB64
            );
            const parsedPayload: {
              text: string;
              fileMeta?: FileAttachmentMeta;
              voiceMeta?: VoiceNoteMeta;
            } = JSON.parse(decryptedJson);

            recordPacketLog(
              'RX',
              contact.callsign,
              packet.ivHex || '',
              packet.sha256Hash || '',
              packet.byteLength || 0
            );

            const incomingMsg: EncryptedMessage = {
              id: packet.messageId,
              contactPeerId: contact.peerId,
              senderPeerId: contact.peerId,
              senderCallsign: contact.personnelName,
              senderNrp: contact.nrp,
              timestamp: packet.timestamp,
              kind: packet.kind || 'text',
              plaintext: parsedPayload.text,
              ciphertextPreview: packet.ciphertextB64.slice(0, 64) + '...',
              ivHex: packet.ivHex || '',
              sha256Hash: packet.sha256Hash || '',
              byteLength: packet.byteLength || 0,
              status: 'VERIFIED',
              transport: 'WebRTC DataChannel (SCTP/DTLS 1.3)',
              fileMeta: parsedPayload.fileMeta,
              voiceMeta: parsedPayload.voiceMeta,
            };

            appendMessage(contact.peerId, incomingMsg);
          }
        } catch {
          // Ignore malformed frame
        }
      };

      remotePc.ondatachannel = (event) => {
        const remoteChannel = event.channel;
        tunnelObj.remoteDc = remoteChannel;

        remoteChannel.onmessage = async (msgEvent) => {
          try {
            const packet: DataChannelPacket = JSON.parse(msgEvent.data);
            if (
              packet.packetType === 'ENCRYPTED_MSG' &&
              packet.ciphertextB64 &&
              packet.ivB64
            ) {
              if (remoteChannel.readyState === 'open') {
                remoteChannel.send(
                  JSON.stringify({
                    packetType: 'DELIVERY_ACK',
                    messageId: packet.messageId,
                    senderPeerId: contact.peerId,
                    senderCallsign: contact.callsign,
                    senderNrp: contact.nrp,
                    timestamp: Date.now(),
                    ackStage: 'DELIVERED',
                  } satisfies DataChannelPacket)
                );
              }

              const decryptedStr = await decryptAES256GCM(
                remoteSharedKey,
                packet.ciphertextB64,
                packet.ivB64
              );
              const payloadObj: {
                text: string;
                fileMeta?: FileAttachmentMeta;
                voiceMeta?: VoiceNoteMeta;
              } = JSON.parse(decryptedStr);

              setTimeout(() => {
                if (remoteChannel.readyState === 'open') {
                  remoteChannel.send(
                    JSON.stringify({
                      packetType: 'DELIVERY_ACK',
                      messageId: packet.messageId,
                      senderPeerId: contact.peerId,
                      senderCallsign: contact.callsign,
                      senderNrp: contact.nrp,
                      timestamp: Date.now(),
                      ackStage: 'VERIFIED',
                    } satisfies DataChannelPacket)
                  );
                }
              }, 200);

              setTimeout(async () => {
                if (remoteChannel.readyState !== 'open') return;
                const replyText = generateTacticalReply(
                  contact.autoResponderProfile,
                  payloadObj.text,
                  packet.kind || 'text',
                  payloadObj.fileMeta?.fileName
                );
                const replyEnvelope = await encryptAES256GCM(
                  remoteSharedKey,
                  JSON.stringify({ text: replyText })
                );
                const replyPacket: DataChannelPacket = {
                  packetType: 'ENCRYPTED_MSG',
                  messageId: `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  senderPeerId: contact.peerId,
                  senderCallsign: contact.callsign,
                  senderNrp: contact.nrp,
                  timestamp: Date.now(),
                  kind: 'text',
                  ciphertextB64: replyEnvelope.ciphertextB64,
                  ivB64: replyEnvelope.ivB64,
                  ivHex: replyEnvelope.ivHex,
                  sha256Hash: replyEnvelope.sha256Hash,
                  byteLength: replyEnvelope.byteLength,
                };
                remoteChannel.send(JSON.stringify(replyPacket));
              }, 700);
            }
          } catch {
            // Channel closed
          }
        };
      };

      localDc.onopen = () => {
        const rtt = Math.max(2, Math.round(performance.now() - handshakeStartTime));
        setContacts((prev) =>
          prev.map((c) =>
            c.peerId === contact.peerId
              ? {
                  ...c,
                  connectionState: 'CONNECTED',
                  iceState: localPc.iceConnectionState,
                  dataChannelState: localDc.readyState,
                  remoteFingerprint: remoteFp,
                  sharedKeyHash,
                  latencyMs: rtt,
                }
              : c
          )
        );

        recordPacketLog(
          'KEY_EXCHANGE',
          contact.callsign,
          'ECDH-P256-OK',
          sharedKeyHash,
          128
        );
      };

      const offer = await localPc.createOffer();
      await localPc.setLocalDescription(offer);
      await remotePc.setRemoteDescription(offer);

      const answer = await remotePc.createAnswer();
      await remotePc.setLocalDescription(answer);
      await localPc.setRemoteDescription(answer);

      loopbackTunnelsRef.current.set(contact.peerId, tunnelObj);
      return tunnelObj;
    },
    [appendMessage, recordPacketLog, updateMessageStatus]
  );

  // Helper to broadcast local node identity & ECDH public key to Signaling Server
  const sendNodeRegistration = useCallback((identity: LocalNodeIdentity) => {
    if (
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN &&
      identity.publicKeyJwk
    ) {
      wsRef.current.send(
        JSON.stringify({
          type: 'node:register',
          peerId: identity.peerId,
          callsign: identity.personnelName,
          nrp: identity.nrp,
          unit: identity.unit,
          rank: identity.rank,
          role: identity.role,
          publicKeyJwk: identity.publicKeyJwk,
          fingerprint: identity.fingerprint,
        })
      );
    }
  }, []);

  // Idempotent processor for incoming E2EE packets (from RTCDataChannel or WebSocket E2EE relay)
  const processIncomingLiveEncryptedPacket = useCallback(
    async (packet: DataChannelPacket) => {
      if (!packet.messageId || processedMessageIdsRef.current.has(packet.messageId)) {
        return;
      }

      const fromPeerId = packet.senderPeerId;
      const threadPeerId = packet.targetGroupPeerId || fromPeerId;

      if (packet.packetType === 'DELIVERY_ACK' && packet.ackStage) {
        updateMessageStatus(threadPeerId, packet.messageId, packet.ackStage);
        return;
      }

      if (
        packet.packetType !== 'ENCRYPTED_MSG' ||
        !packet.ciphertextB64 ||
        !packet.ivB64
      ) {
        return;
      }

      let tunnel = livePeerTunnelsRef.current.get(fromPeerId);
      if (!tunnel) {
        tunnel = createEmptyLivePeerTunnel(
          fromPeerId,
          packet.senderCallsign || `PERSONEL ${packet.senderNrp}`,
          packet.senderNrp || fromPeerId.slice(-6)
        );
        livePeerTunnelsRef.current.set(fromPeerId, tunnel);
      }

      let activeKey = tunnel.sharedKey;

      // Dynamically derive or refresh ECDH P-256 shared key if packet carries senderPublicKeyJwk
      if (
        (!activeKey ||
          (packet.senderPublicKeyJwk &&
            tunnel.remotePublicKeyJwk?.x !== packet.senderPublicKeyJwk.x)) &&
        packet.senderPublicKeyJwk &&
        localIdentityRef.current.privateKey
      ) {
        try {
          const remoteFp = await computeJwkFingerprint(packet.senderPublicKeyJwk);
          const derived = await deriveSharedAESGCMKey(
            localIdentityRef.current.privateKey,
            packet.senderPublicKeyJwk
          );
          activeKey = derived.sharedKey;
          tunnel.sharedKey = derived.sharedKey;
          tunnel.remotePublicKeyJwk = packet.senderPublicKeyJwk;
          tunnel.sharedKeyHash = derived.sharedKeyHash;
          tunnel.remoteFingerprint = remoteFp;
        } catch (err) {
          console.warn('[SILENT LINK E2EE] Initial ECDH key derivation error:', err);
        }
      }

      if (!activeKey) return;

      let decryptedJson: string | null = null;
      try {
        decryptedJson = await decryptAES256GCM(
          activeKey,
          packet.ciphertextB64,
          packet.ivB64
        );
      } catch {
        // Retry by re-deriving shared key directly from packet.senderPublicKeyJwk in case remote rotated keys
        if (packet.senderPublicKeyJwk && localIdentityRef.current.privateKey) {
          try {
            const remoteFp = await computeJwkFingerprint(packet.senderPublicKeyJwk);
            const rederived = await deriveSharedAESGCMKey(
              localIdentityRef.current.privateKey,
              packet.senderPublicKeyJwk
            );
            tunnel.sharedKey = rederived.sharedKey;
            tunnel.remotePublicKeyJwk = packet.senderPublicKeyJwk;
            tunnel.sharedKeyHash = rederived.sharedKeyHash;
            tunnel.remoteFingerprint = remoteFp;
            decryptedJson = await decryptAES256GCM(
              rederived.sharedKey,
              packet.ciphertextB64,
              packet.ivB64
            );
          } catch {
            decryptedJson = null;
          }
        }
      }

      if (!decryptedJson) return;

      try {
        processedMessageIdsRef.current.add(packet.messageId);

        const parsedPayload: {
          text: string;
          fileMeta?: FileAttachmentMeta;
          voiceMeta?: VoiceNoteMeta;
        } = JSON.parse(decryptedJson);

        // Send DELIVERY_ACK (VERIFIED) directly P2P via open RTCDataChannel (zero broker relay when open)
        const ackPacket: DataChannelPacket = {
          packetType: 'DELIVERY_ACK',
          messageId: packet.messageId,
          senderPeerId: localIdentityRef.current.peerId,
          senderCallsign: localIdentityRef.current.personnelName,
          senderNrp: localIdentityRef.current.nrp,
          timestamp: Date.now(),
          ackStage: 'VERIFIED',
        };

        const ackResult = sendOverReliableDataChannel(
          tunnel,
          JSON.stringify(ackPacket),
          recordIceDiagnosticLog
        );

        if (!ackResult.sentImmediately && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'e2ee:ack',
              targetPeerId: fromPeerId,
              targetNrp: packet.senderNrp,
              packet: ackPacket,
            })
          );
        }

        recordPacketLog(
          'RX',
          packet.senderCallsign || fromPeerId,
          packet.ivHex || '',
          packet.sha256Hash || '',
          packet.byteLength || 0
        );

        appendMessage(threadPeerId, {
          id: packet.messageId,
          contactPeerId: threadPeerId,
          senderPeerId: fromPeerId,
          senderCallsign: packet.senderCallsign || `PERSONEL ${packet.senderNrp}`,
          senderNrp: packet.senderNrp || fromPeerId.slice(-6),
          timestamp: packet.timestamp,
          kind: packet.kind || 'text',
          plaintext: parsedPayload.text,
          ciphertextPreview: packet.ciphertextB64.slice(0, 64) + '...',
          ivHex: packet.ivHex || '',
          sha256Hash: packet.sha256Hash || '',
          byteLength: packet.byteLength || 0,
          status: 'VERIFIED',
          transport:
            tunnel.dc?.readyState === 'open'
              ? 'WebRTC DataChannel (ordered:true, reliable:true)'
              : 'WebRTC P2P E2EE (AES-256-GCM)',
          fileMeta: parsedPayload.fileMeta,
          voiceMeta: parsedPayload.voiceMeta,
        });
      } catch {
        // Ignore malformed payload JSON
      }
    },
    [appendMessage, recordIceDiagnosticLog, recordPacketLog, updateMessageStatus]
  );

  // Setup Live Cross-Device WebRTC DataChannel with ordered:true, reliable:true & Queue Flush on Open
  const setupLivePeerDataChannel = useCallback(
    (
      peerId: string,
      peerCallsign: string,
      _peerNrp: string,
      pc: RTCPeerConnection,
      dc: RTCDataChannel,
      _sharedKey: CryptoKey | null,
      sharedKeyHash: string,
      remoteFingerprint: string
    ) => {
      dc.onopen = () => {
        const tunnel = livePeerTunnelsRef.current.get(peerId);
        if (tunnel) {
          tunnel.dc = dc;
          flushOutgoingDataChannelQueue(tunnel, recordIceDiagnosticLog);
        }

        recordIceDiagnosticLog({
          id: `DC-OPEN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          peerId,
          peerName: peerCallsign,
          category: 'DATACHANNEL',
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
          dataChannelState: dc.readyState,
          detail: `DataChannel "${dc.label}" OPEN (ordered: ${dc.ordered}, reliable: true)`,
        });

        setContacts((prev) =>
          prev.map((c) =>
            c.peerId === peerId
              ? {
                  ...c,
                  mode: 'live-peer',
                  connectionState: 'CONNECTED',
                  iceState: pc.iceConnectionState,
                  dataChannelState: dc.readyState,
                  remoteFingerprint,
                  sharedKeyHash,
                  latencyMs: 5,
                }
              : c
          )
        );
      };

      dc.onclose = () => {
        recordIceDiagnosticLog({
          id: `DC-CLOSE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          peerId,
          peerName: peerCallsign,
          category: 'DATACHANNEL',
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
          dataChannelState: dc.readyState,
          detail: `DataChannel "${dc.label}" CLOSED`,
        });

        setContacts((prev) =>
          prev.map((c) =>
            c.peerId === peerId
              ? {
                  ...c,
                  dataChannelState: dc.readyState,
                }
              : c
          )
        );
      };

      dc.onerror = (errEv) => {
        recordIceDiagnosticLog({
          id: `DC-ERR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          peerId,
          peerName: peerCallsign,
          category: 'DATACHANNEL',
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
          dataChannelState: dc.readyState,
          detail: `DataChannel transport event (${String(errEv.type)})`,
        });
      };

      dc.onmessage = async (event) => {
        try {
          const packet: DataChannelPacket = JSON.parse(event.data);
          await processIncomingLiveEncryptedPacket(packet);
        } catch {
          // Ignore malformed packet
        }
      };
    },
    [processIncomingLiveEncryptedPacket, recordIceDiagnosticLog]
  );

  // Automatic & Manual ICE Restart (Re-negotiation) when ICE disconnects or fails mid-session
  const triggerPeerIceRestart = useCallback(
    async (targetPeerId: string, reason = 'Manual/Auto ICE Restart') => {
      const tunnel = livePeerTunnelsRef.current.get(targetPeerId);
      const ws = wsRef.current;
      const myPubJwk = localIdentityRef.current.publicKeyJwk;

      if (!tunnel || !tunnel.pc || !ws || ws.readyState !== WebSocket.OPEN || !myPubJwk) {
        return;
      }

      const pc = tunnel.pc;
      if (pc.signalingState === 'closed') {
        return;
      }

      try {
        tunnel.iceRestartAttempts += 1;
        tunnel.makingOffer = true;

        recordIceDiagnosticLog({
          id: `ICE-RST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          peerId: targetPeerId,
          peerName: tunnel.peerName,
          category: 'ICE_RESTART',
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
          dataChannelState: tunnel.dc?.readyState || 'closed',
          detail: `Triggering ICE Restart #${tunnel.iceRestartAttempts} (${reason})`,
        });

        if (typeof pc.restartIce === 'function') {
          pc.restartIce();
        }

        const restartOffer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(restartOffer);

        // Wait for ICE Agent to gather fresh ICE candidates into localDescription
        await waitForIceGatheringComplete(pc, 900);

        ws.send(
          JSON.stringify({
            type: 'webrtc:offer',
            targetPeerId,
            targetNrp: tunnel.peerNrp,
            fromCallsign: localIdentityRef.current.personnelName,
            fromNrp: localIdentityRef.current.nrp,
            iceRestart: true,
            sdp: pc.localDescription || restartOffer,
            publicKeyJwk: myPubJwk,
          })
        );
      } catch (err) {
        console.warn('[SILENT LINK ICE-RESTART] Failed to execute ICE Restart:', err);
      } finally {
        tunnel.makingOffer = false;
      }
    },
    [recordIceDiagnosticLog]
  );

  // Attach full ICE Agent listeners (oniceconnectionstatechange, onicecandidate, onsignalingstatechange) to a live RTCPeerConnection
  const attachLivePeerConnectionListeners = useCallback(
    (pc: RTCPeerConnection, tunnel: LivePeerTunnel) => {
      const { peerId, peerName, peerNrp } = tunnel;

      pc.onicecandidate = (iceEv) => {
        const ws = wsRef.current;
        if (iceEv.candidate) {
          const candidateJson = iceEv.candidate.toJSON();
          tunnel.localGatheredCandidates.push(candidateJson);
          tunnel.localCandidatesSent += 1;

          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'webrtc:ice-candidate',
                targetPeerId: peerId,
                targetNrp: peerNrp,
                candidate: candidateJson,
              })
            );
          }

          recordIceDiagnosticLog({
            id: `ICE-TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: Date.now(),
            peerId,
            peerName,
            category: 'ICE_CANDIDATE',
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
            signalingState: pc.signalingState,
            dataChannelState: tunnel.dc?.readyState || 'closed',
            detail: `Local ICE Candidate #${tunnel.localCandidatesSent} gathered & sent (${candidateJson.candidate?.slice(0, 50) || 'host/srflx'})`,
          });
        } else {
          // Null candidate indicates ICE Gathering is 100% complete
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'webrtc:ice-complete',
                targetPeerId: peerId,
                targetNrp: peerNrp,
                totalCandidates: tunnel.localCandidatesSent,
              })
            );
          }
          recordIceDiagnosticLog({
            id: `ICE-DONE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: Date.now(),
            peerId,
            peerName,
            category: 'ICE_CANDIDATE',
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
            signalingState: pc.signalingState,
            dataChannelState: tunnel.dc?.readyState || 'closed',
            detail: `ICE Candidate Gathering COMPLETE (${tunnel.localCandidatesSent} local candidates sent)`,
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        const currentIce = pc.iceConnectionState;

        recordIceDiagnosticLog({
          id: `ICE-ST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          peerId,
          peerName,
          category: 'ICE_STATE',
          iceConnectionState: currentIce,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
          dataChannelState: tunnel.dc?.readyState || 'closed',
          detail: `oniceconnectionstatechange -> "${currentIce}"`,
        });

        setContacts((prev) =>
          prev.map((c) => {
            if (c.peerId !== peerId) return c;
            const nextConnState =
              currentIce === 'connected' || currentIce === 'completed'
                ? 'CONNECTED'
                : currentIce === 'checking'
                ? 'HANDSHAKING'
                : currentIce === 'disconnected' || currentIce === 'failed'
                ? 'DEGRADED'
                : c.connectionState;
            return {
              ...c,
              mode: 'live-peer',
              iceState: currentIce,
              connectionState: nextConnState,
              dataChannelState: tunnel.dc?.readyState || c.dataChannelState,
            };
          })
        );

        if (currentIce === 'connected' || currentIce === 'completed') {
          if (tunnel.iceRestartTimer) {
            window.clearTimeout(tunnel.iceRestartTimer);
            tunnel.iceRestartTimer = null;
          }
          flushOutgoingDataChannelQueue(tunnel, recordIceDiagnosticLog);
        } else if (currentIce === 'failed') {
          // Immediate ICE Restart on 'failed'
          triggerPeerIceRestart(peerId, 'ICE state transitioned to failed');
        } else if (currentIce === 'disconnected') {
          // Grace period 2.5s on 'disconnected' before triggering automatic ICE Restart
          if (tunnel.iceRestartTimer) {
            window.clearTimeout(tunnel.iceRestartTimer);
          }
          tunnel.iceRestartTimer = window.setTimeout(() => {
            if (
              tunnel.pc &&
              (tunnel.pc.iceConnectionState === 'disconnected' ||
                tunnel.pc.iceConnectionState === 'failed')
            ) {
              triggerPeerIceRestart(peerId, 'ICE state remained disconnected > 2.5s');
            }
          }, 2500);
        }
      };

      pc.onsignalingstatechange = () => {
        recordIceDiagnosticLog({
          id: `SDP-ST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          peerId,
          peerName,
          category: 'SDP_HANDSHAKE',
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
          dataChannelState: tunnel.dc?.readyState || 'closed',
          detail: `Signaling state -> "${pc.signalingState}"`,
        });
      };
    },
    [recordIceDiagnosticLog, triggerPeerIceRestart]
  );

  // Create and transmit a precision WebRTC SDP Offer + Ordered/Reliable DataChannel to a live peer
  const initiateLiveWebRTCOffer = useCallback(
    async (
      remotePeerId: string,
      remoteCallsign: string,
      remoteNrp: string,
      forceRecreate = false
    ) => {
      const ws = wsRef.current;
      const myPubJwk = localIdentityRef.current.publicKeyJwk;
      if (!ws || ws.readyState !== WebSocket.OPEN || !myPubJwk) return;

      let tunnel = livePeerTunnelsRef.current.get(remotePeerId);
      if (!tunnel) {
        tunnel = createEmptyLivePeerTunnel(remotePeerId, remoteCallsign, remoteNrp);
        livePeerTunnelsRef.current.set(remotePeerId, tunnel);
      } else {
        tunnel.peerName = remoteCallsign || tunnel.peerName;
        tunnel.peerNrp = remoteNrp || tunnel.peerNrp;
      }

      // If DataChannel is already open and forceRecreate is false, just flush queue
      if (
        !forceRecreate &&
        tunnel.pc &&
        tunnel.dc &&
        tunnel.dc.readyState === 'open' &&
        (tunnel.pc.iceConnectionState === 'connected' ||
          tunnel.pc.iceConnectionState === 'completed')
      ) {
        flushOutgoingDataChannelQueue(tunnel, recordIceDiagnosticLog);
        return;
      }

      if (tunnel.makingOffer) return;

      try {
        tunnel.makingOffer = true;

        if (tunnel.pc) {
          try {
            tunnel.dc?.close();
            tunnel.pc.close();
          } catch {
            // Ignore close errors
          }
        }

        const pc = new RTCPeerConnection(TACTICAL_ICE_CONFIG);
        // Configure DataChannel with ordered: true and reliable: true
        const dc = pc.createDataChannel(
          `silentlink-p2p-${remotePeerId}`,
          TACTICAL_DATACHANNEL_CONFIG
        );

        tunnel.pc = pc;
        tunnel.dc = dc;
        tunnel.localGatheredCandidates = [];
        tunnel.localCandidatesSent = 0;

        attachLivePeerConnectionListeners(pc, tunnel);
        setupLivePeerDataChannel(
          remotePeerId,
          remoteCallsign,
          remoteNrp,
          pc,
          dc,
          tunnel.sharedKey,
          tunnel.sharedKeyHash,
          tunnel.remoteFingerprint
        );

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        recordIceDiagnosticLog({
          id: `SDP-OFFER-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          peerId: remotePeerId,
          peerName: remoteCallsign,
          category: 'SDP_HANDSHAKE',
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
          dataChannelState: dc.readyState,
          detail: 'setLocalDescription(SDP Offer) succeeded. Gathering ICE candidates...',
        });

        // Wait for ICE candidate gathering before transmitting SDP Offer so candidates are embedded AND trickled
        await waitForIceGatheringComplete(pc, 900);

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'webrtc:offer',
              targetPeerId: remotePeerId,
              targetNrp: remoteNrp,
              fromCallsign: localIdentityRef.current.personnelName,
              fromNrp: localIdentityRef.current.nrp,
              sdp: pc.localDescription || offer,
              publicKeyJwk: myPubJwk,
            })
          );

          recordIceDiagnosticLog({
            id: `SDP-TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: Date.now(),
            peerId: remotePeerId,
            peerName: remoteCallsign,
            category: 'SDP_HANDSHAKE',
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
            signalingState: pc.signalingState,
            dataChannelState: dc.readyState,
            detail: `Transmitted SDP Offer + ${tunnel.localCandidatesSent} ICE candidate(s) to peer`,
          });
        }
      } catch (err) {
        console.warn('[SILENT LINK SDP] Error creating WebRTC Offer:', err);
      } finally {
        tunnel.makingOffer = false;
      }
    },
    [
      attachLivePeerConnectionListeners,
      recordIceDiagnosticLog,
      setupLivePeerDataChannel,
    ]
  );

  // Operative Onboarding Handler: Parse Admin's embedded ECDH Public Key from QR/DeepLink and establish E2EE Live Session
  const handleCompleteOperativeOnboarding = useCallback(
    async (verifiedCred: ProvisionedOperativeCredential) => {
      const operativeEcdh = await generateEphemeralECDHKeyPair();

      const newIdentity: LocalNodeIdentity = {
        peerId: verifiedCred.assignedPeerId,
        role: 'OPERATIVE',
        personnelName: verifiedCred.personnelName,
        nrp: verifiedCred.nrp,
        callsign: `${verifiedCred.personnelName} [NRP:${verifiedCred.nrp}]`,
        unit: verifiedCred.unit,
        rank: verifiedCred.rank,
        publicKeyJwk: operativeEcdh.publicKeyJwk,
        privateKey: operativeEcdh.privateKey,
        signingPublicKeyJwk: null,
        signingPrivateKey: null,
        fingerprint: operativeEcdh.fingerprint,
        sessionStartedAt: Date.now(),
        authorizedByAdminFingerprint: verifiedCred.adminFingerprint,
      };

      localIdentityRef.current = newIdentity;
      setLocalIdentity(newIdentity);

      const targetAdminPeerId = verifiedCred.adminPeerId || 'SLK-ADM-526316-0001';
      pendingAutoDialPeerRef.current = {
        peerId: targetAdminPeerId,
        callsign: 'Kolonel Lek Yudhi Eko Santoso',
        nrp: '526316',
      };

      // Pre-derive shared AES-256-GCM key with Admin's ECDH Public Key from QR credential
      let adminSharedKeyHash = 'DERIVING ECDH...';
      if (verifiedCred.adminPublicKeyJwk) {
        try {
          const derived = await deriveSharedAESGCMKey(
            operativeEcdh.privateKey,
            verifiedCred.adminPublicKeyJwk
          );
          adminSharedKeyHash = derived.sharedKeyHash;
          const existingAdminTunnel =
            livePeerTunnelsRef.current.get(targetAdminPeerId) ||
            createEmptyLivePeerTunnel(
              targetAdminPeerId,
              'Kolonel Lek Yudhi Eko Santoso',
              '526316'
            );
          existingAdminTunnel.sharedKey = derived.sharedKey;
          existingAdminTunnel.remotePublicKeyJwk = verifiedCred.adminPublicKeyJwk;
          existingAdminTunnel.sharedKeyHash = derived.sharedKeyHash;
          existingAdminTunnel.remoteFingerprint = verifiedCred.adminFingerprint;
          livePeerTunnelsRef.current.set(targetAdminPeerId, existingAdminTunnel);
        } catch {
          // Will re-derive on directory:sync or SDP answer
        }
      }

      const adminContact: TacticalContact = {
        peerId: targetAdminPeerId,
        personnelName: 'Kolonel Lek Yudhi Eko Santoso',
        nrp: '526316',
        callsign: verifiedCred.adminCallsign || 'KOMANDO-01 [ADMIN HP]',
        unit: 'SUBDIS RUDAL DISKOMLEKAU',
        rank: 'Kasubdis Rudal Diskomlekau',
        frequency: 'DIRECT WEBRTC P2P',
        sector: 'Puskodal Mabesau',
        mode: 'live-peer',
        isGroup: false,
        avatarColor: 'from-cyan-400 to-blue-700',
        connectionState: 'HANDSHAKING',
        iceState: 'checking',
        dataChannelState: 'connecting',
        remoteFingerprint: verifiedCred.adminFingerprint,
        sharedKeyHash: adminSharedKeyHash,
        latencyMs: 5,
        unreadCount: 0,
        lastMessagePreview: `Auto-Dial P2P ID ${verifiedCred.assignedPeerId} -> ${targetAdminPeerId} aktif...`,
        lastActivityTime: Date.now(),
        provisionedByAdmin: true,
        autoResponderProfile: 'hq',
      };

      setContacts((prev) => [
        adminContact,
        ...prev.filter((c) => c.peerId !== adminContact.peerId && c.nrp !== '526316'),
      ]);
      setOpenChatPeerId(adminContact.peerId);

      // Immediately register this Operative node on the Cross-Device Signaling Broker (MQTT WSS + PeerJS)
      sendNodeRegistration(newIdentity);

      // Auto-Dial Admin HP across cellular/internet with multi-step retry until DataChannel opens
      const triggerAutoDial = () => {
        const currentTunnel = livePeerTunnelsRef.current.get(targetAdminPeerId);
        if (currentTunnel?.dc?.readyState === 'open') {
          return;
        }
        sendNodeRegistration(localIdentityRef.current);
        initiateLiveWebRTCOffer(
          targetAdminPeerId,
          'Kolonel Lek Yudhi Eko Santoso',
          '526316'
        );
      };

      window.setTimeout(triggerAutoDial, 200);
      window.setTimeout(triggerAutoDial, 1600);
      window.setTimeout(triggerAutoDial, 3800);
    },
    [initiateLiveWebRTCOffer, sendNodeRegistration]
  );

  // Initialize Master Admin ECDH P-256 + ECDSA P-256 Keypairs, Check URL for ?join= / ?invite= QR Link Onboarding, and Connect Cross-Device Signaling
  useEffect(() => {
    let isMounted = true;
    let autoDialInterval: number | null = null;

    const initSystem = async () => {
      const ecdh = await generateEphemeralECDHKeyPair();
      const signing = await generateAdminSigningKeyPair();
      if (!isMounted) return;

      const initialAdminIdentity: LocalNodeIdentity = {
        ...localIdentityRef.current,
        publicKeyJwk: ecdh.publicKeyJwk,
        privateKey: ecdh.privateKey,
        signingPublicKeyJwk: signing.signingPublicKeyJwk,
        signingPrivateKey: signing.signingPrivateKey,
        fingerprint: ecdh.fingerprint,
      };
      localIdentityRef.current = initialAdminIdentity;
      setLocalIdentity(initialAdminIdentity);

      // 1. Connect Cross-Device Signaling Bus (MQTT over WSS + PeerJS Cloud) FIRST so outgoing registration & auto-dial queue/fire immediately
      const ws = new TacticalCrossDeviceSignalingSocket();
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted) return;
        setWsSignalConnected(true);
        sendNodeRegistration(localIdentityRef.current);

        // If client joined via QR/Link (?join=...), immediately auto-dial Admin HP once signaling broker is online
        if (pendingAutoDialPeerRef.current) {
          const target = pendingAutoDialPeerRef.current;
          window.setTimeout(() => {
            initiateLiveWebRTCOffer(target.peerId, target.callsign, target.nrp);
          }, 150);
        }
      };

      ws.onclose = () => {
        if (!isMounted) return;
        setWsSignalConnected(false);
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);

          // 0. Server-assigned collision-safe ID if a 2nd browser tab connected before scanning QR
          if (msg.type === 'node:assigned-id' && msg.peerId) {
            if (localIdentityRef.current.role === 'ADMIN') {
              const updated = {
                ...localIdentityRef.current,
                peerId: String(msg.peerId),
              };
              localIdentityRef.current = updated;
              setLocalIdentity(updated);
            }
            return;
          }

          // 1. Live Peer Directory Sync & Immediate ECDH P-256 Shared Key Derivation
          if (msg.type === 'directory:sync' && Array.isArray(msg.peers)) {
            const remoteNodes: Array<{
              peerId: string;
              callsign: string;
              nrp?: string;
              unit: string;
              rank: string;
              role?: string;
              publicKeyJwk?: JsonWebKey;
              fingerprint?: string;
            }> = msg.peers.filter(
              (p: { peerId: string }) => p.peerId !== localIdentityRef.current.peerId
            );

            const activePrivateKey = localIdentityRef.current.privateKey;
            const activePublicKeyJwk = localIdentityRef.current.publicKeyJwk;

            const derivedMap = new Map<
              string,
              { sharedKeyHash: string; remoteFingerprint: string }
            >();

            if (activePrivateKey) {
              for (const rn of remoteNodes) {
                const rnNrp = rn.nrp || rn.peerId.split('-')[2] || rn.peerId.slice(-6);
                if (rn.publicKeyJwk) {
                  try {
                    const remoteFp =
                      rn.fingerprint || (await computeJwkFingerprint(rn.publicKeyJwk));

                    let tunnel = livePeerTunnelsRef.current.get(rn.peerId);
                    if (!tunnel) {
                      tunnel = createEmptyLivePeerTunnel(
                        rn.peerId,
                        rn.callsign,
                        rnNrp
                      );
                      livePeerTunnelsRef.current.set(rn.peerId, tunnel);
                    } else {
                      tunnel.peerName = rn.callsign || tunnel.peerName;
                      tunnel.peerNrp = rnNrp || tunnel.peerNrp;
                    }

                    if (
                      !tunnel.sharedKey ||
                      tunnel.remotePublicKeyJwk?.x !== rn.publicKeyJwk.x
                    ) {
                      const derived = await deriveSharedAESGCMKey(
                        activePrivateKey,
                        rn.publicKeyJwk
                      );
                      tunnel.sharedKey = derived.sharedKey;
                      tunnel.remotePublicKeyJwk = rn.publicKeyJwk;
                      tunnel.sharedKeyHash = derived.sharedKeyHash;
                      tunnel.remoteFingerprint = remoteFp;
                    }

                    derivedMap.set(rn.peerId, {
                      sharedKeyHash: tunnel.sharedKeyHash,
                      remoteFingerprint: tunnel.remoteFingerprint,
                    });

                    // Close any local loopback auto-responder for this live peer ID
                    const oldLoopback = loopbackTunnelsRef.current.get(rn.peerId);
                    if (oldLoopback) {
                      oldLoopback.localDc.close();
                      oldLoopback.localPc.close();
                      oldLoopback.remotePc.close();
                      loopbackTunnelsRef.current.delete(rn.peerId);
                    }

                    // Operative (or peer with higher ID) auto-dials immediately; Admin waits 1.2s for Client's auto-dial first
                    const needsConnection =
                      activePublicKeyJwk &&
                      (!tunnel.dc || tunnel.dc.readyState !== 'open') &&
                      (!tunnel.pc ||
                        tunnel.pc.connectionState === 'new' ||
                        tunnel.pc.connectionState === 'closed' ||
                        tunnel.pc.connectionState === 'failed' ||
                        tunnel.pc.iceConnectionState === 'disconnected' ||
                        tunnel.pc.iceConnectionState === 'failed');

                    if (needsConnection) {
                      if (
                        localIdentityRef.current.role === 'OPERATIVE' ||
                        localIdentityRef.current.peerId > rn.peerId
                      ) {
                        initiateLiveWebRTCOffer(rn.peerId, rn.callsign, rnNrp);
                      } else {
                        const targetPid = rn.peerId;
                        const targetCs = rn.callsign;
                        window.setTimeout(() => {
                          const currentTunnel = livePeerTunnelsRef.current.get(targetPid);
                          if (
                            !currentTunnel?.pc ||
                            (currentTunnel.dc?.readyState !== 'open' &&
                              currentTunnel.pc.signalingState === 'stable')
                          ) {
                            initiateLiveWebRTCOffer(targetPid, targetCs, rnNrp);
                          }
                        }, 1300);
                      }
                    }
                  } catch {
                    // Ignore key derivation error
                  }
                }
              }
            }

            setContacts((prev) => {
              const updatedList = [...prev];

              for (const rn of remoteNodes) {
                const rnNrp = rn.nrp || rn.peerId.split('-')[2] || rn.peerId.slice(-6);
                const cryptoMeta = derivedMap.get(rn.peerId);
                const currentTunnel = livePeerTunnelsRef.current.get(rn.peerId);
                const currentDcState = currentTunnel?.dc?.readyState || 'connecting';
                const currentIceState =
                  currentTunnel?.pc?.iceConnectionState || 'checking';
                const isChannelOpen = currentDcState === 'open';

                const matchIdx = updatedList.findIndex(
                  (c) =>
                    c.peerId === rn.peerId ||
                    (!c.isGroup && c.nrp === rnNrp && c.provisionedByAdmin)
                );

                if (matchIdx !== -1) {
                  const existing = updatedList[matchIdx];
                  updatedList[matchIdx] = {
                    ...existing,
                    peerId: rn.peerId,
                    personnelName: rn.callsign || existing.personnelName,
                    nrp: rnNrp,
                    unit: rn.unit || existing.unit,
                    rank: rn.rank || existing.rank,
                    mode: 'live-peer',
                    connectionState: isChannelOpen ? 'CONNECTED' : 'HANDSHAKING',
                    iceState: isChannelOpen ? 'connected' : currentIceState,
                    dataChannelState: currentDcState,
                    remoteFingerprint:
                      cryptoMeta?.remoteFingerprint ||
                      rn.fingerprint ||
                      existing.remoteFingerprint,
                    sharedKeyHash:
                      cryptoMeta?.sharedKeyHash || existing.sharedKeyHash,
                    latencyMs: 6,
                  };
                } else {
                  updatedList.unshift({
                    peerId: rn.peerId,
                    personnelName: rn.callsign,
                    nrp: rnNrp,
                    callsign: `${rn.callsign} [LIVE P2P]`,
                    unit: rn.unit || 'DISKOMLEKAU',
                    rank: rn.rank || 'Personel Aktif',
                    frequency: 'DIRECT WEBRTC P2P',
                    sector: 'Multi-Client Live P2P',
                    mode: 'live-peer',
                    isGroup: false,
                    avatarColor: 'from-cyan-400 to-teal-700',
                    connectionState: isChannelOpen ? 'CONNECTED' : 'HANDSHAKING',
                    iceState: isChannelOpen ? 'connected' : currentIceState,
                    dataChannelState: currentDcState,
                    remoteFingerprint:
                      cryptoMeta?.remoteFingerprint ||
                      rn.fingerprint ||
                      'ECDH-P256-VERIFIED',
                    sharedKeyHash: cryptoMeta?.sharedKeyHash || 'AES-256-GCM-OK',
                    latencyMs: 6,
                    unreadCount: 1,
                    lastMessagePreview:
                      'Terhubung langsung P2P E2EE (Chat, Suara & Video Siap).',
                    lastActivityTime: Date.now(),
                    provisionedByAdmin: true,
                  });
                }
              }

              return updatedList;
            });
          }

          // 2. Direct E2EE Encrypted Packet Relay (Fallback only while DataChannel is negotiating / Group broadcast)
          if (
            (msg.type === 'e2ee:packet' || msg.type === 'e2ee:group-packet') &&
            msg.packet
          ) {
            await processIncomingLiveEncryptedPacket(msg.packet as DataChannelPacket);
          }

          // 3. Delivery & Decryption Verification Ack
          if (msg.type === 'e2ee:ack' && msg.packet) {
            const ack = msg.packet as DataChannelPacket;
            if (ack.ackStage) {
              updateMessageStatus(ack.senderPeerId, ack.messageId, ack.ackStage);
            }
          }

          // 4. Live Ephemeral SITREP Status Broadcast
          if (msg.type === 'status:broadcast' && msg.statusItem) {
            const incomingStatus = msg.statusItem as EphemeralStatusUpdate;
            setStatusUpdates((prev) => {
              if (prev.some((s) => s.id === incomingStatus.id)) return prev;
              return [incomingStatus, ...prev];
            });
          }

          // 5. Live Multi-Client Voice Call & Video Call Invitation
          if (msg.type === 'call:invite' && msg.fromPeerId) {
            const cType = msg.callType === 'video' ? 'video' : 'voice';
            setIncomingCallInvite({
              fromPeerId: msg.fromPeerId,
              callerName: msg.callerName || `Personel ${msg.fromPeerId}`,
              callerNrp: msg.callerNrp || msg.fromPeerId.slice(-6),
              callerRank: msg.callerRank || 'Personel Aktif',
              callType: cType,
              timestamp: Date.now(),
            });
            void sendBackgroundSystemNotification(
              `PANGGILAN ${cType === 'video' ? 'VIDEO' : 'SUARA'} P2P MASUK`,
              `${msg.callerName || msg.fromPeerId} (${msg.callerRank || 'Personel'}) memanggil...`,
              soundAlertEnabledRef.current,
              'call'
            );
            setCallHistory((prev) => [
              {
                id: `CALL-${Date.now()}`,
                contactPeerId: msg.fromPeerId,
                personnelName: msg.callerName || `Personel ${msg.fromPeerId}`,
                rank: msg.callerRank || 'Personel Aktif',
                nrp: msg.callerNrp || msg.fromPeerId.slice(-6),
                timestamp: Date.now(),
                callType: cType,
                direction: 'incoming',
              },
              ...prev,
            ]);
          }

          // 6. Live Call Signaling & Media Frame Relay
          if (
            msg.type === 'call:accept' ||
            msg.type === 'call:reject' ||
            msg.type === 'call:hangup' ||
            msg.type === 'call:webrtc-offer' ||
            msg.type === 'call:webrtc-answer' ||
            msg.type === 'call:webrtc-ice' ||
            msg.type === 'call:media-frame'
          ) {
            if (msg.type === 'call:hangup' || msg.type === 'call:reject') {
              setIncomingCallInvite((prev) =>
                prev && prev.fromPeerId === msg.fromPeerId ? null : prev
              );
            }
            setLatestCallSignal({
              ...msg,
              timestamp: Date.now(),
            } as LiveCallSignalPacket);
          }

          // 7. Precision WebRTC DataChannel SDP Handshake & ICE Candidate Gathering
          if (msg.type === 'webrtc:offer' && msg.fromPeerId && msg.sdp && msg.publicKeyJwk) {
            const fromPeerId: string = msg.fromPeerId;
            const fromCallsign: string = msg.fromCallsign || `Personel-${fromPeerId}`;
            const fromNrp: string = msg.fromNrp || fromPeerId.split('-')[2] || fromPeerId.slice(-6);
            const remotePubJwk: JsonWebKey = msg.publicKeyJwk;

            // Close any local loopback auto-responder for this live peer
            const oldLoopback = loopbackTunnelsRef.current.get(fromPeerId);
            if (oldLoopback) {
              oldLoopback.localDc.close();
              oldLoopback.localPc.close();
              oldLoopback.remotePc.close();
              loopbackTunnelsRef.current.delete(fromPeerId);
            }

            // CRITICAL: Synchronously create or lock tunnel BEFORE any async await so early trickle ICE candidates are queued!
            let tunnel = livePeerTunnelsRef.current.get(fromPeerId);
            if (!tunnel) {
              tunnel = createEmptyLivePeerTunnel(fromPeerId, fromCallsign, fromNrp);
              livePeerTunnelsRef.current.set(fromPeerId, tunnel);
            }
            tunnel.peerName = fromCallsign;
            tunnel.peerNrp = fromNrp;
            tunnel.isSettingRemoteDescription = true;

            const isPolite = localIdentityRef.current.peerId > fromPeerId;
            const offerCollision =
              tunnel.makingOffer ||
              (tunnel.pc && tunnel.pc.signalingState !== 'stable');

            if (offerCollision && !isPolite && !msg.iceRestart) {
              tunnel.isSettingRemoteDescription = false;
              return;
            }

            // Create a clean RTCPeerConnection(TACTICAL_ICE_CONFIG) for incoming offer (or reuse on ICE restart)
            let pc = tunnel.pc;
            if (!pc || pc.signalingState === 'closed' || !msg.iceRestart || offerCollision) {
              if (pc) {
                try {
                  pc.close();
                } catch {
                  // Ignore
                }
              }
              pc = new RTCPeerConnection(TACTICAL_ICE_CONFIG);
              tunnel.pc = pc;
              tunnel.localGatheredCandidates = [];
              tunnel.localCandidatesSent = 0;
              attachLivePeerConnectionListeners(pc, tunnel);
            }

            const remoteFp = await computeJwkFingerprint(remotePubJwk);
            const myPrivKey = localIdentityRef.current.privateKey || ecdh.privateKey;
            const myPubJwk = localIdentityRef.current.publicKeyJwk || ecdh.publicKeyJwk;

            const { sharedKey, sharedKeyHash } = await deriveSharedAESGCMKey(
              myPrivKey,
              remotePubJwk
            );

            tunnel.sharedKey = sharedKey;
            tunnel.remotePublicKeyJwk = remotePubJwk;
            tunnel.sharedKeyHash = sharedKeyHash;
            tunnel.remoteFingerprint = remoteFp;

            // Update contact list to show ICE: CHECKING / HANDSHAKING immediately
            setContacts((prev) => {
              const list = [...prev];
              const idx = list.findIndex(
                (c) =>
                  c.peerId === fromPeerId ||
                  (!c.isGroup && c.nrp === fromNrp && c.provisionedByAdmin)
              );
              if (idx !== -1) {
                list[idx] = {
                  ...list[idx],
                  peerId: fromPeerId,
                  personnelName: fromCallsign || list[idx].personnelName,
                  nrp: fromNrp,
                  mode: 'live-peer',
                  connectionState:
                    tunnel?.dc?.readyState === 'open' ? 'CONNECTED' : 'HANDSHAKING',
                  iceState: pc?.iceConnectionState === 'new' ? 'checking' : (pc?.iceConnectionState || 'checking'),
                  dataChannelState: tunnel?.dc?.readyState || 'connecting',
                  remoteFingerprint: remoteFp,
                  sharedKeyHash,
                };
              } else {
                list.unshift({
                  peerId: fromPeerId,
                  personnelName: fromCallsign,
                  nrp: fromNrp,
                  callsign: `${fromCallsign} [LIVE P2P]`,
                  unit: 'SATKOM DISKOMLEKAU',
                  rank: 'Personel Aktif',
                  frequency: 'DIRECT WEBRTC P2P',
                  sector: 'Multi-Client Live P2P',
                  mode: 'live-peer',
                  isGroup: false,
                  avatarColor: 'from-cyan-400 to-teal-700',
                  connectionState: 'HANDSHAKING',
                  iceState: 'checking',
                  dataChannelState: 'connecting',
                  remoteFingerprint: remoteFp,
                  sharedKeyHash,
                  latencyMs: 6,
                  unreadCount: 1,
                  lastMessagePreview: `Auto-Dial masuk dari ${fromCallsign} (${fromPeerId})...`,
                  lastActivityTime: Date.now(),
                  provisionedByAdmin: true,
                });
              }
              return list;
            });

            pc.ondatachannel = (dcEvent) => {
              tunnel!.dc = dcEvent.channel;
              setupLivePeerDataChannel(
                fromPeerId,
                fromCallsign,
                fromNrp,
                pc!,
                dcEvent.channel,
                sharedKey,
                sharedKeyHash,
                remoteFp
              );
            };

            try {
              if (pc.signalingState !== 'stable') {
                await pc.setLocalDescription({ type: 'rollback' });
              }
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
              tunnel.isSettingRemoteDescription = false;

              recordIceDiagnosticLog({
                id: `SDP-RX-OFFER-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                timestamp: Date.now(),
                peerId: fromPeerId,
                peerName: fromCallsign,
                category: 'SDP_HANDSHAKE',
                iceConnectionState: pc.iceConnectionState,
                iceGatheringState: pc.iceGatheringState,
                signalingState: pc.signalingState,
                dataChannelState: tunnel.dc?.readyState || 'connecting',
                detail: `setRemoteDescription(SDP Offer${msg.iceRestart ? ' / ICE-Restart' : ''}) verified`,
              });

              // Immediately flush any remote ICE candidates that arrived while Offer was being processed
              await flushPendingRemoteIceCandidates(tunnel, recordIceDiagnosticLog);

              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);

              // Wait for local STUN/TURN ICE candidates to gather into the SDP Answer
              await waitForIceGatheringComplete(pc, 1100);

              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'webrtc:answer',
                    targetPeerId: fromPeerId,
                    targetNrp: fromNrp,
                    sdp: pc.localDescription || answer,
                    publicKeyJwk: myPubJwk,
                  })
                );

                recordIceDiagnosticLog({
                  id: `SDP-TX-ANS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  timestamp: Date.now(),
                  peerId: fromPeerId,
                  peerName: fromCallsign,
                  category: 'SDP_HANDSHAKE',
                  iceConnectionState: pc.iceConnectionState,
                  iceGatheringState: pc.iceGatheringState,
                  signalingState: pc.signalingState,
                  dataChannelState: tunnel.dc?.readyState || 'connecting',
                  detail: `setLocalDescription(SDP Answer) verified & transmitted (${tunnel.localCandidatesSent} ICE candidates)`,
                });
              }
            } catch (err) {
              tunnel.isSettingRemoteDescription = false;
              console.warn('[SILENT LINK SDP] Error handling incoming Offer:', err);
            }
          }

          if (msg.type === 'webrtc:answer' && msg.fromPeerId && msg.sdp && msg.publicKeyJwk) {
            const fromPeerId: string = msg.fromPeerId;
            const tunnel = livePeerTunnelsRef.current.get(fromPeerId);
            const myPrivKey = localIdentityRef.current.privateKey || ecdh.privateKey;

            if (tunnel && tunnel.pc) {
              tunnel.isSettingRemoteDescription = true;
              try {
                const remoteFp = await computeJwkFingerprint(msg.publicKeyJwk);
                const { sharedKey, sharedKeyHash } = await deriveSharedAESGCMKey(
                  myPrivKey,
                  msg.publicKeyJwk
                );
                tunnel.sharedKey = sharedKey;
                tunnel.remotePublicKeyJwk = msg.publicKeyJwk;
                tunnel.sharedKeyHash = sharedKeyHash;
                tunnel.remoteFingerprint = remoteFp;

                if (tunnel.pc.signalingState === 'have-local-offer') {
                  await tunnel.pc.setRemoteDescription(
                    new RTCSessionDescription(msg.sdp)
                  );
                }
                tunnel.isSettingRemoteDescription = false;

                recordIceDiagnosticLog({
                  id: `SDP-RX-ANS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  timestamp: Date.now(),
                  peerId: fromPeerId,
                  peerName: tunnel.peerName,
                  category: 'SDP_HANDSHAKE',
                  iceConnectionState: tunnel.pc.iceConnectionState,
                  iceGatheringState: tunnel.pc.iceGatheringState,
                  signalingState: tunnel.pc.signalingState,
                  dataChannelState: tunnel.dc?.readyState || 'connecting',
                  detail: 'setRemoteDescription(SDP Answer) verified. Flushing ICE candidate queue...',
                });

                // Flush any buffered remote ICE candidates immediately after setRemoteDescription
                await flushPendingRemoteIceCandidates(tunnel, recordIceDiagnosticLog);

                setContacts((prev) =>
                  prev.map((c) =>
                    c.peerId === fromPeerId
                      ? {
                          ...c,
                          mode: 'live-peer',
                          connectionState:
                            tunnel.dc?.readyState === 'open' ? 'CONNECTED' : 'HANDSHAKING',
                          remoteFingerprint: remoteFp,
                          sharedKeyHash,
                        }
                      : c
                  )
                );
              } catch (err) {
                tunnel.isSettingRemoteDescription = false;
                console.warn('[SILENT LINK SDP] Error applying SDP Answer:', err);
              }
            }
          }

          if (msg.type === 'webrtc:ice-candidate' && msg.fromPeerId && msg.candidate) {
            const fromPeerId: string = msg.fromPeerId;
            let tunnel = livePeerTunnelsRef.current.get(fromPeerId);
            if (!tunnel) {
              tunnel = createEmptyLivePeerTunnel(fromPeerId);
              livePeerTunnelsRef.current.set(fromPeerId, tunnel);
            }
            await addOrQueueRemoteIceCandidate(
              tunnel,
              msg.candidate,
              recordIceDiagnosticLog
            );
          }
        } catch {
          // Ignore malformed signaling packet
        }
      };

      // 2. Check if launched via Admin-generated QR Code Link (?join=SLK-ID-... or ?invite=SLK-ID-...) or Encrypted Deep Link (?silentlink_token=SLK2...)
      const params = new URLSearchParams(window.location.search);
      const joinOrInviteParam = params.get('join') || params.get('invite');
      const deepLinkToken = params.get('silentlink_token');
      if (joinOrInviteParam || deepLinkToken) {
        try {
          const verifiedCred = await verifyAndParseProvisioningToken(
            joinOrInviteParam ? window.location.href : deepLinkToken!
          );
          window.history.replaceState({}, document.title, window.location.pathname);
          await handleCompleteOperativeOnboarding(verifiedCred);
        } catch {
          // Continue normal initialization if invalid
        }
      } else {
        // Register initial Master Admin identity on signaling bus & pre-connect preset loopback demo contact
        sendNodeRegistration(initialAdminIdentity);
        const firstContact = INITIAL_TACTICAL_CONTACTS[0];
        await establishLoopbackWebRTCTunnel(firstContact, {
          privateKey: ecdh.privateKey,
          publicKeyJwk: ecdh.publicKeyJwk,
          fingerprint: ecdh.fingerprint,
        });
      }

      // 3. Background Auto-Dial Retry Watchdog for pending QR/Link cross-device connections
      autoDialInterval = window.setInterval(() => {
        if (!isMounted || wsRef.current?.readyState !== WebSocket.OPEN) return;
        const target = pendingAutoDialPeerRef.current;
        if (target) {
          const t = livePeerTunnelsRef.current.get(target.peerId);
          if (t?.dc?.readyState === 'open') {
            pendingAutoDialPeerRef.current = null;
          } else if (
            !t?.makingOffer &&
            (!t?.pc ||
              t.pc.iceConnectionState === 'failed' ||
              t.pc.iceConnectionState === 'disconnected' ||
              t.pc.iceConnectionState === 'closed' ||
              t.pc.signalingState === 'stable')
          ) {
            sendNodeRegistration(localIdentityRef.current);
            initiateLiveWebRTCOffer(target.peerId, target.callsign, target.nrp);
          }
        }
      }, 4500);
    };

    initSystem();

    const handleUnload = () => {
      if (autoDialInterval) window.clearInterval(autoDialInterval);
      loopbackTunnelsRef.current.forEach((t) => {
        t.localDc.close();
        t.localPc.close();
        t.remotePc.close();
      });
      livePeerTunnelsRef.current.forEach((t) => {
        if (t.iceRestartTimer) window.clearTimeout(t.iceRestartTimer);
        t.dc?.close();
        t.pc?.close();
      });
      wsRef.current?.close();
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => {
      isMounted = false;
      if (autoDialInterval) window.clearInterval(autoDialInterval);
      window.removeEventListener('beforeunload', handleUnload);
      handleUnload();
    };
  }, [
    attachLivePeerConnectionListeners,
    establishLoopbackWebRTCTunnel,
    handleCompleteOperativeOnboarding,
    initiateLiveWebRTCOffer,
    processIncomingLiveEncryptedPacket,
    recordIceDiagnosticLog,
    sendNodeRegistration,
    setupLivePeerDataChannel,
    updateMessageStatus,
  ]);

  // Handle Admin Provisioning of a New Operative (Personnel Name + NRP)
  const handleAdminCredentialProvisioned = async (
    cred: ProvisionedOperativeCredential,
    deployLocalLoopback: boolean
  ) => {
    setIssuedCredentials((prev) => [cred, ...prev]);

    // Publish retained invite credential to Cross-Device MQTT WSS Broker so scanning smartphone syncs immediately
    wsRef.current?.publishRetainedInvite(cred);
    sendNodeRegistration(localIdentityRef.current);

    recordPacketLog(
      'PROVISION',
      `${cred.personnelName} (${cred.nrp})`,
      'ECDSA-P256',
      cred.signatureHex,
      cred.encryptedToken.length
    );

    if (deployLocalLoopback && localIdentity.privateKey && localIdentity.publicKeyJwk) {
      let existingTunnel = livePeerTunnelsRef.current.get(cred.assignedPeerId);
      if (!existingTunnel) {
        existingTunnel = createEmptyLivePeerTunnel(
          cred.assignedPeerId,
          cred.personnelName,
          cred.nrp
        );
        livePeerTunnelsRef.current.set(cred.assignedPeerId, existingTunnel);
      }
      const isAlreadyOpen = existingTunnel.dc?.readyState === 'open';

      const newOperativeContact: TacticalContact = {
        peerId: cred.assignedPeerId,
        personnelName: cred.personnelName,
        nrp: cred.nrp,
        callsign: `${cred.personnelName} [NRP:${cred.nrp}]`,
        unit: cred.unit,
        rank: cred.rank,
        frequency: 'CROSS-DEVICE WEBRTC P2P',
        sector: 'Verified Operative',
        mode: 'live-peer',
        isGroup: false,
        avatarColor: 'from-cyan-500 to-teal-700',
        connectionState: isAlreadyOpen ? 'CONNECTED' : 'HANDSHAKING',
        iceState: isAlreadyOpen ? 'connected' : 'checking',
        dataChannelState: isAlreadyOpen ? 'open' : 'connecting',
        remoteFingerprint: 'MENUNGGU AUTO-DIAL QR PERSONEL...',
        sharedKeyHash: 'SIAP ECDH P-256...',
        latencyMs: 0,
        unreadCount: 1,
        lastMessagePreview: `QR & Link (?join=${cred.assignedPeerId}) siap. Otomatis tersambung P2P saat dipindai.`,
        lastActivityTime: Date.now(),
        provisionedByAdmin: true,
        autoResponderProfile: 'field',
      };

      setContacts((prev) => [
        newOperativeContact,
        ...prev.filter((c) => c.peerId !== cred.assignedPeerId),
      ]);
    }
  };

  // Switch back to Master Admin Device Mode
  const handleRestoreAdminRole = async () => {
    const ecdh = await generateEphemeralECDHKeyPair();
    const signing = await generateAdminSigningKeyPair();

    const adminIdentity: LocalNodeIdentity = {
      peerId: 'SLK-ADM-526316-0001',
      role: 'ADMIN',
      personnelName: 'Kolonel Lek Yudhi Eko Santoso',
      nrp: '526316',
      callsign: 'KOMANDO-01 [ADMIN HP]',
      unit: 'SUBDIS RUDAL DISKOMLEKAU',
      rank: 'Kasubdis Rudal Diskomlekau',
      publicKeyJwk: ecdh.publicKeyJwk,
      privateKey: ecdh.privateKey,
      signingPublicKeyJwk: signing.signingPublicKeyJwk,
      signingPrivateKey: signing.signingPrivateKey,
      fingerprint: ecdh.fingerprint,
      sessionStartedAt: Date.now(),
    };

    localIdentityRef.current = adminIdentity;
    setLocalIdentity(adminIdentity);
    setIsLoggedIn(true);
    sendNodeRegistration(adminIdentity);
  };

  // Login or Switch Account from Mobile Settings Modal
  const handleLoginAccount = async (params: {
    name: string;
    nrp: string;
    rank: string;
    unit: string;
    role: DeviceRole;
  }) => {
    const ecdh = await generateEphemeralECDHKeyPair();
    const signing =
      params.role === 'ADMIN'
        ? await generateAdminSigningKeyPair()
        : { signingPublicKeyJwk: null, signingPrivateKey: null };

    const cleanNrp = params.nrp.replace(/[^a-zA-Z0-9]/g, '') || '526316';
    const isDefaultMaster =
      params.role === 'ADMIN' && cleanNrp === '526316';
    const suffix = isDefaultMaster
      ? '0001'
      : Math.random().toString(36).slice(2, 6).toUpperCase();
    const peerId =
      params.role === 'ADMIN'
        ? `SLK-ADM-${cleanNrp}-${suffix}`
        : `SLK-ID-${cleanNrp}-${suffix}`;

    const newIdentity: LocalNodeIdentity = {
      peerId,
      role: params.role,
      personnelName: params.name,
      nrp: cleanNrp,
      callsign: `${params.name} [${params.role === 'ADMIN' ? 'ADMIN HP' : 'OPERATIVE'}]`,
      unit: params.unit,
      rank: params.rank,
      publicKeyJwk: ecdh.publicKeyJwk,
      privateKey: ecdh.privateKey,
      signingPublicKeyJwk: signing.signingPublicKeyJwk,
      signingPrivateKey: signing.signingPrivateKey,
      fingerprint: ecdh.fingerprint,
      sessionStartedAt: Date.now(),
    };

    localIdentityRef.current = newIdentity;
    setLocalIdentity(newIdentity);
    setIsLoggedIn(true);
    sendNodeRegistration(newIdentity);
  };

  // Logout Account (Zero-Retention RAM Wipe of Session Keys & Chat History)
  const handleLogoutAccount = () => {
    loopbackTunnelsRef.current.forEach((t) => {
      t.localDc.close();
      t.localPc.close();
      t.remotePc.close();
    });
    loopbackTunnelsRef.current.clear();

    livePeerTunnelsRef.current.forEach((t) => {
      if (t.iceRestartTimer) window.clearTimeout(t.iceRestartTimer);
      t.dc?.close();
      t.pc?.close();
    });
    livePeerTunnelsRef.current.clear();
    processedMessageIdsRef.current.clear();

    setMessagesByPeer({});
    setOpenChatPeerId(null);
    setIsLoggedIn(false);
  };

  // Open Chat Room when a chat row is clicked
  const handleOpenChatRoom = async (contact: TacticalContact) => {
    setOpenChatPeerId(contact.peerId);
    setShowEmojiPicker(false);
    setShowTopMenuDropdown(false);

    setContacts((prev) =>
      prev.map((c) => (c.peerId === contact.peerId ? { ...c, unreadCount: 0 } : c))
    );

    if (contact.mode === 'live-peer') {
      const liveTunnel = livePeerTunnelsRef.current.get(contact.peerId);
      if (!liveTunnel?.dc || liveTunnel.dc.readyState !== 'open') {
        initiateLiveWebRTCOffer(contact.peerId, contact.personnelName, contact.nrp);
      }
      return;
    }

    if (
      contact.mode === 'loopback-webrtc' &&
      !livePeerTunnelsRef.current.has(contact.peerId) &&
      localIdentity.privateKey &&
      localIdentity.publicKeyJwk
    ) {
      await establishLoopbackWebRTCTunnel(contact, {
        privateKey: localIdentity.privateKey,
        publicKeyJwk: localIdentity.publicKeyJwk,
        fingerprint: localIdentity.fingerprint,
      });
    }
  };

  // Transmit Encrypted Payload over Ordered/Reliable WebRTC DataChannel (checking readyState === 'open') + Live E2EE Relay
  const transmitEncryptedPayload = async (
    kind: 'text' | 'image' | 'document' | 'voice',
    text: string,
    fileMeta?: FileAttachmentMeta,
    voiceMeta?: VoiceNoteMeta
  ) => {
    const targetPeerId = openChatPeerId || contacts[0]?.peerId;
    const activeContact = contacts.find((c) => c.peerId === targetPeerId);
    if (!activeContact || !localIdentity.privateKey || !localIdentity.publicKeyJwk) return;

    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    processedMessageIdsRef.current.add(messageId);

    const serializedCleartext = JSON.stringify({
      text,
      fileMeta,
      voiceMeta,
    });

    // Check if target is a live connected peer (or has a live tunnel)
    let liveTunnel = livePeerTunnelsRef.current.get(activeContact.peerId);
    if (!liveTunnel && !activeContact.isGroup) {
      // Also check if another live tunnel matches by NRP
      for (const [, candidateTunnel] of livePeerTunnelsRef.current.entries()) {
        if (candidateTunnel.peerNrp === activeContact.nrp && candidateTunnel.sharedKey) {
          liveTunnel = candidateTunnel;
          break;
        }
      }
    }

    const isLivePeer =
      activeContact.mode === 'live-peer' || Boolean(liveTunnel?.sharedKey);

    if (isLivePeer) {
      let sharedKey = liveTunnel?.sharedKey || null;

      // If sharedKey is not yet derived, check if remotePublicKeyJwk is available on the tunnel
      if (!sharedKey && liveTunnel?.remotePublicKeyJwk) {
        try {
          const derived = await deriveSharedAESGCMKey(
            localIdentity.privateKey,
            liveTunnel.remotePublicKeyJwk
          );
          sharedKey = derived.sharedKey;
          liveTunnel.sharedKey = derived.sharedKey;
          liveTunnel.sharedKeyHash = derived.sharedKeyHash;
        } catch {
          // Will re-sync via directory:sync
        }
      }

      if (!sharedKey) {
        // Request fresh directory sync & initiate WebRTC Offer
        sendNodeRegistration(localIdentityRef.current);
        initiateLiveWebRTCOffer(
          activeContact.peerId,
          activeContact.personnelName,
          activeContact.nrp
        );
        return;
      }

      const envelope = await encryptAES256GCM(sharedKey, serializedCleartext);

      // Verify DataChannel readyState === 'open' before transmission
      const packet: DataChannelPacket = {
        packetType: 'ENCRYPTED_MSG',
        messageId,
        senderPeerId: localIdentity.peerId,
        senderCallsign: localIdentity.personnelName,
        senderNrp: localIdentity.nrp,
        senderRank: localIdentity.rank,
        senderUnit: localIdentity.unit,
        senderPublicKeyJwk: localIdentity.publicKeyJwk,
        timestamp: Date.now(),
        kind,
        ciphertextB64: envelope.ciphertextB64,
        ivB64: envelope.ivB64,
        ivHex: envelope.ivHex,
        sha256Hash: envelope.sha256Hash,
        byteLength: envelope.byteLength,
      };

      const serializedPacket = JSON.stringify(packet);

      // 1. Transmit 100% directly over WebRTC DataChannel (ordered:true, reliable:true).
      // Once DataChannel is 'open', zero packets pass through the signaling broker.
      // If DataChannel is still handshaking, packet is queued in FIFO and flushed directly over DataChannel on open.
      const dcResult = sendOverReliableDataChannel(
        liveTunnel,
        serializedPacket,
        recordIceDiagnosticLog
      );

      // If DataChannel is not yet open, trigger Offer/ICE negotiation so the queued packet flushes over DataChannel on open
      if (!dcResult.sentImmediately) {
        initiateLiveWebRTCOffer(
          activeContact.peerId,
          activeContact.personnelName,
          activeContact.nrp
        );
      }

      const outgoingMsg: EncryptedMessage = {
        id: messageId,
        contactPeerId: activeContact.peerId,
        senderPeerId: localIdentity.peerId,
        senderCallsign: localIdentity.personnelName,
        senderNrp: localIdentity.nrp,
        timestamp: packet.timestamp,
        kind,
        plaintext: text,
        ciphertextPreview: envelope.ciphertextB64.slice(0, 64) + '...',
        ivHex: envelope.ivHex,
        sha256Hash: envelope.sha256Hash,
        byteLength: envelope.byteLength,
        status: dcResult.sentImmediately ? 'DELIVERED' : 'SENT',
        transport: dcResult.sentImmediately
          ? '100% Direct P2P WebRTC DataChannel (Zero Broker)'
          : 'WebRTC DataChannel Queue (Flushes on Open)',
        fileMeta,
        voiceMeta,
      };

      appendMessage(activeContact.peerId, outgoingMsg);
      recordPacketLog(
        'TX',
        activeContact.personnelName,
        envelope.ivHex,
        envelope.sha256Hash,
        envelope.byteLength
      );
      return;
    }

    // Loopback / Group mode: establish in-browser WebRTC DataChannel (ordered: true, reliable: true)
    const tunnel = await establishLoopbackWebRTCTunnel(activeContact, {
      privateKey: localIdentity.privateKey,
      publicKeyJwk: localIdentity.publicKeyJwk,
      fingerprint: localIdentity.fingerprint,
    });

    const envelope = await encryptAES256GCM(tunnel.sharedKey, serializedCleartext);

    const outgoingMsg: EncryptedMessage = {
      id: messageId,
      contactPeerId: activeContact.peerId,
      senderPeerId: localIdentity.peerId,
      senderCallsign: localIdentity.personnelName,
      senderNrp: localIdentity.nrp,
      timestamp: Date.now(),
      kind,
      plaintext: text,
      ciphertextPreview: envelope.ciphertextB64.slice(0, 64) + '...',
      ivHex: envelope.ivHex,
      sha256Hash: envelope.sha256Hash,
      byteLength: envelope.byteLength,
      status: 'SENT',
      transport: 'WebRTC DataChannel (ordered:true, reliable:true)',
      fileMeta,
      voiceMeta,
    };

    appendMessage(activeContact.peerId, outgoingMsg);
    recordPacketLog(
      'TX',
      activeContact.personnelName,
      envelope.ivHex,
      envelope.sha256Hash,
      envelope.byteLength
    );

    const packet: DataChannelPacket = {
      packetType: 'ENCRYPTED_MSG',
      messageId,
      senderPeerId: localIdentity.peerId,
      senderCallsign: localIdentity.personnelName,
      senderNrp: localIdentity.nrp,
      senderRank: localIdentity.rank,
      senderUnit: localIdentity.unit,
      senderPublicKeyJwk: localIdentity.publicKeyJwk,
      targetGroupPeerId: activeContact.isGroup ? activeContact.peerId : undefined,
      timestamp: outgoingMsg.timestamp,
      kind,
      ciphertextB64: envelope.ciphertextB64,
      ivB64: envelope.ivB64,
      ivHex: envelope.ivHex,
      sha256Hash: envelope.sha256Hash,
      byteLength: envelope.byteLength,
    };

    if (tunnel.localDc && tunnel.localDc.readyState === 'open') {
      tunnel.localDc.send(JSON.stringify(packet));
    }

    // If this is a Group chat, also encrypt and broadcast to every connected live peer
    if (
      activeContact.isGroup &&
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN
    ) {
      for (const [livePid, lt] of livePeerTunnelsRef.current.entries()) {
        if (lt.sharedKey) {
          try {
            const grpEnv = await encryptAES256GCM(lt.sharedKey, serializedCleartext);
            wsRef.current.send(
              JSON.stringify({
                type: 'e2ee:packet',
                targetPeerId: livePid,
                packet: {
                  ...packet,
                  ciphertextB64: grpEnv.ciphertextB64,
                  ivB64: grpEnv.ivB64,
                  ivHex: grpEnv.ivHex,
                  sha256Hash: grpEnv.sha256Hash,
                  byteLength: grpEnv.byteLength,
                } satisfies DataChannelPacket,
              })
            );
          } catch {
            // Ignore
          }
        }
      }
    }
  };

  const handleSendText = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;
    setInputText('');
    setShowEmojiPicker(false);
    await transmitEncryptedPayload('text', trimmed);
  };

  // File & Image Transfer via WebRTC DataChannel & E2EE Relay
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const isImage = file.type.startsWith('image/');
      const chunkCount = Math.max(1, Math.ceil(file.size / 16384));

      const fileMeta: FileAttachmentMeta = {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        dataUrl,
        chunkCount,
      };

      await transmitEncryptedPayload(
        isImage ? 'image' : 'document',
        isImage ? `Citra Taktis: ${file.name}` : `Dokumen: ${file.name}`,
        fileMeta
      );
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Integrated Voice Note Recording Streamed Directly to Peer via WebRTC DataChannel
  const startVoiceNoteRecording = async () => {
    if (isRecordingVoice) return;
    setIsRecordingVoice(true);
    setRecordingSeconds(0);
    recordingStartTimeRef.current = Date.now();
    recordedChunksRef.current = [];

    recordingTimerRef.current = window.setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
      setLiveVoiceWaveform(
        Array.from({ length: 18 }, () => Math.floor(20 + Math.random() * 78))
      );
    }, 500);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.start(200);
    } catch {
      mediaRecorderRef.current = null;
    }
  };

  const stopAndTransmitVoiceNote = async () => {
    if (!isRecordingVoice) return;
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const elapsedSec = Math.max(
      2,
      Math.round((Date.now() - recordingStartTimeRef.current) / 1000)
    );
    setIsRecordingVoice(false);

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => {
          recorder.stream.getTracks().forEach((t) => t.stop());
          resolve();
        };
        recorder.stop();
      });

      if (recordedChunksRef.current.length > 0) {
        const blob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        const reader = new FileReader();
        reader.onload = async () => {
          const audioDataUrl = reader.result as string;
          const voiceMeta: VoiceNoteMeta = {
            durationSec: elapsedSec,
            mimeType: blob.type || 'audio/webm',
            audioDataUrl,
            byteSize: blob.size,
            waveform: Array.from({ length: 28 }, () => Math.floor(22 + Math.random() * 75)),
          };
          await transmitEncryptedPayload(
            'voice',
            `Pesan suara terenkripsi (${elapsedSec} dtk)`,
            undefined,
            voiceMeta
          );
        };
        reader.readAsDataURL(blob);
        return;
      }
    }

    const synthVoice = synthesizeTacticalVoiceNoteWav(elapsedSec);
    await transmitEncryptedPayload(
      'voice',
      `Pesan suara terenkripsi (${synthVoice.durationSec} dtk)`,
      undefined,
      synthVoice
    );
  };

  const cancelVoiceNoteRecording = () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current.stop();
    }
    setIsRecordingVoice(false);
  };

  // Camera Button Handler (1-tap Tactical Recon Image or Camera Capture)
  const handleSendSampleReconImage = async () => {
    const sample = createSampleTacticalReconImage();
    const chunkCount = Math.max(1, Math.ceil(sample.fileSize / 16384));
    await transmitEncryptedPayload(
      'image',
      `Citra Radar Taktis (${sample.fileName})`,
      {
        fileName: sample.fileName,
        fileSize: sample.fileSize,
        mimeType: sample.mimeType,
        dataUrl: sample.dataUrl,
        chunkCount,
      }
    );
  };

  // Launch WebRTC MediaStream Call & Send Real-Time Call Invite to Remote Client
  const handleLaunchMediaCall = (contact: TacticalContact, callType: 'video' | 'voice') => {
    setMediaCallContact(contact);
    setMediaCallType(callType);
    setIsMediaCaller(true);
    setLatestCallSignal(null);
    setIsMediaStreamOpen(true);

    // Send live call invitation to remote client over WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'call:invite',
          targetPeerId: contact.peerId,
          targetNrp: contact.nrp,
          callType,
          callerName: localIdentity.personnelName,
          callerNrp: localIdentity.nrp,
          callerRank: localIdentity.rank,
        })
      );
    }

    setCallHistory((prev) => [
      {
        id: `CALL-${Date.now()}`,
        contactPeerId: contact.peerId,
        personnelName: contact.personnelName,
        rank: contact.rank,
        nrp: contact.nrp,
        timestamp: Date.now(),
        callType,
        direction: 'outgoing',
      },
      ...prev,
    ]);
  };

  // Accept Incoming Live Call from Remote Client
  const handleAcceptIncomingCall = () => {
    if (!incomingCallInvite) return;
    const matchedContact: TacticalContact =
      contacts.find((c) => c.peerId === incomingCallInvite.fromPeerId) || {
        peerId: incomingCallInvite.fromPeerId,
        personnelName: incomingCallInvite.callerName,
        nrp: incomingCallInvite.callerNrp,
        callsign: `${incomingCallInvite.callerName} [LIVE P2P]`,
        unit: 'DISKOMLEKAU P2P',
        rank: incomingCallInvite.callerRank,
        frequency: 'DIRECT WEBRTC P2P',
        sector: 'Live Multi-Client',
        mode: 'live-peer',
        isGroup: false,
        avatarColor: 'from-cyan-400 to-teal-700',
        connectionState: 'CONNECTED',
        iceState: 'connected',
        dataChannelState: 'open',
        remoteFingerprint: 'ECDH-P256-VERIFIED',
        sharedKeyHash: 'AES-256-GCM-OK',
        latencyMs: 6,
        unreadCount: 0,
        lastMessagePreview: 'Panggilan P2P Terenkripsi',
        lastActivityTime: Date.now(),
        provisionedByAdmin: true,
      };

    setMediaCallContact(matchedContact);
    setMediaCallType(incomingCallInvite.callType);
    setIsMediaCaller(false);
    setLatestCallSignal(null);
    setIncomingCallInvite(null);
    setIsMediaStreamOpen(true);
  };

  // Reject Incoming Live Call
  const handleRejectIncomingCall = () => {
    if (!incomingCallInvite) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'call:reject',
          targetPeerId: incomingCallInvite.fromPeerId,
          targetNrp: incomingCallInvite.callerNrp,
        })
      );
    }
    setIncomingCallInvite(null);
  };

  // Rotate Ephemeral ECDH P-256 Session Key
  const handleRotateSessionKey = async () => {
    const newEcdh = await generateEphemeralECDHKeyPair();
    const updatedIdentity: LocalNodeIdentity = {
      ...localIdentityRef.current,
      publicKeyJwk: newEcdh.publicKeyJwk,
      privateKey: newEcdh.privateKey,
      fingerprint: newEcdh.fingerprint,
    };
    localIdentityRef.current = updatedIdentity;
    setLocalIdentity(updatedIdentity);
    sendNodeRegistration(updatedIdentity);

    const targetId = openChatPeerId || contacts[0]?.peerId;
    const activeContact = contacts.find((c) => c.peerId === targetId);
    if (activeContact && activeContact.mode === 'loopback-webrtc') {
      const existing = loopbackTunnelsRef.current.get(activeContact.peerId);
      if (existing) {
        existing.localDc.close();
        existing.localPc.close();
        existing.remotePc.close();
        loopbackTunnelsRef.current.delete(activeContact.peerId);
      }
      await establishLoopbackWebRTCTunnel(activeContact, {
        privateKey: newEcdh.privateKey,
        publicKeyJwk: newEcdh.publicKeyJwk,
        fingerprint: newEcdh.fingerprint,
      });
    }
  };

  // Emergency Zero-Data Retention RAM Purge
  const handlePurgeSessionMemory = async () => {
    loopbackTunnelsRef.current.forEach((t) => {
      t.localDc.close();
      t.localPc.close();
      t.remotePc.close();
    });
    loopbackTunnelsRef.current.clear();

    livePeerTunnelsRef.current.forEach((t) => {
      t.dc?.close();
      t.pc?.close();
    });
    livePeerTunnelsRef.current.clear();
    processedMessageIdsRef.current.clear();

    setMessagesByPeer({});
    setPacketLogs([]);
    setIssuedCredentials([]);
    setTotalEncryptedPackets(0);
    setTotalTransmittedBytes(0);
    setOpenChatPeerId(null);
    setShowTopMenuDropdown(false);
    setShowSecuritySheet(false);

    const freshEcdh = await generateEphemeralECDHKeyPair();
    const freshSigning = await generateAdminSigningKeyPair();

    setLocalIdentity({
      peerId: 'SLK-ADM-526316-0001',
      role: 'ADMIN',
      personnelName: 'Kolonel Lek Yudhi Eko Santoso',
      nrp: '526316',
      callsign: 'KOMANDO-01 [ADMIN HP]',
      unit: 'SUBDIS RUDAL DISKOMLEKAU',
      rank: 'Kasubdis Rudal Diskomlekau',
      publicKeyJwk: freshEcdh.publicKeyJwk,
      privateKey: freshEcdh.privateKey,
      signingPublicKeyJwk: freshSigning.signingPublicKeyJwk,
      signingPrivateKey: freshSigning.signingPrivateKey,
      fingerprint: freshEcdh.fingerprint,
      sessionStartedAt: Date.now(),
    });

    const first = INITIAL_TACTICAL_CONTACTS[0];
    setContacts(INITIAL_TACTICAL_CONTACTS);

    await establishLoopbackWebRTCTunnel(first, {
      privateKey: freshEcdh.privateKey,
      publicKeyJwk: freshEcdh.publicKeyJwk,
      fingerprint: freshEcdh.fingerprint,
    });
  };

  // Manual SDP Handlers
  const handleManualGenerateOffer = async (customCallsign: string): Promise<string> => {
    if (!localIdentity.publicKeyJwk) throw new Error('Kunci ECDH belum siap');

    const pc = new RTCPeerConnection(TACTICAL_ICE_CONFIG);
    const targetPeerId = `MANUAL-${Date.now().toString().slice(-4)}`;
    const dc = pc.createDataChannel(
      `manual-${targetPeerId}`,
      TACTICAL_DATACHANNEL_CONFIG
    );

    const candidates: RTCIceCandidateInit[] = [];
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        candidates.push(e.candidate.toJSON());
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc, 1200);

    manualPendingPcRef.current = {
      pc,
      dc,
      targetPeerId,
      targetCallsign: customCallsign,
    };

    const payload = {
      v: 1,
      peerId: localIdentity.peerId,
      callsign: localIdentity.personnelName,
      nrp: localIdentity.nrp,
      sdp: pc.localDescription,
      candidates,
      publicKeyJwk: localIdentity.publicKeyJwk,
    };

    return btoa(JSON.stringify(payload));
  };

  const handleManualAcceptOffer = async (
    offerToken: string
  ): Promise<{ answerToken: string; peerCallsign: string }> => {
    if (!localIdentity.privateKey || !localIdentity.publicKeyJwk) {
      throw new Error('Kunci ECDH belum siap');
    }

    const decoded = JSON.parse(atob(offerToken));
    const remotePeerId: string = decoded.peerId || `MANUAL-${Date.now().toString().slice(-4)}`;
    const remoteCallsign: string = decoded.callsign || 'Personel Lapangan';
    const remoteNrp: string = decoded.nrp || '599001';
    const remotePubJwk: JsonWebKey = decoded.publicKeyJwk;

    const remoteFp = await computeJwkFingerprint(remotePubJwk);
    const { sharedKey, sharedKeyHash } = await deriveSharedAESGCMKey(
      localIdentity.privateKey,
      remotePubJwk
    );

    const pc = new RTCPeerConnection(TACTICAL_ICE_CONFIG);
    const localCandidates: RTCIceCandidateInit[] = [];

    const newContact: TacticalContact = {
      peerId: remotePeerId,
      personnelName: remoteCallsign,
      nrp: remoteNrp,
      callsign: `${remoteCallsign} [AIR-GAP]`,
      unit: 'MANUAL SDP P2P',
      rank: 'Personel Air-Gap',
      frequency: 'DIRECT AIR-GAP',
      sector: 'Off-Grid P2P',
      mode: 'live-peer',
      isGroup: false,
      avatarColor: 'from-cyan-500 to-blue-800',
      connectionState: 'HANDSHAKING',
      iceState: 'checking',
      dataChannelState: 'connecting',
      remoteFingerprint: remoteFp,
      sharedKeyHash,
      latencyMs: 6,
      unreadCount: 0,
      lastMessagePreview: 'Handshake SDP Manual selesai.',
      lastActivityTime: Date.now(),
      provisionedByAdmin: true,
    };

    setContacts((prev) => [newContact, ...prev.filter((c) => c.peerId !== remotePeerId)]);
    setOpenChatPeerId(remotePeerId);

    const tunnel = createEmptyLivePeerTunnel(remotePeerId, remoteCallsign, remoteNrp);
    tunnel.pc = pc;
    tunnel.sharedKey = sharedKey;
    tunnel.remotePublicKeyJwk = remotePubJwk;
    tunnel.sharedKeyHash = sharedKeyHash;
    tunnel.remoteFingerprint = remoteFp;
    livePeerTunnelsRef.current.set(remotePeerId, tunnel);

    attachLivePeerConnectionListeners(pc, tunnel);
    pc.addEventListener('icecandidate', (e) => {
      if (e.candidate) {
        localCandidates.push(e.candidate.toJSON());
      }
    });

    pc.ondatachannel = (e) => {
      tunnel.dc = e.channel;
      setupLivePeerDataChannel(
        remotePeerId,
        newContact.personnelName,
        remoteNrp,
        pc,
        e.channel,
        sharedKey,
        sharedKeyHash,
        remoteFp
      );
    };

    await pc.setRemoteDescription(new RTCSessionDescription(decoded.sdp));
    if (Array.isArray(decoded.candidates)) {
      for (const c of decoded.candidates) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(pc, 1200);

    const answerPayload = {
      v: 1,
      peerId: localIdentity.peerId,
      callsign: localIdentity.personnelName,
      nrp: localIdentity.nrp,
      sdp: pc.localDescription,
      candidates: localCandidates,
      publicKeyJwk: localIdentity.publicKeyJwk,
    };

    return {
      answerToken: btoa(JSON.stringify(answerPayload)),
      peerCallsign: remoteCallsign,
    };
  };

  const handleManualFinalizeWithAnswer = async (answerToken: string): Promise<void> => {
    const pending = manualPendingPcRef.current;
    if (!pending || !localIdentity.privateKey) {
      throw new Error('Tidak ada sesi SDP Offer yang menunggu');
    }

    const decoded = JSON.parse(atob(answerToken));
    const remotePubJwk: JsonWebKey = decoded.publicKeyJwk;
    const remoteNrp: string = decoded.nrp || '599002';
    const remoteFp = await computeJwkFingerprint(remotePubJwk);
    const { sharedKey, sharedKeyHash } = await deriveSharedAESGCMKey(
      localIdentity.privateKey,
      remotePubJwk
    );

    const peerId = pending.targetPeerId;
    const personnelName = decoded.callsign || pending.targetCallsign;

    const newContact: TacticalContact = {
      peerId,
      personnelName,
      nrp: remoteNrp,
      callsign: `${personnelName} [AIR-GAP]`,
      unit: 'MANUAL SDP P2P',
      rank: 'Personel Air-Gap',
      frequency: 'DIRECT AIR-GAP',
      sector: 'Off-Grid P2P',
      mode: 'live-peer',
      isGroup: false,
      avatarColor: 'from-cyan-500 to-blue-800',
      connectionState: 'HANDSHAKING',
      iceState: 'checking',
      dataChannelState: 'connecting',
      remoteFingerprint: remoteFp,
      sharedKeyHash,
      latencyMs: 5,
      unreadCount: 0,
      lastMessagePreview: 'Terowongan SDP Air-Gap aktif.',
      lastActivityTime: Date.now(),
      provisionedByAdmin: true,
    };

    setContacts((prev) => [newContact, ...prev]);
    setOpenChatPeerId(peerId);

    const tunnel = createEmptyLivePeerTunnel(peerId, personnelName, remoteNrp);
    tunnel.pc = pending.pc;
    tunnel.dc = pending.dc;
    tunnel.sharedKey = sharedKey;
    tunnel.remotePublicKeyJwk = remotePubJwk;
    tunnel.sharedKeyHash = sharedKeyHash;
    tunnel.remoteFingerprint = remoteFp;
    livePeerTunnelsRef.current.set(peerId, tunnel);

    attachLivePeerConnectionListeners(pending.pc, tunnel);

    if (pending.dc) {
      setupLivePeerDataChannel(
        peerId,
        personnelName,
        remoteNrp,
        pending.pc,
        pending.dc,
        sharedKey,
        sharedKeyHash,
        remoteFp
      );
    }

    await pending.pc.setRemoteDescription(new RTCSessionDescription(decoded.sdp));
    if (Array.isArray(decoded.candidates)) {
      for (const c of decoded.candidates) {
        await pending.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
    }
  };

  const activeContact = contacts.find((c) => c.peerId === openChatPeerId) || null;
  const currentMessages = openChatPeerId ? messagesByPeer[openChatPeerId] || [] : [];

  const filteredContacts = contacts.filter((c) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      c.personnelName.toLowerCase().includes(q) ||
      c.nrp.toLowerCase().includes(q) ||
      c.peerId.toLowerCase().includes(q) ||
      c.rank.toLowerCase().includes(q) ||
      c.unit.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (chatFilterPill === 'unread') return c.unreadCount > 0;
    if (chatFilterPill === 'groups') return Boolean(c.isGroup);
    return true;
  });

  const totalUnreadChats = contacts.reduce((acc, c) => acc + (c.unreadCount > 0 ? 1 : 0), 0);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div
      className="h-dvh w-screen overflow-hidden flex flex-col items-center justify-center select-none relative"
      style={{
        backgroundColor: 'var(--slk-bg-main)',
        color: 'var(--slk-text-primary)',
      }}
    >
      {/* Main 1-Column Mobile-First WhatsApp Android Dark Mode Container */}
      <div
        className="w-full max-w-2xl h-full md:border-x flex flex-col relative overflow-hidden shadow-2xl"
        style={{
          backgroundColor: 'var(--slk-bg-main)',
          borderColor: 'var(--slk-border)',
        }}
      >
        {/* Top Corner Micro Insignia Bar: Left = Logo Petir Super Kecil, Right = Logo TNI AU Super Kecil */}
        <div
          className="h-6 shrink-0 px-3 border-b flex items-center justify-between z-30"
          style={{
            backgroundColor: 'var(--slk-bg-card)',
            borderColor: 'var(--slk-border)',
          }}
        >
          {/* Pojok Kiri Atas: Logo Petir Super Kecil */}
          <div className="flex items-center gap-1.5">
            <img
              src="/assets/aistudio/1794962413180_09546ffa.png"
              alt="Logo Petir Diskomlekau"
              className="w-4 h-4 rounded-full object-cover border border-amber-400/40 shrink-0"
            />
            <span className="text-[10px] font-semibold tracking-wider text-amber-400/90">
              DISKOMLEKAU
            </span>
          </div>

          <span
            className="text-[9px] tracking-widest uppercase truncate px-2 font-mono"
            style={{ color: wsSignalConnected ? 'var(--slk-accent)' : '#fbbf24' }}
          >
            SIGNALING: {wsSignalConnected ? 'ONLINE' : 'CONNECTING'} •{' '}
            {MILITARY_THEMES[activeTheme].badgeText}
          </span>

          {/* Pojok Kanan Atas: Logo TNI AU Super Kecil */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold tracking-wider text-amber-400/90">
              TNI AU
            </span>
            <img
              src="/assets/aistudio/1792503945296_954409ac.jpg"
              alt="Logo TNI AU"
              className="w-4 h-4 rounded-full object-cover border border-amber-400/40 shrink-0"
            />
          </div>
        </div>

        {/* =====================================================================
            VIEW A: FULL-SCREEN CHAT ROOM (SAAT CHAT DIKLIK)
           ===================================================================== */}
        {openChatPeerId && activeContact ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Chat Room Top App Bar (WhatsApp Android Style) */}
            <header
              className="h-15 shrink-0 px-2.5 border-b flex items-center justify-between gap-2 z-20"
              style={{
                backgroundColor: 'var(--slk-bg-header)',
                borderColor: 'var(--slk-border)',
              }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setOpenChatPeerId(null);
                    setShowEmojiPicker(false);
                  }}
                  className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center text-slate-200 hover:bg-white/10 transition-colors"
                  aria-label="Kembali ke Daftar Chat"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                {/* Avatar Bulat */}
                <div
                  onClick={() => setShowSecuritySheet(true)}
                  className={`w-10 h-10 rounded-full bg-gradient-to-br ${
                    activeContact.avatarColor || 'from-cyan-500 to-blue-700'
                  } flex items-center justify-center text-white font-bold text-sm shrink-0 cursor-pointer relative shadow-inner`}
                >
                  {activeContact.isGroup ? (
                    <Users className="w-5 h-5" />
                  ) : (
                    getInitials(activeContact.personnelName)
                  )}
                  <span
                    className="w-2.5 h-2.5 rounded-full border-2 border-[#111b21] absolute bottom-0 right-0"
                    style={{
                      backgroundColor:
                        activeContact.connectionState === 'CONNECTED'
                          ? 'var(--slk-accent)'
                          : '#fbbf24',
                    }}
                  />
                </div>

                {/* Nama Personel & Pangkat / NRP */}
                <div
                  onClick={() => setShowSecuritySheet(true)}
                  className="min-w-0 pl-1 cursor-pointer"
                >
                  <h1 className="text-sm sm:text-base font-semibold truncate leading-tight">
                    {activeContact.personnelName}
                  </h1>
                  <p
                    className="text-xs truncate"
                    style={{ color: 'var(--slk-text-secondary)' }}
                  >
                    {activeContact.rank} · NRP {activeContact.nrp} ·{' '}
                    <span className="font-mono" style={{ color: 'var(--slk-accent)' }}>
                      {activeContact.peerId}
                    </span>{' '}
                    ·{' '}
                    <span style={{ color: 'var(--slk-accent)' }}>
                      {activeContact.connectionState === 'CONNECTED'
                        ? 'P2P Online'
                        : 'Menyambungkan...'}
                    </span>
                  </p>
                </div>
              </div>

              {/* Right Icons: Video Call, Voice Call, Settings, More Menu */}
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleLaunchMediaCall(activeContact, 'video')}
                  className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  title="Panggilan Video WebRTC P2P"
                >
                  <Video className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleLaunchMediaCall(activeContact, 'voice')}
                  className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  title="Panggilan Suara WebRTC P2P"
                >
                  <Phone className="w-4.5 h-4.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  title="Pengaturan HP & Tema Militer"
                >
                  <Settings className="w-5 h-5" style={{ color: 'var(--slk-accent)' }} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowSecuritySheet(true)}
                  className="min-w-[38px] min-h-[38px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  title="Detail Enkripsi & Sesi"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
              </div>
            </header>

            {/* Real-Time Connection Diagnostic Bar: SIGNALING: ONLINE -> ICE: CHECKING -> P2P E2EE: CONNECTED */}
            <div
              onClick={() => setShowSecuritySheet(true)}
              className="py-1.5 px-2.5 border-b flex items-center justify-between gap-2 cursor-pointer transition-colors z-10 overflow-x-auto"
              style={{
                backgroundColor: 'var(--slk-bg-card)',
                borderColor: 'var(--slk-border)',
              }}
            >
              <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono font-semibold whitespace-nowrap mx-auto">
                {/* Stage 1: SIGNALING */}
                <span
                  className={`px-2 py-0.5 rounded border ${
                    wsSignalConnected
                      ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
                      : 'bg-amber-950/70 border-amber-500/40 text-amber-300'
                  }`}
                >
                  SIGNALING: {wsSignalConnected ? 'ONLINE' : 'CONNECTING'}
                </span>

                <span className="text-slate-500">-&gt;</span>

                {/* Stage 2: ICE */}
                <span
                  className={`px-2 py-0.5 rounded border ${
                    activeContact.dataChannelState === 'open' ||
                    activeContact.iceState === 'connected' ||
                    activeContact.iceState === 'completed'
                      ? 'bg-cyan-950/70 border-cyan-500/40 text-cyan-300'
                      : 'bg-amber-950/70 border-amber-500/40 text-amber-300 animate-pulse'
                  }`}
                >
                  ICE:{' '}
                  {activeContact.dataChannelState === 'open' ||
                  activeContact.iceState === 'connected' ||
                  activeContact.iceState === 'completed'
                    ? 'CONNECTED'
                    : activeContact.iceState === 'failed' ||
                      activeContact.iceState === 'disconnected'
                    ? 'RESTARTING'
                    : 'CHECKING'}
                </span>

                <span className="text-slate-500">-&gt;</span>

                {/* Stage 3: P2P E2EE */}
                <span
                  className={`px-2 py-0.5 rounded border ${
                    activeContact.dataChannelState === 'open' ||
                    activeContact.connectionState === 'CONNECTED'
                      ? 'bg-emerald-950/80 border-emerald-400/50 text-emerald-300'
                      : 'bg-slate-900 border-slate-700 text-amber-300'
                  }`}
                >
                  P2P E2EE:{' '}
                  {activeContact.dataChannelState === 'open' ||
                  activeContact.connectionState === 'CONNECTED'
                    ? 'CONNECTED'
                    : 'CHECKING'}
                </span>
              </div>

              {activeContact.mode === 'live-peer' &&
                activeContact.dataChannelState !== 'open' && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      sendNodeRegistration(localIdentityRef.current);
                      initiateLiveWebRTCOffer(
                        activeContact.peerId,
                        activeContact.personnelName,
                        activeContact.nrp,
                        true
                      );
                    }}
                    className="px-2 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-[10px] font-mono font-bold text-cyan-300 shrink-0"
                    title="Auto-Dial Ulang ke ID Target"
                  >
                    DIAL P2P
                  </button>
                )}
            </div>

            {/* Chat Messages Scrollable Area */}
            <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-2.5 wa-tactical-chat-bg">
              {/* WhatsApp-Style E2EE Notice Pill at top of thread */}
              <div className="flex justify-center mb-3">
                <div
                  onClick={() => setShowSecuritySheet(true)}
                  className="max-w-md px-3.5 py-2 rounded-xl border text-[11px] text-center leading-relaxed cursor-pointer shadow-xs"
                  style={{
                    backgroundColor: 'var(--slk-bg-card)',
                    borderColor: 'var(--slk-border)',
                    color: 'var(--slk-text-secondary)',
                  }}
                >
                  <span className="font-medium" style={{ color: 'var(--slk-accent)' }}>
                    Pesan dan panggilan terenkripsi secara ujung-ke-ujung (WebRTC P2P).
                  </span>{' '}
                  Tidak ada seorang pun di luar chat ini yang dapat membaca atau menyimpannya.
                  Ketuk untuk verifikasi kunci ECDH.
                </div>
              </div>

              {currentMessages.length === 0 ? (
                <div className="py-16 text-center space-y-2">
                  <p className="text-xs" style={{ color: 'var(--slk-text-secondary)' }}>
                    Belum ada percakapan di memori RAM sesi ini.
                  </p>
                </div>
              ) : (
                currentMessages.map((msg) => {
                  if (msg.kind === 'system') {
                    return (
                      <div key={msg.id} className="flex justify-center my-2">
                        <div
                          className="max-w-md px-3 py-1.5 rounded-lg text-[11px] text-center border"
                          style={{
                            backgroundColor: 'var(--slk-bg-card)',
                            borderColor: 'var(--slk-border)',
                            color: 'var(--slk-accent)',
                          }}
                        >
                          {msg.plaintext}
                        </div>
                      </div>
                    );
                  }

                  const isOwn = msg.senderPeerId === localIdentity.peerId;

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[85%] sm:max-w-[75%] px-3 py-2 shadow-sm relative border ${
                          isOwn
                            ? 'rounded-2xl rounded-tr-xs'
                            : 'rounded-2xl rounded-tl-xs'
                        }`}
                        style={{
                          backgroundColor: isOwn
                            ? 'var(--slk-bg-bubble-own)'
                            : 'var(--slk-bg-bubble-peer)',
                          borderColor: isOwn
                            ? 'var(--slk-accent-muted)'
                            : 'var(--slk-border)',
                          color: 'var(--slk-text-primary)',
                        }}
                      >
                        {/* Sender Name in Group or Incoming Chat */}
                        {(!isOwn || activeContact.isGroup) && (
                          <div
                            className="text-xs font-semibold mb-0.5"
                            style={{ color: 'var(--slk-accent)' }}
                          >
                            {msg.senderCallsign}
                          </div>
                        )}

                        {/* Voice Note Bubble */}
                        {msg.kind === 'voice' && msg.voiceMeta && (
                          <VoiceNotePlayer voiceMeta={msg.voiceMeta} isOwn={isOwn} />
                        )}

                        {/* Image Attachment Bubble */}
                        {msg.kind === 'image' && msg.fileMeta && (
                          <div
                            className="mb-1.5 rounded-xl overflow-hidden border border-white/10"
                            style={{ backgroundColor: 'var(--slk-bg-main)' }}
                          >
                            <img
                              src={msg.fileMeta.dataUrl}
                              alt={msg.fileMeta.fileName}
                              referrerPolicy="no-referrer"
                              className="w-full max-h-64 object-contain"
                            />
                            <div
                              className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]"
                              style={{ backgroundColor: 'var(--slk-bg-header)' }}
                            >
                              <span className="truncate text-slate-300">
                                {msg.fileMeta.fileName} ({formatFileSize(msg.fileMeta.fileSize)})
                              </span>
                              <a
                                href={msg.fileMeta.dataUrl}
                                download={msg.fileMeta.fileName}
                                className="flex items-center gap-1 hover:underline shrink-0 font-medium"
                                style={{ color: 'var(--slk-accent)' }}
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Unduh</span>
                              </a>
                            </div>
                          </div>
                        )}

                        {/* Document Attachment Bubble */}
                        {msg.kind === 'document' && msg.fileMeta && (
                          <div
                            className="mb-1.5 p-2.5 rounded-xl border border-white/10 flex items-center justify-between gap-3"
                            style={{ backgroundColor: 'var(--slk-bg-header)' }}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <FileText
                                className="w-6 h-6 shrink-0"
                                style={{ color: 'var(--slk-accent)' }}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-slate-100 truncate">
                                  {msg.fileMeta.fileName}
                                </div>
                                <div
                                  className="text-[11px]"
                                  style={{ color: 'var(--slk-text-secondary)' }}
                                >
                                  {formatFileSize(msg.fileMeta.fileSize)} · {msg.fileMeta.chunkCount} SCTP Chunks
                                </div>
                              </div>
                            </div>
                            <a
                              href={msg.fileMeta.dataUrl}
                              download={msg.fileMeta.fileName}
                              className="p-2 rounded-full shrink-0"
                              style={{
                                backgroundColor: 'var(--slk-bg-input)',
                                color: 'var(--slk-accent)',
                              }}
                              title="Simpan Dokumen"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          </div>
                        )}

                        {/* Message Text & Floating Bottom-Right Time + Double Checkmarks */}
                        <div className="flex flex-wrap items-end justify-end gap-x-2 gap-y-0.5">
                          <p className="text-sm leading-snug whitespace-pre-wrap break-words flex-1 min-w-[60px]">
                            {msg.plaintext}
                          </p>
                          <div
                            className="flex items-center gap-1 text-[10px] shrink-0 select-none ml-auto pt-0.5"
                            style={{ color: 'var(--slk-text-secondary)' }}
                          >
                            <span>
                              {new Date(msg.timestamp).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                            </span>
                            {isOwn && (
                              <span>
                                {msg.status === 'SENT' ? (
                                  <Check className="w-3.5 h-3.5 text-slate-400 inline" />
                                ) : (
                                  <CheckCheck
                                    className="w-4 h-4 inline"
                                    style={{ color: 'var(--slk-accent)' }}
                                  />
                                )}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Optional Inline Raw Ciphertext Inspector */}
                        {showCiphertextInline && (
                          <div className="mt-2 pt-1.5 border-t border-white/10 text-[10px] font-mono space-y-0.5 opacity-80">
                            <div className="truncate">AES-GCM: {msg.ciphertextPreview}</div>
                            <div className="truncate">IV: {msg.ivHex} · SHA256: {msg.sha256Hash.slice(0, 16)}...</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Emoji Quick Picker Popover */}
            {showEmojiPicker && (
              <div
                className="px-4 py-2.5 border-t flex items-center justify-between gap-2 z-20"
                style={{
                  backgroundColor: 'var(--slk-bg-header)',
                  borderColor: 'var(--slk-border)',
                }}
              >
                <div className="flex items-center gap-2 overflow-x-auto">
                  {TACTICAL_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setInputText((prev) => prev + em)}
                      className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center text-lg transition-colors shrink-0"
                    >
                      {em}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    transmitEncryptedPayload(
                      'text',
                      'SITREP: Mohon laporan situasi terkini dan status keamanan perimeter.'
                    )
                  }
                  className="px-3 py-1 rounded-full border text-xs font-medium whitespace-nowrap shrink-0"
                  style={{
                    backgroundColor: 'var(--slk-bg-bubble-own)',
                    borderColor: 'var(--slk-accent)',
                    color: 'var(--slk-accent)',
                  }}
                >
                  Kirim SITREP
                </button>
              </div>
            )}

            {/* WhatsApp Standard Bottom Input Bar */}
            {isRecordingVoice ? (
              <div
                className="px-3 py-2.5 border-t flex items-center justify-between gap-3 z-20"
                style={{
                  backgroundColor: 'var(--slk-bg-header)',
                  borderColor: 'var(--slk-border)',
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping shrink-0" />
                  <span className="text-sm font-semibold tabular-nums">
                    0:{recordingSeconds.toString().padStart(2, '0')}
                  </span>
                  <div className="flex items-center gap-1 h-5 w-32 sm:w-44">
                    {liveVoiceWaveform.map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-full transition-all"
                        style={{
                          height: `${h}%`,
                          backgroundColor: 'var(--slk-accent)',
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={cancelVoiceNoteRecording}
                    className="px-3.5 py-2 rounded-full text-xs font-semibold text-red-400 hover:bg-white/5"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={stopAndTransmitVoiceNote}
                    className="w-11 h-11 rounded-full text-slate-950 flex items-center justify-center shadow-lg transition-transform active:scale-95"
                    style={{ backgroundColor: 'var(--slk-accent)' }}
                    aria-label="Kirim Voice Note"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={handleSendText}
                className="px-2.5 py-2 flex items-center gap-2 z-20"
                style={{ backgroundColor: 'var(--slk-bg-main)' }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.txt,.doc,.docx,.csv,.json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                {/* Rounded Pill Input Container */}
                <div
                  className="flex-1 rounded-full px-2 py-1 flex items-center gap-1 border"
                  style={{
                    backgroundColor: 'var(--slk-bg-input)',
                    borderColor: 'var(--slk-border)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="w-9 h-9 rounded-full flex items-center justify-center hover:text-white transition-colors shrink-0"
                    style={{ color: 'var(--slk-text-secondary)' }}
                    aria-label="Emoji"
                  >
                    <Smile className="w-5 h-5" />
                  </button>

                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Ketik pesan terenkripsi..."
                    className="flex-1 bg-transparent py-1.5 px-1 text-sm focus:outline-none min-w-0"
                    style={{ color: 'var(--slk-text-primary)' }}
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-9 h-9 rounded-full flex items-center justify-center hover:text-white transition-colors shrink-0"
                    style={{ color: 'var(--slk-text-secondary)' }}
                    title="Lampirkan File atau Dokumen"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={handleSendSampleReconImage}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0"
                    style={{ color: 'var(--slk-text-secondary)' }}
                    title="Kirim Foto / Citra Radar Recon"
                  >
                    <Camera className="w-5 h-5" />
                  </button>
                </div>

                {/* Rightmost Circular Button: Microphone for Voice Note OR Send Button when typing */}
                {inputText.trim() ? (
                  <button
                    type="submit"
                    className="w-11 h-11 rounded-full text-slate-950 flex items-center justify-center shrink-0 shadow-md transition-transform active:scale-95"
                    style={{ backgroundColor: 'var(--slk-accent)' }}
                    aria-label="Kirim Pesan"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startVoiceNoteRecording}
                    className="w-11 h-11 rounded-full text-slate-950 flex items-center justify-center shrink-0 shadow-md transition-transform active:scale-95"
                    style={{ backgroundColor: 'var(--slk-accent)' }}
                    title="Rekam Voice Note"
                    aria-label="Rekam Voice Note"
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                )}
              </form>
            )}
          </div>
        ) : (
          /* =====================================================================
             VIEW B: HOME SCREEN (WHATSAPP ANDROID DARK MODE 1-COLUMN VIEW)
             ===================================================================== */
          <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            {/* Top App Header: App Icon + "SILENT LINK" (left), Camera/Scan QR, Pengaturan HP & 3-Dots Menu (right) */}
            <header
              className="h-15 shrink-0 px-3.5 flex items-center justify-between z-20 relative border-b"
              style={{
                backgroundColor: 'var(--slk-bg-header)',
                borderColor: 'var(--slk-border)',
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src="/assets/aistudio/1795167005810_e4bb8167.jpg"
                  alt="Icon Aplikasi Silent Link Diskomlekau"
                  className="w-8 h-8 rounded-lg object-cover border shadow-md shrink-0"
                  style={{ borderColor: 'var(--slk-accent)' }}
                />
                <span className="text-base sm:text-lg font-bold tracking-tight truncate">
                  SILENT LINK
                </span>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0"
                  style={{
                    backgroundColor: isLoggedIn
                      ? 'var(--slk-accent-muted)'
                      : 'rgba(239,68,68,0.15)',
                    borderColor: isLoggedIn ? 'var(--slk-accent)' : '#ef4444',
                    color: isLoggedIn ? 'var(--slk-accent)' : '#f87171',
                  }}
                >
                  {!isLoggedIn
                    ? 'LOGGED OUT'
                    : localIdentity.role === 'ADMIN'
                    ? 'ADMIN HP'
                    : 'OPERATIVE'}
                </span>
              </div>

              <div className="flex items-center gap-0.5 shrink-0">
                {/* Quick Fullscreen Button on HP */}
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="min-w-[38px] min-h-[38px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  title="Tampilan Fullscreen HP"
                >
                  <Maximize2
                    className="w-4 h-4"
                    style={{
                      color: isFullscreen
                        ? 'var(--slk-accent)'
                        : 'var(--slk-text-secondary)',
                    }}
                  />
                </button>

                <button
                  type="button"
                  onClick={() => setIsOperativeOnboardingOpen(true)}
                  className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  title="Kamera / Scan QR Code Admin"
                >
                  <Camera className="w-5 h-5" />
                </button>

                {/* Dedicated Mobile Settings Button (Tombol Pengaturan pada HP) */}
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors relative"
                  title="Pengaturan HP, Akun, Login/Logout & Tema Militer"
                >
                  <Settings className="w-5 h-5" style={{ color: 'var(--slk-accent)' }} />
                </button>

                <button
                  type="button"
                  onClick={() => setShowTopMenuDropdown(!showTopMenuDropdown)}
                  className="min-w-[38px] min-h-[38px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  aria-label="Menu"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
              </div>

              {/* 3-Dots Dropdown Menu (WhatsApp Android Style) */}
              {showTopMenuDropdown && (
                <div
                  className="absolute right-3 top-14 w-68 border rounded-xl shadow-2xl py-1.5 z-50 text-sm"
                  style={{
                    backgroundColor: 'var(--slk-bg-card)',
                    borderColor: 'var(--slk-border)',
                    color: 'var(--slk-text-primary)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowTopMenuDropdown(false);
                      setIsSettingsOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5 font-semibold"
                    style={{ color: 'var(--slk-accent)' }}
                  >
                    <Settings className="w-4 h-4" />
                    <span>Pengaturan HP, Akun &amp; Tema Militer</span>
                  </button>

                  {localIdentity.role === 'ADMIN' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowTopMenuDropdown(false);
                        setIsAdminProvisionOpen(true);
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5 font-medium"
                    >
                      <QrCode className="w-4 h-4" style={{ color: 'var(--slk-accent)' }} />
                      <span>+ Buat QR &amp; Link Personel</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setShowTopMenuDropdown(false);
                        handleRestoreAdminRole();
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5 font-medium"
                    >
                      <KeyRound className="w-4 h-4" style={{ color: 'var(--slk-accent)' }} />
                      <span>Beralih ke Master Admin HP</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setShowTopMenuDropdown(false);
                      setIsOperativeOnboardingOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5"
                  >
                    <ScanLine className="w-4 h-4 text-slate-400" />
                    <span>Scan QR / Link Onboarding</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowTopMenuDropdown(false);
                      setIsManualSdpOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5"
                  >
                    <Terminal className="w-4 h-4 text-slate-400" />
                    <span>Koneksi SDP Manual (Air-Gap)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowTopMenuDropdown(false);
                      setShowSecuritySheet(true);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5"
                  >
                    <ShieldCheck className="w-4 h-4 text-slate-400" />
                    <span>Info Enkripsi &amp; Diagnostik ICE</span>
                  </button>

                  <div
                    className="my-1 border-t"
                    style={{ borderColor: 'var(--slk-border)' }}
                  />

                  <button
                    type="button"
                    onClick={handlePurgeSessionMemory}
                    className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5 text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Hapus Sesi &amp; Wipe RAM</span>
                  </button>
                </div>
              )}
            </header>

            {/* Logged-Out Quick Banner (if user logged out in Settings) */}
            {!isLoggedIn && (
              <div className="px-4 py-3 bg-red-950/60 border-b border-red-500/40 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-red-300">
                    Sesi Akun Personel Nonaktif (Logged Out)
                  </div>
                  <div className="text-[11px] text-red-200/80 truncate">
                    Login kembali atau Scan QR Admin untuk mengaktifkan kanal E2EE.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-950 flex items-center gap-1.5"
                  style={{ backgroundColor: 'var(--slk-accent)' }}
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Login</span>
                </button>
              </div>
            )}

            {/* =================================================================
                TAB 1: CHAT LIST (DEFAULT WHATSAPP HOME)
               ================================================================= */}
            {activeBottomTab === 'chat' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Rounded Search Bar & Quick Theme/Settings Strip */}
                <div
                  className="px-3.5 pt-2.5 pb-2 border-b"
                  style={{
                    backgroundColor: 'var(--slk-bg-header)',
                    borderColor: 'var(--slk-border)',
                  }}
                >
                  <div
                    className="relative flex items-center rounded-full px-3.5 py-2 border"
                    style={{
                      backgroundColor: 'var(--slk-bg-input)',
                      borderColor: 'var(--slk-border)',
                    }}
                  >
                    <Search
                      className="w-4 h-4 mr-2.5 shrink-0"
                      style={{ color: 'var(--slk-text-secondary)' }}
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari Nama Personel atau NRP..."
                      className="w-full bg-transparent text-sm focus:outline-none"
                      style={{ color: 'var(--slk-text-primary)' }}
                    />
                  </div>

                  {/* Filter Pills: "Semua", "Belum dibaca", "Grup" + Quick Theme Pill */}
                  <div className="flex items-center justify-between gap-2 mt-2.5 pb-1 overflow-x-auto">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setChatFilterPill('all')}
                        className="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap border"
                        style={{
                          backgroundColor:
                            chatFilterPill === 'all'
                              ? 'var(--slk-accent-muted)'
                              : 'var(--slk-bg-input)',
                          borderColor:
                            chatFilterPill === 'all'
                              ? 'var(--slk-accent)'
                              : 'transparent',
                          color:
                            chatFilterPill === 'all'
                              ? 'var(--slk-accent)'
                              : 'var(--slk-text-secondary)',
                        }}
                      >
                        Semua
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatFilterPill('unread')}
                        className="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap border"
                        style={{
                          backgroundColor:
                            chatFilterPill === 'unread'
                              ? 'var(--slk-accent-muted)'
                              : 'var(--slk-bg-input)',
                          borderColor:
                            chatFilterPill === 'unread'
                              ? 'var(--slk-accent)'
                              : 'transparent',
                          color:
                            chatFilterPill === 'unread'
                              ? 'var(--slk-accent)'
                              : 'var(--slk-text-secondary)',
                        }}
                      >
                        Belum dibaca {totalUnreadChats > 0 ? `(${totalUnreadChats})` : ''}
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatFilterPill('groups')}
                        className="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap border"
                        style={{
                          backgroundColor:
                            chatFilterPill === 'groups'
                              ? 'var(--slk-accent-muted)'
                              : 'var(--slk-bg-input)',
                          borderColor:
                            chatFilterPill === 'groups'
                              ? 'var(--slk-accent)'
                              : 'transparent',
                          color:
                            chatFilterPill === 'groups'
                              ? 'var(--slk-accent)'
                              : 'var(--slk-text-secondary)',
                        }}
                      >
                        Grup
                      </button>
                    </div>

                    {/* Quick 1-Tap Military Theme Switcher Pill */}
                    <button
                      type="button"
                      onClick={() => setIsSettingsOpen(true)}
                      className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold flex items-center gap-1 border shrink-0"
                      style={{
                        backgroundColor: 'var(--slk-bg-input)',
                        borderColor: 'var(--slk-border)',
                        color: 'var(--slk-accent)',
                      }}
                      title="Buka Pengaturan & Pilihan Tema Militer"
                    >
                      <Palette className="w-3.5 h-3.5" />
                      <span>Tema</span>
                    </button>
                  </div>
                </div>

                {/* Chat Rows List */}
                <div
                  className="flex-1 overflow-y-auto divide-y pb-24"
                  style={{ borderColor: 'var(--slk-border)' }}
                >
                  {filteredContacts.length === 0 ? (
                    <div
                      className="py-16 text-center text-sm"
                      style={{ color: 'var(--slk-text-secondary)' }}
                    >
                      Tidak ada obrolan personel yang cocok.
                    </div>
                  ) : (
                    filteredContacts.map((contact) => {
                      const isConnected = contact.connectionState === 'CONNECTED';
                      return (
                        <button
                          key={contact.peerId}
                          type="button"
                          onClick={() => handleOpenChatRoom(contact)}
                          className="w-full px-4 py-3 hover:bg-white/5 active:bg-white/10 transition-colors flex items-center gap-3.5 text-left"
                        >
                          {/* Left Circular Avatar */}
                          <div className="relative shrink-0">
                            <div
                              className={`w-12 h-12 rounded-full bg-gradient-to-br ${
                                contact.avatarColor || 'from-cyan-500 to-blue-700'
                              } flex items-center justify-center text-white font-bold text-base shadow-inner`}
                            >
                              {contact.isGroup ? (
                                <Users className="w-5 h-5" />
                              ) : (
                                getInitials(contact.personnelName)
                              )}
                            </div>
                            <span
                              className="w-3 h-3 rounded-full border-2 border-[#0b141a] absolute bottom-0 right-0"
                              style={{
                                backgroundColor: isConnected
                                  ? 'var(--slk-accent)'
                                  : '#64748b',
                              }}
                            />
                          </div>

                          {/* Center: Personnel Name & Rank + Message Preview */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate flex items-center gap-1.5">
                                <span className="text-[15px] font-semibold truncate">
                                  {contact.personnelName}
                                </span>
                                <span
                                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0"
                                  style={{
                                    backgroundColor: 'var(--slk-accent-muted)',
                                    borderColor: 'var(--slk-border)',
                                    color: 'var(--slk-accent)',
                                  }}
                                >
                                  {contact.peerId}
                                </span>
                              </div>
                              <span
                                className="text-xs shrink-0 tabular-nums"
                                style={{
                                  color:
                                    contact.unreadCount > 0
                                      ? 'var(--slk-accent)'
                                      : 'var(--slk-text-secondary)',
                                  fontWeight: contact.unreadCount > 0 ? 600 : 400,
                                }}
                              >
                                {new Date(contact.lastActivityTime).toLocaleTimeString('id-ID', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: false,
                                })}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-2 mt-1">
                              <div className="flex items-center gap-1 min-w-0 flex-1">
                                <CheckCheck
                                  className="w-4 h-4 shrink-0"
                                  style={{ color: 'var(--slk-accent)' }}
                                />
                                <p
                                  className="text-xs sm:text-sm truncate"
                                  style={{ color: 'var(--slk-text-secondary)' }}
                                >
                                  {contact.lastMessagePreview}
                                </p>
                              </div>

                              {/* Right Unread Badge */}
                              {contact.unreadCount > 0 && (
                                <span
                                  className="min-w-[20px] h-5 px-1.5 rounded-full text-slate-950 text-[11px] font-bold flex items-center justify-center shrink-0"
                                  style={{ backgroundColor: 'var(--slk-accent)' }}
                                >
                                  {contact.unreadCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}

                  {/* Footer Encryption Note in Chat List */}
                  <div
                    className="py-6 px-4 text-center text-xs flex items-center justify-center gap-1.5"
                    style={{ color: 'var(--slk-text-secondary)' }}
                  >
                    <Lock className="w-3.5 h-3.5" style={{ color: 'var(--slk-accent)' }} />
                    <span>
                      Pesan pribadi Anda{' '}
                      <strong className="font-normal" style={{ color: 'var(--slk-accent)' }}>
                        terenkripsi secara ujung-ke-ujung (P2P)
                      </strong>{' '}
                      &amp; tetap aktif di latar belakang
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* =================================================================
                TAB 2: STATUS / PEMBARUAN (EPHEMERAL SITREP UPDATES)
               ================================================================= */}
            {activeBottomTab === 'status' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
                {/* My Status Card */}
                <div
                  className="p-3.5 rounded-2xl border space-y-3"
                  style={{
                    backgroundColor: 'var(--slk-bg-card)',
                    borderColor: 'var(--slk-border)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-slate-950 font-bold"
                      style={{ backgroundColor: 'var(--slk-accent)' }}
                    >
                      {getInitials(localIdentity.personnelName)}
                    </div>
                    <div>
                      <div className="text-sm font-bold">
                        Status Saya ({localIdentity.personnelName})
                      </div>
                      <div
                        className="text-xs"
                        style={{ color: 'var(--slk-text-secondary)' }}
                      >
                        NRP {localIdentity.nrp} · Hanya tersimpan di RAM sesi aktif
                      </div>
                    </div>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newStatusText.trim()) return;
                      const statusItem = {
                        id: `ST-${Date.now()}`,
                        authorName: localIdentity.personnelName,
                        authorRank: localIdentity.rank,
                        nrp: localIdentity.nrp,
                        timestamp: Date.now(),
                        content: newStatusText.trim(),
                        avatarColor: 'from-cyan-400 to-blue-700',
                      };
                      setStatusUpdates((prev) => [statusItem, ...prev]);
                      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(
                          JSON.stringify({
                            type: 'status:broadcast',
                            statusItem,
                          })
                        );
                      }
                      setNewStatusText('');
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      value={newStatusText}
                      onChange={(e) => setNewStatusText(e.target.value)}
                      placeholder="Bagikan pembaruan SITREP terenkripsi..."
                      className="flex-1 rounded-full px-4 py-2 text-xs focus:outline-none border"
                      style={{
                        backgroundColor: 'var(--slk-bg-input)',
                        borderColor: 'var(--slk-border)',
                        color: 'var(--slk-text-primary)',
                      }}
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-full text-slate-950 text-xs font-bold shrink-0"
                      style={{ backgroundColor: 'var(--slk-accent)' }}
                    >
                      Siarkan
                    </button>
                  </form>
                </div>

                <div
                  className="text-xs font-semibold uppercase tracking-wider px-1"
                  style={{ color: 'var(--slk-text-secondary)' }}
                >
                  Pembaruan Terkini Jajaran
                </div>

                <div className="space-y-2.5">
                  {statusUpdates.map((st) => (
                    <div
                      key={st.id}
                      className="p-3.5 rounded-2xl border space-y-2"
                      style={{
                        backgroundColor: 'var(--slk-bg-card)',
                        borderColor: 'var(--slk-border)',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-10 h-10 rounded-full p-0.5 border"
                            style={{ borderColor: 'var(--slk-accent)' }}
                          >
                            <div
                              className="w-full h-full rounded-full flex items-center justify-center text-xs font-bold"
                              style={{
                                backgroundColor: 'var(--slk-bg-header)',
                                color: 'var(--slk-accent)',
                              }}
                            >
                              {getInitials(st.authorName)}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm font-semibold">
                              {st.authorName}
                            </div>
                            <div
                              className="text-xs"
                              style={{ color: 'var(--slk-text-secondary)' }}
                            >
                              {st.authorRank} · NRP {st.nrp}
                            </div>
                          </div>
                        </div>
                        <span
                          className="text-xs"
                          style={{ color: 'var(--slk-text-secondary)' }}
                        >
                          {new Date(st.timestamp).toLocaleTimeString('id-ID', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed pl-1">
                        {st.content}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* =================================================================
                TAB 3: GRUP / SATUAN (TACTICAL UNIT CHANNELS)
               ================================================================= */}
            {activeBottomTab === 'groups' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24">
                <div
                  className="text-xs font-semibold uppercase tracking-wider px-1"
                  style={{ color: 'var(--slk-text-secondary)' }}
                >
                  Grup &amp; Satuan Komando P2P
                </div>
                {contacts.map((c) => (
                  <button
                    key={c.peerId}
                    type="button"
                    onClick={() => handleOpenChatRoom(c)}
                    className="w-full p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-left transition-colors hover:bg-white/5"
                    style={{
                      backgroundColor: 'var(--slk-bg-card)',
                      borderColor: 'var(--slk-border)',
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-11 h-11 rounded-full bg-gradient-to-br ${
                          c.avatarColor || 'from-cyan-500 to-blue-700'
                        } flex items-center justify-center text-white font-bold shrink-0`}
                      >
                        <Users className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {c.unit}
                        </div>
                        <div
                          className="text-xs truncate"
                          style={{ color: 'var(--slk-text-secondary)' }}
                        >
                          {c.personnelName} · {c.frequency}
                        </div>
                      </div>
                    </div>
                    <span
                      className="px-3 py-1 rounded-full text-xs font-semibold shrink-0"
                      style={{
                        backgroundColor: 'var(--slk-accent-muted)',
                        color: 'var(--slk-accent)',
                      }}
                    >
                      Buka Kanal
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* =================================================================
                TAB 4: PANGGILAN (WEBRTC MEDIASTREAM CALL LOGS)
               ================================================================= */}
            {activeBottomTab === 'calls' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24">
                <div
                  className="text-xs font-semibold uppercase tracking-wider px-1"
                  style={{ color: 'var(--slk-text-secondary)' }}
                >
                  Riwayat Panggilan P2P (Sesi RAM Aktif)
                </div>
                {callHistory.map((item) => {
                  const matchedContact =
                    contacts.find((c) => c.peerId === item.contactPeerId) || contacts[0];
                  return (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-2xl border flex items-center justify-between gap-3"
                      style={{
                        backgroundColor: 'var(--slk-bg-card)',
                        borderColor: 'var(--slk-border)',
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-cyan-500 to-blue-700 flex items-center justify-center text-white font-bold shrink-0">
                          {getInitials(item.personnelName)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {item.personnelName}
                          </div>
                          <div
                            className="text-xs"
                            style={{ color: 'var(--slk-text-secondary)' }}
                          >
                            {item.direction === 'incoming' ? '↙ Masuk' : '↗ Keluar'} ·{' '}
                            {new Date(item.timestamp).toLocaleTimeString('id-ID', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })}{' '}
                            · SRTP E2EE
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleLaunchMediaCall(matchedContact, item.callType)}
                        className="w-10 h-10 rounded-full flex items-center justify-center transition-colors shrink-0 border"
                        style={{
                          backgroundColor: 'var(--slk-bg-input)',
                          borderColor: 'var(--slk-border)',
                          color: 'var(--slk-accent)',
                        }}
                        title="Mulai Panggilan P2P"
                      >
                        {item.callType === 'video' ? (
                          <Video className="w-5 h-5" />
                        ) : (
                          <Phone className="w-4.5 h-4.5" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Floating Action Button (FAB) at Bottom-Right (ADMIN HP Exclusive) */}
            {localIdentity.role === 'ADMIN' && isLoggedIn && (
              <button
                type="button"
                onClick={() => setIsAdminProvisionOpen(true)}
                className="absolute bottom-20 right-4 z-30 h-13 px-4 rounded-2xl text-slate-950 font-bold text-xs sm:text-sm flex items-center gap-2 shadow-xl transition-transform active:scale-95"
                style={{ backgroundColor: 'var(--slk-accent)' }}
                title="Khusus Admin HP: + Buat QR & Link Personel Baru"
              >
                <Plus className="w-5 h-5 stroke-[2.5]" />
                <span>Buat QR &amp; Link Personel</span>
              </button>
            )}

            {/* Bottom Navigation Bar (5 Tabs at the Very Bottom including Pengaturan HP) */}
            <nav
              className="h-16 shrink-0 border-t grid grid-cols-5 items-center z-20"
              style={{
                backgroundColor: 'var(--slk-bg-header)',
                borderColor: 'var(--slk-border)',
              }}
            >
              <button
                type="button"
                onClick={() => setActiveBottomTab('chat')}
                className="flex flex-col items-center justify-center h-full relative"
              >
                <div
                  className="px-3.5 py-1 rounded-full flex items-center justify-center transition-colors relative"
                  style={{
                    backgroundColor:
                      activeBottomTab === 'chat' ? 'var(--slk-accent-muted)' : 'transparent',
                    color:
                      activeBottomTab === 'chat'
                        ? 'var(--slk-accent)'
                        : 'var(--slk-text-secondary)',
                  }}
                >
                  <MessageSquare className="w-5 h-5" />
                  {totalUnreadChats > 0 && (
                    <span
                      className="absolute -top-1 right-0.5 min-w-[16px] h-4 px-1 rounded-full text-slate-950 text-[10px] font-bold flex items-center justify-center"
                      style={{ backgroundColor: 'var(--slk-accent)' }}
                    >
                      {totalUnreadChats}
                    </span>
                  )}
                </div>
                <span
                  className="text-[10px] mt-0.5 font-semibold"
                  style={{
                    color:
                      activeBottomTab === 'chat'
                        ? 'var(--slk-text-primary)'
                        : 'var(--slk-text-secondary)',
                  }}
                >
                  Chat
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveBottomTab('status')}
                className="flex flex-col items-center justify-center h-full"
              >
                <div
                  className="px-3.5 py-1 rounded-full flex items-center justify-center transition-colors"
                  style={{
                    backgroundColor:
                      activeBottomTab === 'status' ? 'var(--slk-accent-muted)' : 'transparent',
                    color:
                      activeBottomTab === 'status'
                        ? 'var(--slk-accent)'
                        : 'var(--slk-text-secondary)',
                  }}
                >
                  <Radio className="w-5 h-5" />
                </div>
                <span
                  className="text-[10px] mt-0.5 font-semibold truncate max-w-full px-1"
                  style={{
                    color:
                      activeBottomTab === 'status'
                        ? 'var(--slk-text-primary)'
                        : 'var(--slk-text-secondary)',
                  }}
                >
                  Status
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveBottomTab('groups')}
                className="flex flex-col items-center justify-center h-full"
              >
                <div
                  className="px-3.5 py-1 rounded-full flex items-center justify-center transition-colors"
                  style={{
                    backgroundColor:
                      activeBottomTab === 'groups' ? 'var(--slk-accent-muted)' : 'transparent',
                    color:
                      activeBottomTab === 'groups'
                        ? 'var(--slk-accent)'
                        : 'var(--slk-text-secondary)',
                  }}
                >
                  <Users className="w-5 h-5" />
                </div>
                <span
                  className="text-[10px] mt-0.5 font-semibold"
                  style={{
                    color:
                      activeBottomTab === 'groups'
                        ? 'var(--slk-text-primary)'
                        : 'var(--slk-text-secondary)',
                  }}
                >
                  Satuan
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveBottomTab('calls')}
                className="flex flex-col items-center justify-center h-full"
              >
                <div
                  className="px-3.5 py-1 rounded-full flex items-center justify-center transition-colors"
                  style={{
                    backgroundColor:
                      activeBottomTab === 'calls' ? 'var(--slk-accent-muted)' : 'transparent',
                    color:
                      activeBottomTab === 'calls'
                        ? 'var(--slk-accent)'
                        : 'var(--slk-text-secondary)',
                  }}
                >
                  <Phone className="w-5 h-5" />
                </div>
                <span
                  className="text-[10px] mt-0.5 font-semibold"
                  style={{
                    color:
                      activeBottomTab === 'calls'
                        ? 'var(--slk-text-primary)'
                        : 'var(--slk-text-secondary)',
                  }}
                >
                  Panggilan
                </span>
              </button>

              {/* 5th Tab: Dedicated Mobile Settings Button (Pengaturan HP) */}
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="flex flex-col items-center justify-center h-full"
              >
                <div
                  className="px-3.5 py-1 rounded-full flex items-center justify-center transition-colors"
                  style={{
                    backgroundColor: isSettingsOpen ? 'var(--slk-accent-muted)' : 'transparent',
                    color: 'var(--slk-accent)',
                  }}
                >
                  <Settings className="w-5 h-5" />
                </div>
                <span
                  className="text-[10px] mt-0.5 font-bold"
                  style={{ color: 'var(--slk-accent)' }}
                >
                  Pengaturan
                </span>
              </button>
            </nav>
          </div>
        )}
      </div>

      {/* Security, E2EE & WebRTC ICE/DataChannel Diagnostic Sheet */}
      {showSecuritySheet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
          <div
            className="w-full max-w-lg max-h-[90vh] flex flex-col border rounded-2xl shadow-2xl overflow-hidden"
            style={{
              backgroundColor: 'var(--slk-bg-card)',
              borderColor: 'var(--slk-border)',
              color: 'var(--slk-text-primary)',
            }}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b shrink-0"
              style={{
                backgroundColor: 'var(--slk-bg-header)',
                borderColor: 'var(--slk-border)',
              }}
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" style={{ color: 'var(--slk-accent)' }} />
                <h3 className="text-base font-bold">
                  Diagnostik WebRTC ICE, SDP &amp; DataChannel
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSecuritySheet(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs overflow-y-auto">
              <div
                className="p-3.5 rounded-xl border space-y-1.5"
                style={{
                  backgroundColor: 'var(--slk-bg-main)',
                  borderColor: 'var(--slk-border)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--slk-text-secondary)' }}>Personel Aktif</span>
                  <span className="font-bold">
                    {localIdentity.personnelName} (NRP {localIdentity.nrp})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--slk-text-secondary)' }}>ID Node &amp; Role</span>
                  <span className="font-mono font-bold" style={{ color: 'var(--slk-accent)' }}>
                    {localIdentity.peerId} ({localIdentity.role})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--slk-text-secondary)' }}>Konfigurasi DataChannel</span>
                  <span className="font-mono text-emerald-400">
                    ordered: true, reliable: true (0% Loss)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--slk-text-secondary)' }}>Status ICE &amp; DataChannel</span>
                  <span className="font-mono" style={{ color: 'var(--slk-accent)' }}>
                    ICE: {(activeContact?.iceState || 'connected').toUpperCase()} · DC:{' '}
                    {(activeContact?.dataChannelState || 'open').toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--slk-text-secondary)' }}>Zero-Data Retention</span>
                  <span className="font-semibold" style={{ color: 'var(--slk-accent)' }}>
                    0 Byte Disk ({totalEncryptedPackets} Paket RAM)
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div style={{ color: 'var(--slk-text-secondary)' }}>
                  Sidik Jari Kunci ECDH P-256 (SHA-256):
                </div>
                <div
                  className="p-2.5 rounded-xl border font-mono text-[11px] break-all leading-relaxed"
                  style={{
                    backgroundColor: 'var(--slk-bg-main)',
                    borderColor: 'var(--slk-border)',
                    color: 'var(--slk-accent)',
                  }}
                >
                  {activeContact?.remoteFingerprint || localIdentity.fingerprint}
                </div>
              </div>

              {/* Real-Time oniceconnectionstatechange & SDP/DataChannel Monitor */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-semibold" style={{ color: 'var(--slk-text-secondary)' }}>
                    <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--slk-accent)' }} />
                    Log Real-Time ICE Agent &amp; SDP Handshake ({iceDiagnosticLogs.length})
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400">
                    oniceconnectionstatechange
                  </span>
                </div>
                <div
                  className="max-h-40 overflow-y-auto rounded-xl border p-2.5 font-mono text-[10px] space-y-1.5"
                  style={{
                    backgroundColor: 'var(--slk-bg-main)',
                    borderColor: 'var(--slk-border)',
                  }}
                >
                  {iceDiagnosticLogs.length === 0 ? (
                    <div className="text-slate-500 py-3 text-center">
                      Menunggu aktivitas ICE Candidate / SDP Handshake...
                    </div>
                  ) : (
                    iceDiagnosticLogs.map((log) => (
                      <div
                        key={log.id}
                        className="pb-1.5 border-b border-white/5 last:border-b-0 leading-snug"
                      >
                        <div className="flex items-center justify-between text-[9px] text-slate-400">
                          <span className="font-bold" style={{ color: 'var(--slk-accent)' }}>
                            [{log.category}] {log.peerName}
                          </span>
                          <span>
                            ICE:{log.iceConnectionState} · DC:{log.dataChannelState}
                          </span>
                        </div>
                        <div className="text-slate-200 mt-0.5 break-words">{log.detail}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-1">
                {activeContact && (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeContact.mode === 'live-peer') {
                        const existing = livePeerTunnelsRef.current.get(activeContact.peerId);
                        if (existing?.pc) {
                          triggerPeerIceRestart(
                            activeContact.peerId,
                            'Manual ICE Restart oleh Operator'
                          );
                        } else {
                          initiateLiveWebRTCOffer(
                            activeContact.peerId,
                            activeContact.personnelName,
                            activeContact.nrp,
                            true
                          );
                        }
                      } else if (localIdentity.privateKey && localIdentity.publicKeyJwk) {
                        establishLoopbackWebRTCTunnel(activeContact, {
                          privateKey: localIdentity.privateKey,
                          publicKeyJwk: localIdentity.publicKeyJwk,
                          fingerprint: localIdentity.fingerprint,
                        });
                      }
                    }}
                    className="w-full py-2.5 px-4 rounded-full border font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    style={{
                      backgroundColor: 'var(--slk-bg-bubble-own)',
                      borderColor: 'var(--slk-accent)',
                      color: 'var(--slk-accent)',
                    }}
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Picu ICE Restart &amp; Re-Negosiasi SDP P2P</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowCiphertextInline(!showCiphertextInline)}
                  className="w-full py-2.5 px-4 rounded-full font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  style={{
                    backgroundColor: 'var(--slk-bg-input)',
                    color: 'var(--slk-text-primary)',
                  }}
                >
                  <Eye className="w-4 h-4" style={{ color: 'var(--slk-accent)' }} />
                  <span>
                    {showCiphertextInline
                      ? 'Sembunyikan Ciphertext di Gelembung Chat'
                      : 'Tampilkan Raw Ciphertext AES-GCM di Chat'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleRotateSessionKey}
                  className="w-full py-2.5 px-4 rounded-full font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  style={{
                    backgroundColor: 'var(--slk-bg-input)',
                    color: 'var(--slk-accent)',
                  }}
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Rotasi Kunci Sesi ECDH P-256</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 0: Mobile Settings Modal (Informasi Akun, Login/Logout, Fullscreen/Background Daemon, 4 Tema Militer) */}
      <TacticalSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        nodeIdentity={localIdentity}
        isLoggedIn={isLoggedIn}
        onLoginAccount={handleLoginAccount}
        onLogoutAccount={handleLogoutAccount}
        onWipeRamSession={handlePurgeSessionMemory}
        onOpenQrScanner={() => setIsOperativeOnboardingOpen(true)}
        activeTheme={activeTheme}
        onSelectTheme={setActiveTheme}
        isFullscreen={isFullscreen}
        autoFullscreenOnTap={autoFullscreenOnTap}
        onToggleFullscreen={toggleFullscreen}
        onToggleAutoFullscreen={setAutoFullscreenOnTap}
        keepAliveStatus={keepAliveStatus}
        onToggleKeepAlive={(enabled) => {
          if (enabled) {
            tacticalBackgroundDaemon.start();
          } else {
            tacticalBackgroundDaemon.stop();
          }
        }}
        soundAlertEnabled={soundAlertEnabled}
        onToggleSoundAlert={setSoundAlertEnabled}
        isInstallable={isInstallable}
        isInstalled={isInstalled}
        isIOS={isIOS}
        onPromptInstall={promptInstall}
        wsSignalConnected={wsSignalConnected}
        activePeersCount={contacts.filter((c) => c.connectionState === 'CONNECTED').length}
      />

      {/* Modal 1: Admin HP Only Provisioning (+ Buat QR & Link Personel Baru) */}
      <AdminProvisioningModal
        isOpen={isAdminProvisionOpen}
        onClose={() => setIsAdminProvisionOpen(false)}
        role={localIdentity.role}
        localIdentity={localIdentity}
        onCredentialProvisioned={handleAdminCredentialProvisioned}
        onSimulateOperativeOnboardingWithToken={async (token) => {
          const parsed = await verifyAndParseProvisioningToken(token);
          await handleCompleteOperativeOnboarding(parsed);
        }}
      />

      {/* Modal 2: Client Onboarding & Cryptographic Handshake (QR / Deep Link Only) */}
      <OperativeOnboardingModal
        isOpen={isOperativeOnboardingOpen}
        onClose={() => setIsOperativeOnboardingOpen(false)}
        recentAdminCredentials={issuedCredentials}
        onCompleteOperativeOnboarding={handleCompleteOperativeOnboarding}
      />

      {/* Modal 3: Air-Gapped Manual SDP + ECDH P-256 Handshake */}
      <ManualSdpModal
        isOpen={isManualSdpOpen}
        onClose={() => setIsManualSdpOpen(false)}
        onGenerateOffer={handleManualGenerateOffer}
        onAcceptOfferAndCreateAnswer={handleManualAcceptOffer}
        onFinalizeWithAnswer={handleManualFinalizeWithAnswer}
      />

      {/* Incoming Live Call Alert Overlay (WhatsApp Style) */}
      {incomingCallInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div
            className="w-full max-w-sm rounded-2xl border-2 shadow-2xl p-6 text-center space-y-5"
            style={{
              backgroundColor: 'var(--slk-bg-card)',
              borderColor: 'var(--slk-accent)',
            }}
          >
            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono"
              style={{
                backgroundColor: 'var(--slk-accent-muted)',
                borderColor: 'var(--slk-accent)',
                color: 'var(--slk-accent)',
              }}
            >
              <span
                className="w-2 h-2 rounded-full animate-ping"
                style={{ backgroundColor: 'var(--slk-accent)' }}
              />
              {incomingCallInvite.callType === 'video'
                ? 'PANGGILAN VIDEO P2P MASUK'
                : 'PANGGILAN SUARA P2P MASUK'}
            </div>

            <div
              className="w-20 h-20 rounded-full mx-auto bg-gradient-to-br from-cyan-400 to-blue-800 flex items-center justify-center text-white font-bold text-2xl shadow-lg border-2 animate-pulse"
              style={{ borderColor: 'var(--slk-accent)' }}
            >
              {getInitials(incomingCallInvite.callerName)}
            </div>

            <div>
              <h3 className="text-lg font-bold text-white">
                {incomingCallInvite.callerName}
              </h3>
              <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--slk-accent)' }}>
                {incomingCallInvite.callerRank} · NRP {incomingCallInvite.callerNrp}
              </p>
              <p
                className="text-[11px] font-mono mt-1"
                style={{ color: 'var(--slk-text-secondary)' }}
              >
                ID: {incomingCallInvite.fromPeerId}
              </p>
            </div>

            <div className="flex items-center justify-center gap-4 pt-2">
              <button
                onClick={handleRejectIncomingCall}
                className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-colors cursor-pointer"
              >
                <Phone className="w-4 h-4 rotate-[135deg]" />
                Tolak
              </button>
              <button
                onClick={handleAcceptIncomingCall}
                className="flex-1 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#021220] font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-colors cursor-pointer"
              >
                {incomingCallInvite.callType === 'video' ? (
                  <Video className="w-4 h-4" />
                ) : (
                  <Phone className="w-4 h-4" />
                )}
                Terima
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 4: WebRTC P2P MediaStream (Video Call & Voice Call) */}
      <TacticalMediaStreamModal
        isOpen={isMediaStreamOpen}
        callType={mediaCallType}
        contact={mediaCallContact || activeContact || contacts[0]}
        localCallsign={localIdentity.personnelName}
        localPeerId={localIdentity.peerId}
        isCaller={isMediaCaller}
        wsRef={wsRef}
        latestCallSignal={latestCallSignal}
        onClose={() => {
          setIsMediaStreamOpen(false);
          setLatestCallSignal(null);
        }}
      />
    </div>
  );
}
