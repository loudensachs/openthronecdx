import type {
  ClientIntent,
  LobbyState,
  MatchBootstrap,
  MatchSnapshot,
  ServerPatch,
} from "@shared/sim/types";

export type ClientMessage =
  | { type: "join"; profile: string; reconnect?: boolean }
  | { type: "intent"; intent: ClientIntent }
  | { type: "request-sync" }
  | { type: "ping"; now: number };

export type ServerMessage =
  | { type: "bootstrap"; payload: MatchBootstrap }
  | { type: "lobby"; payload: LobbyState }
  | { type: "snapshot"; payload: MatchSnapshot }
  | { type: "patch"; payload: ServerPatch }
  | { type: "directory"; payload: DirectoryListing }
  | { type: "error"; message: string }
  | { type: "pong"; now: number };

export interface DirectoryEntry {
  roomId: string;
  mapId: string;
  players: number;
  desiredBots: number;
  privacy: "public" | "private";
  createdAt: number;
  hostName: string;
}

export interface DirectoryListing {
  entries: DirectoryEntry[];
}
