import { BALANCE, type BuildingKind, type TerrainKind } from "@shared/config/balance";
import {
  mapDefinitionSchema,
  type LandmassDefinition,
  type MapDefinition,
  type MapPoint,
  type ProvinceDefinition,
  type SeaLaneDefinition,
} from "@shared/maps/schema";
import { distance } from "@shared/utils/graph";
import { createSeededRandom, hashString, randomBetween, sample } from "@shared/utils/random";

type ContinentBlueprint = {
  id: string;
  name: string;
  center: MapPoint;
  radiusX: number;
  radiusY: number;
  countries: string[];
};

type MapBlueprint = {
  id: string;
  name: string;
  atmosphere: string;
  width: number;
  height: number;
  provinceCount: number;
  spawnCount: number;
  seed: string;
  continents: ContinentBlueprint[];
};

type ProvinceSeed = {
  id: string;
  center: MapPoint;
  country: string;
  continent: string;
  polygon: MapPoint[];
  adjacency: string[];
  terrain: TerrainKind;
  building: BuildingKind;
  buildingLevel: number;
  spawnSlot: number | null;
  strategicValue: number;
  coastal: boolean;
  name: string;
};

const MAP_BLUEPRINTS: MapBlueprint[] = [
  {
    id: "crownfall",
    name: "Crownfall",
    atmosphere: "A broad imperial mainland with fertile interior basins, cliff coasts, and old harbor duchies.",
    width: 1800,
    height: 1080,
    provinceCount: 40,
    spawnCount: 4,
    seed: "crownfall-2",
    continents: [
      {
        id: "heartland",
        name: "Heartland",
        center: { x: 900, y: 520 },
        radiusX: 560,
        radiusY: 340,
        countries: ["Aurel", "Merevia", "Cindrel", "Valewyn"],
      },
      {
        id: "westreach",
        name: "Westreach",
        center: { x: 420, y: 520 },
        radiusX: 180,
        radiusY: 140,
        countries: ["Briarcoast", "Westmere"],
      },
      {
        id: "suncliff",
        name: "Suncliff",
        center: { x: 1440, y: 500 },
        radiusX: 220,
        radiusY: 160,
        countries: ["Dawnmarch", "Sunwall"],
      },
    ],
  },
  {
    id: "thornmarch",
    name: "Thornmarch",
    atmosphere: "A forest world of broken peninsulas, dark rivers, and cold northern marches.",
    width: 1960,
    height: 1180,
    provinceCount: 48,
    spawnCount: 6,
    seed: "thornmarch-2",
    continents: [
      {
        id: "northwood",
        name: "Northwood",
        center: { x: 700, y: 340 },
        radiusX: 420,
        radiusY: 240,
        countries: ["Needle Crown", "Hemlock Vale", "Rookfen"],
      },
      {
        id: "southwood",
        name: "Southwood",
        center: { x: 910, y: 820 },
        radiusX: 530,
        radiusY: 260,
        countries: ["Thornmere", "Wolfpine", "Verdancy"],
      },
      {
        id: "eastcape",
        name: "Eastcape",
        center: { x: 1460, y: 620 },
        radiusX: 300,
        radiusY: 200,
        countries: ["Greyglen", "Ravenstrand"],
      },
    ],
  },
  {
    id: "ashen-strait",
    name: "Ashen Strait",
    atmosphere: "Twin realms stare across a volcanic strait crossed by ancient lanes and smoke-black harbors.",
    width: 2040,
    height: 980,
    provinceCount: 44,
    spawnCount: 5,
    seed: "ashen-strait-2",
    continents: [
      {
        id: "emberwest",
        name: "Emberwest",
        center: { x: 620, y: 480 },
        radiusX: 360,
        radiusY: 280,
        countries: ["Smokehold", "Barrow Coast", "Flintmere"],
      },
      {
        id: "midchain",
        name: "Midchain",
        center: { x: 1010, y: 500 },
        radiusX: 160,
        radiusY: 120,
        countries: ["Spanward"],
      },
      {
        id: "cinder-east",
        name: "Cinder East",
        center: { x: 1450, y: 490 },
        radiusX: 390,
        radiusY: 270,
        countries: ["Cindergate", "Salt Abbey", "Gullreach"],
      },
    ],
  },
];

const NAME_PARTS = {
  plains: [
    ["Amber", "Field"],
    ["King", "Meadow"],
    ["Golden", "Ford"],
    ["Laurel", "Market"],
    ["Miller", "Vale"],
  ],
  forest: [
    ["Raven", "Wood"],
    ["Cedar", "Hollow"],
    ["Thorn", "Glen"],
    ["Hunter", "Copse"],
    ["Briar", "Shade"],
  ],
  hills: [
    ["Stone", "Watch"],
    ["High", "Cairn"],
    ["Ash", "Rise"],
    ["Bell", "Crag"],
    ["Iron", "Spur"],
  ],
  marsh: [
    ["Fen", "Reach"],
    ["Mire", "Rest"],
    ["Reed", "Moor"],
    ["Marsh", "Gate"],
    ["Sedge", "Run"],
  ],
  water: [["Sea", "Hold"]],
} satisfies Record<TerrainKind, Array<[string, string]>>;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function linearlySampleLand(
  blueprint: MapBlueprint,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { landRatio: number; waterRatio: number } {
  let land = 0;
  const steps = 18;
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (landScore(blueprint, x, y) > 0.035) land += 1;
  }
  const sampleCount = steps - 1;
  const landRatio = land / sampleCount;
  return { landRatio, waterRatio: 1 - landRatio };
}

function landContribution(blueprint: MapBlueprint, continent: ContinentBlueprint, x: number, y: number) {
  const dx = (x - continent.center.x) / continent.radiusX;
  const dy = (y - continent.center.y) / continent.radiusY;
  const radial = 1 - dx * dx - dy * dy;
  const seed = hashString(`${blueprint.seed}:${continent.id}`);
  const waveA = Math.sin((x + seed * 0.03) / 130) * 0.14;
  const waveB = Math.cos((y - seed * 0.05) / 120) * 0.12;
  const waveC = Math.sin((x + y + seed * 0.09) / 160) * 0.08;
  return radial + waveA + waveB + waveC;
}

function landScore(blueprint: MapBlueprint, x: number, y: number) {
  let best = -Infinity;
  for (const continent of blueprint.continents) {
    best = Math.max(best, landContribution(blueprint, continent, x, y));
  }
  return best;
}

function nearestContinent(blueprint: MapBlueprint, point: MapPoint) {
  return blueprint.continents
    .map((continent) => ({
      continent,
      score: landContribution(blueprint, continent, point.x, point.y),
    }))
    .sort((a, b) => b.score - a.score)[0].continent;
}

function generateLandmasses(blueprint: MapBlueprint): LandmassDefinition[] {
  const random = createSeededRandom(`${blueprint.seed}:landmasses`);
  return blueprint.continents.map((continent) => {
    const polygon: MapPoint[] = [];
    const steps = 28;
    for (let index = 0; index < steps; index += 1) {
      const angle = (Math.PI * 2 * index) / steps;
      const radiusJitter = 0.84 + random() * 0.28;
      const x = continent.center.x + Math.cos(angle) * continent.radiusX * radiusJitter;
      const y = continent.center.y + Math.sin(angle) * continent.radiusY * radiusJitter;
      polygon.push({
        x: clamp(x, 45, blueprint.width - 45),
        y: clamp(y, 45, blueprint.height - 45),
      });
    }
    return {
      id: continent.id,
      name: continent.name,
      polygon,
    };
  });
}

function generateProvinceCenters(blueprint: MapBlueprint) {
  const random = createSeededRandom(`${blueprint.seed}:centers`);
  const centers: Array<{
    id: string;
    center: MapPoint;
    country: string;
    continent: string;
  }> = [];
  const margin = 120;
  let minSpacing = Math.sqrt((blueprint.width * blueprint.height) / blueprint.provinceCount) * 0.42;

  for (let pass = 0; pass < 7 && centers.length < blueprint.provinceCount; pass += 1) {
    const threshold = 0.13 - pass * 0.018;
    for (let attempt = 0; attempt < 5000 && centers.length < blueprint.provinceCount; attempt += 1) {
      const x = randomBetween(random, margin, blueprint.width - margin);
      const y = randomBetween(random, margin, blueprint.height - margin);
      if (landScore(blueprint, x, y) < threshold) continue;
      const tooClose = centers.some((entry) => distance(entry.center, { x, y }) < minSpacing);
      if (tooClose) continue;
      const continent = nearestContinent(blueprint, { x, y });
      centers.push({
        id: `${blueprint.id}_${centers.length}`,
        center: { x, y },
        country: sample(random, continent.countries),
        continent: continent.name,
      });
    }
    minSpacing *= 0.92;
  }

  if (centers.length !== blueprint.provinceCount) {
    throw new Error(`Failed to generate ${blueprint.provinceCount} provinces for ${blueprint.id}`);
  }
  return centers;
}

function pointBelongsToProvince(
  point: MapPoint,
  self: { center: MapPoint },
  others: Array<{ center: MapPoint }>,
) {
  const myDistance = distance(point, self.center);
  const closestOther = others.reduce((best, entry) => Math.min(best, distance(point, entry.center)), Infinity);
  return myDistance <= closestOther * 1.08;
}

function buildProvincePolygon(
  blueprint: MapBlueprint,
  center: { center: MapPoint },
  allCenters: Array<{ center: MapPoint }>,
  random: () => number,
) {
  const nearest = allCenters
    .filter((entry) => entry !== center)
    .map((entry) => distance(entry.center, center.center))
    .sort((a, b) => a - b)[0];
  const baseRadius = clamp(nearest * 0.47, 46, 116);
  const steps = 9 + Math.floor(random() * 4);
  const polygon: MapPoint[] = [];

  for (let index = 0; index < steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps + randomBetween(random, -0.14, 0.14);
    let radius = baseRadius * randomBetween(random, 0.8, 1.18);

    for (let attempt = 0; attempt < 14; attempt += 1) {
      const candidate = {
        x: center.center.x + Math.cos(angle) * radius,
        y: center.center.y + Math.sin(angle) * radius,
      };
      if (
        landScore(blueprint, candidate.x, candidate.y) > -0.035 &&
        pointBelongsToProvince(candidate, center, allCenters)
      ) {
        polygon.push(candidate);
        break;
      }
      radius *= 0.88;
      if (attempt === 13) {
        polygon.push({
          x: center.center.x + Math.cos(angle) * radius,
          y: center.center.y + Math.sin(angle) * radius,
        });
      }
    }
  }

  return polygon;
}

function detectTerrain(
  blueprint: MapBlueprint,
  point: MapPoint,
  coastal: boolean,
): TerrainKind {
  const seed = hashString(`${blueprint.seed}:terrain`);
  const ridge = Math.sin((point.x + seed * 0.13) / 75) + Math.cos((point.y - seed * 0.07) / 82);
  const forest = Math.cos((point.x + point.y) / 94) + Math.sin((point.x - point.y) / 118);
  if (coastal && ridge < -0.2) return "marsh";
  if (ridge > 1.0) return "hills";
  if (forest > 0.45) return "forest";
  return "plains";
}

function connectGraph(
  blueprint: MapBlueprint,
  provinces: ProvinceSeed[],
  adjacency: Map<string, Set<string>>,
) {
  const byId = Object.fromEntries(provinces.map((province) => [province.id, province]));
  const desiredNeighborCount = 4;

  for (const province of provinces) {
    const candidates = provinces
      .filter((entry) => entry.id !== province.id)
      .map((entry) => ({
        entry,
        dist: distance(province.center, entry.center),
        sample: linearlySampleLand(blueprint, province.center.x, province.center.y, entry.center.x, entry.center.y),
      }))
      .filter(({ sample, dist }) => sample.landRatio > 0.72 && dist < 340)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, desiredNeighborCount);

    for (const candidate of candidates) {
      adjacency.get(province.id)!.add(candidate.entry.id);
      adjacency.get(candidate.entry.id)!.add(province.id);
    }
  }

  const seen = new Set<string>();
  const components: string[][] = [];
  for (const province of provinces) {
    if (seen.has(province.id)) continue;
    const component: string[] = [];
    const queue = [province.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) queue.push(next);
      }
    }
    components.push(component);
  }

  if (components.length <= 1) return;

  for (let index = 1; index < components.length; index += 1) {
    const left = components[index - 1];
    const right = components[index];
    let bestPair: [string, string] | null = null;
    let bestDistance = Infinity;
    for (const leftId of left) {
      for (const rightId of right) {
        const leftProvince = byId[leftId];
        const rightProvince = byId[rightId];
        const sample = linearlySampleLand(
          blueprint,
          leftProvince.center.x,
          leftProvince.center.y,
          rightProvince.center.x,
          rightProvince.center.y,
        );
        if (sample.landRatio < 0.58) continue;
        const dist = distance(leftProvince.center, rightProvince.center);
        if (dist < bestDistance) {
          bestDistance = dist;
          bestPair = [leftId, rightId];
        }
      }
    }
    if (bestPair) {
      adjacency.get(bestPair[0])!.add(bestPair[1]);
      adjacency.get(bestPair[1])!.add(bestPair[0]);
    }
  }
}

function buildSeaLanes(blueprint: MapBlueprint, provinces: ProvinceSeed[], adjacency: Map<string, Set<string>>) {
  const seaLanes: SeaLaneDefinition[] = [];
  const coastalProvinces = provinces.filter((province) => province.coastal);
  const laneCounts = new Map<string, number>();
  const laneKey = (a: string, b: string) => [a, b].sort().join(":");
  const existing = new Set<string>();

  function edgeControlPoint(province: ProvinceSeed, candidate: ProvinceSeed) {
    const midX = (province.center.x + candidate.center.x) / 2;
    const midY = (province.center.y + candidate.center.y) / 2;
    const options = [
      { x: midX, y: 54 },
      { x: midX, y: blueprint.height - 54 },
      { x: 54, y: midY },
      { x: blueprint.width - 54, y: midY },
    ];

    return options.sort((left, right) => {
      const leftScore =
        distance(left, province.center) + distance(left, candidate.center);
      const rightScore =
        distance(right, province.center) + distance(right, candidate.center);
      return leftScore - rightScore;
    })[0];
  }

  const pairs = coastalProvinces
    .flatMap((province) =>
      coastalProvinces
        .filter((candidate) => candidate.id !== province.id)
        .map((candidate) => ({ province, candidate })),
    )
    .filter(({ province, candidate }) => !adjacency.get(province.id)?.has(candidate.id))
    .map(({ province, candidate }) => {
      const sample = linearlySampleLand(
        blueprint,
        province.center.x,
        province.center.y,
        candidate.center.x,
        candidate.center.y,
      );
      return {
        province,
        candidate,
        sample,
        dist: distance(province.center, candidate.center),
      };
    });

  function tryAddLane(
    province: ProvinceSeed,
    candidate: ProvinceSeed,
    dist: number,
    controlPointOverride?: MapPoint,
  ) {
    const key = laneKey(province.id, candidate.id);
    if (existing.has(key)) return false;
    if ((laneCounts.get(province.id) ?? 0) >= 3) return false;
    if ((laneCounts.get(candidate.id) ?? 0) >= 3) return false;

    const midX = (province.center.x + candidate.center.x) / 2;
    const midY = (province.center.y + candidate.center.y) / 2;
    const dx = candidate.center.x - province.center.x;
    const dy = candidate.center.y - province.center.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const perpendicular = {
      x: -dy / length,
      y: dx / length,
    };
    const curve = clamp(dist * 0.16, 24, 72) * ((hashString(key) % 2 === 0) ? 1 : -1);

    seaLanes.push({
      from: province.id,
      to: candidate.id,
      controlPoint:
        controlPointOverride ??
        {
          x: midX + perpendicular.x * curve,
          y: midY + perpendicular.y * curve,
        },
    });
    existing.add(key);
    laneCounts.set(province.id, (laneCounts.get(province.id) ?? 0) + 1);
    laneCounts.set(candidate.id, (laneCounts.get(candidate.id) ?? 0) + 1);
    return true;
  }

  for (const { province, candidate, sample, dist } of pairs
    .filter(({ sample, dist }) => sample.waterRatio > 0.45 && dist > 140 && dist < 520)
    .sort((a, b) => a.dist - b.dist)) {
    tryAddLane(province, candidate, dist);
  }

  const minimumLanes = coastalProvinces.length >= 8 ? 2 : 1;
  if (seaLanes.length < minimumLanes) {
    for (const { province, candidate, sample, dist } of pairs
      .filter(({ dist }) => dist > 120 && dist < 720)
      .sort((a, b) => b.sample.waterRatio - a.sample.waterRatio || a.dist - b.dist)) {
      if (sample.waterRatio < 0.28) continue;
      tryAddLane(province, candidate, dist);
      if (seaLanes.length >= minimumLanes) break;
    }
  }

  if (seaLanes.length < minimumLanes) {
    for (const { province, candidate, dist } of pairs
      .filter(({ dist }) => dist > 220)
      .sort((a, b) => b.dist - a.dist)) {
      tryAddLane(province, candidate, dist, edgeControlPoint(province, candidate));
      if (seaLanes.length >= minimumLanes) break;
    }
  }

  return seaLanes;
}

function buildProvinceNames(
  blueprint: MapBlueprint,
  terrain: TerrainKind,
  country: string,
  used: Set<string>,
  random: () => number,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [a, b] = sample(random, NAME_PARTS[terrain]);
    const candidate = `${a}${b}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = `${country} ${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

function assignSpawns(provinces: ProvinceSeed[], blueprint: MapBlueprint) {
  const selected: ProvinceSeed[] = [];
  const center = { x: blueprint.width / 2, y: blueprint.height / 2 };
  for (let index = 0; index < blueprint.spawnCount; index += 1) {
    const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / blueprint.spawnCount;
    const anchor = {
      x: center.x + Math.cos(angle) * blueprint.width * 0.32,
      y: center.y + Math.sin(angle) * blueprint.height * 0.28,
    };
    const choice = provinces
      .filter((province) => !selected.includes(province))
      .map((province) => ({
        province,
        score:
          distance(province.center, anchor) -
          selected.reduce(
            (penalty, selectedProvince) =>
              penalty + 0.55 * distance(province.center, selectedProvince.center),
            0,
          ),
      }))
      .sort((a, b) => a.score - b.score)[0]?.province;

    if (choice) {
      selected.push(choice);
    }
  }

  selected.forEach((province, index) => {
    province.spawnSlot = index;
    province.building = "castle";
    province.buildingLevel = 2;
    province.strategicValue = 5;
  });
}

export function generateMap(blueprint: MapBlueprint): MapDefinition {
  const random = createSeededRandom(`${blueprint.seed}:map`);
  const centerSeeds = generateProvinceCenters(blueprint);
  const usedNames = new Set<string>();

  const provinces: ProvinceSeed[] = centerSeeds.map((seed, index, all) => {
    const polygon = buildProvincePolygon(blueprint, seed, all, random);
    const coastal = polygon.some((point) => landScore(blueprint, point.x, point.y) < 0.08);
    const terrain = detectTerrain(blueprint, seed.center, coastal);
    const building: BuildingKind =
      terrain === "hills" ? "fort" : terrain === "forest" ? "tower" : coastal ? "tower" : "village";

    return {
      id: seed.id,
      center: seed.center,
      country: seed.country,
      continent: seed.continent,
      polygon,
      adjacency: [],
      terrain,
      building,
      buildingLevel: 1,
      spawnSlot: null,
      strategicValue: coastal ? 3 : 2,
      coastal,
      name: buildProvinceNames(blueprint, terrain, seed.country, usedNames, random),
    };
  });

  const adjacency = new Map(provinces.map((province) => [province.id, new Set<string>()]));
  connectGraph(blueprint, provinces, adjacency);
  provinces.forEach((province) => {
    province.adjacency = Array.from(adjacency.get(province.id) ?? []).sort();
    province.strategicValue = clamp(
      Math.round((province.adjacency.length + (province.coastal ? 1 : 0) + (province.terrain === "hills" ? 1 : 0)) / 1.3),
      1,
      5,
    );
  });

  assignSpawns(provinces, blueprint);
  const seaLanes = buildSeaLanes(blueprint, provinces, adjacency);
  const landmasses = generateLandmasses(blueprint);

  return mapDefinitionSchema.parse({
    id: blueprint.id,
    name: blueprint.name,
    width: blueprint.width,
    height: blueprint.height,
    atmosphere: blueprint.atmosphere,
    landmasses,
    seaLanes,
    provinces: provinces.map((province) => ({
      id: province.id,
      name: province.name,
      country: province.country,
      continent: province.continent,
      polygon: province.polygon,
      center: province.center,
      adjacency: province.adjacency,
      terrain: province.terrain,
      building: province.building,
      buildingLevel: province.buildingLevel,
      spawnSlot: province.spawnSlot,
      strategicValue: province.strategicValue,
      coastal: province.coastal,
    })),
  });
}

export function generateAllMaps() {
  return MAP_BLUEPRINTS.map(generateMap);
}
