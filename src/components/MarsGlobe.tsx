import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import {
  AppSettings,
  FlightCameraMode,
  FlightCraftId,
  FlightHudTelemetry,
  FlightStatus,
  FlightTouchInput,
  GeologicalFeature,
  JezeroElevationGrid,
  LayerLoadStatus,
  LayerRuntimeState,
  MarsCoordinate,
  MarsLayerConfig,
  MarsLocation,
  MarsMission,
  MissionTelemetry,
  PlannedRoute,
  RoverCameraMode,
  RoverDriveMode,
  RoverHudTelemetry,
  RoverSimStatus,
  RoverTouchInput,
  RoverVehicleId,
  ScientificPoi,
} from '../types/mars';
import { Compass, Layers, Minus, Navigation, Plus } from 'lucide-react';
import {
  formatMarsCoords,
  marsBearingDeg,
  marsDistanceMeters,
  MARS_EQUATORIAL_RADIUS_M,
} from '../utils/coordinates';
import { evaluateTerrainRisk } from '../analysis/riskScore';
import { sampleElevationGrid } from '../analysis/elevation';
import { FLIGHT_COURSES, FLIGHT_CRAFTS, playFlightCue } from '../data/flightCourses';
import { playRoverCue, ROVER_VEHICLES } from '../data/roverMissions';
import { SCIENTIFIC_POIS } from '../data/geologyAndEnvironment';

// Match NASA Mars Trek EQ & NASA MMGIS datum: Mars_2000_Sphere_IAU (R = 3,396,190 m)
// so planetocentric coordinates, WMTS tiles, and MMGIS rover traverses align with zero latitude offset.
export const MARS_ELLIPSOID = new Cesium.Ellipsoid(
  MARS_EQUATORIAL_RADIUS_M,
  MARS_EQUATORIAL_RADIUS_M,
  MARS_EQUATORIAL_RADIUS_M
);

// Ensure all internal CesiumJS subsystems (entities, HeightReference, GroundPolyline, Terrain) use Mars instead of WGS84.
Cesium.Ellipsoid.default = MARS_ELLIPSOID;

interface MarsGlobeProps {
  layers: MarsLayerConfig[];
  layerStates: Record<string, LayerRuntimeState>;
  onLayerStatusChange: (layerId: string, status: LayerLoadStatus, errorMessage?: string) => void;
  missions: MarsMission[];
  visibleMissionIds: string[];
  missionTelemetry: Record<string, MissionTelemetry>;
  geologicalFeatures: GeologicalFeature[];
  pois: ScientificPoi[];
  showPois: boolean;
  locations: MarsLocation[];
  elevationGrid: JezeroElevationGrid | null;
  routes: PlannedRoute[];
  activeRouteId: string | null;
  hoveredProfileCoord: { lat: number; lon: number; distanceKm: number; elevationM: number | null } | null;
  selectedCoord: MarsCoordinate | null;
  routeStart?: MarsCoordinate | null;
  routeDest?: MarsCoordinate | null;
  pickMode: 'inspect' | 'start' | 'destination';
  onSelectCoordinate: (lat: number, lon: number) => void;
  onSelectMission: (missionId: string) => void;
  onSelectPoi: (poi: ScientificPoi) => void;
  flyToRequest: { lat: number; lon: number; altitudeM: number; pitchDeg?: number; nonce: number } | null;
  settings: AppSettings;
  splitCompareLayerId: string | null;
  onSelectBasemap?: (layerId: string) => void;
  onToggle3dTerrain?: () => void;
  onOpenSettings?: () => void;
  flightSim?: {
    active: boolean;
    courseId: string;
    craftId: FlightCraftId;
    cameraMode: FlightCameraMode;
    status: FlightStatus;
    invertPitch: boolean;
    muted: boolean;
    runNonce: number;
  };
  flightTouchRef?: React.MutableRefObject<FlightTouchInput>;
  onFlightHudUpdate?: (hud: FlightHudTelemetry) => void;
  onFlightStatusChange?: (status: FlightStatus, reason?: string) => void;
  onFlightToggleCamera?: () => void;
  onFlightTogglePause?: () => void;
  onFlightExit?: () => void;
  roverSim?: {
    active: boolean;
    vehicleId: RoverVehicleId;
    cameraMode: RoverCameraMode;
    status: RoverSimStatus;
    driveMode: RoverDriveMode;
    timeScale: 1 | 5 | 20;
    muted: boolean;
    runNonce: number;
    route: PlannedRoute | null;
    start: MarsCoordinate;
    destination: MarsCoordinate;
  };
  roverTouchRef?: React.MutableRefObject<RoverTouchInput>;
  onRoverHudUpdate?: (hud: RoverHudTelemetry) => void;
  onRoverStatusChange?: (status: RoverSimStatus) => void;
  onRoverToggleCamera?: () => void;
  onRoverTogglePause?: () => void;
  onRoverToggleAutopilot?: () => void;
  onRoverExit?: () => void;
}

function createFallbackMarsTexture(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 512, 256);
    grad.addColorStop(0, '#6e3722');
    grad.addColorStop(0.5, '#8c4427');
    grad.addColorStop(1, '#582c1c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let x = 0; x < 512; x += 32) {
      ctx.fillRect(x, 0, 1, 256);
    }
    for (let y = 0; y < 256; y += 32) {
      ctx.fillRect(0, y, 512, 1);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '12px monospace';
    ctx.fillText('FALLBACK PROCEDURAL GRID (NOT NASA IMAGERY)', 20, 130);
  }
  return canvas.toDataURL('image/png');
}

function createJezeroTerrainProvider(grid: JezeroElevationGrid): Cesium.CustomHeightmapTerrainProvider {
  const tilingScheme = new Cesium.GeographicTilingScheme({
    ellipsoid: MARS_ELLIPSOID,
    numberOfLevelZeroTilesX: 2,
    numberOfLevelZeroTilesY: 1,
  });

  const width = 33;
  const height = 33;

  return new Cesium.CustomHeightmapTerrainProvider({
    tilingScheme,
    ellipsoid: MARS_ELLIPSOID,
    width,
    height,
    credit: 'NASA M20 Localization + MOLA/HiRISE Jezero Topography',
    callback: (x: number, y: number, level: number) => {
      const rect = tilingScheme.tileXYToRectangle(x, y, level);
      const westDeg = Cesium.Math.toDegrees(rect.west);
      const eastDeg = Cesium.Math.toDegrees(rect.east);
      const southDeg = Cesium.Math.toDegrees(rect.south);
      const northDeg = Cesium.Math.toDegrees(rect.north);

      const heights = new Float32Array(width * height);
      if (
        eastDeg < grid.bounds.minLon ||
        westDeg > grid.bounds.maxLon ||
        northDeg < grid.bounds.minLat ||
        southDeg > grid.bounds.maxLat
      ) {
        return heights;
      }

      const floorRef = -2570;
      const lonSpan = grid.bounds.maxLon - grid.bounds.minLon;
      const latSpan = grid.bounds.maxLat - grid.bounds.minLat;

      for (let row = 0; row < height; row++) {
        const v = row / (height - 1);
        const lat = northDeg - v * (northDeg - southDeg);
        for (let col = 0; col < width; col++) {
          const u = col / (width - 1);
          const lon = westDeg + u * (eastDeg - westDeg);
          const sampled = sampleElevationGrid(grid, lat, lon);
          let h = 0;
          if (sampled.elevationM !== null) {
            const tx = Math.min(
              (lon - grid.bounds.minLon) / (lonSpan * 0.12),
              (grid.bounds.maxLon - lon) / (lonSpan * 0.12),
              1
            );
            const ty = Math.min(
              (lat - grid.bounds.minLat) / (latSpan * 0.12),
              (grid.bounds.maxLat - lat) / (latSpan * 0.12),
              1
            );
            const taper = Math.max(0, Math.min(1, Math.min(tx, ty)));
            h = (sampled.elevationM - floorRef) * taper;
          }
          heights[row * width + col] = h;
        }
      }
      return heights;
    },
  });
}

export default function MarsGlobe({
  layers,
  layerStates,
  onLayerStatusChange,
  missions,
  visibleMissionIds,
  missionTelemetry,
  geologicalFeatures,
  pois,
  showPois,
  locations,
  elevationGrid,
  routes,
  activeRouteId,
  hoveredProfileCoord,
  selectedCoord,
  routeStart,
  routeDest,
  pickMode,
  onSelectCoordinate,
  onSelectMission,
  onSelectPoi,
  flyToRequest,
  settings,
  splitCompareLayerId,
  onSelectBasemap,
  onToggle3dTerrain,
  onOpenSettings,
  flightSim,
  flightTouchRef,
  onFlightHudUpdate,
  onFlightStatusChange,
  onFlightToggleCamera,
  onFlightTogglePause,
  onFlightExit,
  roverSim,
  roverTouchRef,
  onRoverHudUpdate,
  onRoverStatusChange,
  onRoverToggleCamera,
  onRoverTogglePause,
  onRoverToggleAutopilot,
  onRoverExit,
}: MarsGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const imageryMapRef = useRef<Map<string, Cesium.ImageryLayer>>(new Map());
  const dataSourceRefs = useRef<{
    missions: Cesium.CustomDataSource;
    geology: Cesium.CustomDataSource;
    hazards: Cesium.CustomDataSource;
    routes: Cesium.CustomDataSource;
    selection: Cesium.CustomDataSource;
    graticule: Cesium.CustomDataSource;
    flightSim: Cesium.CustomDataSource;
    roverSim: Cesium.CustomDataSource;
  } | null>(null);

  const [cursorCoord, setCursorCoord] = useState<{ lat: number; lon: number; elevM: number | null } | null>(
    null
  );
  const [cameraAltKm, setCameraAltKm] = useState<number>(9600);
  const [cameraHeadingDeg, setCameraHeadingDeg] = useState<number>(0);
  const [cameraPitchDeg, setCameraPitchDeg] = useState<number>(-90);
  const [scaleBar, setScaleBar] = useState<{ label: string; widthPx: number }>({
    label: '2,000 km',
    widthPx: 88,
  });
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false);
  const [splitPos, setSplitPos] = useState<number>(0.5);

  const callbackRefs = useRef({
    onSelectCoordinate,
    onSelectMission,
    onSelectPoi,
    onLayerStatusChange,
    elevationGrid,
    pickMode,
    settings,
    flightSim,
    flightTouchRef,
    onFlightHudUpdate,
    onFlightStatusChange,
    onFlightToggleCamera,
    onFlightTogglePause,
    onFlightExit,
    roverSim,
    roverTouchRef,
    onRoverHudUpdate,
    onRoverStatusChange,
    onRoverToggleCamera,
    onRoverTogglePause,
    onRoverToggleAutopilot,
    onRoverExit,
  });
  callbackRefs.current = {
    onSelectCoordinate,
    onSelectMission,
    onSelectPoi,
    onLayerStatusChange,
    elevationGrid,
    pickMode,
    settings,
    flightSim,
    flightTouchRef,
    onFlightHudUpdate,
    onFlightStatusChange,
    onFlightToggleCamera,
    onFlightTogglePause,
    onFlightExit,
    roverSim,
    roverTouchRef,
    onRoverHudUpdate,
    onRoverStatusChange,
    onRoverToggleCamera,
    onRoverTogglePause,
    onRoverToggleAutopilot,
    onRoverExit,
  };

  // Mutable 60fps flight physics state (never triggers React renders per-frame)
  const flightPhysRef = useRef({
    lat: 18.4446,
    lon: 77.4509,
    altEllipsoidM: 135,
    aglM: 135,
    headingDeg: 270,
    pitchDeg: 0,
    rollDeg: 0,
    speedMs: 48,
    throttle: 0.55,
    verticalSpeedMs: 0,
    gateIndex: 0,
    elapsedMs: 0,
    score: 0,
    peakSpeedKmh: 0,
    boosting: false,
    lastHudEmitMs: 0,
    lastWarnSoundMs: 0,
    worldPos: Cesium.Cartesian3.fromDegrees(77.4509, 18.4446, 135, MARS_ELLIPSOID),
    trailPts: [] as Cesium.Cartesian3[],
    craftQuat: Cesium.Quaternion.IDENTITY.clone(),
    basisRight: new Cesium.Cartesian3(1, 0, 0),
    basisFwd: new Cesium.Cartesian3(0, 1, 0),
    basisUp: new Cesium.Cartesian3(0, 0, 1),
  });
  const flightKeysRef = useRef<Set<string>>(new Set());

  // Mutable 60fps Rover physics state (never triggers React renders per-frame)
  const roverPhysRef = useRef({
    lat: 18.4446,
    lon: 77.4509,
    groundElevOffsetM: 0,
    headingDeg: 270,
    pitchDeg: 0,
    rollDeg: 0,
    slopeDeg: 0,
    speedMs: 0,
    throttle: 0,
    boosting: false,
    braking: false,
    batteryPct: 100,
    oxygenPct: 100,
    distanceTraveledM: 0,
    totalRouteDistanceM: 7500,
    peakSlopeDeg: 0,
    waypointIdx: 1,
    waypoints: [] as Array<[number, number]>,
    elapsedMs: 0,
    lastHudEmitMs: 0,
    lastWarnSoundMs: 0,
    lastTrackDistM: 0,
    worldPos: Cesium.Cartesian3.fromDegrees(77.4509, 18.4446, 2, MARS_ELLIPSOID),
    trackLeftPts: [] as Cesium.Cartesian3[],
    trackRightPts: [] as Cesium.Cartesian3[],
    craftQuat: Cesium.Quaternion.IDENTITY.clone(),
    basisRight: new Cesium.Cartesian3(1, 0, 0),
    basisFwd: new Cesium.Cartesian3(0, 1, 0),
    basisUp: new Cesium.Cartesian3(0, 0, 1),
  });
  const roverKeysRef = useRef<Set<string>>(new Set());

  // Initialize CesiumJS Viewer once with Mars 2000 IAU Sphere
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    Cesium.Ellipsoid.default = MARS_ELLIPSOID;

    const globe = new Cesium.Globe(MARS_ELLIPSOID);
    globe.baseColor = Cesium.Color.fromCssColorString('#3d1f14');
    globe.enableLighting = false;
    globe.depthTestAgainstTerrain = false;

    const viewer = new Cesium.Viewer(containerRef.current, {
      ellipsoid: MARS_ELLIPSOID,
      globe,
      mapProjection: new Cesium.GeographicProjection(MARS_ELLIPSOID),
      terrainProvider: new Cesium.EllipsoidTerrainProvider({ ellipsoid: MARS_ELLIPSOID }),
      baseLayer: false,
      skyAtmosphere: new Cesium.SkyAtmosphere(MARS_ELLIPSOID),
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer: document.createElement('div'),
      requestRenderMode: false,
    });

    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.hueShift = -0.45;
      viewer.scene.skyAtmosphere.saturationShift = -0.25;
      viewer.scene.skyAtmosphere.brightnessShift = -0.15;
    }
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#030406');

    const fallbackUrl = createFallbackMarsTexture();
    const fallbackProvider = new Cesium.SingleTileImageryProvider({
      url: fallbackUrl,
      ellipsoid: MARS_ELLIPSOID,
      rectangle: Cesium.Rectangle.MAX_VALUE,
      tileWidth: 512,
      tileHeight: 256,
    });
    viewer.imageryLayers.addImageryProvider(fallbackProvider);

    const tilingScheme = new Cesium.GeographicTilingScheme({
      ellipsoid: MARS_ELLIPSOID,
      numberOfLevelZeroTilesX: 2,
      numberOfLevelZeroTilesY: 1,
    });

    layers.forEach((layer) => {
      if (layer.kind !== 'trek_wmts' && layer.kind !== 'usgs_wms') return;
      let provider: Cesium.ImageryProvider | null = null;
      const rectangle = layer.bounds
        ? Cesium.Rectangle.fromDegrees(
            layer.bounds[0],
            layer.bounds[1],
            layer.bounds[2],
            layer.bounds[3]
          )
        : Cesium.Rectangle.MAX_VALUE;

      if (layer.kind === 'trek_wmts' && layer.trekLayerId) {
        const ext = layer.trekFormat || 'jpg';
        provider = new Cesium.UrlTemplateImageryProvider({
          url: `/api/tiles/trek/${layer.trekLayerId}/{z}/{y}/{x}.${ext}`,
          tilingScheme,
          ellipsoid: MARS_ELLIPSOID,
          rectangle,
          maximumLevel: layer.maxZoom,
          tileWidth: 256,
          tileHeight: 256,
        });
      } else if (layer.kind === 'usgs_wms' && layer.usgsLayers) {
        provider = new Cesium.WebMapServiceImageryProvider({
          url: '/api/tiles/usgs',
          layers: layer.usgsLayers,
          parameters: {
            transparent: true,
            format: 'image/png',
            styles: '',
          },
          tilingScheme,
          rectangle,
          maximumLevel: layer.maxZoom,
        });
      }

      if (provider) {
        provider.errorEvent.addEventListener(() => {
          callbackRefs.current.onLayerStatusChange(
            layer.id,
            'error',
            'NASA/USGS tile request failed or out of regional coverage.'
          );
        });
        const imgLayer = viewer.imageryLayers.addImageryProvider(provider);
        imgLayer.show = layer.defaultEnabled;
        imgLayer.alpha = layer.defaultOpacity;
        imageryMapRef.current.set(layer.id, imgLayer);
        if (layer.defaultEnabled) {
          callbackRefs.current.onLayerStatusChange(layer.id, 'ready');
        }
      }
    });

    const dsMissions = new Cesium.CustomDataSource('missions');
    const dsGeology = new Cesium.CustomDataSource('geology');
    const dsHazards = new Cesium.CustomDataSource('hazards');
    const dsRoutes = new Cesium.CustomDataSource('routes');
    const dsSelection = new Cesium.CustomDataSource('selection');
    const dsGraticule = new Cesium.CustomDataSource('graticule');
    const dsFlightSim = new Cesium.CustomDataSource('flight_sim');
    const dsRoverSim = new Cesium.CustomDataSource('rover_sim');

    viewer.dataSources.add(dsGraticule);
    viewer.dataSources.add(dsHazards);
    viewer.dataSources.add(dsGeology);
    viewer.dataSources.add(dsMissions);
    viewer.dataSources.add(dsRoutes);
    viewer.dataSources.add(dsSelection);
    viewer.dataSources.add(dsFlightSim);
    viewer.dataSources.add(dsRoverSim);

    dataSourceRefs.current = {
      missions: dsMissions,
      geology: dsGeology,
      hazards: dsHazards,
      routes: dsRoutes,
      selection: dsSelection,
      graticule: dsGraticule,
      flightSim: dsFlightSim,
      roverSim: dsRoverSim,
    };

    viewer.camera.percentageChanged = 0.01;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(77.42, 18.45, 9600000, MARS_ELLIPSOID),
    });

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (callbackRefs.current.flightSim?.active) return;
      const isPickingRoutePoint = callbackRefs.current.pickMode !== 'inspect';
      if (callbackRefs.current.roverSim?.active && !isPickingRoutePoint) return;
      const picked = viewer.scene.pick(movement.position);

      if (!isPickingRoutePoint && Cesium.defined(picked) && picked.id && picked.id.properties) {
        const kind = picked.id.properties.kind?.getValue();
        if (kind === 'mission') {
          const mid = picked.id.properties.missionId?.getValue();
          if (mid) callbackRefs.current.onSelectMission(mid);
        } else if (kind === 'poi') {
          const poiData = picked.id.properties.poiData?.getValue() as ScientificPoi | undefined;
          if (poiData) callbackRefs.current.onSelectPoi(poiData);
        }
      }

      if (isPickingRoutePoint && Cesium.defined(picked) && picked.id?.position) {
        const entityPos = picked.id.position.getValue(Cesium.JulianDate.now());
        if (entityPos) {
          const carto = MARS_ELLIPSOID.cartesianToCartographic(entityPos);
          callbackRefs.current.onSelectCoordinate(
            Cesium.Math.toDegrees(carto.latitude),
            Cesium.Math.toDegrees(carto.longitude)
          );
          return;
        }
      }

      const ray = viewer.camera.getPickRay(movement.position);
      const cartesian =
        (ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined) ||
        viewer.camera.pickEllipsoid(movement.position, MARS_ELLIPSOID);

      if (cartesian) {
        const carto = MARS_ELLIPSOID.cartesianToCartographic(cartesian);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        callbackRefs.current.onSelectCoordinate(lat, lon);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, MARS_ELLIPSOID);
      if (!cartesian) {
        setCursorCoord(null);
        return;
      }
      const carto = MARS_ELLIPSOID.cartesianToCartographic(cartesian);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const elev = sampleElevationGrid(callbackRefs.current.elevationGrid, lat, lon);
      setCursorCoord({ lat, lon, elevM: elev.elevationM });
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    const updateCamTelemetry = () => {
      const carto = MARS_ELLIPSOID.cartesianToCartographic(viewer.camera.positionWC);
      if (!carto) return;
      const altM = Math.max(100, carto.height);
      setCameraAltKm(Math.max(0.1, Number((altM / 1000).toFixed(1))));
      setCameraHeadingDeg(Cesium.Math.toDegrees(viewer.camera.heading));
      setCameraPitchDeg(Cesium.Math.toDegrees(viewer.camera.pitch));

      const canvasH = Math.max(400, viewer.scene.canvas.clientHeight || 800);
      const metersPerPixel = Math.max(0.1, (2 * altM * Math.tan(Cesium.Math.toRadians(55) / 2)) / canvasH);
      const targetMeters = metersPerPixel * 90;
      const niceSteps = [
        50, 100, 250, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2000000,
      ];
      let best = niceSteps[niceSteps.length - 1];
      for (const s of niceSteps) {
        if (s >= targetMeters * 0.65) {
          best = s;
          break;
        }
      }
      const widthPx = Math.max(46, Math.min(126, Math.round(best / metersPerPixel)));
      const label = best >= 1000 ? `${(best / 1000).toLocaleString()} km` : `${best} m`;
      setScaleBar({ label, widthPx });
    };

    updateCamTelemetry();
    const removeCamListener = viewer.camera.changed.addEventListener(updateCamTelemetry);

    viewerRef.current = viewer;

    return () => {
      removeCamListener();
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
      imageryMapRef.current.clear();
      dataSourceRefs.current = null;
    };
  }, []);

  // Update 3D Jezero Terrain Relief Provider
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (settings.enable3dTerrain && elevationGrid) {
      viewer.terrainProvider = createJezeroTerrainProvider(elevationGrid);
    } else {
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider({ ellipsoid: MARS_ELLIPSOID });
    }
  }, [elevationGrid, settings.enable3dTerrain]);

  // Sync imagery layer visibility, opacity, and split comparison
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.scene.splitPosition = splitCompareLayerId ? splitPos : 0;

    layers.forEach((layer) => {
      const imgLayer = imageryMapRef.current.get(layer.id);
      const st = layerStates[layer.id];
      if (!imgLayer || !st) return;
      imgLayer.show = st.enabled;
      imgLayer.alpha = st.opacity;
      if (splitCompareLayerId && layer.id === splitCompareLayerId) {
        imgLayer.splitDirection = Cesium.SplitDirection.RIGHT;
        imgLayer.show = true;
      } else {
        imgLayer.splitDirection = Cesium.SplitDirection.NONE;
      }
    });
  }, [layers, layerStates, splitCompareLayerId, splitPos]);

  // Camera flyTo requests
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !flyToRequest) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        flyToRequest.lon,
        flyToRequest.lat,
        flyToRequest.altitudeM,
        MARS_ELLIPSOID
      ),
      orientation:
        flyToRequest.pitchDeg !== undefined
          ? {
              heading: 0,
              pitch: Cesium.Math.toRadians(flyToRequest.pitchDeg),
              roll: 0,
            }
          : undefined,
      duration: 1.4,
    });
  }, [flyToRequest]);

  // Render graticule lines
  useEffect(() => {
    const ds = dataSourceRefs.current?.graticule;
    if (!ds) return;
    ds.entities.removeAll();
    if (!settings.showGraticule) return;

    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: Cesium.Cartesian3[] = [];
      for (let lon = -180; lon <= 180; lon += 10) {
        pts.push(Cesium.Cartesian3.fromDegrees(lon, lat, 400, MARS_ELLIPSOID));
      }
      ds.entities.add({
        polyline: {
          positions: pts,
          width: 1,
          material: Cesium.Color.fromCssColorString('rgba(148,163,184,0.22)'),
        },
      });
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const pts: Cesium.Cartesian3[] = [];
      for (let lat = -80; lat <= 80; lat += 10) {
        pts.push(Cesium.Cartesian3.fromDegrees(lon, lat, 400, MARS_ELLIPSOID));
      }
      ds.entities.add({
        polyline: {
          positions: pts,
          width: 1,
          material: Cesium.Color.fromCssColorString('rgba(148,163,184,0.22)'),
        },
      });
    }
  }, [settings.showGraticule]);

  // Render Terrain Slope & Hazard Grid Overlay
  useEffect(() => {
    const ds = dataSourceRefs.current?.hazards;
    if (!ds) return;
    ds.entities.removeAll();
    const hazardEnabled = layerStates['terrain_slope_hazard']?.enabled;
    const opacity = layerStates['terrain_slope_hazard']?.opacity ?? 0.55;
    if (!hazardEnabled || !elevationGrid) return;

    const { bounds, cols, rows, dLon, dLat } = elevationGrid;
    const stride = 2;
    for (let r = 0; r < rows - stride; r += stride) {
      for (let c = 0; c < cols - stride; c += stride) {
        const lat = bounds.minLat + (r + stride / 2) * dLat;
        const lon = bounds.minLon + (c + stride / 2) * dLon;
        const sample = evaluateTerrainRisk(
          elevationGrid,
          lat,
          lon,
          settings.slopeWarningDeg,
          settings.slopeDangerDeg
        );

        let cssColor = '#64748b';
        if (sample.riskLevel === 'low') cssColor = '#22c55e';
        else if (sample.riskLevel === 'moderate') cssColor = '#eab308';
        else if (sample.riskLevel === 'high') cssColor = '#ef4444';

        const color = Cesium.Color.fromCssColorString(cssColor).withAlpha(opacity * 0.62);
        ds.entities.add({
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(
              bounds.minLon + c * dLon,
              bounds.minLat + r * dLat,
              bounds.minLon + (c + stride) * dLon,
              bounds.minLat + (r + stride) * dLat
            ),
            material: color,
            outline: false,
          },
        });
      }
    }
  }, [elevationGrid, layerStates, settings.slopeWarningDeg, settings.slopeDangerDeg]);

  // Render CRISM Mineralogy & Geological Polygons
  useEffect(() => {
    const ds = dataSourceRefs.current?.geology;
    if (!ds) return;
    ds.entities.removeAll();
    const crismState = layerStates['crism_mineral_footprints'];
    if (!crismState?.enabled) return;

    const alpha = crismState.opacity * 0.42;
    geologicalFeatures.forEach((feat) => {
      const col = Cesium.Color.fromCssColorString(feat.color);
      if (feat.polygon && feat.polygon.length >= 3) {
        const flat: number[] = [];
        feat.polygon.forEach(([lon, lat]) => flat.push(lon, lat));
        ds.entities.add({
          name: feat.name,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(flat, MARS_ELLIPSOID),
            material: col.withAlpha(alpha),
            outline: true,
            outlineColor: col.withAlpha(Math.min(1, alpha + 0.35)),
            outlineWidth: 1.5,
          },
        });
      } else {
        ds.entities.add({
          position: Cesium.Cartesian3.fromDegrees(feat.lon, feat.lat, 50, MARS_ELLIPSOID),
          ellipse: {
            semiMajorAxis: feat.radiusKm * 1000,
            semiMinorAxis: feat.radiusKm * 1000,
            material: col.withAlpha(alpha),
            outline: true,
            outlineColor: col.withAlpha(0.85),
          },
        });
      }
    });
  }, [geologicalFeatures, layerStates]);

  // Render Missions, NASA 3D GLB Models, Traverses, Sample Caches, Landmarks, and POIs
  useEffect(() => {
    const ds = dataSourceRefs.current?.missions;
    if (!ds) return;
    ds.entities.removeAll();

    const surfaceHeightAt = (lat: number, lon: number): number => {
      if (!settings.enable3dTerrain || !elevationGrid) return 0;
      const sampled = sampleElevationGrid(elevationGrid, lat, lon);
      if (sampled.elevationM === null) return 0;
      return sampled.elevationM - -2570;
    };

    // Known landmarks
    locations.forEach((loc) => {
      if (loc.category === 'landing_site') return;
      const h = surfaceHeightAt(loc.lat, loc.lon);
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat, h + 15, MARS_ELLIPSOID),
        point: {
          pixelSize: 6,
          color: Cesium.Color.fromCssColorString('#e2e8f0'),
          outlineColor: Cesium.Color.fromCssColorString('#0f172a'),
          outlineWidth: 1.5,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(40000, 15000000),
        },
        label: {
          text: loc.name,
          font: '11px "IBM Plex Sans", sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#e2e8f0'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(25000, 9000000),
        },
      });
    });

    // Missions, Traverses & Official NASA 3D Models
    missions.forEach((mission) => {
      if (!visibleMissionIds.includes(mission.id)) return;
      const mColor = Cesium.Color.fromCssColorString(mission.color);
      const isOrbiter = mission.missionType === 'Orbiter';
      const telemetry = missionTelemetry[mission.id];

      // Determine final/current spacecraft placement coordinate
      let craftLon = mission.lon;
      let craftLat = mission.lat;
      if (telemetry && telemetry.waypoints.length > 0) {
        const lastWp = telemetry.waypoints[telemetry.waypoints.length - 1];
        craftLon = lastWp.lon;
        craftLat = lastWp.lat;
      } else if (mission.staticTraverse && mission.staticTraverse.length > 0) {
        const lastPt = mission.staticTraverse[mission.staticTraverse.length - 1];
        craftLon = lastPt[0];
        craftLat = lastPt[1];
      }

      if (isOrbiter) {
        const alt = mission.orbitAltitudeM || 300000;
        const orbitPts: Cesium.Cartesian3[] = [];
        for (let lat = -88; lat <= 88; lat += 4) {
          orbitPts.push(Cesium.Cartesian3.fromDegrees(craftLon, lat, alt, MARS_ELLIPSOID));
        }
        for (let lat = 88; lat >= -88; lat -= 4) {
          const oppLon = craftLon >= 0 ? craftLon - 180 : craftLon + 180;
          orbitPts.push(Cesium.Cartesian3.fromDegrees(oppLon, lat, alt, MARS_ELLIPSOID));
        }
        orbitPts.push(Cesium.Cartesian3.fromDegrees(craftLon, -88, alt, MARS_ELLIPSOID));

        ds.entities.add({
          polyline: {
            positions: orbitPts,
            width: 1.4,
            material: new Cesium.PolylineDashMaterialProperty({
              color: mColor.withAlpha(0.55),
              dashLength: 16,
            }),
          },
        });

        const orbPos = Cesium.Cartesian3.fromDegrees(craftLon, craftLat, alt, MARS_ELLIPSOID);
        const orbOrientation = Cesium.Transforms.headingPitchRollQuaternion(
          orbPos,
          new Cesium.HeadingPitchRoll(0, 0, 0),
          MARS_ELLIPSOID
        );

        ds.entities.add({
          position: orbPos,
          orientation: orbOrientation,
          model:
            settings.showNasaModels && mission.modelKey
              ? {
                  uri: `/api/models/${mission.modelKey}.glb`,
                  minimumPixelSize: 64,
                  maximumScale: 45000,
                }
              : undefined,
          point:
            !settings.showNasaModels || !mission.modelKey
              ? {
                  pixelSize: 10,
                  color: mColor,
                  outlineColor: Cesium.Color.WHITE,
                  outlineWidth: 2,
                }
              : undefined,
          label: {
            text: `${mission.name} (${Math.round(alt / 1000)} km Orbit)`,
            font: '600 11px "IBM Plex Sans", sans-serif',
            fillColor: mColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -26),
          },
          properties: {
            kind: 'mission',
            missionId: mission.id,
          },
        });
        return;
      }

      // Surface / Aerial Mission Landing Marker at exact landing coordinates (mission.lat, mission.lon)
      const landingH = surfaceHeightAt(mission.lat, mission.lon);
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(mission.lon, mission.lat, landingH + 10, MARS_ELLIPSOID),
        point: {
          pixelSize: 9,
          color: mColor,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1.5,
        },
        label: {
          text:
            mission.id === 'ingenuity'
              ? 'Wright Brothers Field (Ingenuity Start)'
              : `${mission.name.split(' (')[0]} Landing`,
          font: '600 11px "IBM Plex Sans", sans-serif',
          fillColor: mColor,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
        },
        properties: {
          kind: 'mission',
          missionId: mission.id,
        },
      });

      // Rover or Helicopter Traverse Polylines clamped on Mars surface
      if (telemetry && telemetry.pathSegments.length > 0) {
        telemetry.pathSegments.forEach((seg) => {
          if (seg.length < 2) return;
          const positions = seg.map((coord) =>
            Cesium.Cartesian3.fromDegrees(
              coord[0],
              coord[1],
              surfaceHeightAt(coord[1], coord[0]) + 4,
              MARS_ELLIPSOID
            )
          );
          ds.entities.add({
            polyline: {
              positions,
              width: 2.8,
              material: mColor.withAlpha(0.92),
            },
          });
        });
      } else if (mission.staticTraverse && mission.staticTraverse.length >= 2) {
        const positions = mission.staticTraverse.map(([lon, lat]) =>
          Cesium.Cartesian3.fromDegrees(
            lon,
            lat,
            surfaceHeightAt(lat, lon) + (mission.id === 'ingenuity' ? 18 : 4),
            MARS_ELLIPSOID
          )
        );
        ds.entities.add({
          polyline: {
            positions,
            width: 2.5,
            material: new Cesium.PolylineDashMaterialProperty({
              color: mColor.withAlpha(0.9),
              dashLength: 10,
            }),
          },
        });
      }

      // Official NASA 3D GLB Spacecraft / Rover Model upright in local Mars ENU frame
      const craftH = surfaceHeightAt(craftLat, craftLon) + (mission.id === 'ingenuity' ? 22 : 4);
      const craftPos = Cesium.Cartesian3.fromDegrees(craftLon, craftLat, craftH, MARS_ELLIPSOID);
      const craftOrientation = Cesium.Transforms.headingPitchRollQuaternion(
        craftPos,
        new Cesium.HeadingPitchRoll(0, 0, 0),
        MARS_ELLIPSOID
      );

      if (settings.showNasaModels && mission.modelKey) {
        ds.entities.add({
          position: craftPos,
          orientation: craftOrientation,
          model: {
            uri: `/api/models/${mission.modelKey}.glb`,
            minimumPixelSize: 54,
            maximumScale: 1600,
          },
          properties: {
            kind: 'mission',
            missionId: mission.id,
          },
        });
      }

      // Final / Latest Archive Site Marker (when rover/helicopter moved away from landing site)
      const movedFromLanding =
        Math.abs(craftLat - mission.lat) > 0.001 || Math.abs(craftLon - mission.lon) > 0.001;
      if (movedFromLanding) {
        const lastWp =
          telemetry && telemetry.waypoints.length > 0
            ? telemetry.waypoints[telemetry.waypoints.length - 1]
            : null;
        ds.entities.add({
          position: craftPos,
          point: {
            pixelSize: 9,
            color: Cesium.Color.WHITE,
            outlineColor: mColor,
            outlineWidth: 2.5,
          },
          label: {
            text: lastWp
              ? `${mission.name.split(' ')[0]} Archive Sol ${lastWp.sol}`
              : mission.id === 'ingenuity'
              ? 'Ingenuity Final Site (Flight 72)'
              : `${mission.name.split(' ')[0]} Final Site`,
            font: '600 11px "JetBrains Mono", monospace',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -28),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 180000),
          },
          properties: {
            kind: 'mission',
            missionId: mission.id,
          },
        });
      }

      // Sample cache pins
      mission.sampleCaches?.forEach((sc) => {
        const scH = surfaceHeightAt(sc.lat, sc.lon) + 6;
        ds.entities.add({
          position: Cesium.Cartesian3.fromDegrees(sc.lon, sc.lat, scH, MARS_ELLIPSOID),
          point: {
            pixelSize: 7,
            color: Cesium.Color.fromCssColorString('#fbbf24'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1.5,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 45000),
          },
          label: {
            text: `Core: ${sc.name.split(' ')[0]}`,
            font: '10px "JetBrains Mono", monospace',
            fillColor: Cesium.Color.fromCssColorString('#fde68a'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, 14),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 22000),
          },
        });
      });
    });

    // Scientific POIs
    if (showPois) {
      pois.forEach((poi) => {
        const poiH = surfaceHeightAt(poi.lat, poi.lon) + 12;
        ds.entities.add({
          position: Cesium.Cartesian3.fromDegrees(poi.lon, poi.lat, poiH, MARS_ELLIPSOID),
          point: {
            pixelSize: 8,
            color: Cesium.Color.fromCssColorString('#06b6d4'),
            outlineColor: Cesium.Color.fromCssColorString('#083344'),
            outlineWidth: 2,
          },
          label: {
            text: poi.name,
            font: '500 11px "IBM Plex Sans", sans-serif',
            fillColor: Cesium.Color.fromCssColorString('#67e8f9'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2.5,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(10, -4),
            horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 38000),
          },
          properties: {
            kind: 'poi',
            poiData: poi,
          },
        });
      });
    }
  }, [
    missions,
    visibleMissionIds,
    missionTelemetry,
    pois,
    showPois,
    locations,
    settings.showNasaModels,
    settings.enable3dTerrain,
    elevationGrid,
  ]);

  // Render Planned Routes + Hazards + Profile Hover Marker
  useEffect(() => {
    const ds = dataSourceRefs.current?.routes;
    if (!ds) return;
    ds.entities.removeAll();

    const surfaceHeightAt = (lat: number, lon: number): number => {
      if (!settings.enable3dTerrain || !elevationGrid) return 0;
      const sampled = sampleElevationGrid(elevationGrid, lat, lon);
      if (sampled.elevationM === null) return 0;
      return sampled.elevationM - -2570;
    };

    routes.forEach((route) => {
      const isActive = route.id === activeRouteId;
      const rColor = Cesium.Color.fromCssColorString(route.color);
      const lineLiftM = route.totalDistanceKm > 60 ? 2200 : 10;
      const positions = route.waypoints.map(([lon, lat]) =>
        Cesium.Cartesian3.fromDegrees(lon, lat, surfaceHeightAt(lat, lon) + lineLiftM, MARS_ELLIPSOID)
      );

      if (positions.length >= 2) {
        ds.entities.add({
          polyline: {
            positions,
            arcType: Cesium.ArcType.GEODESIC,
            width: isActive ? 4.5 : 2.5,
            material: route.isProvisional
              ? new Cesium.PolylineDashMaterialProperty({
                  color: rColor.withAlpha(isActive ? 1 : 0.65),
                  dashLength: 14,
                })
              : rColor.withAlpha(isActive ? 1 : 0.55),
          },
        });
      }

      if (isActive) {
        route.hazards.forEach((hz) => {
          ds.entities.add({
            position: Cesium.Cartesian3.fromDegrees(
              hz.lon,
              hz.lat,
              surfaceHeightAt(hz.lat, hz.lon) + 14,
              MARS_ELLIPSOID
            ),
            point: {
              pixelSize: 9,
              color:
                hz.severity === 'high'
                  ? Cesium.Color.fromCssColorString('#ef4444')
                  : hz.severity === 'moderate'
                  ? Cesium.Color.fromCssColorString('#eab308')
                  : Cesium.Color.fromCssColorString('#94a3b8'),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 1.5,
            },
          });
        });
      }
    });

    const activeRouteObj = routes.find((r) => r.id === activeRouteId) || routes[0] || null;
    const pinStart = activeRouteObj?.start ?? routeStart;
    const pinDest = activeRouteObj?.destination ?? routeDest;
    const pinLiftM = activeRouteObj && activeRouteObj.totalDistanceKm > 60 ? 2600 : 18;

    if (pinStart) {
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          pinStart.lon,
          pinStart.lat,
          surfaceHeightAt(pinStart.lat, pinStart.lon) + pinLiftM,
          MARS_ELLIPSOID
        ),
        point: {
          pixelSize: 12,
          color: Cesium.Color.fromCssColorString('#22c55e'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: pinStart.label ? `START · ${pinStart.label}` : 'START',
          font: '600 11px "JetBrains Mono", monospace',
          fillColor: Cesium.Color.fromCssColorString('#86efac'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2.5,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
        },
      });
    }

    if (pinDest) {
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          pinDest.lon,
          pinDest.lat,
          surfaceHeightAt(pinDest.lat, pinDest.lon) + pinLiftM,
          MARS_ELLIPSOID
        ),
        point: {
          pixelSize: 12,
          color: Cesium.Color.fromCssColorString('#ef4444'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: pinDest.label ? `DEST · ${pinDest.label}` : 'DEST',
          font: '600 11px "JetBrains Mono", monospace',
          fillColor: Cesium.Color.fromCssColorString('#fca5a5'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2.5,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
        },
      });
    }

    if (hoveredProfileCoord) {
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          hoveredProfileCoord.lon,
          hoveredProfileCoord.lat,
          surfaceHeightAt(hoveredProfileCoord.lat, hoveredProfileCoord.lon) + 25,
          MARS_ELLIPSOID
        ),
        point: {
          pixelSize: 13,
          color: Cesium.Color.fromCssColorString('#38bdf8'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2.5,
        },
        label: {
          text: `${hoveredProfileCoord.distanceKm.toFixed(2)} km · ${
            hoveredProfileCoord.elevationM !== null ? `${hoveredProfileCoord.elevationM.toFixed(0)} m` : 'No DEM'
          }`,
          font: '600 11px "JetBrains Mono", monospace',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -20),
        },
      });
    }
  }, [routes, activeRouteId, routeStart, routeDest, hoveredProfileCoord, settings.enable3dTerrain, elevationGrid]);

  // Render Selected Location Crosshair
  useEffect(() => {
    const ds = dataSourceRefs.current?.selection;
    if (!ds) return;
    ds.entities.removeAll();
    if (!selectedCoord) return;

    const h =
      settings.enable3dTerrain && elevationGrid
        ? (sampleElevationGrid(elevationGrid, selectedCoord.lat, selectedCoord.lon).elevationM ?? -2570) -
          -2570
        : 0;

    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        selectedCoord.lon,
        selectedCoord.lat,
        h + 15,
        MARS_ELLIPSOID
      ),
      point: {
        pixelSize: 11,
        color: Cesium.Color.fromCssColorString('#f97316'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
    });
  }, [selectedCoord, settings.enable3dTerrain, elevationGrid]);

  // Flight Simulator: Helper to compute terrain surface offset at (lat, lon) matching Jezero DEM relief
  const getTerrainSurfaceOffsetAt = (lat: number, lon: number): number => {
    const grid = callbackRefs.current.elevationGrid;
    const enabled = callbackRefs.current.settings.enable3dTerrain;
    if (!enabled || !grid) return 0;
    const sampled = sampleElevationGrid(grid, lat, lon);
    if (sampled.elevationM === null) return 0;
    const lonSpan = grid.bounds.maxLon - grid.bounds.minLon;
    const latSpan = grid.bounds.maxLat - grid.bounds.minLat;
    const tx = Math.min(
      (lon - grid.bounds.minLon) / (lonSpan * 0.12),
      (grid.bounds.maxLon - lon) / (lonSpan * 0.12),
      1
    );
    const ty = Math.min(
      (lat - grid.bounds.minLat) / (latSpan * 0.12),
      (grid.bounds.maxLat - lat) / (latSpan * 0.12),
      1
    );
    const taper = Math.max(0, Math.min(1, Math.min(tx, ty)));
    return Math.max(0, (sampled.elevationM - -2570) * taper);
  };

  // Flight Simulator: Keyboard listener (active while flightSim.active is true)
  useEffect(() => {
    if (!flightSim?.active) {
      flightKeysRef.current.clear();
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      const key = e.key.toLowerCase();
      if (
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'Space'
      ) {
        e.preventDefault();
      }
      flightKeysRef.current.add(code);

      if (e.repeat) return;
      if (key === 'c') {
        callbackRefs.current.onFlightToggleCamera?.();
      } else if (key === 'p' || code === 'Space') {
        const st = callbackRefs.current.flightSim?.status;
        if (st === 'flying' || st === 'paused') {
          callbackRefs.current.onFlightTogglePause?.();
        }
      } else if (code === 'Escape') {
        callbackRefs.current.onFlightExit?.();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      flightKeysRef.current.delete(e.code);
    };

    const onBlur = () => {
      flightKeysRef.current.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      flightKeysRef.current.clear();
    };
  }, [flightSim?.active]);

  // Flight Simulator: Initialize start state + aerial gate rings + craft entity
  useEffect(() => {
    const viewer = viewerRef.current;
    const ds = dataSourceRefs.current?.flightSim;
    if (!viewer || !ds) return;

    const rebuildFlightEntities = () => {
      ds.entities.removeAll();
      const sim = callbackRefs.current.flightSim;
      if (!sim?.active) return;

      const phys = flightPhysRef.current;
      const course = FLIGHT_COURSES.find((c) => c.id === sim.courseId) || FLIGHT_COURSES[0];

      // Draw aerial checkpoint gate rings for current course
      course.checkpoints.forEach((cp, idx) => {
        const prev =
          idx === 0
            ? { lat: course.startLat, lon: course.startLon }
            : course.checkpoints[idx - 1];
        const legBearingDeg = marsBearingDeg(prev.lat, prev.lon, cp.lat, cp.lon);
        const ringNormalHeadingRad = Cesium.Math.toRadians(legBearingDeg);
        const groundH = getTerrainSurfaceOffsetAt(cp.lat, cp.lon);
        const centerAlt = groundH + cp.aglTargetM;
        const centerPos = Cesium.Cartesian3.fromDegrees(cp.lon, cp.lat, centerAlt, MARS_ELLIPSOID);
        const enu = Cesium.Transforms.eastNorthUpToFixedFrame(centerPos, MARS_ELLIPSOID);

        // Ring plane perpendicular to flight direction (tangent right vector)
        const tangentX = Math.cos(ringNormalHeadingRad); // East component of right vector
        const tangentY = -Math.sin(ringNormalHeadingRad); // North component of right vector

        const ringPts: Cesium.Cartesian3[] = [];
        const segs = 28;
        for (let s = 0; s <= segs; s++) {
          const theta = (s / segs) * Math.PI * 2;
          const rHoriz = Math.cos(theta) * cp.radiusM;
          const rVert = Math.sin(theta) * cp.radiusM;
          const localPt = new Cesium.Cartesian3(
            tangentX * rHoriz,
            tangentY * rHoriz,
            rVert
          );
          ringPts.push(Cesium.Matrix4.multiplyByPoint(enu, localPt, new Cesium.Cartesian3()));
        }

        const cleared = idx < phys.gateIndex;
        const isCurrent = idx === phys.gateIndex;

        const ringColor = cleared
          ? Cesium.Color.fromCssColorString('#22c55e').withAlpha(0.35)
          : isCurrent
          ? Cesium.Color.fromCssColorString('#f97316')
          : Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.55);

        ds.entities.add({
          id: `flight-gate-${cp.id}`,
          polyline: {
            positions: ringPts,
            width: isCurrent ? 5.5 : cleared ? 2 : 2.8,
            material: ringColor,
          },
        });

        // Vertical light tether to ground so gates remain crisp against Martian regolith
        const basePos = Cesium.Cartesian3.fromDegrees(cp.lon, cp.lat, groundH + 2, MARS_ELLIPSOID);
        ds.entities.add({
          id: `flight-tether-${cp.id}`,
          polyline: {
            positions: [basePos, centerPos],
            width: isCurrent ? 2 : 1,
            material: ringColor.withAlpha(isCurrent ? 0.65 : 0.25),
          },
          position: centerPos,
          label: isCurrent
            ? {
                text: `GATE ${idx + 1} · ${cp.name}`,
                font: '600 11px "JetBrains Mono", monospace',
                fillColor: Cesium.Color.fromCssColorString('#fed7aa'),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -28),
              }
            : undefined,
        });
      });

      // Player craft entity in chase cam
      if (sim.cameraMode === 'chase') {
        const craftPosProp = new Cesium.CallbackProperty(
          () => flightPhysRef.current.worldPos,
          false
        ) as unknown as Cesium.PositionProperty;

        if (sim.craftId === 'ingenuity_scout') {
          ds.entities.add({
            id: 'flight-player-craft',
            position: craftPosProp,
            orientation: new Cesium.CallbackProperty(
              () => flightPhysRef.current.craftQuat,
              false
            ) as unknown as Cesium.Property,
            model: {
              uri: '/api/models/ingenuity.glb',
              minimumPixelSize: 68,
              maximumScale: 40,
            },
          });
        } else {
          // High-contrast 3D swept lifting-body Mars Wing airframe built from exact (right, fwd, up) basis
          const wingPolyProp = new Cesium.CallbackProperty(() => {
            const p = flightPhysRef.current;
            const c = p.worldPos;
            const r = p.basisRight;
            const f = p.basisFwd;
            const u = p.basisUp;
            const pt = (rx: number, fy: number, uz: number) => {
              const out = Cesium.Cartesian3.clone(c);
              Cesium.Cartesian3.add(out, Cesium.Cartesian3.multiplyByScalar(r, rx, new Cesium.Cartesian3()), out);
              Cesium.Cartesian3.add(out, Cesium.Cartesian3.multiplyByScalar(f, fy, new Cesium.Cartesian3()), out);
              Cesium.Cartesian3.add(out, Cesium.Cartesian3.multiplyByScalar(u, uz, new Cesium.Cartesian3()), out);
              return out;
            };
            // Nose -> Right wingtip -> Tail -> Left wingtip -> Nose -> Tail -> Fin tip
            return [
              pt(0, 14, 0),
              pt(13, -7, -0.8),
              pt(2.6, -9, 0.2),
              pt(-2.6, -9, 0.2),
              pt(-13, -7, -0.8),
              pt(0, 14, 0),
              pt(0, -9, 0.4),
              pt(0, -10.5, 4.5),
            ];
          }, false) as unknown as Cesium.Property;

          ds.entities.add({
            id: 'flight-player-wings',
            polyline: {
              positions: wingPolyProp,
              width: 3.5,
              material: Cesium.Color.fromCssColorString('#f8fafc'),
            },
          });

          // Core craft body beacon
          ds.entities.add({
            id: 'flight-player-core',
            position: craftPosProp,
            point: {
              pixelSize: 10,
              color: Cesium.Color.fromCssColorString('#f97316'),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 2,
            },
          });
        }

        // Subtle wingtip/exhaust contrail
        const trailProp = new Cesium.CallbackProperty(
          () => flightPhysRef.current.trailPts,
          false
        ) as unknown as Cesium.Property;
        ds.entities.add({
          id: 'flight-player-trail',
          polyline: {
            positions: trailProp,
            width: 2.2,
            material: Cesium.Color.fromCssColorString('#fb923c').withAlpha(0.55),
          },
        });
      }
    };

    if (!flightSim?.active) {
      ds.entities.removeAll();
      viewer.scene.screenSpaceCameraController.enableInputs = true;
      if (viewer.camera.frustum instanceof Cesium.PerspectiveFrustum) {
        viewer.camera.frustum.fov = Cesium.Math.toRadians(60);
      }
      return;
    }

    const course = FLIGHT_COURSES.find((c) => c.id === flightSim.courseId) || FLIGHT_COURSES[0];
    const craft = FLIGHT_CRAFTS[flightSim.craftId];

    // If entering menu or restarting a flight run, reset physics position to spawn
    let startLat = course.startLat;
    let startLon = course.startLon;
    let startHeading = course.startHeadingDeg;

    if (course.isFreeFlight) {
      const camCarto = MARS_ELLIPSOID.cartesianToCartographic(viewer.camera.positionWC);
      if (camCarto && camCarto.height < 1200000) {
        startLat = Math.max(-80, Math.min(80, Cesium.Math.toDegrees(camCarto.latitude)));
        startLon = Cesium.Math.toDegrees(camCarto.longitude);
        startHeading = ((Cesium.Math.toDegrees(viewer.camera.heading) % 360) + 360) % 360;
      }
    }

    const groundStart = getTerrainSurfaceOffsetAt(startLat, startLon);
    const startAlt = groundStart + course.startAglM;
    const worldPos = Cesium.Cartesian3.fromDegrees(startLon, startLat, startAlt, MARS_ELLIPSOID);

    flightPhysRef.current = {
      lat: startLat,
      lon: startLon,
      altEllipsoidM: startAlt,
      aglM: course.startAglM,
      headingDeg: startHeading,
      pitchDeg: 0,
      rollDeg: 0,
      speedMs: craft.cruiseSpeedMs,
      throttle:
        (craft.cruiseSpeedMs - craft.minSpeedMs) /
        Math.max(1, craft.maxSpeedMs - craft.minSpeedMs),
      verticalSpeedMs: 0,
      gateIndex: 0,
      elapsedMs: 0,
      score: 0,
      peakSpeedKmh: craft.cruiseSpeedMs * 3.6,
      boosting: false,
      lastHudEmitMs: 0,
      lastWarnSoundMs: 0,
      worldPos,
      trailPts: [worldPos],
      craftQuat: Cesium.Quaternion.IDENTITY.clone(),
      basisRight: new Cesium.Cartesian3(1, 0, 0),
      basisFwd: new Cesium.Cartesian3(0, 1, 0),
      basisUp: new Cesium.Cartesian3(0, 0, 1),
    };

    rebuildFlightEntities();

    // Snap camera immediately behind craft so user sees the Martian launch corridor live
    const updateCameraAndBasis = () => {
      const p = flightPhysRef.current;
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(p.worldPos, MARS_ELLIPSOID);
      const hRad = Cesium.Math.toRadians(p.headingDeg);
      const pRad = Cesium.Math.toRadians(p.pitchDeg);
      const rRad = Cesium.Math.toRadians(p.rollDeg);

      const fwdH = new Cesium.Cartesian3(Math.sin(hRad), Math.cos(hRad), 0);
      const right0 = new Cesium.Cartesian3(Math.cos(hRad), -Math.sin(hRad), 0);

      const localFwd = new Cesium.Cartesian3(
        fwdH.x * Math.cos(pRad),
        fwdH.y * Math.cos(pRad),
        Math.sin(pRad)
      );
      const localUp0 = new Cesium.Cartesian3(
        -fwdH.x * Math.sin(pRad),
        -fwdH.y * Math.sin(pRad),
        Math.cos(pRad)
      );

      const localRight = new Cesium.Cartesian3(
        right0.x * Math.cos(rRad) - localUp0.x * Math.sin(rRad),
        right0.y * Math.cos(rRad) - localUp0.y * Math.sin(rRad),
        -localUp0.z * Math.sin(rRad)
      );
      const localUp = new Cesium.Cartesian3(
        localUp0.x * Math.cos(rRad) + right0.x * Math.sin(rRad),
        localUp0.y * Math.cos(rRad) + right0.y * Math.sin(rRad),
        localUp0.z * Math.cos(rRad)
      );

      const rotMat = Cesium.Matrix4.getMatrix3(enu, new Cesium.Matrix3());
      const worldFwd = Cesium.Matrix3.multiplyByVector(rotMat, localFwd, new Cesium.Cartesian3());
      const worldRight = Cesium.Matrix3.multiplyByVector(rotMat, localRight, new Cesium.Cartesian3());
      const worldUp = Cesium.Matrix3.multiplyByVector(rotMat, localUp, new Cesium.Cartesian3());
      Cesium.Cartesian3.normalize(worldFwd, worldFwd);
      Cesium.Cartesian3.normalize(worldRight, worldRight);
      Cesium.Cartesian3.normalize(worldUp, worldUp);

      p.basisFwd = worldFwd;
      p.basisRight = worldRight;
      p.basisUp = worldUp;

      // Align Cesium GLTF heading (heading=0 points +X East -> hRad - PI/2)
      p.craftQuat = Cesium.Transforms.headingPitchRollQuaternion(
        p.worldPos,
        new Cesium.HeadingPitchRoll(hRad - Math.PI / 2, pRad, rRad),
        MARS_ELLIPSOID
      );

      if (flightSim.cameraMode === 'cockpit') {
        const eye = Cesium.Cartesian3.add(
          p.worldPos,
          Cesium.Cartesian3.multiplyByScalar(worldUp, 2.5, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
        viewer.camera.setView({
          destination: eye,
          orientation: {
            direction: worldFwd,
            up: worldUp,
          },
        });
      } else {
        const backOffset = Cesium.Cartesian3.multiplyByScalar(
          worldFwd,
          -craft.chaseDistanceM,
          new Cesium.Cartesian3()
        );
        const upOffset = Cesium.Cartesian3.multiplyByScalar(
          worldUp,
          craft.chaseHeightM,
          new Cesium.Cartesian3()
        );
        const camPos = Cesium.Cartesian3.add(
          Cesium.Cartesian3.add(p.worldPos, backOffset, new Cesium.Cartesian3()),
          upOffset,
          new Cesium.Cartesian3()
        );

        // Clamp chase camera safely above local terrain surface
        const camCarto = MARS_ELLIPSOID.cartesianToCartographic(camPos);
        if (camCarto) {
          const camGround = getTerrainSurfaceOffsetAt(
            Cesium.Math.toDegrees(camCarto.latitude),
            Cesium.Math.toDegrees(camCarto.longitude)
          );
          if (camCarto.height < camGround + 6) {
            camCarto.height = camGround + 6;
            MARS_ELLIPSOID.cartographicToCartesian(camCarto, camPos);
          }
        }

        const lookTarget = Cesium.Cartesian3.add(
          p.worldPos,
          Cesium.Cartesian3.multiplyByScalar(worldFwd, 55, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
        const camDir = Cesium.Cartesian3.normalize(
          Cesium.Cartesian3.subtract(lookTarget, camPos, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );

        // Gentle damped horizon tilt in chase cam
        const levelWorldUp = Cesium.Matrix3.multiplyByVector(
          rotMat,
          localUp0,
          new Cesium.Cartesian3()
        );
        const blendedUp = Cesium.Cartesian3.normalize(
          Cesium.Cartesian3.lerp(levelWorldUp, worldUp, 0.45, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );

        viewer.camera.setView({
          destination: camPos,
          orientation: {
            direction: camDir,
            up: blendedUp,
          },
        });
      }
    };

    updateCameraAndBasis();

    // Emit initial telemetry snapshot
    const nextCp0 = course.checkpoints[0] || null;
    callbackRefs.current.onFlightHudUpdate?.({
      lat: startLat,
      lon: startLon,
      aglM: course.startAglM,
      molaElevM:
        sampleElevationGrid(callbackRefs.current.elevationGrid, startLat, startLon).elevationM ??
        course.groundRefElevM,
      speedMs: craft.cruiseSpeedMs,
      speedKmh: craft.cruiseSpeedMs * 3.6,
      verticalSpeedMs: 0,
      headingDeg: startHeading,
      pitchDeg: 0,
      rollDeg: 0,
      throttle: flightPhysRef.current.throttle,
      boosting: false,
      gateIndex: 0,
      totalGates: course.checkpoints.length,
      nextGateName: nextCp0 ? nextCp0.name : null,
      nextGateDistM: nextCp0
        ? marsDistanceMeters(startLat, startLon, nextCp0.lat, nextCp0.lon)
        : null,
      nextGateBearingDeg: nextCp0
        ? marsBearingDeg(startLat, startLon, nextCp0.lat, nextCp0.lon)
        : null,
      nextGateAltDiffM: nextCp0 ? nextCp0.aglTargetM - course.startAglM : null,
      elapsedMs: 0,
      score: 0,
      peakSpeedKmh: craft.cruiseSpeedMs * 3.6,
      lowTerrainWarning: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightSim?.active, flightSim?.courseId, flightSim?.craftId, flightSim?.runNonce]);

  // Flight Simulator: Camera mode switch rebuilds chase entity visibility immediately
  useEffect(() => {
    const ds = dataSourceRefs.current?.flightSim;
    if (!ds || !flightSim?.active) return;
    const entitiesToToggle = ['flight-player-craft', 'flight-player-wings', 'flight-player-core'];
    entitiesToToggle.forEach((eid) => {
      const ent = ds.entities.getById(eid);
      if (ent) ent.show = flightSim.cameraMode === 'chase';
    });
  }, [flightSim?.active, flightSim?.cameraMode]);

  // Flight Simulator: 60fps RAF Physics & Camera Loop
  useEffect(() => {
    const viewer = viewerRef.current;
    const ds = dataSourceRefs.current?.flightSim;
    if (!viewer || !ds || !flightSim?.active) return;

    viewer.scene.screenSpaceCameraController.enableInputs = false;

    if (flightSim.status !== 'flying') {
      return;
    }

    let rafId = 0;
    let prevTs = performance.now();
    let trailTimer = 0;

    const refreshGateStyles = (course: (typeof FLIGHT_COURSES)[number], activeGateIdx: number) => {
      course.checkpoints.forEach((cp, idx) => {
        const ringEnt = ds.entities.getById(`flight-gate-${cp.id}`);
        const tetherEnt = ds.entities.getById(`flight-tether-${cp.id}`);
        const cleared = idx < activeGateIdx;
        const isCurrent = idx === activeGateIdx;
        const col = cleared
          ? Cesium.Color.fromCssColorString('#22c55e').withAlpha(0.35)
          : isCurrent
          ? Cesium.Color.fromCssColorString('#f97316')
          : Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.55);

        if (ringEnt?.polyline) {
          ringEnt.polyline.width = new Cesium.ConstantProperty(isCurrent ? 5.5 : cleared ? 2 : 2.8);
          ringEnt.polyline.material = new Cesium.ColorMaterialProperty(col);
        }
        if (tetherEnt) {
          if (tetherEnt.polyline) {
            tetherEnt.polyline.width = new Cesium.ConstantProperty(isCurrent ? 2 : 1);
            tetherEnt.polyline.material = new Cesium.ColorMaterialProperty(
              col.withAlpha(isCurrent ? 0.65 : 0.25)
            );
          }
          tetherEnt.label = isCurrent
            ? new Cesium.LabelGraphics({
                text: `GATE ${idx + 1} · ${cp.name}`,
                font: '600 11px "JetBrains Mono", monospace',
                fillColor: Cesium.Color.fromCssColorString('#fed7aa'),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -28),
              })
            : undefined;
        }
      });
    };

    const tick = (now: number) => {
      const sim = callbackRefs.current.flightSim;
      if (!sim?.active || sim.status !== 'flying') return;

      const dt = Math.min(0.05, Math.max(0.001, (now - prevTs) / 1000));
      prevTs = now;

      const course = FLIGHT_COURSES.find((c) => c.id === sim.courseId) || FLIGHT_COURSES[0];
      const craft = FLIGHT_CRAFTS[sim.craftId];
      const p = flightPhysRef.current;
      const keys = flightKeysRef.current;
      const touch = callbackRefs.current.flightTouchRef?.current;

      // Read pitch/roll/throttle/boost inputs
      let pitchInput = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) pitchInput += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) pitchInput -= 1;
      if (touch) pitchInput += touch.pitch;
      if (sim.invertPitch) pitchInput = -pitchInput;

      let yawInput = 0;
      if (keys.has('KeyD') || keys.has('ArrowRight')) yawInput += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) yawInput -= 1;
      if (touch) yawInput += touch.yaw;

      let throttleDelta = 0;
      if (keys.has('KeyE') || keys.has('Equal')) throttleDelta += 1;
      if (keys.has('KeyQ') || keys.has('Minus')) throttleDelta -= 1;
      if (touch) throttleDelta += touch.throttleDelta;

      const boosting = keys.has('ShiftLeft') || keys.has('ShiftRight') || Boolean(touch?.boost);
      p.boosting = boosting;

      if (throttleDelta !== 0) {
        p.throttle = Math.max(0, Math.min(1, p.throttle + throttleDelta * 0.48 * dt));
      }

      // Smooth attitude integration
      if (pitchInput !== 0) {
        p.pitchDeg = Math.max(-55, Math.min(55, p.pitchDeg + pitchInput * craft.pitchRateDegS * dt));
      } else {
        // Gentle aerodynamic nose self-leveling
        p.pitchDeg *= Math.exp(-0.9 * dt);
      }

      const targetRoll = yawInput * craft.maxBankDeg;
      const rollLerp = 1 - Math.exp(-6.5 * dt);
      p.rollDeg = p.rollDeg + (targetRoll - p.rollDeg) * rollLerp;

      const bankTurnFactor = Math.sin(Cesium.Math.toRadians(p.rollDeg)) * craft.yawRateDegS;
      p.headingDeg = (p.headingDeg + (bankTurnFactor + yawInput * 14) * dt + 360) % 360;

      // Speed envelope under Mars gravity (climb slightly trims airspeed, dive accelerates)
      const targetSpeed = boosting
        ? craft.boostSpeedMs
        : craft.minSpeedMs + p.throttle * (craft.maxSpeedMs - craft.minSpeedMs);
      const gravPitchEffect = -Math.sin(Cesium.Math.toRadians(p.pitchDeg)) * 18;
      p.speedMs += ((targetSpeed + gravPitchEffect) - p.speedMs) * (1 - Math.exp(-2.8 * dt));
      p.speedMs = Math.max(craft.minSpeedMs * 0.8, Math.min(craft.boostSpeedMs * 1.05, p.speedMs));

      const speedKmh = p.speedMs * 3.6;
      if (speedKmh > p.peakSpeedKmh) p.peakSpeedKmh = speedKmh;

      // Integrate 3D position over Mars Sphere
      const hRad = Cesium.Math.toRadians(p.headingDeg);
      const pRad = Cesium.Math.toRadians(p.pitchDeg);
      const vHoriz = p.speedMs * Math.cos(pRad);
      const vVert = p.speedMs * Math.sin(pRad);
      p.verticalSpeedMs = vVert;

      const vNorth = vHoriz * Math.cos(hRad);
      const vEast = vHoriz * Math.sin(hRad);

      p.lat = Math.max(
        -84,
        Math.min(84, p.lat + ((vNorth * dt) / MARS_EQUATORIAL_RADIUS_M) * (180 / Math.PI))
      );
      const cosLat = Math.max(0.18, Math.cos(Cesium.Math.toRadians(p.lat)));
      let nextLon = p.lon + ((vEast * dt) / (MARS_EQUATORIAL_RADIUS_M * cosLat)) * (180 / Math.PI);
      if (nextLon > 180) nextLon -= 360;
      if (nextLon < -180) nextLon += 360;
      p.lon = nextLon;

      p.altEllipsoidM += vVert * dt;
      p.elapsedMs += dt * 1000;

      const demGround = getTerrainSurfaceOffsetAt(p.lat, p.lon);
      const globeHeight = viewer.scene.globe.getHeight(
        Cesium.Cartographic.fromDegrees(p.lon, p.lat, 0)
      );
      const groundH = Math.max(demGround, Number.isFinite(globeHeight) ? (globeHeight as number) : 0);
      p.aglM = p.altEllipsoidM - groundH;

      // Clamp hard ceiling at 45 km above datum
      if (p.altEllipsoidM > 45000) {
        p.altEllipsoidM = 45000;
        p.pitchDeg = Math.min(0, p.pitchDeg);
      }

      p.worldPos = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.altEllipsoidM, MARS_ELLIPSOID);

      // Trail sampling
      trailTimer += dt;
      if (trailTimer >= 0.08) {
        trailTimer = 0;
        p.trailPts.push(Cesium.Cartesian3.clone(p.worldPos));
        if (p.trailPts.length > 42) p.trailPts.shift();
      }

      // Update local ENU basis + orientation + camera
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(p.worldPos, MARS_ELLIPSOID);
      const rRad = Cesium.Math.toRadians(p.rollDeg);
      const fwdH = new Cesium.Cartesian3(Math.sin(hRad), Math.cos(hRad), 0);
      const right0 = new Cesium.Cartesian3(Math.cos(hRad), -Math.sin(hRad), 0);

      const localFwd = new Cesium.Cartesian3(
        fwdH.x * Math.cos(pRad),
        fwdH.y * Math.cos(pRad),
        Math.sin(pRad)
      );
      const localUp0 = new Cesium.Cartesian3(
        -fwdH.x * Math.sin(pRad),
        -fwdH.y * Math.sin(pRad),
        Math.cos(pRad)
      );
      const localRight = new Cesium.Cartesian3(
        right0.x * Math.cos(rRad) - localUp0.x * Math.sin(rRad),
        right0.y * Math.cos(rRad) - localUp0.y * Math.sin(rRad),
        -localUp0.z * Math.sin(rRad)
      );
      const localUp = new Cesium.Cartesian3(
        localUp0.x * Math.cos(rRad) + right0.x * Math.sin(rRad),
        localUp0.y * Math.cos(rRad) + right0.y * Math.sin(rRad),
        localUp0.z * Math.cos(rRad)
      );

      const rotMat = Cesium.Matrix4.getMatrix3(enu, new Cesium.Matrix3());
      const worldFwd = Cesium.Cartesian3.normalize(
        Cesium.Matrix3.multiplyByVector(rotMat, localFwd, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      const worldRight = Cesium.Cartesian3.normalize(
        Cesium.Matrix3.multiplyByVector(rotMat, localRight, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      const worldUp = Cesium.Cartesian3.normalize(
        Cesium.Matrix3.multiplyByVector(rotMat, localUp, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );

      p.basisFwd = worldFwd;
      p.basisRight = worldRight;
      p.basisUp = worldUp;
      p.craftQuat = Cesium.Transforms.headingPitchRollQuaternion(
        p.worldPos,
        new Cesium.HeadingPitchRoll(hRad - Math.PI / 2, pRad, rRad),
        MARS_ELLIPSOID
      );

      // Dynamic FOV widening on boost for crisp speed sensation
      if (viewer.camera.frustum instanceof Cesium.PerspectiveFrustum) {
        const targetFov = Cesium.Math.toRadians(boosting ? 73 : 60);
        const curFov = viewer.camera.frustum.fov ?? Cesium.Math.toRadians(60);
        viewer.camera.frustum.fov = curFov + (targetFov - curFov) * (1 - Math.exp(-5 * dt));
      }

      if (sim.cameraMode === 'cockpit') {
        const eye = Cesium.Cartesian3.add(
          p.worldPos,
          Cesium.Cartesian3.multiplyByScalar(worldUp, 2.5, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
        viewer.camera.setView({
          destination: eye,
          orientation: {
            direction: worldFwd,
            up: worldUp,
          },
        });
      } else {
        const backOffset = Cesium.Cartesian3.multiplyByScalar(
          worldFwd,
          -craft.chaseDistanceM,
          new Cesium.Cartesian3()
        );
        const upOffset = Cesium.Cartesian3.multiplyByScalar(
          worldUp,
          craft.chaseHeightM,
          new Cesium.Cartesian3()
        );
        const camPos = Cesium.Cartesian3.add(
          Cesium.Cartesian3.add(p.worldPos, backOffset, new Cesium.Cartesian3()),
          upOffset,
          new Cesium.Cartesian3()
        );
        const camCarto = MARS_ELLIPSOID.cartesianToCartographic(camPos);
        if (camCarto) {
          const camGround = getTerrainSurfaceOffsetAt(
            Cesium.Math.toDegrees(camCarto.latitude),
            Cesium.Math.toDegrees(camCarto.longitude)
          );
          if (camCarto.height < camGround + 6) {
            camCarto.height = camGround + 6;
            MARS_ELLIPSOID.cartographicToCartesian(camCarto, camPos);
          }
        }
        const lookTarget = Cesium.Cartesian3.add(
          p.worldPos,
          Cesium.Cartesian3.multiplyByScalar(worldFwd, 55, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
        const camDir = Cesium.Cartesian3.normalize(
          Cesium.Cartesian3.subtract(lookTarget, camPos, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
        const levelWorldUp = Cesium.Matrix3.multiplyByVector(
          rotMat,
          localUp0,
          new Cesium.Cartesian3()
        );
        const blendedUp = Cesium.Cartesian3.normalize(
          Cesium.Cartesian3.lerp(levelWorldUp, worldUp, 0.45, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
        viewer.camera.setView({
          destination: camPos,
          orientation: {
            direction: camDir,
            up: blendedUp,
          },
        });
      }

      // Check Terrain Impact Crash
      const lowTerrainWarning = p.aglM < 30;
      if (lowTerrainWarning && now - p.lastWarnSoundMs > 900) {
        p.lastWarnSoundMs = now;
        playFlightCue('warn', sim.muted);
      }

      if (p.aglM <= 2) {
        p.aglM = 0;
        p.altEllipsoidM = groundH + 2;
        p.worldPos = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.altEllipsoidM, MARS_ELLIPSOID);
        playFlightCue('crash', sim.muted);
        callbackRefs.current.onFlightHudUpdate?.({
          lat: p.lat,
          lon: p.lon,
          aglM: 0,
          molaElevM:
            sampleElevationGrid(callbackRefs.current.elevationGrid, p.lat, p.lon).elevationM ??
            course.groundRefElevM,
          speedMs: 0,
          speedKmh: 0,
          verticalSpeedMs: 0,
          headingDeg: p.headingDeg,
          pitchDeg: p.pitchDeg,
          rollDeg: p.rollDeg,
          throttle: p.throttle,
          boosting: false,
          gateIndex: p.gateIndex,
          totalGates: course.checkpoints.length,
          nextGateName: course.checkpoints[p.gateIndex]?.name ?? null,
          nextGateDistM: null,
          nextGateBearingDeg: null,
          nextGateAltDiffM: null,
          elapsedMs: p.elapsedMs,
          score: p.score,
          peakSpeedKmh: p.peakSpeedKmh,
          lowTerrainWarning: true,
          crashReason: `Surface collision at ${p.lat.toFixed(4)}°N, ${p.lon.toFixed(4)}°E`,
        });
        callbackRefs.current.onFlightStatusChange?.(
          'crashed',
          `Surface collision at ${p.lat.toFixed(4)}°N, ${p.lon.toFixed(4)}°E`
        );
        return;
      }

      // Check Active Gate Ring Capture
      let activeCp = course.checkpoints[p.gateIndex] || null;
      if (activeCp) {
        const cpGround = getTerrainSurfaceOffsetAt(activeCp.lat, activeCp.lon);
        const cpWorld = Cesium.Cartesian3.fromDegrees(
          activeCp.lon,
          activeCp.lat,
          cpGround + activeCp.aglTargetM,
          MARS_ELLIPSOID
        );
        const dist3d = Cesium.Cartesian3.distance(p.worldPos, cpWorld);
        if (dist3d <= activeCp.radiusM * 1.15) {
          p.gateIndex += 1;
          p.score += 1000 + Math.round(speedKmh * 0.5);
          refreshGateStyles(course, p.gateIndex);

          if (p.gateIndex >= course.checkpoints.length) {
            playFlightCue('complete', sim.muted);
            const timeBonus = Math.max(200, Math.round(6000 - p.elapsedMs / 35));
            p.score += timeBonus;
            callbackRefs.current.onFlightHudUpdate?.({
              lat: p.lat,
              lon: p.lon,
              aglM: p.aglM,
              molaElevM:
                sampleElevationGrid(callbackRefs.current.elevationGrid, p.lat, p.lon).elevationM ??
                course.groundRefElevM,
              speedMs: p.speedMs,
              speedKmh,
              verticalSpeedMs: p.verticalSpeedMs,
              headingDeg: p.headingDeg,
              pitchDeg: p.pitchDeg,
              rollDeg: p.rollDeg,
              throttle: p.throttle,
              boosting: p.boosting,
              gateIndex: p.gateIndex,
              totalGates: course.checkpoints.length,
              nextGateName: null,
              nextGateDistM: 0,
              nextGateBearingDeg: null,
              nextGateAltDiffM: 0,
              elapsedMs: p.elapsedMs,
              score: p.score,
              peakSpeedKmh: p.peakSpeedKmh,
              lowTerrainWarning,
            });
            callbackRefs.current.onFlightStatusChange?.('completed');
            return;
          } else {
            playFlightCue('gate', sim.muted);
            activeCp = course.checkpoints[p.gateIndex];
          }
        }
      }

      // Throttled ~18 Hz HUD Snapshot Update to React
      if (now - p.lastHudEmitMs >= 55) {
        p.lastHudEmitMs = now;
        const molaElevM =
          sampleElevationGrid(callbackRefs.current.elevationGrid, p.lat, p.lon).elevationM ??
          course.groundRefElevM;
        const nextDistM = activeCp
          ? marsDistanceMeters(p.lat, p.lon, activeCp.lat, activeCp.lon)
          : null;
        const nextBearingDeg = activeCp
          ? marsBearingDeg(p.lat, p.lon, activeCp.lat, activeCp.lon)
          : null;
        const nextAltDiffM = activeCp ? activeCp.aglTargetM - p.aglM : null;

        callbackRefs.current.onFlightHudUpdate?.({
          lat: p.lat,
          lon: p.lon,
          aglM: p.aglM,
          molaElevM,
          speedMs: p.speedMs,
          speedKmh,
          verticalSpeedMs: p.verticalSpeedMs,
          headingDeg: p.headingDeg,
          pitchDeg: p.pitchDeg,
          rollDeg: p.rollDeg,
          throttle: p.throttle,
          boosting: p.boosting,
          gateIndex: p.gateIndex,
          totalGates: course.checkpoints.length,
          nextGateName: activeCp ? activeCp.name : null,
          nextGateDistM: nextDistM,
          nextGateBearingDeg: nextBearingDeg,
          nextGateAltDiffM: nextAltDiffM,
          elapsedMs: p.elapsedMs,
          score: p.score,
          peakSpeedKmh: p.peakSpeedKmh,
          lowTerrainWarning,
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [flightSim?.active, flightSim?.status]);

  // Rover Simulator: Keyboard listener
  useEffect(() => {
    if (!roverSim?.active) {
      roverKeysRef.current.clear();
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      const key = e.key.toLowerCase();
      if (
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'Space'
      ) {
        e.preventDefault();
      }
      roverKeysRef.current.add(code);

      if (e.repeat) return;
      if (key === 'c') {
        callbackRefs.current.onRoverToggleCamera?.();
      } else if (key === 't') {
        callbackRefs.current.onRoverToggleAutopilot?.();
      } else if (key === 'p') {
        const st = callbackRefs.current.roverSim?.status;
        if (st === 'driving' || st === 'paused') {
          callbackRefs.current.onRoverTogglePause?.();
        }
      } else if (code === 'Escape') {
        callbackRefs.current.onRoverExit?.();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      roverKeysRef.current.delete(e.code);
    };

    const onBlur = () => {
      roverKeysRef.current.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      roverKeysRef.current.clear();
    };
  }, [roverSim?.active]);

  // Helper: compute rover terrain surface elevation & local terrain pitch/roll angles
  const sampleRoverTerrainPose = (lat: number, lon: number, headingDeg: number) => {
    const hCenter = getTerrainSurfaceOffsetAt(lat, lon);
    const hRad = Cesium.Math.toRadians(headingDeg);
    const probeDistM = 8;
    const dLatPerM = (180 / Math.PI) / MARS_EQUATORIAL_RADIUS_M;
    const cosLat = Math.max(0.18, Math.cos(Cesium.Math.toRadians(lat)));
    const dLonPerM = (180 / Math.PI) / (MARS_EQUATORIAL_RADIUS_M * cosLat);

    const fLat = Math.cos(hRad) * probeDistM * dLatPerM;
    const fLon = Math.sin(hRad) * probeDistM * dLonPerM;
    const rLat = -Math.sin(hRad) * probeDistM * dLatPerM;
    const rLon = Math.cos(hRad) * probeDistM * dLonPerM;

    const hFwd = getTerrainSurfaceOffsetAt(lat + fLat, lon + fLon);
    const hBack = getTerrainSurfaceOffsetAt(lat - fLat, lon - fLon);
    const hRight = getTerrainSurfaceOffsetAt(lat + rLat, lon + rLon);
    const hLeft = getTerrainSurfaceOffsetAt(lat - rLat, lon - rLon);

    const pitchDeg = Math.max(
      -35,
      Math.min(35, Cesium.Math.toDegrees(Math.atan2(hFwd - hBack, probeDistM * 2)))
    );
    const rollDeg = Math.max(
      -35,
      Math.min(35, Cesium.Math.toDegrees(Math.atan2(hLeft - hRight, probeDistM * 2)))
    );

    const gridSlope = callbackRefs.current.elevationGrid
      ? evaluateTerrainRisk(callbackRefs.current.elevationGrid, lat, lon).slopeDeg ?? 0
      : 0;
    const slopeDeg = Math.max(gridSlope, Math.hypot(pitchDeg, rollDeg));

    return { hCenter, pitchDeg, rollDeg, slopeDeg };
  };

  // Helper: compute rover ENU basis, orientation quaternion, and camera placement
  const updateRoverBasisAndCamera = (
    viewer: Cesium.Viewer,
    camMode: RoverCameraMode,
    vehicleId: RoverVehicleId
  ) => {
    const p = roverPhysRef.current;
    const spec = ROVER_VEHICLES[vehicleId];
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(p.worldPos, MARS_ELLIPSOID);
    const hRad = Cesium.Math.toRadians(p.headingDeg);
    const pRad = Cesium.Math.toRadians(p.pitchDeg);
    const rRad = Cesium.Math.toRadians(p.rollDeg);

    const fwdH = new Cesium.Cartesian3(Math.sin(hRad), Math.cos(hRad), 0);
    const right0 = new Cesium.Cartesian3(Math.cos(hRad), -Math.sin(hRad), 0);

    const localFwd = new Cesium.Cartesian3(
      fwdH.x * Math.cos(pRad),
      fwdH.y * Math.cos(pRad),
      Math.sin(pRad)
    );
    const localUp0 = new Cesium.Cartesian3(
      -fwdH.x * Math.sin(pRad),
      -fwdH.y * Math.sin(pRad),
      Math.cos(pRad)
    );
    const localRight = new Cesium.Cartesian3(
      right0.x * Math.cos(rRad) - localUp0.x * Math.sin(rRad),
      right0.y * Math.cos(rRad) - localUp0.y * Math.sin(rRad),
      -localUp0.z * Math.sin(rRad)
    );
    const localUp = new Cesium.Cartesian3(
      localUp0.x * Math.cos(rRad) + right0.x * Math.sin(rRad),
      localUp0.y * Math.cos(rRad) + right0.y * Math.sin(rRad),
      localUp0.z * Math.cos(rRad)
    );

    const rotMat = Cesium.Matrix4.getMatrix3(enu, new Cesium.Matrix3());
    const worldFwd = Cesium.Cartesian3.normalize(
      Cesium.Matrix3.multiplyByVector(rotMat, localFwd, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    const worldRight = Cesium.Cartesian3.normalize(
      Cesium.Matrix3.multiplyByVector(rotMat, localRight, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    const worldUp = Cesium.Cartesian3.normalize(
      Cesium.Matrix3.multiplyByVector(rotMat, localUp, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );

    p.basisFwd = worldFwd;
    p.basisRight = worldRight;
    p.basisUp = worldUp;
    p.craftQuat = Cesium.Transforms.headingPitchRollQuaternion(
      p.worldPos,
      new Cesium.HeadingPitchRoll(hRad - Math.PI / 2, pRad, rRad),
      MARS_ELLIPSOID
    );

    if (camMode === 'cabin') {
      const eye = Cesium.Cartesian3.add(
        Cesium.Cartesian3.add(
          p.worldPos,
          Cesium.Cartesian3.multiplyByScalar(worldUp, spec.cabinEyeHeightM, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        ),
        Cesium.Cartesian3.multiplyByScalar(worldFwd, 1.8, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      const lookFwd = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.add(
          worldFwd,
          Cesium.Cartesian3.multiplyByScalar(worldUp, -0.09, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        ),
        new Cesium.Cartesian3()
      );
      viewer.camera.setView({
        destination: eye,
        orientation: { direction: lookFwd, up: worldUp },
      });
    } else if (camMode === 'overhead') {
      const camPos = Cesium.Cartesian3.add(
        Cesium.Cartesian3.add(
          p.worldPos,
          Cesium.Cartesian3.multiplyByScalar(worldUp, 130, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        ),
        Cesium.Cartesian3.multiplyByScalar(worldFwd, -45, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      const lookTarget = Cesium.Cartesian3.add(
        p.worldPos,
        Cesium.Cartesian3.multiplyByScalar(worldFwd, 25, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      const camDir = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(lookTarget, camPos, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      viewer.camera.setView({
        destination: camPos,
        orientation: { direction: camDir, up: worldFwd },
      });
    } else {
      const backOffset = Cesium.Cartesian3.multiplyByScalar(
        worldFwd,
        -spec.chaseDistanceM,
        new Cesium.Cartesian3()
      );
      const upOffset = Cesium.Cartesian3.multiplyByScalar(
        worldUp,
        spec.chaseHeightM,
        new Cesium.Cartesian3()
      );
      const camPos = Cesium.Cartesian3.add(
        Cesium.Cartesian3.add(p.worldPos, backOffset, new Cesium.Cartesian3()),
        upOffset,
        new Cesium.Cartesian3()
      );

      const camCarto = MARS_ELLIPSOID.cartesianToCartographic(camPos);
      if (camCarto) {
        const camGround = getTerrainSurfaceOffsetAt(
          Cesium.Math.toDegrees(camCarto.latitude),
          Cesium.Math.toDegrees(camCarto.longitude)
        );
        if (camCarto.height < camGround + 4) {
          camCarto.height = camGround + 4;
          MARS_ELLIPSOID.cartographicToCartesian(camCarto, camPos);
        }
      }

      const lookTarget = Cesium.Cartesian3.add(
        p.worldPos,
        Cesium.Cartesian3.multiplyByScalar(worldFwd, 16, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      const camDir = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(lookTarget, camPos, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      const levelUp = Cesium.Matrix3.multiplyByVector(rotMat, localUp0, new Cesium.Cartesian3());
      const blendedUp = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.lerp(levelUp, worldUp, 0.35, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );

      viewer.camera.setView({
        destination: camPos,
        orientation: { direction: camDir, up: blendedUp },
      });
    }
  };

  // Rover Simulator: Initialize route corridor, rover entity, wheel tracks, and spawn pose
  useEffect(() => {
    const viewer = viewerRef.current;
    const ds = dataSourceRefs.current?.roverSim;
    if (!viewer || !ds) return;

    if (!roverSim?.active) {
      ds.entities.removeAll();
      if (!flightSim?.active) {
        viewer.scene.screenSpaceCameraController.enableInputs = true;
      }
      return;
    }

    // When picking a point on the globe during rover setup, keep free globe mouse control active
    if (roverSim.status === 'setup' && pickMode !== 'inspect') {
      viewer.scene.screenSpaceCameraController.enableInputs = true;
      return;
    }

    ds.entities.removeAll();

    const rawWaypoints: Array<[number, number]> =
      roverSim.route && roverSim.route.waypoints.length >= 2
        ? roverSim.route.waypoints
        : [
            [roverSim.start.lon, roverSim.start.lat],
            [roverSim.destination.lon, roverSim.destination.lat],
          ];

    let totalRouteDistM = 0;
    for (let i = 1; i < rawWaypoints.length; i++) {
      totalRouteDistM += marsDistanceMeters(
        rawWaypoints[i - 1][1],
        rawWaypoints[i - 1][0],
        rawWaypoints[i][1],
        rawWaypoints[i][0]
      );
    }

    const startLat = roverSim.start.lat;
    const startLon = roverSim.start.lon;
    const firstTarget = rawWaypoints[1] || [roverSim.destination.lon, roverSim.destination.lat];
    const startHeading = marsBearingDeg(startLat, startLon, firstTarget[1], firstTarget[0]);
    const pose = sampleRoverTerrainPose(startLat, startLon, startHeading);
    const worldPos = Cesium.Cartesian3.fromDegrees(
      startLon,
      startLat,
      pose.hCenter + 1.4,
      MARS_ELLIPSOID
    );

    roverPhysRef.current = {
      lat: startLat,
      lon: startLon,
      groundElevOffsetM: pose.hCenter,
      headingDeg: startHeading,
      pitchDeg: pose.pitchDeg,
      rollDeg: pose.rollDeg,
      slopeDeg: pose.slopeDeg,
      speedMs: 0,
      throttle: 0,
      boosting: false,
      braking: false,
      batteryPct: 100,
      oxygenPct: 100,
      distanceTraveledM: 0,
      totalRouteDistanceM: Math.max(10, totalRouteDistM),
      peakSlopeDeg: pose.slopeDeg,
      waypointIdx: rawWaypoints.length > 1 ? 1 : 0,
      waypoints: rawWaypoints,
      elapsedMs: 0,
      lastHudEmitMs: 0,
      lastWarnSoundMs: 0,
      lastTrackDistM: 0,
      worldPos,
      trackLeftPts: [worldPos],
      trackRightPts: [worldPos],
      craftQuat: Cesium.Quaternion.IDENTITY.clone(),
      basisRight: new Cesium.Cartesian3(1, 0, 0),
      basisFwd: new Cesium.Cartesian3(0, 1, 0),
      basisUp: new Cesium.Cartesian3(0, 0, 1),
    };

    // Draw planned A->B corridor polyline
    const corridorPositions = rawWaypoints.map(([lon, lat]) =>
      Cesium.Cartesian3.fromDegrees(
        lon,
        lat,
        getTerrainSurfaceOffsetAt(lat, lon) + 2.2,
        MARS_ELLIPSOID
      )
    );
    ds.entities.add({
      id: 'rover-corridor-line',
      polyline: {
        positions: corridorPositions,
        width: 4,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#22d3ee').withAlpha(0.85),
          dashLength: 14,
        }),
      },
    });

    // Intermediate waypoint beacons (sampled every few vertices so screen stays clean)
    const stepStride = Math.max(1, Math.floor(rawWaypoints.length / 10));
    for (let i = stepStride; i < rawWaypoints.length - 1; i += stepStride) {
      const [wLon, wLat] = rawWaypoints[i];
      const wGround = getTerrainSurfaceOffsetAt(wLat, wLon);
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(wLon, wLat, wGround + 3, MARS_ELLIPSOID),
        point: {
          pixelSize: 6,
          color: Cesium.Color.fromCssColorString('#22d3ee'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1.5,
        },
      });
    }

    // Start Marker
    const startH = getTerrainSurfaceOffsetAt(roverSim.start.lat, roverSim.start.lon);
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        roverSim.start.lon,
        roverSim.start.lat,
        startH + 4,
        MARS_ELLIPSOID
      ),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString('#22c55e'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
      label: {
        text: `ORIGIN · ${roverSim.start.label || 'Start'}`,
        font: '600 11px "JetBrains Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString('#86efac'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 50000),
      },
    });

    // Destination Beacon Pole + Ring
    const destH = getTerrainSurfaceOffsetAt(roverSim.destination.lat, roverSim.destination.lon);
    const destGroundPos = Cesium.Cartesian3.fromDegrees(
      roverSim.destination.lon,
      roverSim.destination.lat,
      destH + 2,
      MARS_ELLIPSOID
    );
    const destBeaconTop = Cesium.Cartesian3.fromDegrees(
      roverSim.destination.lon,
      roverSim.destination.lat,
      destH + 85,
      MARS_ELLIPSOID
    );
    ds.entities.add({
      polyline: {
        positions: [destGroundPos, destBeaconTop],
        width: 3,
        material: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.85),
      },
      position: destBeaconTop,
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString('#f59e0b'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
      label: {
        text: `DEST · ${roverSim.destination.label || 'Target'}`,
        font: '600 11px "JetBrains Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString('#fde68a'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
      },
    });
    ds.entities.add({
      position: destGroundPos,
      ellipse: {
        semiMajorAxis: 26,
        semiMinorAxis: 26,
        height: destH + 1.5,
        material: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.18),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.85),
        outlineWidth: 2,
      },
    });

    // Dual Wheel Track Trails
    ds.entities.add({
      id: 'rover-track-left',
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => roverPhysRef.current.trackLeftPts,
          false
        ) as unknown as Cesium.Property,
        width: 2.2,
        material: Cesium.Color.fromCssColorString('#451a03').withAlpha(0.75),
      },
    });
    ds.entities.add({
      id: 'rover-track-right',
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => roverPhysRef.current.trackRightPts,
          false
        ) as unknown as Cesium.Property,
        width: 2.2,
        material: Cesium.Color.fromCssColorString('#451a03').withAlpha(0.75),
      },
    });

    // Player Rover 3D Entity
    const roverPosProp = new Cesium.CallbackProperty(
      () => roverPhysRef.current.worldPos,
      false
    ) as unknown as Cesium.PositionProperty;

    if (roverSim.vehicleId === 'perseverance_eva') {
      ds.entities.add({
        id: 'rover-player-model',
        position: roverPosProp,
        orientation: new Cesium.CallbackProperty(
          () => roverPhysRef.current.craftQuat,
          false
        ) as unknown as Cesium.Property,
        model: {
          uri: '/api/models/perseverance.glb',
          minimumPixelSize: 64,
          maximumScale: 18,
        },
      });
    } else {
      // Articulated 3D Pressurized Crew Rover SEV-6 wireframe/chassis in local rover frame
      const sevFrameProp = new Cesium.CallbackProperty(() => {
        const p = roverPhysRef.current;
        const c = p.worldPos;
        const r = p.basisRight;
        const f = p.basisFwd;
        const u = p.basisUp;
        const pt = (rx: number, fy: number, uz: number) => {
          const out = Cesium.Cartesian3.clone(c);
          Cesium.Cartesian3.add(
            out,
            Cesium.Cartesian3.multiplyByScalar(r, rx, new Cesium.Cartesian3()),
            out
          );
          Cesium.Cartesian3.add(
            out,
            Cesium.Cartesian3.multiplyByScalar(f, fy, new Cesium.Cartesian3()),
            out
          );
          Cesium.Cartesian3.add(
            out,
            Cesium.Cartesian3.multiplyByScalar(u, uz, new Cesium.Cartesian3()),
            out
          );
          return out;
        };
        // Cabin outer box + windshield + roof rack + 6-wheel suspension struts
        return [
          pt(-1.6, -2.8, 0.3),
          pt(1.6, -2.8, 0.3),
          pt(1.6, 2.8, 0.3),
          pt(-1.6, 2.8, 0.3),
          pt(-1.6, -2.8, 0.3),
          pt(-1.4, -2.5, 2.3),
          pt(1.4, -2.5, 2.3),
          pt(1.4, 2.2, 2.3),
          pt(-1.4, 2.2, 2.3),
          pt(-1.4, -2.5, 2.3),
          pt(-1.6, 2.8, 0.3),
          pt(-1.4, 2.2, 2.3),
          pt(1.4, 2.2, 2.3),
          pt(1.6, 2.8, 0.3),
          pt(1.6, -2.8, 0.3),
          pt(1.4, -2.5, 2.3),
        ];
      }, false) as unknown as Cesium.Property;

      const sevWheelsProp = new Cesium.CallbackProperty(() => {
        const p = roverPhysRef.current;
        const c = p.worldPos;
        const r = p.basisRight;
        const f = p.basisFwd;
        const u = p.basisUp;
        const pt = (rx: number, fy: number, uz: number) => {
          const out = Cesium.Cartesian3.clone(c);
          Cesium.Cartesian3.add(
            out,
            Cesium.Cartesian3.multiplyByScalar(r, rx, new Cesium.Cartesian3()),
            out
          );
          Cesium.Cartesian3.add(
            out,
            Cesium.Cartesian3.multiplyByScalar(f, fy, new Cesium.Cartesian3()),
            out
          );
          Cesium.Cartesian3.add(
            out,
            Cesium.Cartesian3.multiplyByScalar(u, uz, new Cesium.Cartesian3()),
            out
          );
          return out;
        };
        return [
          pt(-2.1, 2.4, -0.4),
          pt(2.1, 2.4, -0.4),
          pt(2.1, 0, -0.4),
          pt(-2.1, 0, -0.4),
          pt(-2.1, -2.4, -0.4),
          pt(2.1, -2.4, -0.4),
        ];
      }, false) as unknown as Cesium.Property;

      ds.entities.add({
        id: 'rover-sev-chassis',
        polyline: {
          positions: sevFrameProp,
          width: 4,
          material: Cesium.Color.fromCssColorString('#f8fafc'),
        },
      });
      ds.entities.add({
        id: 'rover-sev-axles',
        polyline: {
          positions: sevWheelsProp,
          width: 3,
          material: Cesium.Color.fromCssColorString('#22d3ee'),
        },
      });
      ds.entities.add({
        id: 'rover-sev-beacon',
        position: roverPosProp,
        point: {
          pixelSize: 11,
          color: Cesium.Color.fromCssColorString('#22d3ee'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
      });
    }

    updateRoverBasisAndCamera(viewer, roverSim.cameraMode, roverSim.vehicleId);

    const destBearing = marsBearingDeg(
      startLat,
      startLon,
      roverSim.destination.lat,
      roverSim.destination.lon
    );
    const destDistM = marsDistanceMeters(
      startLat,
      startLon,
      roverSim.destination.lat,
      roverSim.destination.lon
    );

    callbackRefs.current.onRoverHudUpdate?.({
      lat: startLat,
      lon: startLon,
      elevM:
        sampleElevationGrid(callbackRefs.current.elevationGrid, startLat, startLon).elevationM ??
        null,
      headingDeg: startHeading,
      pitchDeg: pose.pitchDeg,
      rollDeg: pose.rollDeg,
      slopeDeg: pose.slopeDeg,
      speedMs: 0,
      speedKmh: 0,
      throttle: 0,
      boosting: false,
      braking: false,
      driveMode: roverSim.driveMode,
      timeScale: roverSim.timeScale,
      batteryPct: 100,
      oxygenPct: 100,
      distanceTraveledM: 0,
      distanceRemainingM: totalRouteDistM,
      totalRouteDistanceM: totalRouteDistM,
      progressPct: 0,
      etaSeconds: null,
      waypointIdx: rawWaypoints.length > 1 ? 1 : 0,
      totalWaypoints: rawWaypoints.length,
      nextWaypointBearingDeg: startHeading,
      destBearingDeg: destBearing,
      destDistM,
      peakSlopeDeg: pose.slopeDeg,
      steepGradeWarning: pose.slopeDeg >= 12,
      nearbyPoiName: null,
      nearbyPoiDistM: null,
      elapsedMs: 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    roverSim?.active,
    roverSim?.vehicleId,
    roverSim?.runNonce,
    roverSim?.start.lat,
    roverSim?.start.lon,
    roverSim?.destination.lat,
    roverSim?.destination.lon,
    roverSim?.route?.id,
    pickMode,
  ]);

  // Rover Simulator: Toggle model visibility on camera mode switch (hide in cabin view)
  useEffect(() => {
    const ds = dataSourceRefs.current?.roverSim;
    const viewer = viewerRef.current;
    if (!ds || !viewer || !roverSim?.active) return;
    const hideInCabin = roverSim.cameraMode === 'cabin';
    ['rover-player-model', 'rover-sev-chassis', 'rover-sev-axles', 'rover-sev-beacon'].forEach(
      (id) => {
        const ent = ds.entities.getById(id);
        if (ent) ent.show = !hideInCabin;
      }
    );
    if (roverSim.status !== 'setup') {
      updateRoverBasisAndCamera(viewer, roverSim.cameraMode, roverSim.vehicleId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roverSim?.active, roverSim?.cameraMode, roverSim?.status]);

  // Rover Simulator: 60fps RAF Physics, Autopilot & Camera Loop
  useEffect(() => {
    const viewer = viewerRef.current;
    const ds = dataSourceRefs.current?.roverSim;
    if (!viewer || !ds || !roverSim?.active) return;

    if (roverSim.status === 'setup' && pickMode !== 'inspect') {
      viewer.scene.screenSpaceCameraController.enableInputs = true;
      return;
    }

    viewer.scene.screenSpaceCameraController.enableInputs = false;

    if (roverSim.status !== 'driving') {
      return;
    }

    let rafId = 0;
    let prevTs = performance.now();

    const tick = (now: number) => {
      const sim = callbackRefs.current.roverSim;
      if (!sim?.active || sim.status !== 'driving') return;

      const rawDt = Math.min(0.05, Math.max(0.001, (now - prevTs) / 1000));
      prevTs = now;
      const dt = rawDt * sim.timeScale;

      const spec = ROVER_VEHICLES[sim.vehicleId];
      const p = roverPhysRef.current;
      const keys = roverKeysRef.current;
      const touch = callbackRefs.current.roverTouchRef?.current;

      // Read manual inputs
      let throttleInput = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) throttleInput += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) throttleInput -= 1;
      if (touch) throttleInput += touch.throttle;

      let steerInput = 0;
      if (keys.has('KeyD') || keys.has('ArrowRight')) steerInput += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) steerInput -= 1;
      if (touch) steerInput += touch.steer;

      const braking = keys.has('Space') || Boolean(touch?.brake);
      const boosting = keys.has('ShiftLeft') || keys.has('ShiftRight') || Boolean(touch?.boost);
      p.braking = braking;
      p.boosting = boosting && !braking;

      // Advance waypoints if close
      while (p.waypointIdx < p.waypoints.length - 1) {
        const [wLon, wLat] = p.waypoints[p.waypointIdx];
        const dWp = marsDistanceMeters(p.lat, p.lon, wLat, wLon);
        if (dWp < 32) {
          p.waypointIdx += 1;
          playRoverCue('waypoint', sim.muted);
        } else {
          break;
        }
      }

      const activeWp = p.waypoints[p.waypointIdx] || [sim.destination.lon, sim.destination.lat];
      const nextWpBearing = marsBearingDeg(p.lat, p.lon, activeWp[1], activeWp[0]);
      const destDistM = marsDistanceMeters(
        p.lat,
        p.lon,
        sim.destination.lat,
        sim.destination.lon
      );
      const destBearing = marsBearingDeg(
        p.lat,
        p.lon,
        sim.destination.lat,
        sim.destination.lon
      );

      // Autopilot vs Manual steering & speed control
      let targetSpeedMs = 0;
      if (braking) {
        targetSpeedMs = 0;
      } else if (sim.driveMode === 'autopilot') {
        const headingErr = ((((nextWpBearing - p.headingDeg + 180) % 360) + 360) % 360) - 180;
        const maxSteerStep = spec.turnRateDegS * dt;
        const steerDelta = Math.max(-maxSteerStep, Math.min(maxSteerStep, headingErr * 2.2 * dt * 10));
        p.headingDeg = (p.headingDeg + steerDelta + 360) % 360;

        // Govern speed smoothly around sharp turns & steep terrain
        const turnFactor = Math.max(0.45, 1 - Math.abs(headingErr) / 110);
        const slopeFactor = p.slopeDeg > 14 ? 0.58 : p.slopeDeg > 9 ? 0.78 : 1.0;
        const approachFactor = destDistM < 85 ? Math.max(0.35, destDistM / 85) : 1.0;
        const baseCruise = boosting ? spec.boostSpeedMs : spec.cruiseSpeedMs;
        targetSpeedMs = baseCruise * turnFactor * slopeFactor * approachFactor;
        p.throttle = targetSpeedMs / spec.maxSpeedMs;
      } else {
        // Manual steering
        if (steerInput !== 0) {
          const speedFactor = Math.abs(p.speedMs) > 0.3 ? (p.speedMs >= 0 ? 1 : -1) : 0.7;
          p.headingDeg = (p.headingDeg + steerInput * spec.turnRateDegS * speedFactor * rawDt + 360) % 360;
        }
        if (throttleInput > 0) {
          targetSpeedMs = (boosting ? spec.boostSpeedMs : spec.maxSpeedMs) * Math.min(1, throttleInput);
        } else if (throttleInput < 0) {
          targetSpeedMs = -spec.reverseSpeedMs * Math.min(1, Math.abs(throttleInput));
        } else {
          targetSpeedMs = 0;
        }
        p.throttle = throttleInput;
      }

      // Slope drag physics (uphill resists, gentle braking when coasting)
      const accelRate = braking ? 9.5 : 4.2;
      p.speedMs += (targetSpeedMs - p.speedMs) * (1 - Math.exp(-accelRate * Math.min(0.25, dt)));

      // Integrate surface coordinates along Mars sphere
      const stepDistM = p.speedMs * dt;
      const hRad = Cesium.Math.toRadians(p.headingDeg);
      const dNorthM = stepDistM * Math.cos(hRad);
      const dEastM = stepDistM * Math.sin(hRad);

      p.lat = Math.max(
        -84,
        Math.min(84, p.lat + (dNorthM / MARS_EQUATORIAL_RADIUS_M) * (180 / Math.PI))
      );
      const cosLat = Math.max(0.18, Math.cos(Cesium.Math.toRadians(p.lat)));
      let nextLon = p.lon + (dEastM / (MARS_EQUATORIAL_RADIUS_M * cosLat)) * (180 / Math.PI);
      if (nextLon > 180) nextLon -= 360;
      if (nextLon < -180) nextLon += 360;
      p.lon = nextLon;

      p.distanceTraveledM += Math.abs(stepDistM);
      p.elapsedMs += rawDt * 1000;

      // Sample terrain elevation, pitch, roll, and slope
      const pose = sampleRoverTerrainPose(p.lat, p.lon, p.headingDeg);
      p.groundElevOffsetM = pose.hCenter;
      p.pitchDeg = p.pitchDeg + (pose.pitchDeg - p.pitchDeg) * (1 - Math.exp(-9 * rawDt));
      p.rollDeg = p.rollDeg + (pose.rollDeg - p.rollDeg) * (1 - Math.exp(-9 * rawDt));
      p.slopeDeg = pose.slopeDeg;
      if (pose.slopeDeg > p.peakSlopeDeg) p.peakSlopeDeg = pose.slopeDeg;

      p.worldPos = Cesium.Cartesian3.fromDegrees(
        p.lon,
        p.lat,
        p.groundElevOffsetM + 1.4,
        MARS_ELLIPSOID
      );

      // Update local basis & camera
      updateRoverBasisAndCamera(viewer, sim.cameraMode, sim.vehicleId);

      // Lay dual wheel tracks every ~6 m
      if (p.distanceTraveledM - p.lastTrackDistM >= 6) {
        p.lastTrackDistM = p.distanceTraveledM;
        const leftPt = Cesium.Cartesian3.add(
          p.worldPos,
          Cesium.Cartesian3.multiplyByScalar(p.basisRight, -1.45, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
        const rightPt = Cesium.Cartesian3.add(
          p.worldPos,
          Cesium.Cartesian3.multiplyByScalar(p.basisRight, 1.45, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
        p.trackLeftPts.push(leftPt);
        p.trackRightPts.push(rightPt);
        if (p.trackLeftPts.length > 180) p.trackLeftPts.shift();
        if (p.trackRightPts.length > 180) p.trackRightPts.shift();
      }

      // Battery & O2 life-support consumption (gentle realistic drain + RTG/solar trickle)
      const gradeFactor = 1 + Math.max(0, p.pitchDeg) / 14;
      const powerDrawPerSec =
        (Math.abs(p.speedMs) / Math.max(1, spec.maxSpeedMs)) *
        0.045 *
        gradeFactor *
        (p.boosting ? 1.7 : 1.0);
      p.batteryPct = Math.max(5, Math.min(100, p.batteryPct - (powerDrawPerSec - 0.008) * dt));
      p.oxygenPct = Math.max(15, p.oxygenPct - 0.0045 * dt);

      const steepGradeWarning = p.slopeDeg >= 14;
      if (steepGradeWarning && now - p.lastWarnSoundMs > 2200) {
        p.lastWarnSoundMs = now;
        playRoverCue('warn', sim.muted);
      }

      // Check Arrival at Destination (< 24 m)
      const newDestDistM = marsDistanceMeters(
        p.lat,
        p.lon,
        sim.destination.lat,
        sim.destination.lon
      );
      if (newDestDistM <= 24) {
        p.speedMs = 0;
        playRoverCue('arrived', sim.muted);
        callbackRefs.current.onRoverHudUpdate?.({
          lat: p.lat,
          lon: p.lon,
          elevM:
            sampleElevationGrid(callbackRefs.current.elevationGrid, p.lat, p.lon).elevationM ??
            null,
          headingDeg: p.headingDeg,
          pitchDeg: p.pitchDeg,
          rollDeg: p.rollDeg,
          slopeDeg: p.slopeDeg,
          speedMs: 0,
          speedKmh: 0,
          throttle: 0,
          boosting: false,
          braking: true,
          driveMode: sim.driveMode,
          timeScale: sim.timeScale,
          batteryPct: p.batteryPct,
          oxygenPct: p.oxygenPct,
          distanceTraveledM: p.distanceTraveledM,
          distanceRemainingM: 0,
          totalRouteDistanceM: p.totalRouteDistanceM,
          progressPct: 100,
          etaSeconds: 0,
          waypointIdx: p.waypoints.length - 1,
          totalWaypoints: p.waypoints.length,
          nextWaypointBearingDeg: null,
          destBearingDeg: destBearing,
          destDistM: 0,
          peakSlopeDeg: p.peakSlopeDeg,
          steepGradeWarning: false,
          nearbyPoiName: null,
          nearbyPoiDistM: null,
          elapsedMs: p.elapsedMs,
        });
        callbackRefs.current.onRoverStatusChange?.('arrived');
        return;
      }

      // Throttled HUD snapshot update (~18 Hz)
      if (now - p.lastHudEmitMs >= 55) {
        p.lastHudEmitMs = now;
        const elevM =
          sampleElevationGrid(callbackRefs.current.elevationGrid, p.lat, p.lon).elevationM ?? null;

        // Find nearest scientific POI within 600 m
        let nearbyPoiName: string | null = null;
        let nearbyPoiDistM: number | null = null;
        for (const poi of SCIENTIFIC_POIS) {
          const d = marsDistanceMeters(p.lat, p.lon, poi.lat, poi.lon);
          if (d <= 600 && (nearbyPoiDistM === null || d < nearbyPoiDistM)) {
            nearbyPoiName = poi.name;
            nearbyPoiDistM = d;
          }
        }

        // Compute remaining route distance from rover through remaining waypoints
        let remDistM = marsDistanceMeters(p.lat, p.lon, activeWp[1], activeWp[0]);
        for (let i = p.waypointIdx; i < p.waypoints.length - 1; i++) {
          remDistM += marsDistanceMeters(
            p.waypoints[i][1],
            p.waypoints[i][0],
            p.waypoints[i + 1][1],
            p.waypoints[i + 1][0]
          );
        }

        const progressPct = Math.max(
          0,
          Math.min(99, (1 - remDistM / Math.max(1, p.totalRouteDistanceM)) * 100)
        );
        const etaSeconds =
          Math.abs(p.speedMs) > 0.3
            ? remDistM / (Math.abs(p.speedMs) * sim.timeScale)
            : null;

        callbackRefs.current.onRoverHudUpdate?.({
          lat: p.lat,
          lon: p.lon,
          elevM,
          headingDeg: p.headingDeg,
          pitchDeg: p.pitchDeg,
          rollDeg: p.rollDeg,
          slopeDeg: p.slopeDeg,
          speedMs: p.speedMs,
          speedKmh: Math.abs(p.speedMs) * 3.6,
          throttle: p.throttle,
          boosting: p.boosting,
          braking: p.braking,
          driveMode: sim.driveMode,
          timeScale: sim.timeScale,
          batteryPct: p.batteryPct,
          oxygenPct: p.oxygenPct,
          distanceTraveledM: p.distanceTraveledM,
          distanceRemainingM: remDistM,
          totalRouteDistanceM: p.totalRouteDistanceM,
          progressPct,
          etaSeconds,
          waypointIdx: p.waypointIdx,
          totalWaypoints: p.waypoints.length,
          nextWaypointBearingDeg: nextWpBearing,
          destBearingDeg: destBearing,
          destDistM: newDestDistM,
          peakSlopeDeg: p.peakSlopeDeg,
          steepGradeWarning,
          nearbyPoiName,
          nearbyPoiDistM,
          elapsedMs: p.elapsedMs,
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [roverSim?.active, roverSim?.status, pickMode]);

  const cursorFormatted = cursorCoord
    ? formatMarsCoords(
        cursorCoord.lat,
        cursorCoord.lon,
        settings.coordinateFormat,
        settings.longitudeConvention
      )
    : null;

  const handleZoom = (factor: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const carto = MARS_ELLIPSOID.cartesianToCartographic(viewer.camera.positionWC);
    const h = carto ? Math.max(300, carto.height) : 100000;
    if (factor > 0) {
      viewer.camera.zoomIn(h * 0.45);
    } else {
      viewer.camera.zoomOut(Math.min(12000000, h * 0.65));
    }
  };

  const handleResetNorth = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: {
        heading: 0,
        pitch: viewer.camera.pitch,
        roll: 0,
      },
      duration: 0.6,
    });
  };

  const handleToggle3dView = () => {
    const viewer = viewerRef.current;
    onToggle3dTerrain?.();
    if (!viewer) return;
    const currentlyTilted = cameraPitchDeg > -75;
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: {
        heading: viewer.camera.heading,
        pitch: Cesium.Math.toRadians(currentlyTilted ? -90 : -45),
        roll: 0,
      },
      duration: 0.7,
    });
  };

  const handleFlyJezeroSurface = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(77.392, 18.42, 7500, MARS_ELLIPSOID),
      orientation: {
        heading: Cesium.Math.toRadians(-12),
        pitch: Cesium.Math.toRadians(-35),
        roll: 0,
      },
      duration: 1.6,
    });
  };

  const activeBasemapLabel = layerStates['mola_color_relief']?.enabled
    ? 'MOLA Elev'
    : layerStates['themis_day_ir']?.enabled
    ? 'THEMIS IR'
    : layerStates['jezero_hirise']?.enabled
    ? 'Viking + HiRISE'
    : 'Viking Color';

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#030406]">
      <div
        ref={containerRef}
        className={`h-full w-full ${pickMode !== 'inspect' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
      />

      {splitCompareLayerId && !flightSim?.active && !roverSim?.active && (
        <div
          className="pointer-events-auto absolute inset-y-0 z-10 w-0.5 bg-[#8ab4f8]"
          style={{ left: `${splitPos * 100}%` }}
        >
          <input
            type="range"
            min={0.1}
            max={0.9}
            step={0.01}
            value={splitPos}
            onChange={(e) => setSplitPos(parseFloat(e.target.value))}
            aria-label="Layer comparison split slider"
            className="absolute top-1/2 -left-16 w-32 -translate-y-1/2 cursor-ew-resize accent-[#8ab4f8]"
          />
        </div>
      )}

      {pickMode !== 'inspect' && !flightSim?.active && (
        <div className="pointer-events-none absolute top-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-cyan-500/60 bg-[#202124]/95 px-4 py-1.5 text-xs font-medium text-cyan-200 shadow-xl backdrop-blur-md">
          Click anywhere on Mars to set{' '}
          <span className="font-semibold text-cyan-400">
            {pickMode === 'start' ? 'Starting Point' : 'Destination'}
          </span>
        </div>
      )}

      {/* Bottom-Left Google Earth Style Basemap Switcher Square */}
      {!flightSim?.active && !roverSim?.active && (
        <div className="absolute bottom-10 left-3 z-20">
          {basemapMenuOpen && (
            <div className="mb-2 w-52 rounded-2xl border border-white/12 bg-[#202124]/95 p-2 text-xs text-[#e8eaed] shadow-2xl backdrop-blur-md">
              <div className="px-2 py-1 text-[10px] font-medium text-[#9aa0a6]">
                Quick Basemap View
              </div>
              {(
                [
                  ['viking_mdim21', 'Viking Color + HiRISE', '232m / 25cm'],
                  ['mola_color_relief', 'MOLA Shaded Elevation', '463m/px'],
                  ['mola_hrsc_shade', 'HRSC/MOLA Hillshade', '200m/px'],
                  ['themis_day_ir', 'THEMIS Day Infrared', '100m/px'],
                ] as const
              ).map(([id, title, res]) => {
                const active = Boolean(layerStates[id]?.enabled);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      onSelectBasemap?.(id);
                      setBasemapMenuOpen(false);
                    }}
                    className={`mt-1 flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left transition-colors ${
                      active ? 'bg-[#8ab4f8]/20 text-[#8ab4f8]' : 'hover:bg-white/10'
                    }`}
                  >
                    <span className="font-medium">{title}</span>
                    <span className="font-mono text-[10px] opacity-70">{res}</span>
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => setBasemapMenuOpen((v) => !v)}
            className="group relative flex h-12 w-12 items-end justify-center overflow-hidden rounded-xl border-2 border-white/25 bg-[#202124] shadow-xl transition-transform hover:scale-105 hover:border-[#8ab4f8]"
            title={`Switch Mars Basemap (${activeBasemapLabel})`}
          >
            <div
              className="absolute inset-0 opacity-90"
              style={{
                background:
                  'radial-gradient(circle at 30% 35%, #d97736 0%, #9a3412 45%, #3f1d14 100%)',
              }}
            />
            <Layers className="relative z-10 mb-3 h-4 w-4 text-white/90 drop-shadow" />
            <span className="relative z-10 w-full bg-black/75 py-0.5 text-center text-[9px] font-medium text-white truncate px-0.5">
              {activeBasemapLabel.split(' ')[0]}
            </span>
          </button>
        </div>
      )}

      {/* Bottom-Right Google Earth Navigation Cluster (Surface Fly-In, North Compass, 3D/2D, Zoom -/+) */}
      {!flightSim?.active && !roverSim?.active && (
        <div className="absolute bottom-10 right-3 z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={handleFlyJezeroSurface}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-[#292a2d]/92 text-orange-400 shadow-lg backdrop-blur-md transition-colors hover:bg-[#3c4043] hover:text-orange-300"
            title="Fly to Jezero Crater 3D Surface View (Perseverance & Delta)"
          >
            <Navigation className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleToggle3dView}
            className={`flex h-9 w-9 items-center justify-center rounded-full border text-[11px] font-bold shadow-lg backdrop-blur-md transition-colors ${
              settings.enable3dTerrain
                ? 'border-[#8ab4f8]/50 bg-[#292a2d]/95 text-[#8ab4f8] hover:bg-[#3c4043]'
                : 'border-white/12 bg-[#292a2d]/92 text-[#9aa0a6] hover:bg-[#3c4043] hover:text-white'
            }`}
            title="Toggle 3D Terrain & Tilted Perspective"
          >
            3D
          </button>

          <button
            type="button"
            onClick={handleResetNorth}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-[#292a2d]/92 text-[#e8eaed] shadow-lg backdrop-blur-md transition-colors hover:bg-[#3c4043]"
            title="Reset Camera Heading to North"
          >
            <div
              className="transition-transform duration-150"
              style={{ transform: `rotate(${-cameraHeadingDeg}deg)` }}
            >
              <Compass className="h-4 w-4 text-rose-400" />
            </div>
          </button>

          <div className="flex h-9 items-center overflow-hidden rounded-full border border-white/12 bg-[#292a2d]/92 shadow-lg backdrop-blur-md">
            <button
              type="button"
              onClick={() => handleZoom(-1)}
              className="flex h-full w-9 items-center justify-center text-[#e8eaed] hover:bg-[#3c4043]"
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <Minus className="h-4 w-4" />
            </button>
            <div className="h-4 w-px bg-white/12" />
            <button
              type="button"
              onClick={() => handleZoom(1)}
              className="flex h-full w-9 items-center justify-center text-[#e8eaed] hover:bg-[#3c4043]"
              title="Zoom In"
              aria-label="Zoom In"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Very Bottom Google Earth Attribution + Dynamic Scale Bar + Live Telemetry Strip */}
      {!flightSim?.active && !roverSim?.active && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex h-7 items-center justify-between border-t border-white/10 bg-[#17181b]/92 px-3 text-[11px] text-[#bdc1c6] backdrop-blur-sm select-none">
          <div className="flex items-center gap-3">
            <span className="font-semibold tracking-tight text-white">NASA / USGS</span>
            <span className="hidden sm:inline font-mono text-[10px] text-[#9aa0a6]">100%</span>
            <button
              type="button"
              onClick={() => onOpenSettings?.()}
              className="underline decoration-white/40 hover:text-white"
            >
              Data attribution
            </button>
          </div>

          <div className="flex items-center gap-4 font-mono text-[11px] tabular-nums">
            {/* Google Earth Style Metric Bracket Scale Bar */}
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-[#e8eaed]">
              <span>{scaleBar.label}</span>
              <div
                className="h-1.5 border-x border-b border-[#e8eaed]/80"
                style={{ width: `${scaleBar.widthPx}px` }}
              />
            </div>

            <span className="text-[#e8eaed]">
              Camera: {cameraAltKm >= 100 ? Math.round(cameraAltKm).toLocaleString() : cameraAltKm.toFixed(1)} km
            </span>

            {cursorFormatted ? (
              <span className="hidden md:inline text-[#e8eaed]">
                {cursorFormatted.latStr} {cursorFormatted.lonStr}
                {cursorCoord?.elevM !== null && cursorCoord?.elevM !== undefined
                  ? ` · ${cursorCoord.elevM.toFixed(0)} m`
                  : ''}
              </span>
            ) : (
              <span className="hidden md:inline text-[#9aa0a6]">Mars 2000 Planetocentric</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

