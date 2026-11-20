import React, { useState } from 'react';
import {
  QrCode,
  ShieldCheck,
  KeyRound,
  Lock,
  X,
  ScanLine,
  AlertTriangle,
  ArrowRight,
  Radio,
} from 'lucide-react';
import { ProvisionedOperativeCredential } from '../types/tactical';
import { verifyAndParseProvisioningToken } from '../utils/cryptoEngine';

interface OperativeOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  recentAdminCredentials: ProvisionedOperativeCredential[];
  onCompleteOperativeOnboarding: (verifiedCred: ProvisionedOperativeCredential) => Promise<void>;
}

export const OperativeOnboardingModal: React.FC<OperativeOnboardingModalProps> = ({
  isOpen,
  onClose,
  recentAdminCredentials,
  onCompleteOperativeOnboarding,
}) => {
  const [tokenInput, setTokenInput] = useState('');
  const [verifiedPreview, setVerifiedPreview] = useState<ProvisionedOperativeCredential | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  if (!isOpen) return null;

  const handleParseAndVerify = async (rawTokenString: string) => {
    setErrorMsg('');
    setIsVerifying(true);
    try {
      const parsed = await verifyAndParseProvisioningToken(rawTokenString);
      setVerifiedPreview(parsed);
      setTokenInput(parsed.encryptedToken);
    } catch (err) {
      setVerifiedPreview(null);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Token QR / Deep Link tidak valid atau tanda tangan ECDSA ditolak.'
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const handleEstablishSession = async () => {
    if (!verifiedPreview) return;
    setIsVerifying(true);
    try {
      await onCompleteOperativeOnboarding(verifiedPreview);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membuka sesi E2EE WebRTC.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-[#111b21] border border-[#222e35] rounded-2xl text-slate-100 shadow-2xl my-auto overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#222e35] bg-[#202c33]">
          <div className="flex items-center gap-2.5">
            <ScanLine className="w-5 h-5 text-[#00f0ff]" />
            <h2 className="text-base font-bold text-slate-100">
              Pindai QR Code / Deep Link Admin
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-100 hover:bg-white/10"
            aria-label="Tutup modal onboarding"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          <div className="p-3.5 rounded-xl bg-[#0b141a] border border-cyan-500/20 flex items-start gap-3">
            <Lock className="w-4 h-4 text-[#00f0ff] shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-[#00f0ff]">
                Jaringan Tertutup · Tanpa Registrasi Terbuka
              </div>
              <p className="text-slate-400 leading-relaxed">
                Personel hanya dapat masuk dengan memindai <strong>QR Code Admin</strong> atau
                menempelkan <strong>Deep Link Terenkripsi</strong> yang diterbitkan khusus untuk
                Nama &amp; NRP Anda.
              </p>
            </div>
          </div>

          {recentAdminCredentials.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[#00f0ff] flex items-center gap-1.5">
                <QrCode className="w-4 h-4" />
                <span>Pindai Instan QR / Barcode Personel yang Baru Dibuat Admin:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {recentAdminCredentials.map((cred) => (
                  <button
                    key={cred.assignedPeerId}
                    type="button"
                    onClick={() => handleParseAndVerify(cred.deepLinkUrl)}
                    className="p-3 rounded-xl bg-[#202c33] hover:bg-[#2a3942] border border-cyan-500/20 text-left transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-100 truncate">
                        {cred.personnelName}
                      </div>
                      <div className="text-[11px] text-[#00f0ff] tabular-nums">
                        NRP: {cred.nrp}
                      </div>
                      <div className="text-[10px] text-cyan-300/90 font-mono truncate mt-0.5">
                        ID: {cred.assignedPeerId}
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-[#00f0ff] text-[#031525] text-[11px] font-bold shrink-0">
                      Scan QR
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300">
              Tempel Link QR (?invite=SLK-ID-...), ID Barcode (SLK-ID-...), atau Token (SLK2...):
            </label>
            <textarea
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Tempel Link QR hasil scan kamera HP (?invite=SLK-ID-...), ID Barcode (SLK-ID-...), atau Token SLK2..."
              rows={3}
              className="w-full bg-[#202c33] border border-[#2a3942] rounded-xl p-3 text-xs text-[#00f0ff] font-mono focus:outline-none focus:border-[#00f0ff]"
            />
            <div className="flex justify-end">
              <button
                type="button"
                disabled={isVerifying || !tokenInput.trim()}
                onClick={() => handleParseAndVerify(tokenInput)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#202c33] hover:bg-[#2a3942] disabled:opacity-40 text-slate-100 text-xs font-semibold transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#00f0ff]" />
                <span>Verifikasi Link / Barcode Personel</span>
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-950/70 border border-red-500/50 text-red-200 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {verifiedPreview && (
            <div className="p-4 rounded-xl bg-[#0b141a] border border-cyan-500/40 space-y-3">
              <div className="flex items-center justify-between border-b border-[#202c33] pb-2">
                <div className="flex items-center gap-2 text-[#00f0ff] text-xs font-bold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>KREDENSIAL &amp; ID PERSONEL UNIK VALID</span>
                </div>
                <span className="text-[11px] text-cyan-300 font-mono">
                  {verifiedPreview.assignedPeerId}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg bg-[#111b21]">
                  <div className="text-slate-400 text-[11px]">Nama Personel</div>
                  <div className="text-slate-100 font-bold mt-0.5">
                    {verifiedPreview.personnelName}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#111b21]">
                  <div className="text-slate-400 text-[11px]">NRP &amp; Satuan</div>
                  <div className="text-[#00f0ff] font-bold mt-0.5">
                    {verifiedPreview.nrp} · {verifiedPreview.unit}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#111b21]">
                  <div className="text-slate-400 text-[11px]">ID Personel Unik</div>
                  <div className="text-cyan-300 font-mono font-bold mt-0.5">
                    {verifiedPreview.assignedPeerId}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isVerifying}
                onClick={handleEstablishSession}
                className="w-full flex items-center justify-center gap-2 py-3 px-5 rounded-full bg-[#00f0ff] hover:bg-cyan-300 text-[#031525] font-bold text-sm transition-colors"
              >
                <Radio className="w-4 h-4" />
                <span>Hubungkan Sesi E2EE Sekarang</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
