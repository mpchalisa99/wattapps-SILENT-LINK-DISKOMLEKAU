// Standard-Compliant ISO/IEC 18004 QR Code & Code-128B Barcode Generator
// Generates real Reed-Solomon QR Codes scannable by any physical smartphone camera (iOS, Android, Google Lens, WhatsApp)
// Pure in-memory generation (Zero external network requests, works offline/air-gapped)

import QRCode from 'qrcode';

// Real ISO/IEC 18004 QR Code Matrix generator using Reed-Solomon Error Correction Level M
export function generateTacticalQrMatrix(payloadUrl: string): boolean[][] {
  try {
    const qr = QRCode.create(payloadUrl || 'https://silentlink.diskomlekau.mil.id', {
      errorCorrectionLevel: 'M',
    });
    const size = qr.modules.size;
    const data = qr.modules.data;
    const matrix: boolean[][] = [];

    for (let r = 0; r < size; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < size; c++) {
        row.push(data[r * size + c] === 1);
      }
      matrix.push(row);
    }
    return matrix;
  } catch {
    // Fallback minimal valid QR if input is empty
    const qr = QRCode.create('SILENT-LINK-DISKOMLEKAU', {
      errorCorrectionLevel: 'L',
    });
    const size = qr.modules.size;
    const data = qr.modules.data;
    const matrix: boolean[][] = [];
    for (let r = 0; r < size; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < size; c++) {
        row.push(data[r * size + c] === 1);
      }
      matrix.push(row);
    }
    return matrix;
  }
}

// High-contrast PNG DataURL generator with 4-module white quiet zone for guaranteed phone camera focus
export async function generateScannableQrDataUrl(payloadUrl: string): Promise<string> {
  return QRCode.toDataURL(payloadUrl, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 340,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
}

// Authentic Code-128B bar/space width table (107 patterns, each 6 elements summing to 11 modules; Stop pattern has 7 elements = 13 modules)
const CODE128_PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

// Generates a real, standard Code-128B 1D Barcode (with Start B = 104, Mod 103 checksum, and Stop = 106)
export function generateTacticalBarcodeBars(personnelIdText: string): number[] {
  const clean = personnelIdText
    .trim()
    .toUpperCase()
    .replace(/[^\x20-\x7E]/g, '')
    .slice(0, 28);

  const values: number[] = [104]; // Start Code B
  let checksum = 104;

  for (let i = 0; i < clean.length; i++) {
    const codeVal = clean.charCodeAt(i) - 32;
    const clamped = Math.max(0, Math.min(94, codeVal));
    values.push(clamped);
    checksum += clamped * (i + 1);
  }

  values.push(checksum % 103); // Modulo 103 Checksum
  values.push(106); // Stop Pattern

  const bars: number[] = [];
  for (const val of values) {
    const pattern = CODE128_PATTERNS[val] || CODE128_PATTERNS[0];
    for (let i = 0; i < pattern.length; i++) {
      bars.push(parseInt(pattern[i], 10));
    }
  }

  return bars;
}
