import React from 'react';
import {
  ShieldCheck,
  KeyRound,
  Cpu,
  Lock,
  RefreshCw,
  Eye,
  EyeOff,
  Trash2,
  Network,
  X,
  UserCheck,
} from 'lucide-react';
import { CryptoPacketLog, LocalNodeIdentity, TacticalContact } from '../types/tactical';

interface EncryptionTelemetryPanelProps {
  localIdentity: LocalNodeIdentity;
  activeContact: TacticalContact | null;
  packetLogs: CryptoPacketLog[];
  totalEncryptedPackets: number;
  totalTransmittedBytes: number;
  showCiphertextInline: boolean;
  onToggleCiphertextInline: () => void;
  onRotateSessionKey: () => void;
  onPurgeSessionMemory: () => void;
  onCloseMobile?: () => void;
}

export const EncryptionTelemetryPanel: React.FC<EncryptionTelemetryPanelProps> = ({
  localIdentity,
  activeContact,
  packetLogs,
  totalEncryptedPackets,
  totalTransmittedBytes,
  showCiphertextInline,
  onToggleCiphertextInline,
  onRotateSessionKey,
  onPurgeSessionMemory,
  onCloseMobile,
}) => {
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <aside className="w-full lg:w-80 xl:w-96 shrink-0 bg-slate-950 border-l border-slate-800 flex flex-col h-full select-none">
      {/* Panel Header */}
      <div className="px-4 py-3.5 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <h2 className="text-xs font-semibold tracking-wider text-slate-100">
            OTORISASI RBAC &amp; TELEMETRI E2EE
          </h2>
        </div>
        {onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden p-1 text-slate-400 hover:text-slate-100"
            aria-label="Tutup panel keamanan"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80 text-xs">
        {/* Section 1: RBAC Device Role & Personnel Identity */}
        <div className="p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-medium text-slate-200">
              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Identitas &amp; Hak Akses Perangkat</span>
            </span>
            <span
              className={`font-bold text-[11px] ${
                localIdentity.role === 'ADMIN' ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              ROLE: {localIdentity.role}
            </span>
          </div>

          <div className="p-2.5 bg-slate-900/80 border border-slate-800 space-y-1.5 text-[11px] tabular-nums">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Nama Personel</span>
              <span className="text-slate-100 font-semibold truncate max-w-44">
                {localIdentity.personnelName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">NRP</span>
              <span className="text-emerald-400 font-semibold">{localIdentity.nrp}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Otoritas Kripto</span>
              <span className="text-slate-200">
                {localIdentity.role === 'ADMIN'
                  ? 'Master ECDSA Signer (QR/Link)'
                  : 'Operative Terverifikasi QR'}
              </span>
            </div>
          </div>
        </div>

        {/* Section 2: Real-Time P2P Link & Cipher Suite */}
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between text-slate-400">
            <span className="font-medium text-slate-200">Status Kanal P2P</span>
            <span
              className={
                activeContact?.connectionState === 'CONNECTED'
                  ? 'text-emerald-400 font-semibold'
                  : 'text-amber-400 font-semibold'
              }
            >
              {activeContact?.connectionState || 'STANDBY'}
            </span>
          </div>

          <div className="space-y-2 text-[11px] text-slate-300">
            <div className="flex items-center justify-between py-1 border-b border-slate-900">
              <span className="text-slate-400">Rekan Terhubung</span>
              <span className="text-slate-100 truncate max-w-44">
                {activeContact
                  ? `${activeContact.personnelName} (NRP ${activeContact.nrp})`
                  : '-'}
              </span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-slate-900">
              <span className="text-slate-400">Routing</span>
              <span className="text-emerald-300">Serverless WebRTC DataChannel</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-slate-900">
              <span className="text-slate-400">Cipher Payload E2EE</span>
              <span className="text-slate-100">AES-256-GCM (96-bit IV)</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-400">Pertukaran Kunci</span>
              <span className="text-slate-100">ECDH P-256 + ECDSA Auth</span>
            </div>
          </div>
        </div>

        {/* Section 3: Cryptographic Key Fingerprints */}
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-slate-200 font-medium">
              <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
              <span>Sidik Jari Kunci (SHA-256)</span>
            </div>
            <button
              type="button"
              onClick={onRotateSessionKey}
              className="flex items-center gap-1 px-2 py-1 text-[11px] bg-slate-900 hover:bg-slate-800 border border-slate-700 text-emerald-300 transition-colors whitespace-nowrap"
              title="Putar ulang pasangan kunci ECDH P-256 sesi ini"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Rotasi Kunci</span>
            </button>
          </div>

          <div className="space-y-2.5 text-[11px]">
            <div>
              <div className="text-slate-400 mb-1">
                Kunci Publik Perangkat Ini · NRP {localIdentity.nrp}
              </div>
              <div className="p-2 bg-slate-900/90 border border-slate-800 text-emerald-300 font-mono break-all leading-relaxed">
                {localIdentity.fingerprint || 'MENGHASILKAN KUNCI...'}
              </div>
            </div>

            <div>
              <div className="text-slate-400 mb-1">
                Kunci Publik Rekan · {activeContact?.callsign || 'BELUM DIPILIH'}
              </div>
              <div className="p-2 bg-slate-900/90 border border-slate-800 text-slate-200 font-mono break-all leading-relaxed">
                {activeContact?.remoteFingerprint || 'MENUNGGU HANDSHAKE P2P'}
              </div>
            </div>

            <div>
              <div className="text-slate-400 mb-1">
                Hash Kunci Sesi E2EE (Derived AES-256-GCM)
              </div>
              <div className="p-2 bg-slate-900/90 border border-slate-800 text-emerald-400 font-mono break-all">
                {activeContact?.sharedKeyHash || 'BELUM DITURUNKAN'}
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Zero-Data Retention Compliance */}
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-1.5 text-slate-200 font-medium">
            <Cpu className="w-3.5 h-3.5 text-emerald-400" />
            <span>Status Zero-Data Retention</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] tabular-nums">
            <div className="p-2.5 bg-slate-900/70 border border-slate-800">
              <div className="text-slate-400">Penyimpanan Disk</div>
              <div className="text-sm font-semibold text-emerald-400 mt-0.5">0 Bytes (NIHIL)</div>
              <div className="text-[10px] text-slate-400 mt-0.5">RAM-Only Volatile</div>
            </div>
            <div className="p-2.5 bg-slate-900/70 border border-slate-800">
              <div className="text-slate-400">Trafik Terenkripsi</div>
              <div className="text-sm font-semibold text-slate-100 mt-0.5">
                {formatBytes(totalTransmittedBytes)}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {totalEncryptedPackets} Frame SCTP
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={onToggleCiphertextInline}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap"
            >
              {showCiphertextInline ? (
                <>
                  <EyeOff className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Sembunyikan Payload Ciphertext</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Inspeksi Payload Ciphertext di Chat</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onPurgeSessionMemory}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-red-950/60 hover:bg-red-900/70 border border-red-500/40 text-red-200 text-xs font-medium transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Terminasi Sesi &amp; Hapus Memori RAM</span>
            </button>
          </div>
        </div>

        {/* Section 5: Live Packet Telemetry Audit Log */}
        <div className="p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-slate-200 font-medium">
              <Network className="w-3.5 h-3.5 text-emerald-400" />
              <span>Log Transmisi Paket SCTP</span>
            </div>
            <span className="text-[11px] text-slate-400 tabular-nums">
              {packetLogs.length} frame
            </span>
          </div>

          {packetLogs.length === 0 ? (
            <div className="py-5 text-center text-slate-400 text-[11px] border border-dashed border-slate-800">
              Belum ada paket kriptografi yang ditransmisikan pada sesi ini.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {packetLogs.map((pkt) => (
                <div
                  key={pkt.id}
                  className="p-2 bg-slate-900/80 border border-slate-800/90 text-[10px] space-y-1 tabular-nums"
                >
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="font-semibold text-emerald-400">
                      [{pkt.direction}] {pkt.peerCallsign}
                    </span>
                    <span className="text-slate-400">
                      {new Date(pkt.timestamp).toLocaleTimeString('id-ID', {
                        hour12: false,
                      })}
                    </span>
                  </div>
                  <div className="text-slate-400 truncate">
                    {pkt.cipherSuite} · IV:{pkt.ivHex.slice(0, 12)} · {pkt.bytes}B
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer Security Seal */}
      <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between text-[11px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-emerald-400" />
          <span>DISKOMLEKAU SECURE P2P</span>
        </div>
        <span>ZERO-RETENTION RAM</span>
      </div>
    </aside>
  );
};
