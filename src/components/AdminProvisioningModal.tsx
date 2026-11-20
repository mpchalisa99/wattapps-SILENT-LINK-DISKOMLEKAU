import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  QrCode,
  KeyRound,
  Copy,
  Check,
  UserPlus,
  X,
  Lock,
  Terminal,
  Fingerprint,
  Smartphone,
} from 'lucide-react';
import { DeviceRole, LocalNodeIdentity, ProvisionedOperativeCredential } from '../types/tactical';
import { generateSignedProvisioningCredential } from '../utils/cryptoEngine';
import {
  generateScannableQrDataUrl,
  generateTacticalBarcodeBars,
  generateTacticalQrMatrix,
} from '../utils/qrAndBarcodeSvg';

interface AdminProvisioningModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: DeviceRole;
  localIdentity: LocalNodeIdentity;
  onCredentialProvisioned: (cred: ProvisionedOperativeCredential, deployLocalLoopback: boolean) => void;
  onSimulateOperativeOnboardingWithToken: (token: string) => void;
}

export const AdminProvisioningModal: React.FC<AdminProvisioningModalProps> = ({
  isOpen,
  onClose,
  role,
  localIdentity,
  onCredentialProvisioned,
  onSimulateOperativeOnboardingWithToken,
}) => {
  const [personnelName, setPersonnelName] = useState('');
  const [nrp, setNrp] = useState('');
  const [unit, setUnit] = useState('SATKOM DISKOMLEKAU');
  const [rank, setRank] = useState('Kapten Lek');
  const [generatedCred, setGeneratedCred] = useState<ProvisionedOperativeCredential | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    let active = true;
    if (generatedCred) {
      generateScannableQrDataUrl(generatedCred.deepLinkUrl)
        .then((url) => {
          if (active) setQrDataUrl(url);
        })
        .catch(() => {
          if (active) setQrDataUrl('');
        });
    } else {
      setQrDataUrl('');
    }
    return () => {
      active = false;
    };
  }, [generatedCred]);

  if (!isOpen) return null;

  if (role !== 'ADMIN') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
        <div className="w-full max-w-md bg-[#111b21] border border-cyan-500/30 rounded-2xl p-6 text-slate-100 space-y-4 shadow-2xl">
          <div className="flex items-center gap-3 text-amber-400">
            <ShieldAlert className="w-6 h-6 shrink-0" />
            <h2 className="text-base font-bold">
              Akses Ditolak · Khusus Admin HP
            </h2>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            Perangkat ini sedang berada dalam mode <strong>OPERATIVE</strong>. Hanya perangkat
            Master Creator (ADMIN HP) yang memiliki kunci privat penandatanganan ECDSA P-256 untuk
            membuat QR Code, Barcode ID Personel, dan Deep Link personel baru.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-[#202c33] hover:bg-slate-700 rounded-full text-sm font-semibold text-slate-100"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleGenerateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const trimmedName = personnelName.trim();
    const trimmedNrp = nrp.trim();

    if (!trimmedName || !trimmedNrp) {
      setErrorMsg('Nama Personel dan NRP wajib diisi sebelum membuat QR Code & Link.');
      return;
    }

    if (
      !localIdentity.publicKeyJwk ||
      !localIdentity.signingPrivateKey ||
      !localIdentity.signingPublicKeyJwk
    ) {
      setErrorMsg('Kunci kriptografi Master Admin sedang disiapkan. Coba sesaat lagi.');
      return;
    }

    setIsGenerating(true);
    try {
      const cred = await generateSignedProvisioningCredential({
        personnelName: trimmedName,
        nrp: trimmedNrp,
        unit,
        rank,
        adminPeerId: localIdentity.peerId,
        adminCallsign: localIdentity.callsign,
        adminPublicKeyJwk: localIdentity.publicKeyJwk,
        adminFingerprint: localIdentity.fingerprint,
        adminSigningPrivateKey: localIdentity.signingPrivateKey,
        adminSigningPublicKeyJwk: localIdentity.signingPublicKeyJwk,
      });

      setGeneratedCred(cred);
      onCredentialProvisioned(cred, true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membuat kredensial.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyDeepLink = async () => {
    if (!generatedCred) return;
    await navigator.clipboard.writeText(generatedCred.deepLinkUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyPersonnelId = async () => {
    if (!generatedCred) return;
    await navigator.clipboard.writeText(generatedCred.assignedPeerId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleCopyRawToken = async () => {
    if (!generatedCred) return;
    await navigator.clipboard.writeText(generatedCred.encryptedToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  // Encode the compact scannable Deep Link URL in the ISO/IEC 18004 QR Code matrix
  const qrMatrix = generatedCred ? generateTacticalQrMatrix(generatedCred.deepLinkUrl) : null;
  // Encode the unique Personnel ID (SLK-ID-...) in the standard Code-128B 1D Barcode
  const barcodeBars = generatedCred
    ? generateTacticalBarcodeBars(generatedCred.assignedPeerId)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-[#111b21] border border-[#222e35] rounded-2xl text-slate-100 shadow-2xl my-auto overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#222e35] bg-[#202c33]">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-[#00f0ff]" />
            <h2 className="text-base font-bold text-slate-100">
              + Buat QR, Barcode &amp; ID Personel Unik (ADMIN HP)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors"
            aria-label="Tutup modal Admin"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 text-sm">
          <form onSubmit={handleGenerateCredentials} className="space-y-4">
            <div className="p-3.5 rounded-xl bg-[#0b141a] border border-cyan-500/20 text-xs text-slate-300 space-y-1">
              <div className="text-[#00f0ff] font-semibold flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Otoritas Kriptografi Master Admin ({localIdentity.personnelName})</span>
                </span>
                <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded-full border border-cyan-500/30">
                  ID ADMIN: {localIdentity.peerId}
                </span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Setiap klik <strong>Generate</strong> akan menerbitkan <strong>ID Personel Unik</strong>{' '}
                yang berbeda (<code>SLK-ID-NRP-XXXX</code>), <strong>QR Code standar ISO/IEC 18004</strong>{' '}
                yang langsung terbaca kamera HP, serta <strong>Barcode Code-128B</strong>.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-200">
                  Nama Personel (Wajib) <span className="text-[#00f0ff]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={personnelName}
                  onChange={(e) => setPersonnelName(e.target.value)}
                  placeholder="Contoh: Mayor Lek Satrio Wibowo"
                  className="w-full bg-[#202c33] border border-[#2a3942] rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#00f0ff]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-200">
                  NRP (Wajib) <span className="text-[#00f0ff]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={nrp}
                  onChange={(e) => setNrp(e.target.value)}
                  placeholder="Contoh: 548921"
                  className="w-full bg-[#202c33] border border-[#2a3942] rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#00f0ff] tabular-nums"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Pangkat / Jabatan</label>
                <input
                  type="text"
                  value={rank}
                  onChange={(e) => setRank(e.target.value)}
                  className="w-full bg-[#202c33] border border-[#2a3942] rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#00f0ff]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Satuan / Unit</label>
                <input
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full bg-[#202c33] border border-[#2a3942] rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#00f0ff]"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-950/70 border border-red-500/50 text-red-200 text-xs">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isGenerating || !personnelName.trim() || !nrp.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-full bg-[#00f0ff] hover:bg-cyan-300 disabled:opacity-40 text-[#031525] font-bold text-sm transition-colors shadow-lg shadow-cyan-500/10"
            >
              <QrCode className="w-4 h-4" />
              <span>Generate ID Unik, QR Code HP &amp; Link Terenkripsi</span>
            </button>
          </form>

          {/* Generated Credential Output */}
          {generatedCred && (
            <div className="p-4 rounded-2xl bg-[#0b141a] border border-cyan-500/30 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#202c33] pb-3">
                <div>
                  <div className="text-sm font-bold text-[#00f0ff]">
                    {generatedCred.personnelName}
                  </div>
                  <div className="text-xs text-slate-400 tabular-nums">
                    NRP: {generatedCred.nrp} · {generatedCred.rank} · {generatedCred.unit}
                  </div>
                </div>

                {/* Unique Personnel ID Badge */}
                <div className="flex items-center gap-2">
                  <div className="px-3 py-1 rounded-lg bg-cyan-950/90 border border-[#00f0ff]/50 flex items-center gap-1.5">
                    <Fingerprint className="w-3.5 h-3.5 text-[#00f0ff]" />
                    <span className="text-[11px] font-mono font-bold text-[#00f0ff]">
                      ID: {generatedCred.assignedPeerId}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyPersonnelId}
                    className="px-2.5 py-1 rounded-lg bg-[#202c33] hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1"
                    title="Salin ID Personel Unik"
                  >
                    {copiedId ? <Check className="w-3 h-3 text-[#00f0ff]" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedId ? 'ID Tersalin' : 'Salin ID'}</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4">
                {/* Real ISO/IEC 18004 Scannable QR Code with 4-Module White Quiet Zone */}
                <div className="flex flex-col items-center gap-1.5 shrink-0">
                  <div className="bg-white p-3 rounded-xl shadow-md border-2 border-white">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt={`QR Code ${generatedCred.assignedPeerId}`}
                        className="w-40 h-40 object-contain block"
                      />
                    ) : (
                      qrMatrix && (
                        <svg
                          viewBox={`-4 -4 ${qrMatrix.length + 8} ${qrMatrix.length + 8}`}
                          className="w-40 h-40"
                          shapeRendering="crispEdges"
                        >
                          <rect
                            x={-4}
                            y={-4}
                            width={qrMatrix.length + 8}
                            height={qrMatrix.length + 8}
                            fill="#FFFFFF"
                          />
                          {qrMatrix.map((row, rIdx) =>
                            row.map((cell, cIdx) =>
                              cell ? (
                                <rect
                                  key={`${rIdx}-${cIdx}`}
                                  x={cIdx}
                                  y={rIdx}
                                  width={1}
                                  height={1}
                                  fill="#000000"
                                />
                              ) : null
                            )
                          )}
                        </svg>
                      )
                    )}
                  </div>
                  <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Siap Dipindai Kamera HP</span>
                  </span>
                </div>

                <div className="flex-1 min-w-0 space-y-3 w-full">
                  {/* Standard Code-128B 1D Barcode encoding Unique Personnel ID */}
                  {barcodeBars && (
                    <div className="bg-white px-4 py-2.5 rounded-xl shadow-xs">
                      <svg
                        viewBox={`-10 0 ${barcodeBars.reduce((a, b) => a + b, 0) + 20} 36`}
                        className="w-full h-10"
                        preserveAspectRatio="none"
                        shapeRendering="crispEdges"
                      >
                        <rect
                          x={-10}
                          y={0}
                          width={barcodeBars.reduce((a, b) => a + b, 0) + 20}
                          height={36}
                          fill="#FFFFFF"
                        />
                        {(() => {
                          let xCursor = 0;
                          return barcodeBars.map((w, idx) => {
                            const x = xCursor;
                            xCursor += w;
                            return idx % 2 === 0 ? (
                              <rect key={idx} x={x} y={0} width={w} height={36} fill="#000000" />
                            ) : null;
                          });
                        })()}
                      </svg>
                      <div className="text-[11px] text-black font-mono font-bold text-center tracking-widest mt-1">
                        {generatedCred.assignedPeerId}
                      </div>
                    </div>
                  )}

                  {/* Scannable Deep Link URL */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-medium">
                        Link QR Kamera HP (Otomatis Login):
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleCopyRawToken}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#202c33] hover:bg-slate-700 text-slate-200 text-xs transition-colors"
                        >
                          {copiedToken ? (
                            <Check className="w-3 h-3 text-[#00f0ff]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedToken ? 'Tersalin' : 'Salin Token SLK2'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyDeepLink}
                          className="flex items-center gap-1 px-3 py-1 rounded-full bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/40 text-[#00f0ff] text-xs font-semibold transition-colors"
                        >
                          {copiedLink ? (
                            <Check className="w-3 h-3 text-[#00f0ff]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedLink ? 'Link Tersalin' : 'Salin Link QR'}</span>
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      readOnly
                      value={generatedCred.deepLinkUrl}
                      className="w-full bg-[#111b21] border border-[#222e35] rounded-lg px-3 py-2 text-xs text-[#00f0ff] font-mono focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-[#202c33] flex flex-col sm:flex-row items-center justify-between gap-2.5">
                <span className="text-xs text-[#00f0ff] flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4 shrink-0" />
                  <span>
                    Personel <strong>{generatedCred.personnelName}</strong> (ID:{' '}
                    <code className="font-mono">{generatedCred.assignedPeerId}</code>) ditambahkan ke
                    Daftar Chat!
                  </span>
                </span>

                <button
                  type="button"
                  onClick={() => {
                    onSimulateOperativeOnboardingWithToken(generatedCred.deepLinkUrl);
                    onClose();
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#202c33] hover:bg-slate-700 text-[#00f0ff] text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Simulasikan Buka Link QR di HP Personel</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
