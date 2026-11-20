import { useState, useEffect, useCallback } from 'react';

// ============================================================================
// 1. MILITARY THEME ENGINE (4 TACTICAL COLOR THEMES)
// ============================================================================
export type MilitaryThemeId = 'grey' | 'army-green' | 'tactical-black' | 'red';

export interface MilitaryThemeConfig {
  id: MilitaryThemeId;
  name: string;
  subtitle: string;
  badgeText: string;
  bgMain: string;
  bgHeader: string;
  bgCard: string;
  bgInput: string;
  bgBubbleOwn: string;
  bgBubblePeer: string;
  accent: string;
  accentHover: string;
  accentMuted: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  swatchColors: [string, string, string];
}

export const MILITARY_THEMES: Record<MilitaryThemeId, MilitaryThemeConfig> = {
  'grey': {
    id: 'grey',
    name: 'Abu-Abu Taktis (Tactical Grey)',
    subtitle: 'Stealth Urban & Naval Battleship Slate',
    badgeText: 'STEALTH GREY',
    bgMain: '#14181f',
    bgHeader: '#1e242e',
    bgCard: '#1a2029',
    bgInput: '#252c38',
    bgBubbleOwn: '#2b394a',
    bgBubblePeer: '#1e242e',
    accent: '#94a3b8',
    accentHover: '#cbd5e1',
    accentMuted: 'rgba(148, 163, 184, 0.16)',
    border: '#2e3746',
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    swatchColors: ['#14181f', '#2b394a', '#94a3b8'],
  },
  'army-green': {
    id: 'army-green',
    name: 'Army Green (Hijau Militer)',
    subtitle: 'Operasi Lapangan & Pertahanan Udara Taktis',
    badgeText: 'ARMY GREEN',
    bgMain: '#09140d',
    bgHeader: '#112217',
    bgCard: '#0e1c13',
    bgInput: '#162b1e',
    bgBubbleOwn: '#153d26',
    bgBubblePeer: '#122418',
    accent: '#22c55e',
    accentHover: '#4ade80',
    accentMuted: 'rgba(34, 197, 94, 0.16)',
    border: '#1d3826',
    textPrimary: '#ecfdf5',
    textSecondary: '#86efac',
    swatchColors: ['#09140d', '#153d26', '#22c55e'],
  },
  'tactical-black': {
    id: 'tactical-black',
    name: 'Tactical Black (Hitam Taktis)',
    subtitle: 'Komando Siber OLED & Night Ops DISKOMLEKAU',
    badgeText: 'CYBER BLACK',
    bgMain: '#05080c',
    bgHeader: '#0d141c',
    bgCard: '#0a1017',
    bgInput: '#131d28',
    bgBubbleOwn: '#03384e',
    bgBubblePeer: '#111a24',
    accent: '#00f0ff',
    accentHover: '#38bdf8',
    accentMuted: 'rgba(0, 240, 255, 0.15)',
    border: '#192634',
    textPrimary: '#e9edef',
    textSecondary: '#8696a0',
    swatchColors: ['#05080c', '#03384e', '#00f0ff'],
  },
  'red': {
    id: 'red',
    name: 'Merah Komando (Red Tactical)',
    subtitle: 'Siaga Rudal & Red Alert Night Vision',
    badgeText: 'RED COMMAND',
    bgMain: '#140608',
    bgHeader: '#240b10',
    bgCard: '#1c090d',
    bgInput: '#2d0f15',
    bgBubbleOwn: '#4c111b',
    bgBubblePeer: '#240b10',
    accent: '#ff3b5c',
    accentHover: '#fb7185',
    accentMuted: 'rgba(255, 59, 92, 0.18)',
    border: '#3d131b',
    textPrimary: '#ffe4e6',
    textSecondary: '#fda4af',
    swatchColors: ['#140608', '#4c111b', '#ff3b5c'],
  },
};

export function applyMilitaryThemeToDOM(themeId: MilitaryThemeId): void {
  const theme = MILITARY_THEMES[themeId] || MILITARY_THEMES['tactical-black'];
  const root = document.documentElement;
  root.setAttribute('data-military-theme', theme.id);
  root.style.setProperty('--slk-bg-main', theme.bgMain);
  root.style.setProperty('--slk-bg-header', theme.bgHeader);
  root.style.setProperty('--slk-bg-card', theme.bgCard);
  root.style.setProperty('--slk-bg-input', theme.bgInput);
  root.style.setProperty('--slk-bg-bubble-own', theme.bgBubbleOwn);
  root.style.setProperty('--slk-bg-bubble-peer', theme.bgBubblePeer);
  root.style.setProperty('--slk-accent', theme.accent);
  root.style.setProperty('--slk-accent-hover', theme.accentHover);
  root.style.setProperty('--slk-accent-muted', theme.accentMuted);
  root.style.setProperty('--slk-border', theme.border);
  root.style.setProperty('--slk-text-primary', theme.textPrimary);
  root.style.setProperty('--slk-text-secondary', theme.textSecondary);

  const metaTheme = document.getElementById('dynamic-theme-color');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme.bgHeader);
  }
}

// ============================================================================
// 2. PWA INSTALL & FULLSCREEN HOOK FOR HP (ANDROID & IOS)
// ============================================================================
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function usePWAAndFullscreen() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoFullscreenOnTap, setAutoFullscreenOnTap] = useState(true);

  const checkFullscreenState = useCallback(() => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
    };
    const inFull =
      Boolean(document.fullscreenElement || doc.webkitFullscreenElement) ||
      window.matchMedia('(display-mode: fullscreen)').matches;
    setIsFullscreen(inFull);
  }, []);

  const requestAppFullscreen = useCallback(async (): Promise<boolean> => {
    try {
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' });
        setIsFullscreen(true);
        return true;
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
        setIsFullscreen(true);
        return true;
      }
    } catch {
      // Fullscreen request requires direct user gesture on some mobile browsers
    }
    return false;
  }, []);

  const exitAppFullscreen = useCallback(async () => {
    try {
      const doc = document as Document & {
        webkitExitFullscreen?: () => Promise<void>;
      };
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
      }
      setIsFullscreen(false);
    } catch {
      // Ignore
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await exitAppFullscreen();
    } else {
      await requestAppFullscreen();
    }
  }, [exitAppFullscreen, requestAppFullscreen]);

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua);
    setIsIOS(ios);

    const standalone =
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (standalone) {
      setIsInstalled(true);
    }
    checkFullscreenState();

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
      void requestAppFullscreen();
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    document.addEventListener('fullscreenchange', checkFullscreenState);
    document.addEventListener('webkitfullscreenchange', checkFullscreenState);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      document.removeEventListener('fullscreenchange', checkFullscreenState);
      document.removeEventListener('webkitfullscreenchange', checkFullscreenState);
    };
  }, [checkFullscreenState, requestAppFullscreen]);

  // Automatically trigger fullscreen on first touch when installed or running on mobile smartphone
  useEffect(() => {
    if (!autoFullscreenOnTap) return;
    const isMobileScreen = window.innerWidth <= 900 || /android|iphone|ipad|mobile/i.test(navigator.userAgent);
    if (!isMobileScreen && !isInstalled) return;

    const handleFirstTouch = () => {
      if (!document.fullscreenElement && autoFullscreenOnTap) {
        void requestAppFullscreen();
      }
    };

    window.addEventListener('touchend', handleFirstTouch, { once: true, passive: true });
    return () => {
      window.removeEventListener('touchend', handleFirstTouch);
    };
  }, [autoFullscreenOnTap, isInstalled, requestAppFullscreen]);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setIsInstallable(false);
      return true;
    }
    return false;
  }, [deferredPrompt]);

  return {
    isInstallable,
    isInstalled,
    isIOS,
    isFullscreen,
    autoFullscreenOnTap,
    setAutoFullscreenOnTap,
    requestAppFullscreen,
    exitAppFullscreen,
    toggleFullscreen,
    promptInstall,
  };
}

// ============================================================================
// 3. BACKGROUND KEEP-ALIVE ENGINE (TETAP BEROPERASI SAAT BUKA APK LAIN DI HP)
// ============================================================================
// Mobile OS browsers (Android Chrome / WebAPK / iOS Safari) throttle or suspend
// tabs when switching to another app UNLESS the app holds:
//   a) An active Web Audio / MediaSession stream (registers as active communication audio)
//   b) An active Web Lock (`navigator.locks.request`)
//   c) Screen Wake Lock (`navigator.wakeLock`) when visible + instant recovery on visibilitychange
//   d) A background WebWorker / high-priority timer that keeps WebRTC & WebSocket signaling alive

export interface BackgroundKeepAliveStatus {
  enabled: boolean;
  audioKeepAliveActive: boolean;
  webLockActive: boolean;
  wakeLockActive: boolean;
  backgroundSeconds: number;
  lastHeartbeat: string;
}

class TacticalBackgroundDaemon {
  private enabled = true;
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private oscNode: OscillatorNode | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private webLockRelease: (() => void) | null = null;
  private workerTimer: Worker | null = null;
  private backgroundEnteredAt: number | null = null;
  private backgroundSeconds = 0;
  private lastHeartbeat = '--:--:--';
  private listeners: Set<(status: BackgroundKeepAliveStatus) => void> = new Set();
  private heartbeatCallbacks: Set<() => void> = new Set();

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.backgroundEnteredAt = Date.now();
          if (this.enabled) {
            this.ensureAudioKeepAlive();
            this.triggerHeartbeat();
          }
        } else {
          if (this.backgroundEnteredAt) {
            this.backgroundSeconds += Math.round((Date.now() - this.backgroundEnteredAt) / 1000);
            this.backgroundEnteredAt = null;
          }
          if (this.enabled) {
            void this.acquireWakeLock();
            this.triggerHeartbeat();
          }
          this.notifyListeners();
        }
      });
    }
  }

  public subscribe(cb: (status: BackgroundKeepAliveStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.getStatus());
    return () => {
      this.listeners.delete(cb);
    };
  }

  public onHeartbeat(cb: () => void): () => void {
    this.heartbeatCallbacks.add(cb);
    return () => {
      this.heartbeatCallbacks.delete(cb);
    };
  }

  public getStatus(): BackgroundKeepAliveStatus {
    return {
      enabled: this.enabled,
      audioKeepAliveActive: Boolean(this.audioCtx && this.audioCtx.state === 'running'),
      webLockActive: Boolean(this.webLockRelease),
      wakeLockActive: Boolean(this.wakeLock),
      backgroundSeconds: this.backgroundSeconds,
      lastHeartbeat: this.lastHeartbeat,
    };
  }

  private notifyListeners(): void {
    const st = this.getStatus();
    this.listeners.forEach((cb) => cb(st));
  }

  private triggerHeartbeat(): void {
    this.lastHeartbeat = new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    this.heartbeatCallbacks.forEach((cb) => {
      try {
        cb();
      } catch {
        // Ignore callback errors
      }
    });
    this.notifyListeners();
  }

  public start(): void {
    this.enabled = true;
    this.ensureAudioKeepAlive();
    this.acquireWebLock();
    void this.acquireWakeLock();
    this.startWorkerHeartbeat();
    this.notifyListeners();
  }

  public stop(): void {
    this.enabled = false;
    if (this.oscNode) {
      try {
        this.oscNode.stop();
        this.oscNode.disconnect();
      } catch {
        // Ignore
      }
      this.oscNode = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
    if (this.webLockRelease) {
      this.webLockRelease();
      this.webLockRelease = null;
    }
    if (this.wakeLock) {
      void this.wakeLock.release();
      this.wakeLock = null;
    }
    if (this.workerTimer) {
      this.workerTimer.terminate();
      this.workerTimer = null;
    }
    this.notifyListeners();
  }

  public ensureAudioKeepAlive(): void {
    if (!this.enabled || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.audioCtx && AudioCtx) {
        this.audioCtx = new AudioCtx();
        this.gainNode = this.audioCtx.createGain();
        // Near-zero inaudible gain (0.00001) keeps mobile OS audio daemon active without any sound
        this.gainNode.gain.value = 0.00001;
        this.gainNode.connect(this.audioCtx.destination);

        this.oscNode = this.audioCtx.createOscillator();
        this.oscNode.type = 'sine';
        this.oscNode.frequency.value = 1; // 1 Hz sub-audible pulse
        this.oscNode.connect(this.gainNode);
        this.oscNode.start();
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume().then(() => this.notifyListeners());
      }

      // Register MediaSession metadata so Android/iOS keeps the WebAPK alive when switching apps
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'SILENT LINK DISKOMLEKAU',
          artist: 'Kanal P2P E2EE Aktif di Latar Belakang',
          album: 'Zero-Retention Tactical Link',
          artwork: [
            { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          ],
        });
        navigator.mediaSession.playbackState = 'playing';
      }
    } catch {
      // AudioContext requires user gesture on first load
    }
    this.notifyListeners();
  }

  private acquireWebLock(): void {
    if (this.webLockRelease || typeof navigator === 'undefined' || !('locks' in navigator)) return;
    try {
      navigator.locks.request('silentlink_p2p_background_daemon', () => {
        return new Promise<void>((resolve) => {
          this.webLockRelease = resolve;
          this.notifyListeners();
        });
      });
    } catch {
      // Ignore if Web Locks unsupported
    }
  }

  private async acquireWakeLock(): Promise<void> {
    if (!this.enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    if (document.visibilityState !== 'visible') return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
        this.notifyListeners();
      });
      this.notifyListeners();
    } catch {
      // Ignore if battery saver blocks wakeLock
    }
  }

  private startWorkerHeartbeat(): void {
    if (this.workerTimer) return;
    try {
      // Inline Web Worker timer is NOT throttled to 1 minute by Chrome/Android when another app is in front
      const workerCode = `
        let intervalId = setInterval(() => {
          self.postMessage('HEARTBEAT_TICK');
        }, 8000);
        self.onmessage = (e) => {
          if (e.data === 'STOP') clearInterval(intervalId);
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      this.workerTimer = new Worker(url);
      this.workerTimer.onmessage = () => {
        if (this.enabled) {
          this.triggerHeartbeat();
        }
      };
    } catch {
      // Fallback if Worker Blob blocked
    }
  }

  public playTacticalNotificationTone(type: 'message' | 'call'): void {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = this.audioCtx || new AudioCtx();
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(type === 'call' ? 880 : 660, ctx.currentTime);
      if (type === 'call') {
        osc.frequency.setValueAtTime(1174, ctx.currentTime + 0.12);
      }
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (type === 'call' ? 0.35 : 0.18));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (type === 'call' ? 0.35 : 0.18));
    } catch {
      // Ignore audio errors
    }
  }
}

export const tacticalBackgroundDaemon = new TacticalBackgroundDaemon();

export async function sendBackgroundSystemNotification(
  title: string,
  body: string,
  soundEnabled = true,
  type: 'message' | 'call' = 'message'
): Promise<void> {
  if (soundEnabled) {
    tacticalBackgroundDaemon.playTacticalNotificationTone(type);
    if ('vibrate' in navigator) {
      navigator.vibrate(type === 'call' ? [200, 100, 200, 100, 300] : [120, 60, 120]);
    }
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) {
          await reg.showNotification(title, {
            body,
            icon: '/pwa-192x192.png',
            badge: '/pwa-192x192.png',
            tag: `slk-${type}-${Date.now()}`,
          });
          return;
        }
      }
      new Notification(title, {
        body,
        icon: '/pwa-192x192.png',
      });
    } catch {
      // Ignore notification errors
    }
  }
}
