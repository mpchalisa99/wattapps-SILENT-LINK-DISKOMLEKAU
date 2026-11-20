import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Mic } from 'lucide-react';
import { VoiceNoteMeta } from '../types/tactical';

interface VoiceNotePlayerProps {
  voiceMeta: VoiceNoteMeta;
  isOwn: boolean;
}

export const VoiceNotePlayer: React.FC<VoiceNotePlayerProps> = ({ voiceMeta, isOwn }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressRatio, setProgressRatio] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);

  useEffect(() => {
    const audio = new Audio(voiceMeta.audioDataUrl);
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      const dur = audio.duration && isFinite(audio.duration) ? audio.duration : voiceMeta.durationSec;
      setCurrentTimeSec(Math.floor(audio.currentTime));
      setProgressRatio(dur > 0 ? Math.min(1, audio.currentTime / dur) : 0);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setProgressRatio(0);
      setCurrentTimeSec(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [voiceMeta]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60)
      .toString()
      .padStart(2, '0');
    return `${m}:${s}`;
  };

  const bars = voiceMeta.waveform?.length
    ? voiceMeta.waveform
    : Array.from({ length: 28 }, (_, i) => 25 + ((i * 19) % 65));

  return (
    <div className="my-1 py-1.5 px-1 flex items-center gap-3 min-w-[220px] sm:min-w-[260px]">
      <button
        type="button"
        onClick={togglePlayback}
        className="w-10 h-10 rounded-full flex items-center justify-center bg-[#00f0ff] hover:bg-cyan-300 text-[#031525] transition-colors shrink-0 shadow-sm"
        aria-label={isPlaying ? 'Jeda Voice Note' : 'Putar Voice Note'}
      >
        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>

      {/* Waveform Bars */}
      <div className="flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-[3px] h-6">
          {bars.map((heightPct, idx) => {
            const barRatio = idx / bars.length;
            const isPlayed = barRatio <= progressRatio && isPlaying;
            return (
              <div
                key={idx}
                className={`flex-1 rounded-full transition-colors ${
                  isPlayed
                    ? 'bg-[#00f0ff]'
                    : isOwn
                    ? 'bg-cyan-300/60'
                    : 'bg-slate-400/60'
                }`}
                style={{ height: `${Math.max(22, Math.min(100, heightPct))}%` }}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-300/90 tabular-nums">
          <span>{formatTime(isPlaying ? currentTimeSec : voiceMeta.durationSec)}</span>
          <span className="flex items-center gap-1 text-[#00f0ff]">
            <Mic className="w-3 h-3" />
            <span>E2EE PTT</span>
          </span>
        </div>
      </div>
    </div>
  );
};
