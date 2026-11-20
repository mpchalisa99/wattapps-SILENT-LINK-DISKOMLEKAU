import React from 'react';
import { Shield, Lock, Radio } from 'lucide-react';
import { ConnectionState, DeviceRole } from '../types/tactical';

interface TacticalHudOverlayProps {
  connectionState: ConnectionState;
  role: DeviceRole;
  personnelName: string;
  nrp: string;
  sharedKeyHash: string;
  latencyMs: number;
}

export const TacticalHudOverlay: React.FC<TacticalHudOverlayProps> = ({
  connectionState,
  role,
  personnelName,
  nrp,
  sharedKeyHash,
  latencyMs,
}) => {
  const isConnected = connectionState === 'CONNECTED';
  const e2eeStatus = isConnected ? 'ACTIVE' : 'HANDSHAKING';

  return (
    <div
      className="pointer-events-none fixed bottom-20 right-4 lg:right-84 xl:right-100 z-30 select-none"
      aria-label="Tactical System HUD Overlay"
    >
      <div className="bg-slate-950/85 backdrop-blur-xs border border-emerald-500/40 px-3.5 py-2 text-[11px] font-mono text-slate-200 shadow-xl space-y-1">
        {/* Primary Required HUD Line */}
        <div className="flex items-center gap-2 tracking-wide whitespace-nowrap">
          <Radio
            className={`w-3.5 h-3.5 shrink-0 ${
              isConnected ? 'text-emerald-400' : 'text-amber-400'
            }`}
          />
          <span>
            P2P STATUS:{' '}
            <strong className={isConnected ? 'text-emerald-400' : 'text-amber-400'}>
              {connectionState}
            </strong>{' '}
            <span className="text-slate-600">|</span> E2EE:{' '}
            <strong className="text-emerald-400">{e2eeStatus}</strong>{' '}
            <span className="text-slate-600">|</span> ROLE:{' '}
            <strong className={role === 'ADMIN' ? 'text-amber-400' : 'text-emerald-300'}>
              {role}
            </strong>
          </span>
        </div>

        {/* Secondary Tactical Telemetry Line */}
        <div className="flex items-center justify-between gap-4 text-[10px] text-slate-400 tabular-nums border-t border-slate-800/90 pt-1">
          <span className="truncate max-w-52">
            OP: {personnelName} · NRP:{nrp}
          </span>
          <span className="flex items-center gap-1 text-emerald-400/90 shrink-0">
            <Lock className="w-2.5 h-2.5" />
            <span>AES-256-GCM · {latencyMs}ms · 0-BYTE DISK</span>
          </span>
        </div>
      </div>
    </div>
  );
};
