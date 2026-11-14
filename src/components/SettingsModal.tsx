import { X } from 'lucide-react';
import { AppSettings } from '../types/mars';

interface SettingsModalProps {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onClose: () => void;
}

export default function SettingsModal({ settings, onChange, onClose }: SettingsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-[#202124] text-xs text-[#e8eaed] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 bg-[#1b1c1f] px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Coordinate & Terrain Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#9aa0a6] hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1.5 block font-medium text-[#bdc1c6]">Coordinate Format</label>
            <div className="grid grid-cols-2 gap-2">
              {(['decimal', 'dms'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => onChange({ ...settings, coordinateFormat: fmt })}
                  className={`rounded-xl border px-3 py-1.5 font-medium transition-colors ${
                    settings.coordinateFormat === fmt
                      ? 'border-[#8ab4f8]/60 bg-[#8ab4f8]/15 text-[#8ab4f8]'
                      : 'border-white/10 bg-[#292a2d] text-[#9aa0a6] hover:text-white'
                  }`}
                >
                  {fmt === 'decimal' ? 'Decimal Degrees' : 'DMS (Deg Min Sec)'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-medium text-[#bdc1c6]">Longitude Convention</label>
            <div className="grid grid-cols-2 gap-2">
              {(['signed', 'east360'] as const).map((conv) => (
                <button
                  key={conv}
                  type="button"
                  onClick={() => onChange({ ...settings, longitudeConvention: conv })}
                  className={`rounded-xl border px-3 py-1.5 font-medium transition-colors ${
                    settings.longitudeConvention === conv
                      ? 'border-[#8ab4f8]/60 bg-[#8ab4f8]/15 text-[#8ab4f8]'
                      : 'border-white/10 bg-[#292a2d] text-[#9aa0a6] hover:text-white'
                  }`}
                >
                  {conv === 'signed' ? 'Signed (-180° to +180°)' : 'Planetocentric (0°–360°E)'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 flex justify-between text-[#bdc1c6]">
              <span>Moderate Slope Threshold</span>
              <span className="font-mono text-amber-300">{settings.slopeWarningDeg}°</span>
            </div>
            <input
              type="range"
              min={3}
              max={12}
              step={1}
              value={settings.slopeWarningDeg}
              onChange={(e) =>
                onChange({ ...settings, slopeWarningDeg: parseInt(e.target.value, 10) })
              }
              className="w-full accent-[#8ab4f8]"
            />
          </div>

          <div>
            <div className="mb-1 flex justify-between text-[#bdc1c6]">
              <span>High Risk Slope Threshold</span>
              <span className="font-mono text-rose-400">{settings.slopeDangerDeg}°</span>
            </div>
            <input
              type="range"
              min={10}
              max={25}
              step={1}
              value={settings.slopeDangerDeg}
              onChange={(e) =>
                onChange({ ...settings, slopeDangerDeg: parseInt(e.target.value, 10) })
              }
              className="w-full accent-[#8ab4f8]"
            />
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-[#292a2d] px-3 py-2">
            <span>Render NASA-3D-Resources Spacecraft & Rover Models</span>
            <input
              type="checkbox"
              checked={settings.showNasaModels}
              onChange={(e) => onChange({ ...settings, showNasaModels: e.target.checked })}
              className="accent-[#8ab4f8]"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-[#292a2d] px-3 py-2">
            <span>Enable 3D Jezero Terrain Relief Model</span>
            <input
              type="checkbox"
              checked={settings.enable3dTerrain}
              onChange={(e) => onChange({ ...settings, enable3dTerrain: e.target.checked })}
              className="accent-[#8ab4f8]"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-[#292a2d] px-3 py-2">
            <span>Show Mars Coordinate Graticule (30° Grid)</span>
            <input
              type="checkbox"
              checked={settings.showGraticule}
              onChange={(e) => onChange({ ...settings, showGraticule: e.target.checked })}
              className="accent-[#8ab4f8]"
            />
          </label>
        </div>

        <div className="flex justify-end border-t border-white/10 bg-[#1b1c1f] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-[#8ab4f8] px-5 py-1.5 font-semibold text-[#17181b] hover:bg-[#aecbfa]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
