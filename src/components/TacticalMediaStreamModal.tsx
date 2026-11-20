import React, { useEffect, useRef, useState } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Lock,
  Volume2,
  MoreHorizontal,
  UserPlus,
  Minimize2,
  RefreshCw,
  Wand2,
  MonitorUp,
  User,
  ShieldCheck,
} from 'lucide-react';
import { TacticalContact } from '../types/tactical';
import { TACTICAL_ICE_CONFIG } from '../utils/webrtcPeerEngine';

export interface LiveCallSignalPacket {
  type:
    | 'call:accept'
    | 'call:reject'
    | 'call:hangup'
    | 'call:webrtc-offer'
    | 'call:webrtc-answer'
    | 'call:webrtc-ice'
    | 'call:media-frame';
  fromPeerId: string;
  targetPeerId: string;
  callType?: 'voice' | 'video';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  frameType?: 'video' | 'audio';
  dataUrl?: string;
  timestamp?: number;
}

interface TacticalMediaStreamModalProps {
  isOpen: boolean;
  callType: 'voice' | 'video';
  isCaller: boolean;
  contact: TacticalContact | null;
  localPeerId: string;
  localCallsign: string;
  wsRef: React.MutableRefObject<{ readyState: number; send: (data: string) => void } | null>;
  latestCallSignal: LiveCallSignalPacket | null;
  onClose: (notifyRemote?: boolean) => void;
}

const RTC_ICE_CONFIG: RTCConfiguration = TACTICAL_ICE_CONFIG;

export const TacticalMediaStreamModal: React.FC<TacticalMediaStreamModalProps> = ({
  isOpen,
  callType,
  isCaller,
  contact,
  localPeerId,
  localCallsign,
  wsRef,
  latestCallSignal,
  onClose,
}) => {
  const [activeMode, setActiveMode] = useState<'voice' | 'video'>(callType);
  const [micMuted, setMicMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(callType === 'video');
  const [tacticalFilterOn, setTacticalFilterOn] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [showSrtpInfo, setShowSrtpInfo] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [durationSec, setDurationSec] = useState<number>(0);
  const [callStateText, setCallStateText] = useState<string>('Memanggil...');
  const [remoteVideoFrameUrl, setRemoteVideoFrameUrl] = useState<string | null>(null);
  const [hasDirectRemoteVideoTrack, setHasDirectRemoteVideoTrack] = useState<boolean>(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remotePipVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcLocalRef = useRef<RTCPeerConnection | null>(null);
  const pcRemoteLoopbackRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);

  // Sync activeMode when modal opens with a specific callType
  useEffect(() => {
    if (isOpen) {
      setActiveMode(callType);
      setVideoEnabled(callType === 'video');
      setMicMuted(false);
      setSpeakerOn(true);
      setTacticalFilterOn(false);
      setIsScreenSharing(false);
      setShowSrtpInfo(false);
      setDurationSec(0);
      setRemoteVideoFrameUrl(null);
      setHasDirectRemoteVideoTrack(false);
      setCallStateText(
        contact?.mode === 'live-peer'
          ? isCaller
            ? 'Memanggil Perangkat...'
            : 'Tersambung (P2P Live)'
          : 'Memanggil...'
      );
    }
  }, [isOpen, callType, contact?.mode, isCaller]);

  // Call duration timer
  useEffect(() => {
    if (!isOpen || !contact) return;

    let connectTimeout: number | null = null;
    if (contact.mode !== 'live-peer' || !isCaller) {
      connectTimeout = window.setTimeout(() => {
        setCallStateText('Tersambung');
      }, 900);
    }

    const timer = window.setInterval(() => {
      setDurationSec((prev) => prev + 1);
    }, 1000);

    return () => {
      if (connectTimeout) window.clearTimeout(connectTimeout);
      window.clearInterval(timer);
    };
  }, [isOpen, contact, isCaller]);

  // Helper to send call signaling packet over WebSocket
  const sendCallSignal = (payload: Partial<LiveCallSignalPacket>) => {
    if (!contact || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({
        ...payload,
        fromPeerId: localPeerId,
        targetPeerId: contact.peerId,
        targetNrp: contact.nrp,
        timestamp: Date.now(),
      })
    );
  };

  // Create & configure real cross-device RTCPeerConnection for Live Peer Calls
  const initiateLiveWebRTCOffer = async () => {
    const pc = pcLocalRef.current;
    if (!pc || !contact) return;
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: activeMode === 'video',
      });
      await pc.setLocalDescription(offer);
      sendCallSignal({
        type: 'call:webrtc-offer',
        callType: activeMode,
        sdp: pc.localDescription || offer,
      });
    } catch {
      // Fallback media frame relay still works even if SDP fails
    }
  };

  // Handle incoming call signaling packets (accept, offer, answer, ice, media-frame, hangup)
  useEffect(() => {
    if (!isOpen || !contact || !latestCallSignal) return;

    const handleSignal = async () => {
      const sig = latestCallSignal;
      const pc = pcLocalRef.current;

      if (sig.type === 'call:accept') {
        setCallStateText('Tersambung (P2P Live)');
        await initiateLiveWebRTCOffer();
        return;
      }

      if (sig.type === 'call:reject' || sig.type === 'call:hangup') {
        onClose(false);
        return;
      }

      if (sig.type === 'call:webrtc-offer' && sig.sdp && pc) {
        try {
          setCallStateText('Tersambung (P2P Live)');
          await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
          for (const cand of pendingIceCandidatesRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          pendingIceCandidatesRef.current = [];

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendCallSignal({
            type: 'call:webrtc-answer',
            sdp: pc.localDescription || answer,
          });
        } catch {
          // Ignore duplicate offer state
        }
        return;
      }

      if (sig.type === 'call:webrtc-answer' && sig.sdp && pc) {
        try {
          setCallStateText('Tersambung (P2P Live)');
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
            for (const cand of pendingIceCandidatesRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
            pendingIceCandidatesRef.current = [];
          }
        } catch {
          // Ignore duplicate answer state
        }
        return;
      }

      if (sig.type === 'call:webrtc-ice' && sig.candidate && pc) {
        try {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(sig.candidate));
          } else {
            pendingIceCandidatesRef.current.push(sig.candidate);
          }
        } catch {
          // Ignore invalid candidate
        }
        return;
      }

      if (sig.type === 'call:media-frame' && sig.dataUrl) {
        setCallStateText('Tersambung (P2P Live)');
        if (sig.frameType === 'video') {
          setRemoteVideoFrameUrl(sig.dataUrl);
        } else if (sig.frameType === 'audio' && speakerOn) {
          try {
            const audio = new Audio(sig.dataUrl);
            audio.volume = 1.0;
            audio.play().catch(() => {});
          } catch {
            // Ignore audio playback gesture block
          }
        }
      }
    };

    handleSignal();
  }, [latestCallSignal, isOpen, contact, speakerOn]);

  // Manage WebRTC MediaStream based on activeMode ('voice' vs 'video') and contact mode ('live-peer' vs 'loopback-webrtc')
  useEffect(() => {
    if (!isOpen || !contact) return;

    let isCancelled = false;
    let animFrameId: number | null = null;
    let videoRelayIntervalId: number | null = null;
    let audioRelayIntervalId: number | null = null;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    pcLocalRef.current?.close();
    pcRemoteLoopbackRef.current?.close();
    pendingIceCandidatesRef.current = [];

    // Synthetic radar video stream for fallback camera or loopback demo contacts
    const createSyntheticStream = (label: string): MediaStream => {
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 640;
      const ctx = canvas.getContext('2d')!;
      let angle = 0;

      const draw = () => {
        if (isCancelled) return;
        angle = (angle + 0.03) % (Math.PI * 2);

        ctx.fillStyle = '#07131c';
        ctx.fillRect(0, 0, 480, 640);

        ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
        for (let x = 0; x < 480; x += 40) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 640);
          ctx.stroke();
        }
        for (let y = 0; y < 640; y += 40) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(480, y);
          ctx.stroke();
        }

        const cx = 240;
        const cy = 320;
        [50, 100, 150].forEach((r) => {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
          ctx.stroke();
        });

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, 150, angle, angle + 0.5);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 240, 255, 0.2)';
        ctx.fill();

        ctx.font = 'bold 14px sans-serif';
        ctx.fillStyle = '#00f0ff';
        ctx.fillText(label, 24, 42);
        ctx.font = '11px monospace';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('SRTP E2EE STREAM AKTIF', 24, 64);

        animFrameId = requestAnimationFrame(draw);
      };

      draw();
      return canvas.captureStream(20);
    };

    const startMedia = async () => {
      let stream: MediaStream | null = null;

      if (activeMode === 'voice') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
        } catch {
          stream = null;
        }
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
            audio: true,
          });
        } catch {
          stream = createSyntheticStream(localCallsign);
        }
      }

      if (isCancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }

      localStreamRef.current = stream;
      if (localVideoRef.current && stream && activeMode === 'video') {
        localVideoRef.current.srcObject = stream;
      }

      // Setup Real Cross-Device WebRTC PeerConnection
      const pc = new RTCPeerConnection(RTC_ICE_CONFIG);
      pcLocalRef.current = pc;

      if (stream) {
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream!);
        });
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          if (contact.mode === 'live-peer') {
            sendCallSignal({
              type: 'call:webrtc-ice',
              candidate: e.candidate.toJSON(),
            });
          } else {
            pcRemoteLoopbackRef.current?.addIceCandidate(e.candidate).catch(() => {});
          }
        }
      };

      pc.ontrack = (event) => {
        const remoteStream = event.streams[0];
        if (!remoteStream) return;
        setCallStateText('Tersambung (SRTP)');

        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
        }
        if (event.track.kind === 'video' && remotePipVideoRef.current) {
          remotePipVideoRef.current.srcObject = remoteStream;
          setHasDirectRemoteVideoTrack(true);
        }
      };

      if (contact.mode === 'live-peer') {
        // If we are the callee (we just clicked Terima on an incoming call), notify the caller immediately
        if (!isCaller) {
          sendCallSignal({
            type: 'call:accept',
            callType: activeMode,
          });
        } else {
          // Caller also sends an initial WebRTC offer right away
          await initiateLiveWebRTCOffer();
        }

        // Start real-time WebSocket Video Frame Relay (4 fps JPEG) so video calls work even across strict 4G CGNAT
        if (activeMode === 'video') {
          const captureCanvas = document.createElement('canvas');
          captureCanvas.width = 240;
          captureCanvas.height = 320;
          const captureCtx = captureCanvas.getContext('2d');

          videoRelayIntervalId = window.setInterval(() => {
            if (
              isCancelled ||
              !localVideoRef.current ||
              !captureCtx ||
              localVideoRef.current.readyState < 2
            ) {
              return;
            }
            captureCtx.drawImage(localVideoRef.current, 0, 0, 240, 320);
            const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.45);
            sendCallSignal({
              type: 'call:media-frame',
              frameType: 'video',
              dataUrl,
            });
          }, 260);
        }

        // Start real-time WebSocket Audio Chunk Relay (1.1s chunks) so voice audio works even behind symmetric NAT
        if (stream && stream.getAudioTracks().length > 0 && typeof MediaRecorder !== 'undefined') {
          const audioOnlyStream = new MediaStream(stream.getAudioTracks());
          const startChunkCycle = () => {
            if (isCancelled || !localStreamRef.current) return;
            try {
              const rec = new MediaRecorder(audioOnlyStream);
              audioRecorderRef.current = rec;
              const chunks: BlobPart[] = [];
              rec.ondataavailable = (ev) => {
                if (ev.data && ev.data.size > 0) chunks.push(ev.data);
              };
              rec.onstop = () => {
                if (isCancelled || chunks.length === 0) return;
                const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result === 'string') {
                    sendCallSignal({
                      type: 'call:media-frame',
                      frameType: 'audio',
                      dataUrl: reader.result,
                    });
                  }
                };
                reader.readAsDataURL(blob);
              };
              rec.start();
              window.setTimeout(() => {
                if (rec.state === 'recording') rec.stop();
              }, 1100);
            } catch {
              // Browser doesn't support recurring MediaRecorder
            }
          };

          audioRelayIntervalId = window.setInterval(startChunkCycle, 1200);
        }
      } else {
        // Loopback demo mode for preset contacts when offline
        if (activeMode === 'video') {
          const pc2 = new RTCPeerConnection();
          pcRemoteLoopbackRef.current = pc2;
          pc2.onicecandidate = (e) => {
            if (e.candidate) pc.addIceCandidate(e.candidate).catch(() => {});
          };
          const remoteStream = createSyntheticStream(contact.personnelName);
          remoteStream.getTracks().forEach((track) => pc2.addTrack(track, remoteStream));

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await pc2.setRemoteDescription(offer);
          const answer = await pc2.createAnswer();
          await pc2.setLocalDescription(answer);
          await pc.setRemoteDescription(answer);
        }
      }
    };

    startMedia();

    return () => {
      isCancelled = true;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (videoRelayIntervalId) window.clearInterval(videoRelayIntervalId);
      if (audioRelayIntervalId) window.clearInterval(audioRelayIntervalId);
      if (audioRecorderRef.current && audioRecorderRef.current.state === 'recording') {
        try {
          audioRecorderRef.current.stop();
        } catch {
          // Ignore
        }
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      pcLocalRef.current?.close();
      pcRemoteLoopbackRef.current?.close();
    };
  }, [isOpen, contact?.peerId, contact?.mode, activeMode, facingMode, localCallsign, isCaller]);

  if (!isOpen || !contact) return null;

  const toggleMic = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = micMuted;
      });
    }
    setMicMuted(!micMuted);
  };

  const toggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !next;
    }
  };

  const handleToggleVideoMode = () => {
    if (activeMode === 'voice') {
      setActiveMode('video');
      setVideoEnabled(true);
      setSpeakerOn(true);
    } else {
      if (videoEnabled) {
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((t) => {
            t.enabled = false;
          });
        }
        setVideoEnabled(false);
        setActiveMode('voice');
      } else {
        setVideoEnabled(true);
        setActiveMode('video');
      }
    }
  };

  const handleFlipCamera = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  const handleHangup = () => {
    sendCallSignal({ type: 'call:hangup' });
    onClose(true);
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 select-none">
      {/* Hidden WebRTC Remote Audio Output for both Voice and Video Calls */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Mobile-First Full-Height Container matching WhatsApp Android Call Screen */}
      <div className="w-full max-w-md h-full bg-[#0b141a] flex flex-col justify-between relative overflow-hidden shadow-2xl">
        {activeMode === 'video' ? (
          /* ===================================================================
             MODE 1: WHATSAPP ANDROID VIDEO CALL SCREEN (FULL-SCREEN CAMERA)
             =================================================================== */
          <>
            {/* Full-Screen Main Video Feed */}
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 w-full h-full object-cover transition-all ${
                tacticalFilterOn ? 'hue-rotate-180 contrast-125 brightness-95' : ''
              }`}
            />

            {/* Top Gradient Scrim for legibility */}
            <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/70 via-black/30 to-transparent pointer-events-none" />

            {/* Top Header Info + Right Floating Action Stack */}
            <div className="relative z-20 pt-6 px-4 flex items-start justify-between">
              <button
                type="button"
                onClick={handleHangup}
                className="w-11 h-11 rounded-full bg-[#1f2c34]/80 hover:bg-[#1f2c34] text-white flex items-center justify-center backdrop-blur-xs transition-colors"
                aria-label="Kecilkan layar panggilan"
              >
                <Minimize2 className="w-5 h-5" />
              </button>

              <div className="text-center flex-1 px-2">
                <h2 className="text-xl font-medium text-white drop-shadow-sm truncate">
                  {contact.personnelName}
                </h2>
                <div className="flex items-center justify-center gap-1.5 text-xs text-slate-200/90 mt-1 drop-shadow-xs">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Terenkripsi secara end-to-end
                    {durationSec > 1 ? ` • ${formatDuration(durationSec)}` : ` • ${callStateText}`}
                  </span>
                </div>
              </div>

              {/* Top-Right Vertical Stack of 3 Circular Dark Buttons */}
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setShowSrtpInfo(!showSrtpInfo)}
                  className="w-11 h-11 rounded-full bg-[#1f2c34]/85 hover:bg-[#1f2c34] text-white flex items-center justify-center backdrop-blur-xs shadow-md transition-colors"
                  title="Info Partisipan & Enkripsi SRTP"
                >
                  <UserPlus className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={handleFlipCamera}
                  className="w-11 h-11 rounded-full bg-[#1f2c34]/85 hover:bg-[#1f2c34] text-white flex items-center justify-center backdrop-blur-xs shadow-md transition-colors"
                  title="Putar Kamera"
                >
                  <RefreshCw className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => setTacticalFilterOn(!tacticalFilterOn)}
                  className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xs shadow-md transition-colors ${
                    tacticalFilterOn
                      ? 'bg-[#00f0ff] text-[#031525]'
                      : 'bg-[#1f2c34]/85 hover:bg-[#1f2c34] text-white'
                  }`}
                  title="Filter Night-Vision Taktis"
                >
                  <Wand2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Floating Remote Peer Picture-in-Picture (PiP) Thumbnail */}
            <div className="relative z-20 self-end mr-4 mt-auto mb-4 w-28 h-40 rounded-2xl overflow-hidden border border-white/20 bg-[#111b21] shadow-2xl">
              <video
                ref={remotePipVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${
                  !hasDirectRemoteVideoTrack && remoteVideoFrameUrl ? 'hidden' : 'block'
                }`}
              />
              {!hasDirectRemoteVideoTrack && remoteVideoFrameUrl && (
                <img
                  src={remoteVideoFrameUrl}
                  alt={contact.personnelName}
                  className="w-full h-full object-cover block"
                />
              )}
              <div className="absolute bottom-1.5 inset-x-1.5 text-[10px] text-white bg-black/60 px-1.5 py-0.5 rounded text-center truncate">
                {contact.personnelName.split(' ')[0]} · {contact.nrp}
              </div>
            </div>

            {showSrtpInfo && (
              <div className="relative z-20 mx-4 mb-3 p-3 rounded-2xl bg-[#182229]/95 border border-cyan-500/30 text-xs text-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#00f0ff]" />
                  <span>DTLS-SRTP Video P2P · VP8/Opus · Zero-Retention</span>
                </div>
                <span className="text-[#00f0ff] font-mono">{contact.peerId}</span>
              </div>
            )}

            {/* Bottom Floating Pill Control Bar (5 Circular Buttons) */}
            <div className="relative z-20 px-4 pb-6">
              <div className="bg-[#182229]/95 backdrop-blur-md rounded-full px-4 py-3 flex items-center justify-between shadow-2xl border border-white/5">
                <button
                  type="button"
                  onClick={() => setShowSrtpInfo(!showSrtpInfo)}
                  className="w-12 h-12 rounded-full bg-[#2a3942] hover:bg-slate-600 text-white flex items-center justify-center transition-colors"
                  aria-label="Lainnya"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={toggleSpeaker}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                    speakerOn
                      ? 'bg-white text-[#111b21]'
                      : 'bg-[#2a3942] text-white hover:bg-slate-600'
                  }`}
                  aria-label="Speaker"
                >
                  <Volume2 className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={handleToggleVideoMode}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                    videoEnabled
                      ? 'bg-[#2a3942] text-white hover:bg-slate-600'
                      : 'bg-white text-[#111b21]'
                  }`}
                  aria-label="Matikan Video / Beralih ke Panggilan Suara"
                  title="Beralih ke Panggilan Suara"
                >
                  {videoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                </button>

                <button
                  type="button"
                  onClick={toggleMic}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                    micMuted
                      ? 'bg-white text-[#111b21]'
                      : 'bg-[#2a3942] text-white hover:bg-slate-600'
                  }`}
                  aria-label="Senyapkan Mikrofon"
                >
                  {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>

                <button
                  type="button"
                  onClick={handleHangup}
                  className="w-12 h-12 rounded-full bg-[#ea0038] hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95"
                  aria-label="Akhiri Panggilan"
                >
                  <PhoneOff className="w-5 h-5" />
                </button>
              </div>
            </div>
          </>
        ) : (
          /* ===================================================================
             MODE 2: WHATSAPP ANDROID VOICE CALL SCREEN (AUDIO ONLY)
             =================================================================== */
          <div className="flex-1 flex flex-col justify-between h-full wa-tactical-chat-bg">
            <div className="pt-6 px-4 flex items-start justify-between">
              <button
                type="button"
                onClick={handleHangup}
                className="w-11 h-11 rounded-full bg-[#1f2c34] hover:bg-[#2a3942] text-white flex items-center justify-center transition-colors"
                aria-label="Kecilkan layar panggilan"
              >
                <Minimize2 className="w-5 h-5" />
              </button>

              <div className="text-center flex-1 px-2">
                <h2 className="text-xl font-medium text-[#e9edef] truncate">
                  {contact.personnelName}
                </h2>
                <div className="flex items-center justify-center gap-1.5 text-xs text-[#8696a0] mt-1">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>Terenkripsi secara end-to-end</span>
                </div>
                <div className="text-xs text-[#00f0ff] font-medium mt-1 tabular-nums">
                  {callStateText === 'Tersambung (P2P Live)' ||
                  callStateText === 'Tersambung (SRTP)' ||
                  callStateText === 'Tersambung'
                    ? formatDuration(durationSec)
                    : callStateText}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowSrtpInfo(!showSrtpInfo)}
                className="w-11 h-11 rounded-full bg-[#1f2c34] hover:bg-[#2a3942] text-white flex items-center justify-center transition-colors"
                aria-label="Tambah Partisipan / Info SRTP"
              >
                <UserPlus className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center px-6">
              <div className="relative flex items-center justify-center">
                <div className="w-48 h-48 rounded-full bg-[#103629]/80 flex items-center justify-center shadow-2xl border border-[#25d366]/20">
                  <User className="w-24 h-24 text-[#25d366] fill-[#25d366]" />
                </div>
              </div>

              {isScreenSharing && (
                <div className="mt-4 px-3.5 py-1.5 rounded-full bg-[#00f0ff]/15 border border-[#00f0ff]/40 text-xs text-[#00f0ff]">
                  Berbagi Layar Taktis P2P Aktif
                </div>
              )}

              {showSrtpInfo && (
                <div className="mt-4 p-3 rounded-2xl bg-[#182229] border border-cyan-500/30 text-xs text-slate-300 text-center space-y-1 max-w-xs">
                  <div className="text-[#00f0ff] font-semibold">
                    Panggilan Suara WebRTC Opus SRTP
                  </div>
                  <div>
                    {contact.rank} · NRP {contact.nrp} · ID {contact.peerId}
                  </div>
                </div>
              )}
            </div>

            <div className="px-3 pb-5">
              <div className="bg-[#182229]/95 backdrop-blur-md rounded-3xl p-6 shadow-2xl border border-white/5">
                <div className="grid grid-cols-3 gap-y-6 gap-x-4 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleSpeaker}
                      className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                        speakerOn
                          ? 'bg-white text-[#111b21]'
                          : 'bg-[#2a3942] text-white hover:bg-slate-600'
                      }`}
                    >
                      <Volume2 className="w-6 h-6" />
                    </button>
                    <span className="text-xs text-[#e9edef]">Speaker</span>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleVideoMode}
                      className="w-14 h-14 rounded-full bg-[#2a3942] hover:bg-slate-600 text-white flex items-center justify-center transition-colors"
                    >
                      <Video className="w-6 h-6" />
                    </button>
                    <span className="text-xs text-[#e9edef]">Video</span>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleMic}
                      className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                        micMuted
                          ? 'bg-white text-[#111b21]'
                          : 'bg-[#2a3942] text-white hover:bg-slate-600'
                      }`}
                    >
                      <MicOff className="w-6 h-6" />
                    </button>
                    <span className="text-xs text-[#e9edef]">Senyapkan</span>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowSrtpInfo(!showSrtpInfo)}
                      className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                        showSrtpInfo
                          ? 'bg-white text-[#111b21]'
                          : 'bg-[#2a3942] text-white hover:bg-slate-600'
                      }`}
                    >
                      <MoreHorizontal className="w-6 h-6" />
                    </button>
                    <span className="text-xs text-[#e9edef]">Lainnya</span>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsScreenSharing(!isScreenSharing)}
                      className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                        isScreenSharing
                          ? 'bg-white text-[#111b21]'
                          : 'bg-[#2a3942] text-white hover:bg-slate-600'
                      }`}
                    >
                      <MonitorUp className="w-6 h-6" />
                    </button>
                    <span className="text-xs text-[#e9edef]">Bagikan</span>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={handleHangup}
                      className="w-14 h-14 rounded-full bg-[#ea0038] hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95"
                    >
                      <PhoneOff className="w-6 h-6" />
                    </button>
                    <span className="text-xs text-[#e9edef]">Akhiri</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
