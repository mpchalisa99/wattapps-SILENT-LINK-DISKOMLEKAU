// Tactical Voice Note Recorder & PCM WAV Fallback Synthesizer
// Streams voice notes directly in memory (Zero-Data Retention) for WebRTC DataChannel E2EE transfer

import { VoiceNoteMeta } from '../types/tactical';

function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}

function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

// Synthesize a realistic playable military PTT Voice Note WAV in RAM when physical microphone is unavailable in iframe
export function synthesizeTacticalVoiceNoteWav(durationSec: number): VoiceNoteMeta {
  const clampedSec = Math.max(1.5, Math.min(durationSec, 15));
  const sampleRate = 16000;
  const totalSamples = Math.floor(clampedSec * sampleRate);
  const samples = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Initial PTT Roger Beep (0.0s - 0.14s)
    if (t < 0.14) {
      samples[i] = Math.sin(2 * Math.PI * 1050 * t) * 0.35;
    } else if (t > clampedSec - 0.18) {
      // End PTT Squelch Tail + Dual-Tone Ack
      const freq = t > clampedSec - 0.09 ? 1480 : 980;
      samples[i] =
        Math.sin(2 * Math.PI * freq * t) * 0.32 + (Math.random() * 2 - 1) * 0.05;
    } else {
      // Encrypted tactical radio carrier modulation + subtle HF static
      const envelope =
        0.5 +
        0.45 * Math.sin(2 * Math.PI * 3.2 * t) * Math.cos(2 * Math.PI * 1.1 * t);
      const formant1 = Math.sin(2 * Math.PI * (240 + 45 * Math.sin(t * 7)) * t);
      const formant2 = Math.sin(2 * Math.PI * (680 + 90 * Math.cos(t * 5)) * t) * 0.5;
      const radioNoise = (Math.random() * 2 - 1) * 0.04;
      samples[i] = (formant1 + formant2) * 0.25 * Math.max(0.08, envelope) + radioNoise;
    }
  }

  const wavBuffer = encodeWAV(samples, sampleRate);
  const audioDataUrl = arrayBufferToDataUrl(wavBuffer, 'audio/wav');

  // Compute 24 waveform bars
  const bars: number[] = [];
  const blockSize = Math.floor(totalSamples / 24);
  for (let b = 0; b < 24; b++) {
    let sum = 0;
    for (let j = 0; j < blockSize; j++) {
      sum += Math.abs(samples[b * blockSize + j] || 0);
    }
    const avg = sum / Math.max(1, blockSize);
    bars.push(Math.min(100, Math.max(18, Math.round(avg * 380))));
  }

  return {
    durationSec: Math.round(clampedSec),
    mimeType: 'audio/wav',
    audioDataUrl,
    byteSize: wavBuffer.byteLength,
    waveform: bars,
  };
}
