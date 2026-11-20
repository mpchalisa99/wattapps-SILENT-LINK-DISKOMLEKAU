import React, { useState } from 'react';
import { Copy, Check, Terminal, ShieldCheck, ArrowRight, X, Radio } from 'lucide-react';

interface ManualSdpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerateOffer: (customCallsign: string) => Promise<string>;
  onAcceptOfferAndCreateAnswer: (offerToken: string) => Promise<{ answerToken: string; peerCallsign: string }>;
  onFinalizeWithAnswer: (answerToken: string) => Promise<void>;
}

export const ManualSdpModal: React.FC<ManualSdpModalProps> = ({
  isOpen,
  onClose,
  onGenerateOffer,
  onAcceptOfferAndCreateAnswer,
  onFinalizeWithAnswer,
}) => {
  const [role, setRole] = useState<'initiator' | 'responder'>('initiator');
  const [targetCallsign, setTargetCallsign] = useState('ELANG-07 [FIELD]');
  const [generatedOffer, setGeneratedOffer] = useState('');
  const [remoteAnswerInput, setRemoteAnswerInput] = useState('');
  const [remoteOfferInput, setRemoteOfferInput] = useState('');
  const [generatedAnswer, setGeneratedAnswer] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [copiedOffer, setCopiedOffer] = useState(false);
  const [copiedAnswer, setCopiedAnswer] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const handleCreateOffer = async () => {
    setBusy(true);
    setStatusMessage('Mengumpulkan kandidat ICE & kunci publik ECDH P-256...');
    try {
      const token = await onGenerateOffer(targetCallsign.trim() || 'FIELD-NODE');
      setGeneratedOffer(token);
      setStatusMessage('Paket SDP Offer + Kunci ECDH siap. Salin dan kirim ke perangkat rekan.');
    } catch (err) {
      setStatusMessage(`Gagal membuat SDP Offer: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleApplyAnswer = async () => {
    if (!remoteAnswerInput.trim()) return;
    setBusy(true);
    setStatusMessage('Memverifikasi SDP Answer & menurunkan kunci AES-256-GCM...');
    try {
      await onFinalizeWithAnswer(remoteAnswerInput.trim());
      setStatusMessage('Terowongan WebRTC P2P terbentuk! Membuka kanal komunikasi...');
      setTimeout(() => {
        onClose();
      }, 600);
    } catch (err) {
      setStatusMessage(`Token SDP Answer tidak valid: ${err instanceof Error ? err.message : 'Invalid format'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleProcessRemoteOffer = async () => {
    if (!remoteOfferInput.trim()) return;
    setBusy(true);
    setStatusMessage('Memproses SDP Offer & menghasilkan SDP Answer + ECDH...');
    try {
      const { answerToken, peerCallsign } = await onAcceptOfferAndCreateAnswer(remoteOfferInput.trim());
      setGeneratedAnswer(answerToken);
      setStatusMessage(`SDP Answer untuk ${peerCallsign} siap! Salin kembali ke perangkat pengirim.`);
    } catch (err) {
      setStatusMessage(`Gagal memproses SDP Offer: ${err instanceof Error ? err.message : 'Invalid format'}`);
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string, type: 'offer' | 'answer') => {
    await navigator.clipboard.writeText(text);
    if (type === 'offer') {
      setCopiedOffer(true);
      setTimeout(() => setCopiedOffer(false), 2000);
    } else {
      setCopiedAnswer(true);
      setTimeout(() => setCopiedAnswer(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl bg-slate-950 border border-emerald-500/40 text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-2.5">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold tracking-wider text-slate-100">
              HANDSHAKE P2P MANUAL (AIR-GAPPED SDP + ECDH P-256)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-100 transition-colors"
            aria-label="Tutup modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          <p className="text-slate-400 leading-relaxed">
            Gunakan protokol ini untuk menghubungkan dua perangkat secara langsung tanpa server signaling
            (Out-of-Band / Radio / Air-Gap). Paket di bawah berisi deskripsi sesi WebRTC (SDP), kandidat ICE, dan
            kunci publik ECDH P-256.
          </p>

          {/* Role selector */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900 border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setRole('initiator');
                setStatusMessage('');
              }}
              className={`py-2 px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                role === 'initiator'
                  ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              1. Inisiator (Buat SDP Offer)
            </button>
            <button
              type="button"
              onClick={() => {
                setRole('responder');
                setStatusMessage('');
              }}
              className={`py-2 px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                role === 'responder'
                  ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              2. Responder (Terima Offer & Buat Answer)
            </button>
          </div>

          {role === 'initiator' ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-slate-300 font-medium">
                  Callsign Rekan Tujuan
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={targetCallsign}
                    onChange={(e) => setTargetCallsign(e.target.value)}
                    placeholder="Contoh: ELANG-07 [FIELD]"
                    className="flex-1 bg-slate-900 border border-slate-800 px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleCreateOffer}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-semibold transition-colors whitespace-nowrap shrink-0"
                  >
                    Buat Paket SDP Offer
                  </button>
                </div>
              </div>

              {generatedOffer && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-400 font-medium">
                      Langkah A · Salin Token SDP Offer Ini ke Perangkat Rekan:
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText(generatedOffer, 'offer')}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                    >
                      {copiedOffer ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedOffer ? 'Tersalin' : 'Salin Offer'}</span>
                    </button>
                  </div>
                  <textarea
                    readOnly
                    value={generatedOffer}
                    rows={3}
                    className="w-full bg-slate-900/90 border border-slate-800 p-2.5 text-[11px] text-emerald-300 font-mono focus:outline-none"
                  />
                </div>
              )}

              <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                <label className="block text-slate-300 font-medium">
                  Langkah B · Tempel Token SDP Answer dari Rekan:
                </label>
                <textarea
                  value={remoteAnswerInput}
                  onChange={(e) => setRemoteAnswerInput(e.target.value)}
                  placeholder="Tempel paket Base64 SDP Answer dari rekan di sini..."
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-800 p-2.5 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy || !remoteAnswerInput.trim()}
                    onClick={handleApplyAnswer}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 font-semibold transition-colors whitespace-nowrap"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>Aktifkan Terowongan P2P</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-slate-300 font-medium">
                  Langkah A · Tempel Token SDP Offer dari Inisiator:
                </label>
                <textarea
                  value={remoteOfferInput}
                  onChange={(e) => setRemoteOfferInput(e.target.value)}
                  placeholder="Tempel paket Base64 SDP Offer di sini..."
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-800 p-2.5 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy || !remoteOfferInput.trim()}
                    onClick={handleProcessRemoteOffer}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 font-semibold transition-colors whitespace-nowrap"
                  >
                    <ArrowRight className="w-4 h-4" />
                    <span>Proses Offer & Buat SDP Answer</span>
                  </button>
                </div>
              </div>

              {generatedAnswer && (
                <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-400 font-medium">
                      Langkah B · Salin Token SDP Answer Ini Kembali ke Inisiator:
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText(generatedAnswer, 'answer')}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                    >
                      {copiedAnswer ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedAnswer ? 'Tersalin' : 'Salin Answer'}</span>
                    </button>
                  </div>
                  <textarea
                    readOnly
                    value={generatedAnswer}
                    rows={3}
                    className="w-full bg-slate-900/90 border border-slate-800 p-2.5 text-[11px] text-emerald-300 font-mono focus:outline-none"
                  />
                </div>
              )}
            </div>
          )}

          {statusMessage && (
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border border-slate-800 text-emerald-300 text-xs">
              <Radio className="w-3.5 h-3.5 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
