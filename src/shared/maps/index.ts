import crownfallRaw from "@shared/maps/crownfall.json";
import thornmarchRaw from "@shared/maps/thornmarch.json";
import ashenStraitRaw from "@shared/maps/ashen-strait.json";
import {
  mapDefinitionSchema,
  rawMapDefinitionSchema,
  type MapDefinition,
  type ProvinceDefinition,
  type RawMapDefinition,
} from "@shared/maps/schema";

function edgeKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

function rectPolygon(rawMap: RawMapDefinition, row: number, col: number, widthUnits: number, heightUnits: number) {
  const { cellWidth, cellHeight, inset } = rawMap.grid;
  const x = col * cellWidth;
  const y = row * cellHeight;
  const width = widthUnits * cellWidth;
  const height = heightUnits * cellHeight;

  return [
    { x: x + inset, y: y + inset + 4 },
    { x: x + width - inset, y: y + inset },
    { x: x + width - inset - 6, y: y + height - inset },
    { x: x + inset + 3, y: y + height - inset + 4 },
  ];
}

function centerOfPolygon(polygon: ProvinceDefinition["polygon"]) {
  return polygon.reduce(
    (acc, point) => ({
      x: acc.x + point.x / polygon.length,
      y: acc.y + point.y / polygon.length,
    }),
    { x: 0, y: 0 },
  );
}

function areGridAdjacent(a: RawMapDefinition["provinces"][number], b: RawMapDefinition["provinces"][number]) {
  const aRight = a.col + (a.widthUnits ?? 1);
  const aBottom = a.row + (a.heightUnits ?? 1);
  const bRight = b.col + (b.widthUnits ?? 1);
  const bBottom = b.row + (b.heightUnits ?? 1);
  const horizontalTouch =
    (aRight === b.col || bRight === a.col) &&
    Math.max(a.row, b.row) < Math.min(aBottom, bBottom);
  const verticalTouch =
    (aBottom === b.row || bBottom === a.row) &&
    Math.max(a.col, b.col) < Math.min(aRight, bRight);
  return horizontalTouch || verticalTouch;
}

export function expandRawMap(input: unknown): MapDefinition {
  const rawMap = rawMapDefinitionSchema.parse(input);
  const blocked = new Set(rawMap.blockedEdges.map(([a, b]) => edgeKey(a, b)));
  const bridges = new Set(rawMap.bridgeEdges.map(([a, b]) => edgeKey(a, b)));

  const provinces: ProvinceDefinition[] = rawMap.provinces.map((province) => {
    const polygon = rectPolygon(
      rawMap,
      province.row,
      province.col,
      province.widthUnits ?? 1,
      province.heightUnits ?? 1,
    );
    return {
      id: province.id,
      name: province.name,
      polygon,
      center: centerOfPolygon(polygon),
      adjacency: [],
      terrain: province.terrain,
      building: province.building,
      buildingLevel: province.buildingLevel,
      spawnSlot: province.spawnSlot,
      strategicValue: province.strategicValue,
    };
  });

  for (const province of provinces) {
    const rawProvince = rawMap.provinces.find((entry) => entry.id === province.id)!;
    const adjacency = rawMap.provinces
      .filter((candidate) => candidate.id !== rawProvince.id)
      .filter((candidate) => areGridAdjacent(rawProvince, candidate))
      .filter((candidate) => {
        const key = edgeKey(rawProvince.id, candidate.id);
        return !blocked.has(key) || bridges.has(key);
      })
      .map((candidate) => candidate.id);
    province.adjacency = adjacency;
  }

  return mapDefinitionSchema.parse({
    id: rawMap.id,
    name: rawMap.name,
    width: rawMap.width,
    height: rawMap.height,
    atmosphere: rawMap.atmosphere,
    provinces,
  });
}

const maps = [expandRawMap(crownfallRaw), expandRawMap(thornmarchRaw), expandRawMap(ashenStraitRaw)];

export const MAPS = maps;
export const MAPS_BY_ID = Object.fromEntries(maps.map((map) => [map.id, map]));

export function getMapById(mapId: string) {
  return MAPS_BY_ID[mapId] ?? MAPS[0];
}
