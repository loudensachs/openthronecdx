export type BuildingKind = "castle" | "village" | "fort" | "tower";
export type TerrainKind = "plains" | "forest" | "hills" | "marsh" | "water";
export type BotPersonality = "warden" | "raider" | "chancellor";
export type Difficulty = "squire" | "baron" | "king";

export interface BuildingBalance {
  levyPerTick: number;
  coinPerTick: number;
  defenseMultiplier: number;
  upgradeCost: number;
  travelModifier: number;
}

export interface BalanceConfig {
  tickRate: number;
  maxAllianceCount: number;
  breakAllianceTruceTicks: number;
  coalitionVictoryTicks: number;
  maxBuildingLevel: number;
  defaultSendRatio: number;
  sendRatioOptions: number[];
  unownedCapturePenalty: number;
  building: Record<BuildingKind, BuildingBalance>;
  terrainDefense: Record<TerrainKind, number>;
  terrainTravel: Record<TerrainKind, number>;
  botCadenceTicks: Record<Difficulty, number>;
}

export const BALANCE: BalanceConfig = {
  tickRate: 10,
  maxAllianceCount: 2,
  breakAllianceTruceTicks: 15 * 10,
  coalitionVictoryTicks: 5 * 10,
  maxBuildingLevel: 3,
  defaultSendRatio: 0.5,
  sendRatioOptions: [0.25, 0.5, 1],
  unownedCapturePenalty: 0.85,
  building: {
    castle: {
      levyPerTick: 0.26,
      coinPerTick: 0.19,
      defenseMultiplier: 1.7,
      upgradeCost: 16,
      travelModifier: 1,
    },
    village: {
      levyPerTick: 0.33,
      coinPerTick: 0.28,
      defenseMultiplier: 0.95,
      upgradeCost: 12,
      travelModifier: 1,
    },
    fort: {
      levyPerTick: 0.18,
      coinPerTick: 0.14,
      defenseMultiplier: 1.85,
      upgradeCost: 14,
      travelModifier: 1,
    },
    tower: {
      levyPerTick: 0.22,
      coinPerTick: 0.17,
      defenseMultiplier: 1.2,
      upgradeCost: 13,
      travelModifier: 0.92,
    },
  },
  terrainDefense: {
    plains: 1,
    forest: 1.15,
    hills: 1.25,
    marsh: 0.95,
    water: 1,
  },
  terrainTravel: {
    plains: 1,
    forest: 0.9,
    hills: 0.94,
    marsh: 0.8,
    water: 0.72,
  },
  botCadenceTicks: {
    squire: 16,
    baron: 10,
    king: 7,
  },
};

export const CRESTS = [
  "stag",
  "tower",
  "crown",
  "wyvern",
  "oak",
  "raven",
  "sun",
  "wolf",
] as const;

export const BANNER_COLORS = [
  "#8b2f2a",
  "#4f6b3c",
  "#355c7d",
  "#7e5a2d",
  "#5d4057",
  "#6b2c44",
  "#2d4a5d",
  "#7a6631",
] as const;
