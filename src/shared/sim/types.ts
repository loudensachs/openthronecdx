import type {
  BotPersonality,
  BuildingKind,
  Difficulty,
} from "@shared/config/balance";
import type { MapDefinition } from "@shared/maps/schema";

export type MatchPhase = "lobby" | "active" | "finished";

export interface PlayerProfile {
  id: string;
  sessionId: string;
  name: string;
  bannerColor: string;
  crest: string;
  isBot: boolean;
  botPersonality?: BotPersonality;
  difficulty?: Difficulty;
}

export interface LobbySlot extends PlayerProfile {
  ready: boolean;
  joinedAt: number;
}

export interface LobbyState {
  roomId: string;
  hostId: string | null;
  privacy: "public" | "private";
  selectedMapId: string;
  desiredBots: number;
  started: boolean;
  slots: LobbySlot[];
  createdAt: number;
}

export interface ProvinceState {
  id: string;
  ownerId: string | null;
  levies: number;
  building: BuildingKind;
  buildingLevel: number;
  coinReserve: number;
}

export interface RouteState {
  id: string;
  ownerId: string;
  mode: "land" | "sea";
  amount: number;
  fromProvinceId: string;
  toProvinceId: string;
  path: string[];
  progress: number;
  totalTicks: number;
}

export interface AllianceRequest {
  id: string;
  fromPlayerId: string;
  toPlayerId: string;
  createdTick: number;
}

export interface AllianceState {
  pairKey: string;
  players: [string, string];
  formedTick: number;
}

export interface TruceState {
  pairKey: string;
  players: [string, string];
  expiresAtTick: number;
}

export interface ScoreboardEntry {
  playerId: string;
  provinces: number;
  levies: number;
  coins: number;
  alliances: number;
  alive: boolean;
}

export interface MatchStats {
  alliancesFormed: number;
  alliancesBroken: number;
  troopsSent: Record<string, number>;
  provincesCaptured: Record<string, number>;
}

export interface MatchState {
  roomId: string;
  map: MapDefinition;
  phase: MatchPhase;
  tick: number;
  players: Record<string, PlayerProfile>;
  provinces: Record<string, ProvinceState>;
  routes: Record<string, RouteState>;
  alliances: AllianceState[];
  allianceRequests: AllianceRequest[];
  truces: TruceState[];
  scoreboard: ScoreboardEntry[];
  victoryCountdown: {
    coalition: string[];
    ticksRemaining: number;
  } | null;
  winnerCoalition: string[] | null;
  paused: boolean;
  stats: MatchStats;
}

export type SendRatio = 0.25 | 0.5 | 1;

export type ClientIntent =
  | { type: "toggle-ready"; playerId: string; ready: boolean }
  | { type: "set-map"; playerId: string; mapId: string }
  | { type: "set-bots"; playerId: string; desiredBots: number }
  | { type: "start-match"; playerId: string }
  | {
      type: "send-levies";
      playerId: string;
      fromProvinceId: string;
      toProvinceId: string;
      ratio: SendRatio;
    }
  | {
      type: "change-building";
      playerId: string;
      provinceId: string;
      building: BuildingKind;
    }
  | {
      type: "upgrade-building";
      playerId: string;
      provinceId: string;
    }
  | {
      type: "request-alliance";
      playerId: string;
      targetPlayerId: string;
    }
  | {
      type: "respond-alliance";
      playerId: string;
      requestId: string;
      accept: boolean;
    }
  | {
      type: "break-alliance";
      playerId: string;
      targetPlayerId: string;
    }
  | { type: "toggle-pause"; playerId: string; paused: boolean };

export interface ProvincePatch {
  id: string;
  ownerId: string | null;
  levies: number;
  building: BuildingKind;
  buildingLevel: number;
  coinReserve: number;
}

export interface ServerPatch {
  tick: number;
  phase: MatchPhase;
  changedProvinces: ProvincePatch[];
  routes: RouteState[];
  scoreboard: ScoreboardEntry[];
  alliances: AllianceState[];
  allianceRequests: AllianceRequest[];
  truces: TruceState[];
  victoryCountdown: MatchState["victoryCountdown"];
  winnerCoalition: string[] | null;
  paused: boolean;
  stats: MatchStats;
}

export interface MatchSnapshot {
  roomId: string;
  map: MapDefinition;
  phase: MatchPhase;
  tick: number;
  me: string | null;
  players: Record<string, PlayerProfile>;
  provinces: Record<string, ProvinceState>;
  routes: Record<string, RouteState>;
  alliances: AllianceState[];
  allianceRequests: AllianceRequest[];
  truces: TruceState[];
  scoreboard: ScoreboardEntry[];
  victoryCountdown: MatchState["victoryCountdown"];
  winnerCoalition: string[] | null;
  paused: boolean;
  stats: MatchStats;
}

export interface MatchBootstrap {
  lobby: LobbyState;
  snapshot: MatchSnapshot | null;
}

export type RuntimeConfig = {
  partykitHost: string;
};
