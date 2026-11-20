import { TacticalContact } from '../types/tactical';

export const INITIAL_TACTICAL_CONTACTS: TacticalContact[] = [
  {
    peerId: 'SLK-ID-521890-A101',
    personnelName: 'Kolonel Lek Hendra Wijaya',
    nrp: '521890',
    callsign: 'GARUDA-01 [PUSKODAL]',
    unit: 'DISKOMLEKAU MABESAU',
    rank: 'KadiskomlekOps',
    frequency: 'UHF 314.850 MHz',
    sector: 'Sektor Alpha · Halim P.',
    mode: 'loopback-webrtc',
    isGroup: false,
    avatarColor: 'from-cyan-500 to-blue-700',
    connectionState: 'DISCONNECTED',
    iceState: 'new',
    dataChannelState: 'closed',
    remoteFingerprint: 'MENUNGGU HANDSHAKE ECDH...',
    sharedKeyHash: 'BELUM TERBENTUK',
    latencyMs: 0,
    unreadCount: 2,
    lastMessagePreview: 'Kanal P2P WebRTC siap. Otorisasi Admin & ECDH P-256 aktif.',
    lastActivityTime: Date.now() - 120000,
    provisionedByAdmin: true,
    autoResponderProfile: 'hq',
  },
  {
    peerId: 'SLK-ID-534112-B204',
    personnelName: 'Mayor Pas Rizky Pratama',
    nrp: '534112',
    callsign: 'BRAVO-90 [SATKOM]',
    unit: 'DENBRAVO 90 KOPASGAT',
    rank: 'Komandan Tim Taktis',
    frequency: 'VHF 142.400 MHz',
    sector: 'Sektor Charlie · Bogor',
    mode: 'loopback-webrtc',
    isGroup: false,
    avatarColor: 'from-sky-500 to-indigo-700',
    connectionState: 'DISCONNECTED',
    iceState: 'new',
    dataChannelState: 'closed',
    remoteFingerprint: 'MENUNGGU HANDSHAKE ECDH...',
    sharedKeyHash: 'BELUM TERBENTUK',
    latencyMs: 0,
    unreadCount: 1,
    lastMessagePreview: 'Perimeter aman. Siap menerima koordinat, dokumen & voice note.',
    lastActivityTime: Date.now() - 540000,
    provisionedByAdmin: true,
    autoResponderProfile: 'field',
  },
  {
    peerId: 'SLK-GRP-KOOPS-G01',
    personnelName: 'Satgas Komlek Koopsudnas',
    nrp: 'GRP-01',
    callsign: 'GRUP KOMANDO UTAMA',
    unit: 'KOOPSUDNAS · 14 SIMPUL P2P',
    rank: 'Grup Operasi Taktis',
    frequency: 'MULTICAST P2P MESH',
    sector: 'Nasional · Koridor Udara',
    mode: 'loopback-webrtc',
    isGroup: true,
    avatarColor: 'from-teal-500 to-cyan-800',
    connectionState: 'DISCONNECTED',
    iceState: 'new',
    dataChannelState: 'closed',
    remoteFingerprint: 'MENUNGGU HANDSHAKE ECDH...',
    sharedKeyHash: 'BELUM TERBENTUK',
    latencyMs: 0,
    unreadCount: 3,
    lastMessagePreview: 'GARUDA-01: Seluruh jajaran aktifkan frekuensi terenkripsi AES-256.',
    lastActivityTime: Date.now() - 900000,
    provisionedByAdmin: true,
    autoResponderProfile: 'hq',
  },
  {
    peerId: 'SLK-ID-528405-C309',
    personnelName: 'Letkol Pnb Bagus Santoso',
    nrp: '528405',
    callsign: 'RAIDER-31 [C-130J]',
    unit: 'SKADRON UDARA 31',
    rank: 'Komandan Unsur Udara',
    frequency: 'SATCOM 255.100 MHz',
    sector: 'FL240 · Koridor Timur',
    mode: 'loopback-webrtc',
    isGroup: false,
    avatarColor: 'from-blue-500 to-slate-800',
    connectionState: 'DISCONNECTED',
    iceState: 'new',
    dataChannelState: 'closed',
    remoteFingerprint: 'MENUNGGU HANDSHAKE ECDH...',
    sharedKeyHash: 'BELUM TERBENTUK',
    latencyMs: 0,
    unreadCount: 0,
    lastMessagePreview: 'Telemetry link standby. Enkripsi AES-256-GCM aktif.',
    lastActivityTime: Date.now() - 1800000,
    provisionedByAdmin: true,
    autoResponderProfile: 'air',
  },
  {
    peerId: 'SLK-ID-541908-D412',
    personnelName: 'Kapten Lek Arif Budiman',
    nrp: '541908',
    callsign: 'SENTINEL-04 [SOC]',
    unit: 'SATSIBER DISKOMLEKAU',
    rank: 'Perwira Kriptografi',
    frequency: 'SHF 4.420 GHz',
    sector: 'Sektor Delta · Sentul',
    mode: 'loopback-webrtc',
    isGroup: false,
    avatarColor: 'from-cyan-600 to-slate-900',
    connectionState: 'DISCONNECTED',
    iceState: 'new',
    dataChannelState: 'closed',
    remoteFingerprint: 'MENUNGGU HANDSHAKE ECDH...',
    sharedKeyHash: 'BELUM TERBENTUK',
    latencyMs: 0,
    unreadCount: 0,
    lastMessagePreview: 'Audit Zero-Data Retention: 0 byte tersimpan di disk.',
    lastActivityTime: Date.now() - 3600000,
    provisionedByAdmin: true,
    autoResponderProfile: 'cyber',
  },
  {
    peerId: 'SLK-GRP-SIBER-G02',
    personnelName: 'Grup Satsiber & Sandi AU',
    nrp: 'GRP-02',
    callsign: 'TIM SIBER & KRIPTO',
    unit: 'DISKOMLEKAU · 8 SIMPUL P2P',
    rank: 'Grup Pengawasan Sandi',
    frequency: 'SHF MESH P2P',
    sector: 'Mabesau · Cilangkap',
    mode: 'loopback-webrtc',
    isGroup: true,
    avatarColor: 'from-indigo-500 to-cyan-900',
    connectionState: 'DISCONNECTED',
    iceState: 'new',
    dataChannelState: 'closed',
    remoteFingerprint: 'MENUNGGU HANDSHAKE ECDH...',
    sharedKeyHash: 'BELUM TERBENTUK',
    latencyMs: 0,
    unreadCount: 0,
    lastMessagePreview: 'SENTINEL-04: Rotasi kunci ECDH P-256 terjadwal berjalan normal.',
    lastActivityTime: Date.now() - 7200000,
    provisionedByAdmin: true,
    autoResponderProfile: 'cyber',
  },
];

export function generateTacticalReply(
  profile: string | undefined,
  incomingText: string,
  kind: 'text' | 'image' | 'document' | 'voice',
  fileName?: string
): string {
  const upper = incomingText.toUpperCase();

  if (kind === 'voice') {
    return 'Siap, pesan suara PTT terenkripsi sudah diterima dan didekripsi melalui WebRTC DataChannel. Kualitas audio jernih, arahan dilaksanakan.';
  }

  if (kind === 'image') {
    return `Citra taktis "${fileName || 'RECON.PNG'}" diterima utuh melalui WebRTC DataChannel (AES-256-GCM). Hash SHA-256 tervalidasi.`;
  }

  if (kind === 'document') {
    return `Dokumen "${fileName || 'BERKAS.PDF'}" diterima melalui SCTP DataChannel P2P. Sesuai protokol Zero-Data Retention, berkas hanya dibuka di RAM volatil.`;
  }

  if (upper.includes('SITREP') || upper.includes('STATUS') || upper.includes('LAPOR')) {
    if (profile === 'hq') {
      return 'SITREP PUSKODAL: Seluruh simpul jaringan SILENT LINK beroperasi pada mode P2P murni. Latensi SCTP < 15ms. Kunci sesi ECDH P-256 terverifikasi.';
    }
    if (profile === 'field') {
      return 'SITREP DENBRAVO-90: Posisi tim di Grid 106.8891°E -6.2665°S. Jalur komunikasi radio & WebRTC DataChannel bersih dari intersepsi.';
    }
    if (profile === 'air') {
      return 'SITREP C-130J RAIDER-31: Ketinggian 24.000 kaki, kecepatan 310 KTAS, heading 085°. Link data terenkripsi stabil.';
    }
    return 'SITREP SATSIBER: Integritas terowongan DTLS 1.3 + AES-256-GCM 100% nominal. Zero-Data Retention aktif.';
  }

  switch (profile) {
    case 'hq':
      return `Siap Komando, pesan terenkripsi diterima ("${incomingText.slice(0, 48)}${incomingText.length > 48 ? '...' : ''}"). Instruksi dicatat di RAM sesi aktif.`;
    case 'field':
      return 'Copy Bravo-90: Transmisi P2P diterima jelas di lapangan. Tim siap melaksanakan arahan komando.';
    case 'air':
      return 'Wilco Raider-31: Salinan pesan diterima di dek penerbangan melalui kanal SCTP terenkripsi. Mempertahankan vektor operasi.';
    default:
      return 'Pesan AES-256-GCM berhasil didekripsi di RAM dan tanda tangan SHA-256 cocok. Siap melaksanakan perintah.';
  }
}

export function createSampleTacticalReconImage(): {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  fileSize: number;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#031525';
  ctx.fillRect(0, 0, 640, 360);

  ctx.strokeStyle = 'rgba(0, 240, 255, 0.14)';
  ctx.lineWidth = 1;
  for (let x = 0; x < 640; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 360);
    ctx.stroke();
  }
  for (let y = 0; y < 360; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(640, y);
    ctx.stroke();
  }

  const cx = 320;
  const cy = 180;
  [50, 100, 150].forEach((r) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.moveTo(cx - 170, cy);
  ctx.lineTo(cx + 170, cy);
  ctx.moveTo(cx, cy - 170);
  ctx.lineTo(cx, cy + 170);
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
  ctx.stroke();

  const targets = [
    { x: 260, y: 130, label: 'TGT-ALPHA [UAV]' },
    { x: 390, y: 210, label: 'POSKO-BRAVO' },
    { x: 345, y: 115, label: 'PATROLI-04' },
  ];

  targets.forEach((t) => {
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(t.x - 4, t.y - 4, 8, 8);
    ctx.strokeStyle = '#00f0ff';
    ctx.strokeRect(t.x - 9, t.y - 9, 18, 18);
    ctx.font = '11px monospace';
    ctx.fillStyle = '#a5f3fc';
    ctx.fillText(t.label, t.x + 14, t.y + 4);
  });

  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = '#00f0ff';
  ctx.fillText('DISKOMLEKAU // CITRA RECON RADAR SEKTOR-A', 18, 28);
  ctx.font = '11px monospace';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`LAT -06.2665 LON 106.8891 | AES-256-GCM P2P | ${new Date().toISOString()}`, 18, 342);

  const dataUrl = canvas.toDataURL('image/png');
  const fileSize = Math.round((dataUrl.length * 3) / 4);

  return {
    fileName: `RECON_RADAR_${Date.now().toString().slice(-5)}.PNG`,
    mimeType: 'image/png',
    dataUrl,
    fileSize,
  };
}
