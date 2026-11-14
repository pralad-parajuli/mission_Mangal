import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Map, X } from 'lucide-react';
import { MarsLayerConfig, PlannedRoute } from '../types/mars';
import {
  exportMissionReportPDF,
  exportRouteCSV,
  exportRouteGeoJSON,
} from '../services/reportExport';

interface ReportModalProps {
  route: PlannedRoute;
  activeLayers: MarsLayerConfig[];
  onClose: () => void;
}

export default function ReportModal({ route, activeLayers, onClose }: ReportModalProps) {
  const [missionName, setMissionName] = useState(
    `Jezero EVA Traverse — ${route.destination.label || 'Delta Campaign'}`
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#202124] text-xs text-[#e8eaed] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 bg-[#1b1c1f] px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Mission Planning Report Generator</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#9aa0a6] hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div>
            <label htmlFor="mission-report-name" className="mb-1.5 block font-medium text-[#bdc1c6]">
              Mission Plan Title
            </label>
            <input
              id="mission-report-name"
              type="text"
              value={missionName}
              onChange={(e) => setMissionName(e.target.value)}
              className="h-9 w-full rounded-xl border border-white/12 bg-[#303134] px-3 text-xs text-white focus:border-[#8ab4f8] focus:outline-none"
            />
          </div>

          {/* Summary Grid */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-[#292a2d] p-3 font-mono tabular-nums">
            <div>
              <div className="text-[10px] text-[#9aa0a6]">START COORDINATES</div>
              <div className="text-white">
                {route.start.lat.toFixed(5)}°N, {route.start.lon.toFixed(5)}°E
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#9aa0a6]">DESTINATION COORDINATES</div>
              <div className="text-white">
                {route.destination.lat.toFixed(5)}°N, {route.destination.lon.toFixed(5)}°E
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#9aa0a6]">TOTAL DISTANCE / DIFFICULTY</div>
              <div className="text-orange-400">
                {route.totalDistanceKm.toFixed(2)} km · {route.overallDifficulty.toUpperCase()}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#9aa0a6]">ELEVATION / MAX SLOPE</div>
              <div className="text-[#8ab4f8]">
                {route.minElevationM ?? '—'}m to {route.maxElevationM ?? '—'}m · Max{' '}
                {route.maxSlopeDeg.toFixed(1)}°
              </div>
            </div>
          </div>

          {/* Hazards & Science */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-[#292a2d] p-3">
              <div className="mb-1.5 font-semibold text-white">
                Identified Hazards ({route.hazards.length})
              </div>
              {route.hazards.length === 0 ? (
                <p className="text-[11px] text-[#9aa0a6]">
                  No major grid-scale hazards detected along planned waypoints.
                </p>
              ) : (
                <ul className="space-y-1 text-[11px] text-[#bdc1c6]">
                  {route.hazards.slice(0, 5).map((h) => (
                    <li key={h.id}>
                      km {h.distanceKm.toFixed(2)}: {h.type} ({h.severity})
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-[#292a2d] p-3">
              <div className="mb-1.5 font-semibold text-white">
                Scientific Targets Nearby ({route.nearbyPois.length})
              </div>
              {route.nearbyPois.length === 0 ? (
                <p className="text-[11px] text-[#9aa0a6]">
                  No cataloged POIs within 1.5 km of traverse.
                </p>
              ) : (
                <ul className="space-y-1 text-[11px] text-[#bdc1c6]">
                  {route.nearbyPois.slice(0, 5).map((p) => (
                    <li key={p.id}>
                      {p.name} ({p.distanceToRouteKm} km off route)
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Provenance & Limitations */}
          <div className="rounded-xl border border-white/10 bg-[#292a2d] p-3">
            <div className="mb-1.5 font-semibold text-white">
              Active Data Sources & Observation Dates ({activeLayers.length})
            </div>
            <ul className="space-y-1 text-[10px] text-[#bdc1c6]">
              {activeLayers.map((l) => (
                <li key={l.id}>
                  <span className="text-white">{l.name}</span> — {l.source} ({l.observationDate})
                </li>
              ))}
            </ul>
            <div className="mt-2.5 border-t border-white/10 pt-2 text-[10px] leading-relaxed text-amber-300/90">
              <strong>Data Limitations:</strong> Regional terrain risk combines ~115 m Jezero elevation modeling with historical NASA M20 Perseverance waypoints. Sub-meter boulders, unconsolidated dust traps, and overhangs require high-resolution HiRISE stereo DTM verification. Not certified for actual astronaut or rover navigation.
            </div>
          </div>
        </div>

        {/* Export Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#1b1c1f] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => exportMissionReportPDF(route, missionName, activeLayers)}
              className="inline-flex items-center gap-1.5 rounded-full bg-orange-600 px-4 py-1.5 font-semibold text-white hover:bg-orange-500"
            >
              <FileText className="h-3.5 w-3.5" />
              Export PDF Report
            </button>
            <button
              type="button"
              onClick={() => exportRouteGeoJSON(route, missionName)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#292a2d] px-3.5 py-1.5 font-medium text-[#8ab4f8] hover:bg-[#303134]"
            >
              <Map className="h-3.5 w-3.5" />
              Export GeoJSON
            </button>
            <button
              type="button"
              onClick={() => exportRouteCSV(route, missionName)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#292a2d] px-3.5 py-1.5 font-medium text-[#e8eaed] hover:bg-[#303134]"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Export Profile CSV
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-full border border-white/15 px-4 py-1.5 text-[#bdc1c6] hover:bg-white/10 hover:text-white"
          >
            <Download className="hidden" />
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
