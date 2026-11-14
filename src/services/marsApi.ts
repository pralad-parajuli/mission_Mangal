import { JezeroElevationGrid, MissionTelemetry } from '../types/mars';

export interface TrekSearchItem {
  title: string;
  productLabel: string;
  itemType: string;
  instrument?: string;
  mission?: string;
  shape?: string;
  description?: string;
}

export async function fetchMissionTelemetry(
  missionId: 'perseverance' | 'curiosity'
): Promise<MissionTelemetry> {
  const res = await fetch(`/api/missions/${missionId}/telemetry`);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${missionId} telemetry (HTTP ${res.status})`);
  }
  return res.json();
}

export async function fetchJezeroElevationGrid(): Promise<JezeroElevationGrid> {
  const res = await fetch('/api/elevation/jezero-grid');
  if (!res.ok) {
    throw new Error(`Failed to fetch Jezero elevation grid (HTTP ${res.status})`);
  }
  return res.json();
}

export async function searchMarsTrekNomenclature(
  query: string
): Promise<{ items: TrekSearchItem[]; source: string }> {
  const res = await fetch(`/api/trek/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    return { items: [], source: 'Mars Trek search unavailable' };
  }
  return res.json();
}
