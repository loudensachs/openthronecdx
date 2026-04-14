import { generateAllMaps } from "@shared/maps/generator";

const maps = generateAllMaps();

export const MAPS = maps;
export const MAPS_BY_ID = Object.fromEntries(maps.map((map) => [map.id, map]));

export function getMapById(mapId: string) {
  return MAPS_BY_ID[mapId] ?? MAPS[0];
}
