/// <reference lib="webworker" />

import { getMapById } from "@shared/maps";
import type { ClientMessage, ServerMessage } from "@shared/net/protocol";
import { createMatchState, tickMatch } from "@shared/sim/engine";
import { createPatch, createSnapshot } from "@shared/sim/patch";
import type { ClientIntent, LobbyState, MatchState, PlayerProfile } from "@shared/sim/types";

interface StartPayload {
  roomId: string;
  profile: PlayerProfile;
  desiredBots: number;
  mapId: string;
}

let state: MatchState | null = null;
let playerId: string | null = null;
let queue: ClientIntent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

function post(message: ServerMessage) {
  self.postMessage(message);
}

function startSkirmish(payload: StartPayload) {
  playerId = payload.profile.id;
  const lobby: LobbyState = {
    roomId: payload.roomId,
    hostId: payload.profile.id,
    privacy: "private",
    selectedMapId: payload.mapId,
    desiredBots: payload.desiredBots,
    started: true,
    createdAt: Date.now(),
    slots: [
      {
        ...payload.profile,
        ready: true,
        joinedAt: Date.now(),
      },
    ],
  };
  state = createMatchState(payload.roomId, lobby, getMapById(payload.mapId));
  post({
    type: "bootstrap",
    payload: {
      lobby,
      snapshot: createSnapshot(state, playerId),
    },
  });

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (!state) return;
    const previous = structuredClone(state);
    state = tickMatch(state, queue);
    queue = [];
    post({ type: "patch", payload: createPatch(previous, state) });
    if (state.phase === "finished" && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 100);
}

self.addEventListener("message", (event: MessageEvent<ClientMessage | { type: "start-skirmish"; payload: StartPayload }>) => {
  const message = event.data;

  if (message.type === "start-skirmish") {
    startSkirmish(message.payload);
    return;
  }

  if (message.type === "intent") {
    queue.push(message.intent);
    return;
  }

  if (message.type === "request-sync" && state) {
    post({ type: "snapshot", payload: createSnapshot(state, playerId) });
  }
});
