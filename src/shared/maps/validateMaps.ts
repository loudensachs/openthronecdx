import { MAPS } from "@shared/maps";

function validateConnectivity(mapId: string, provinces: string[], adjacency: Record<string, string[]>) {
  const seen = new Set<string>();
  const queue = [provinces[0]];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency[current] ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }

  if (seen.size !== provinces.length) {
    throw new Error(`${mapId}: disconnected graph (${seen.size}/${provinces.length})`);
  }
}

for (const map of MAPS) {
  const provinceIds = map.provinces.map((province) => province.id);
  const adjacency = Object.fromEntries(map.provinces.map((province) => [province.id, province.adjacency]));
  const spawnCount = map.provinces.filter((province) => province.spawnSlot !== null).length;
  if (spawnCount < 4) {
    throw new Error(`${map.id}: not enough spawn castles`);
  }
  validateConnectivity(map.id, provinceIds, adjacency);
}

console.log(`Validated ${MAPS.length} OpenThrone maps.`);
