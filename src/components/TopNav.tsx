import { useEffect, useRef, useState } from 'react';
import {
  CloudSun,
  Compass,
  FileText,
  Globe,
  Grid,
  Info,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  Mountain,
  Plane,
  Redo2,
  Rocket,
  Route as RouteIcon,
  Satellite,
  Search,
  Settings,
  Truck,
  Undo2,
  X,
} from 'lucide-react';
import { MarsLocation, MarsMission, PlannedRoute } from '../types/mars';
import { parseCoordinateQuery } from '../utils/coordinates';
import { searchMarsTrekNomenclature, TrekSearchItem } from '../services/marsApi';
import { LeftTab } from './LeftSidebar';

interface TopNavProps {
  locations: MarsLocation[];
  missions: MarsMission[];
  activeMissionId: string;
  onSelectMission: (missionId: string) => void;
  onFlyTo: (lat: number, lon: number, altitudeM: number, label?: string) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onCameraBack: () => void;
  onCameraForward: () => void;
  leftDrawerOpen: boolean;
  activeLeftTab: LeftTab;
  onSelectToolTab: (tab: LeftTab) => void;
  rightDrawerOpen: boolean;
  onToggleRightDrawer: () => void;
  showLegend: boolean;
  onToggleLegend: () => void;
  showGraticule: boolean;
  onToggleGraticule: () => void;
  enable3dTerrain: boolean;
  onToggle3dTerrain: () => void;
  activeRoute: PlannedRoute | null;
  bottomDockOpen: boolean;
  onToggleBottomDock: () => void;
  onOpenReportModal: () => void;
  onOpenSettings: () => void;
  onSetPickMode: (mode: 'inspect' | 'start' | 'destination') => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  flightSimActive?: boolean;
  onOpenFlightSim: () => void;
  roverSimActive?: boolean;
  onOpenRoverSim: () => void;
  satelliteSimActive?: boolean;
  onOpenSatelliteSim: () => void;
}

type MenuKey = 'file' | 'view' | 'layers' | 'missions' | 'tools' | 'help' | null;

export default function TopNav({
  locations,
  missions,
  activeMissionId,
  onSelectMission,
  onFlyTo,
  canGoBack,
  canGoForward,
  onCameraBack,
  onCameraForward,
  leftDrawerOpen,
  activeLeftTab,
  onSelectToolTab,
  rightDrawerOpen,
  onToggleRightDrawer,
  showLegend,
  onToggleLegend,
  showGraticule,
  onToggleGraticule,
  enable3dTerrain,
  onToggle3dTerrain,
  activeRoute,
  bottomDockOpen,
  onToggleBottomDock,
  onOpenReportModal,
  onOpenSettings,
  onSetPickMode,
  isFullscreen,
  onToggleFullscreen,
  flightSimActive,
  onOpenFlightSim,
  roverSimActive,
  onOpenRoverSim,
  satelliteSimActive,
  onOpenSatelliteSim,
}: TopNavProps) {
  const [query, setQuery] = useState('');
  const [openResults, setOpenResults] = useState(false);
  const [trekResults, setTrekResults] = useState<TrekSearchItem[]>([]);
  const [searchingTrek, setSearchingTrek] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const [showCatalogTip, setShowCatalogTip] = useState(true);
  const [showAttributionToast, setShowAttributionToast] = useState(false);

  const searchBoxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setOpenResults(false);
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3 || parseCoordinateQuery(trimmed)) {
      setTrekResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingTrek(true);
      const res = await searchMarsTrekNomenclature(trimmed);
      setTrekResults(res.items.slice(0, 5));
      setSearchingTrek(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const parsedCoord = parseCoordinateQuery(query);
  const matchingLocations = query.trim()
    ? locations.filter(
        (l) =>
          l.name.toLowerCase().includes(query.toLowerCase()) ||
          l.region.toLowerCase().includes(query.toLowerCase())
      )
    : locations.slice(0, 6);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedCoord) {
      onFlyTo(parsedCoord.lat, parsedCoord.lon, 65000, 'Coordinate Target');
      setOpenResults(false);
      return;
    }
    if (matchingLocations.length > 0) {
      const top = matchingLocations[0];
      onFlyTo(
        top.lat,
        top.lon,
        top.region.includes('Jezero') ? 16000 : 180000,
        top.name
      );
      setOpenResults(false);
    }
  };

  const extractCenterFromWkt = (shape?: string): { lat: number; lon: number } | null => {
    if (!shape) return null;
    const nums = shape.match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 2) return null;
    const lon = parseFloat(nums[0]);
    const lat = parseFloat(nums[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  };

  const isToolActive = (tab: LeftTab) => leftDrawerOpen && activeLeftTab === tab;

  const toolBtnClass = (active: boolean) =>
    `relative flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
      active
        ? 'bg-[#8ab4f8]/20 text-[#8ab4f8]'
        : 'text-[#bdc1c6] hover:bg-white/10 hover:text-white'
    }`;

  return (
    <header className="relative z-30 shrink-0 border-b border-white/10 bg-[#202124] select-none">
      {/* Row 1: Classic Google Earth Menu Bar */}
      <div
        ref={menuRef}
        className="flex h-6 items-center justify-between border-b border-white/5 bg-[#1b1c1f] px-3 text-[11px] text-[#bdc1c6]"
      >
        <div className="flex items-center gap-0.5">
          {(
            [
              ['file', 'File'],
              ['view', 'View'],
              ['layers', 'Layers'],
              ['missions', 'Missions'],
              ['tools', 'Tools'],
              ['help', 'Help'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu((cur) => (cur === key ? null : key))}
                className={`rounded px-2 py-0.5 transition-colors ${
                  openMenu === key ? 'bg-white/12 text-white' : 'hover:bg-white/8 hover:text-white'
                }`}
              >
                {label}
              </button>

              {openMenu === key && (
                <div className="absolute top-6 left-0 z-50 min-w-[210px] rounded-xl border border-white/12 bg-[#292a2d] py-1.5 text-xs text-[#e8eaed] shadow-2xl">
                  {key === 'file' && (
                    <>
                      <button
                        type="button"
                        disabled={!activeRoute}
                        onClick={() => {
                          onOpenReportModal();
                          setOpenMenu(null);
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-1.5 text-left hover:bg-white/10 disabled:opacity-40"
                      >
                        <span>Export Mission Report (PDF / GeoJSON)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onToggleFullscreen();
                          setOpenMenu(null);
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        <span>{isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenSettings();
                          setOpenMenu(null);
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        <span>Preferences & Units...</span>
                      </button>
                    </>
                  )}

                  {key === 'view' && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onFlyTo(18.45, 77.41, 9500000, 'Mars Global View');
                          setOpenMenu(null);
                        }}
                        className="block w-full px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        Global Mars View
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onFlyTo(18.45, 77.41, 22000, 'Jezero Crater');
                          setOpenMenu(null);
                        }}
                        className="block w-full px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        Zoom to Jezero Crater
                      </button>
                      <div className="my-1 border-t border-white/10" />
                      <button
                        type="button"
                        onClick={() => {
                          onToggle3dTerrain();
                          setOpenMenu(null);
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        <span>3D Jezero Terrain Relief</span>
                        <span className="text-[#8ab4f8]">{enable3dTerrain ? 'ON' : 'OFF'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onToggleGraticule();
                          setOpenMenu(null);
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        <span>30° Coordinate Graticule</span>
                        <span className="text-[#8ab4f8]">{showGraticule ? 'ON' : 'OFF'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onToggleLegend();
                          setOpenMenu(null);
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        <span>Map Legend & Provenance</span>
                        <span className="text-[#8ab4f8]">{showLegend ? 'ON' : 'OFF'}</span>
                      </button>
                    </>
                  )}

                  {key === 'layers' && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectToolTab('layers');
                          setOpenMenu(null);
                        }}
                        className="block w-full px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        Open NASA / USGS Data Catalog
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectToolTab('geology');
                          setOpenMenu(null);
                        }}
                        className="block w-full px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        Geological Units & Scientific POIs
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectToolTab('environment');
                          setOpenMenu(null);
                        }}
                        className="block w-full px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        Historical Sensor Climate Archives
                      </button>
                    </>
                  )}

                  {key === 'missions' && (
                    <div className="max-h-72 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectToolTab('missions');
                          setOpenMenu(null);
                        }}
                        className="block w-full border-b border-white/10 px-3.5 py-1.5 text-left font-medium text-[#8ab4f8] hover:bg-white/10"
                      >
                        Open All 14 Missions Panel
                      </button>
                      {missions.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            onSelectMission(m.id);
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3.5 py-1.5 text-left hover:bg-white/10"
                        >
                          <span className="truncate">{m.name}</span>
                          <span className="shrink-0 text-[10px] text-[#9aa0a6]">{m.missionType}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {key === 'tools' && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectToolTab('routing');
                          setOpenMenu(null);
                        }}
                        className="block w-full px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        A* Astronaut EVA Route Planner
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSetPickMode('start');
                          setOpenMenu(null);
                        }}
                        className="block w-full px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        Pick Route Start on Globe
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSetPickMode('destination');
                          setOpenMenu(null);
                        }}
                        className="block w-full px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        Pick Route Destination on Globe
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onToggleBottomDock();
                          setOpenMenu(null);
                        }}
                        className="block w-full px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        {bottomDockOpen ? 'Hide Elevation Profile Tray' : 'Show Elevation Profile Tray'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onToggleRightDrawer();
                          setOpenMenu(null);
                        }}
                        className="block w-full px-3.5 py-1.5 text-left hover:bg-white/10"
                      >
                        {rightDrawerOpen ? 'Hide Location Inspector' : 'Show Location Inspector'}
                      </button>
                      <div className="my-1 border-t border-white/10" />
                      <button
                        type="button"
                        onClick={() => {
                          onOpenRoverSim();
                          setOpenMenu(null);
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-1.5 text-left font-medium text-cyan-300 hover:bg-white/10"
                      >
                        <span>Astronaut Rover Simulator</span>
                        <span className="text-[10px] text-cyan-400">A → B Drive</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenSatelliteSim();
                          setOpenMenu(null);
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-1.5 text-left font-medium text-indigo-300 hover:bg-white/10"
                      >
                        <span>Mars Satellite Simulator</span>
                        <span className="text-[10px] text-indigo-400">Orbit A → B</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenFlightSim();
                          setOpenMenu(null);
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-1.5 text-left font-medium text-orange-300 hover:bg-white/10"
                      >
                        <span>Mars Flight Simulator</span>
                        <span className="text-[10px] text-orange-400">3D Game</span>
                      </button>
                    </>
                  )}

                  {key === 'help' && (
                    <div className="max-w-xs space-y-2 px-3.5 py-2 text-[11px] leading-relaxed text-[#bdc1c6]">
                      <div className="font-semibold text-white">Mars Explorer Scientific Notice</div>
                      <p>
                        Imagery sourced from NASA Mars Trek WMTS & USGS Astrogeology WMS. Traverses from NASA MMGIS archives. Spacecraft 3D meshes from NASA-3D-Resources.
                      </p>
                      <p className="text-amber-300">
                        Not certified for operational rover or astronaut navigation.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAttributionToast(true);
                          setOpenMenu(null);
                        }}
                        className="text-[#8ab4f8] hover:underline"
                      >
                        View Coordinate Datum Info
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="hidden sm:flex items-center gap-2 text-[10px] text-[#9aa0a6]">
          <span className="font-mono">Mars 2000 IAU Sphere (R = 3,396.19 km)</span>
        </div>
      </div>

      {/* Row 2: Main Google Earth Web Spatial Toolbar */}
      <div className="flex h-11 items-center justify-between gap-2 px-3">
        {/* Left: Mars Emblem + Pill Search + Navigation History */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Mars Sphere Emblem */}
          <button
            type="button"
            onClick={() => onFlyTo(18.45, 77.41, 9500000, 'Mars Global View')}
            className="flex shrink-0 items-center gap-2 rounded-full pr-1.5 transition-opacity hover:opacity-90"
            title="Mars Explorer — Return to Global Mars View"
          >
            <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0">
              <defs>
                <radialGradient id="marsEmblemGrad" cx="35%" cy="32%" r="70%">
                  <stop offset="0%" stopColor="#fdba74" />
                  <stop offset="45%" stopColor="#ea580c" />
                  <stop offset="100%" stopColor="#431407" />
                </radialGradient>
              </defs>
              <circle cx="16" cy="16" r="14" fill="url(#marsEmblemGrad)" />
              <path
                d="M7 14c3-2 7-1 10 1s6 2 9 0"
                fill="none"
                stroke="rgba(67,20,7,0.45)"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <ellipse cx="16" cy="5.5" rx="4.5" ry="1.4" fill="rgba(255,255,255,0.72)" />
            </svg>
            <span className="hidden xl:inline text-[13px] font-medium tracking-tight text-[#e8eaed] whitespace-nowrap">
              Mars Explorer
            </span>
          </button>

          {/* Pill Search Input */}
          <div ref={searchBoxRef} className="relative w-48 sm:w-64 md:w-72 shrink-0">
            <form onSubmit={handleSubmit} className="relative flex items-center">
              <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-[#9aa0a6]" />
              <input
                type="text"
                value={query}
                onFocus={() => setOpenResults(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpenResults(true);
                }}
                placeholder="Search Mars features or coords"
                className="h-8 w-full rounded-full border border-transparent bg-[#303134] pr-3 pl-9 text-xs text-[#e8eaed] placeholder:text-[#9aa0a6] focus:border-[#8ab4f8]/60 focus:bg-[#292a2d] focus:outline-none"
              />
            </form>

            {openResults && (
              <div className="absolute top-10 left-0 z-50 max-h-80 w-80 overflow-y-auto rounded-2xl border border-white/12 bg-[#292a2d] py-1.5 shadow-2xl">
                {parsedCoord && (
                  <button
                    type="button"
                    onClick={() => {
                      onFlyTo(parsedCoord.lat, parsedCoord.lon, 45000, 'Coordinate Target');
                      setOpenResults(false);
                    }}
                    className="flex w-full items-center justify-between border-b border-white/10 px-3.5 py-2 text-left text-xs hover:bg-white/10"
                  >
                    <span className="font-medium text-[#8ab4f8]">
                      Fly to: {parsedCoord.lat.toFixed(4)}°, {parsedCoord.lon.toFixed(4)}°
                    </span>
                    <span className="font-mono text-[11px] text-[#9aa0a6]">Go</span>
                  </button>
                )}

                {matchingLocations.map((loc) => (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => {
                      onFlyTo(
                        loc.lat,
                        loc.lon,
                        loc.region.includes('Jezero') ? 16000 : 160000,
                        loc.name
                      );
                      setOpenResults(false);
                    }}
                    className="flex w-full items-center justify-between border-b border-white/5 px-3.5 py-2 text-left hover:bg-white/10"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="truncate text-xs font-medium text-[#e8eaed]">{loc.name}</div>
                      <div className="truncate text-[11px] text-[#9aa0a6]">{loc.region}</div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-[#9aa0a6] tabular-nums">
                      {loc.lat.toFixed(2)}°, {loc.lon.toFixed(2)}°
                    </span>
                  </button>
                ))}

                {searchingTrek && (
                  <div className="px-3.5 py-2 text-[11px] text-[#9aa0a6]">
                    Querying NASA Mars Trek index...
                  </div>
                )}

                {trekResults.length > 0 && (
                  <div className="border-t border-white/10">
                    <div className="bg-black/25 px-3.5 py-1 text-[10px] font-medium text-[#9aa0a6]">
                      NASA Mars Trek Index
                    </div>
                    {trekResults.map((item, idx) => {
                      const center = extractCenterFromWkt(item.shape);
                      return (
                        <button
                          key={`${item.productLabel}-${idx}`}
                          type="button"
                          disabled={!center}
                          onClick={() => {
                            if (center) {
                              onFlyTo(center.lat, center.lon, 60000, item.title);
                              setOpenResults(false);
                            }
                          }}
                          className="flex w-full items-center justify-between border-b border-white/5 px-3.5 py-1.5 text-left hover:bg-white/10 disabled:opacity-50"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="truncate text-xs text-[#e8eaed]">{item.title}</div>
                            <div className="truncate text-[10px] text-[#9aa0a6]">
                              {item.itemType}
                              {item.instrument ? ` · ${item.instrument}` : ''}
                            </div>
                          </div>
                          {center && (
                            <span className="shrink-0 font-mono text-[10px] text-[#8ab4f8] tabular-nums">
                              {center.lat.toFixed(2)}°, {center.lon.toFixed(2)}°
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Camera History & Graticule */}
          <div className="hidden md:flex items-center gap-0.5">
            <button
              type="button"
              disabled={!canGoBack}
              onClick={onCameraBack}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#bdc1c6] hover:bg-white/10 hover:text-white disabled:opacity-30"
              title="Previous Camera View"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={!canGoForward}
              onClick={onCameraForward}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#bdc1c6] hover:bg-white/10 hover:text-white disabled:opacity-30"
              title="Next Camera View"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onToggleGraticule}
              className={toolBtnClass(showGraticule)}
              title="Toggle 30° Mars Graticule Grid"
            >
              <Grid className="h-4 w-4" />
            </button>
          </div>

          <div className="hidden sm:block h-5 w-px bg-white/12 mx-0.5" />

          {/* Main Spatial Tool Icons (Google Earth Icon Bar) */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onFlyTo(18.45, 77.41, 22000, 'Jezero Crater')}
              className={toolBtnClass(false)}
              title="Fly to Jezero Crater (Perseverance Site)"
            >
              <Compass className="h-4 w-4 text-orange-400" />
            </button>

            <button
              type="button"
              onClick={() => onFlyTo(18.45, 77.41, 9500000, 'Mars Global View')}
              className={toolBtnClass(false)}
              title="Return to Global Mars View"
            >
              <Globe className="h-4 w-4" />
            </button>

            <div className="h-5 w-px bg-white/12 mx-0.5" />

            <button
              type="button"
              onClick={() => onSelectToolTab('geology')}
              className={toolBtnClass(isToolActive('geology'))}
              title="Scientific POIs, Geology & Saved Places"
            >
              <MapPin className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => onSelectToolTab('missions')}
              className={toolBtnClass(isToolActive('missions'))}
              title="Mars Missions, 3D Models & Historical Traverses (14)"
            >
              <Rocket className="h-4 w-4" />
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-orange-400" />
            </button>

            {/* Data Catalog (Layers) with Google Earth Callout Anchor */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  onSelectToolTab('layers');
                  setShowCatalogTip(false);
                }}
                className={toolBtnClass(isToolActive('layers'))}
                title="NASA / USGS Scientific Data Catalog & Layers"
              >
                <Layers className="h-4 w-4" />
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[#f28b82]" />
              </button>

              {showCatalogTip && !leftDrawerOpen && (
                <div className="hidden md:block absolute top-11 left-1/2 z-50 w-72 -translate-x-1/2 rounded-xl border border-white/12 bg-[#292a2d] p-3.5 text-xs text-[#e8eaed] shadow-2xl">
                  <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-t border-l border-white/12 bg-[#292a2d]" />
                  <p className="leading-relaxed text-[#e8eaed]">
                    Access the data catalog anytime to explore NASA Mars Trek layers, 14 missions, and EVA route planning.
                  </p>
                  <div className="mt-2.5 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setShowCatalogTip(false)}
                      className="font-medium text-[#8ab4f8] hover:underline"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectToolTab('layers');
                        setShowCatalogTip(false);
                      }}
                      className="rounded-full bg-[#8ab4f8]/15 px-3 py-1 text-[11px] font-medium text-[#8ab4f8] hover:bg-[#8ab4f8]/25"
                    >
                      Open Catalog
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onSelectToolTab('routing')}
              className={toolBtnClass(isToolActive('routing'))}
              title="A* Astronaut EVA Route Planner"
            >
              <RouteIcon className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => onSelectToolTab('environment')}
              className={toolBtnClass(isToolActive('environment'))}
              title="Mars Historical Environmental & Weather Archives"
            >
              <CloudSun className="h-4 w-4" />
            </button>

            <div className="hidden lg:block h-5 w-px bg-white/12 mx-0.5" />

            <button
              type="button"
              onClick={onToggleBottomDock}
              className={`hidden lg:flex ${toolBtnClass(bottomDockOpen)}`}
              title="Toggle Route Elevation Profile & Comparison Dock"
            >
              <Mountain className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onToggleLegend}
              className={`hidden lg:flex ${toolBtnClass(showLegend)}`}
              title="Toggle Map Legend & Provenance Card"
            >
              <Info className="h-4 w-4" />
            </button>

            {activeRoute && (
              <button
                type="button"
                onClick={onOpenReportModal}
                className="hidden lg:flex h-8 w-8 items-center justify-center rounded-full text-[#bdc1c6] hover:bg-white/10 hover:text-white"
                title="Generate Mission Report (PDF / GeoJSON / CSV)"
              >
                <FileText className="h-4 w-4" />
              </button>
            )}

            <div className="h-5 w-px bg-white/12 mx-0.5" />

            <button
              type="button"
              onClick={onOpenRoverSim}
              className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                roverSimActive
                  ? 'border-cyan-500/70 bg-cyan-500/20 text-cyan-300'
                  : 'border-white/12 bg-[#303134] text-[#e8eaed] hover:border-cyan-500/50 hover:bg-cyan-500/15 hover:text-cyan-200'
              }`}
              title="Launch Astronaut Point-to-Point Rover Simulator"
            >
              <Truck className="h-3.5 w-3.5 text-cyan-400" />
              <span className="hidden xl:inline">Rover Sim</span>
            </button>

            <button
              type="button"
              onClick={onOpenSatelliteSim}
              className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                satelliteSimActive
                  ? 'border-indigo-500/70 bg-indigo-500/20 text-indigo-300'
                  : 'border-white/12 bg-[#303134] text-[#e8eaed] hover:border-indigo-500/50 hover:bg-indigo-500/15 hover:text-indigo-200'
              }`}
              title="Launch Mars Satellite Orbital Transit Simulator"
            >
              <Satellite className="h-3.5 w-3.5 text-indigo-400" />
              <span className="hidden xl:inline">Orbit Sim</span>
            </button>

            <button
              type="button"
              onClick={onOpenFlightSim}
              className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                flightSimActive
                  ? 'border-orange-500/70 bg-orange-500/20 text-orange-300'
                  : 'border-white/12 bg-[#303134] text-[#e8eaed] hover:border-orange-500/50 hover:bg-orange-500/15 hover:text-orange-200'
              }`}
              title="Launch Mars Flight Simulator Game"
            >
              <Plane className="h-3.5 w-3.5 text-orange-400" />
              <span className="hidden xl:inline">Flight Sim</span>
            </button>
          </div>
        </div>

        {/* Right: Mission Quick Selector, Settings, Fullscreen, Inspector */}
        <div className="flex shrink-0 items-center gap-2">
          <select
            aria-label="Jump to Mars mission"
            value={activeMissionId}
            onChange={(e) => onSelectMission(e.target.value)}
            className="hidden lg:block h-8 max-w-[190px] rounded-full border border-white/10 bg-[#303134] px-3 text-xs text-[#e8eaed] focus:border-[#8ab4f8] focus:outline-none"
          >
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onOpenSettings}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#bdc1c6] hover:bg-white/10 hover:text-white"
            title="Settings & Coordinate Conventions"
          >
            <Settings className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onToggleFullscreen}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#bdc1c6] hover:bg-white/10 hover:text-white"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={onToggleRightDrawer}
            className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
              rightDrawerOpen
                ? 'border-[#8ab4f8]/50 bg-[#8ab4f8]/20 text-[#8ab4f8]'
                : 'border-white/12 bg-[#303134] text-[#e8eaed] hover:bg-white/15'
            }`}
            title="Toggle Location Knowledge Card / Inspector"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-orange-600 text-[9px] font-bold text-white">
              M
            </span>
            <span className="hidden sm:inline">Inspector</span>
          </button>
        </div>
      </div>

      {showAttributionToast && (
        <div className="absolute top-20 right-4 z-50 w-80 rounded-2xl border border-white/12 bg-[#292a2d] p-4 text-xs text-[#e8eaed] shadow-2xl">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-semibold text-white">Datum & Attribution</span>
            <button
              type="button"
              onClick={() => setShowAttributionToast(false)}
              className="rounded-full p-1 text-[#9aa0a6] hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-[#bdc1c6]">
            Coordinates use Mars 2000 IAU Planetocentric Sphere (R = 3,396,190 m). Imagery streamed from NASA Mars Trek WMTS & USGS Astrogeology WMS; traverses from NASA/JPL MMGIS.
          </p>
        </div>
      )}
    </header>
  );
}
