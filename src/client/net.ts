import type { DirectoryEntry, ServerMessage } from "@shared/net/protocol";
import type { ClientIntent, MatchBootstrap, MatchSnapshot, PlayerProfile, ServerPatch } from "@shared/sim/types";
import { httpRoomUrl, wsUrl } from "@client/runtime";

export interface MatchHandlers {
  onBootstrap: (payload: MatchBootstrap) => void;
  onLobby: (payload: MatchBootstrap["lobby"]) => void;
  onSnapshot: (payload: MatchSnapshot) => void;
  onPatch: (payload: ServerPatch) => void;
  onError: (message: string) => void;
}

export interface MatchConnection {
  sendIntent: (intent: ClientIntent) => void;
  requestSync: () => void;
  close: () => void;
}

export function connectPartyRoom(
  baseHost: string,
  roomId: string,
  profile: PlayerProfile,
  handlers: MatchHandlers,
): MatchConnection {
  const socket = new WebSocket(wsUrl(baseHost, roomId));

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "join", profile: JSON.stringify(profile) }));
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    switch (message.type) {
      case "bootstrap":
        handlers.onBootstrap(message.payload);
        break;
      case "lobby":
        handlers.onLobby(message.payload);
        break;
      case "snapshot":
        handlers.onSnapshot(message.payload);
        break;
      case "patch":
        handlers.onPatch(message.payload);
        break;
      case "error":
        handlers.onError(message.message);
        break;
      default:
        break;
    }
  });

  socket.addEventListener("close", () => {
    handlers.onError("Connection closed.");
  });

  return {
    sendIntent: (intent) => socket.send(JSON.stringify({ type: "intent", intent })),
    requestSync: () => socket.send(JSON.stringify({ type: "request-sync" })),
    close: () => socket.close(),
  };
}

export function connectSkirmish(
  profile: PlayerProfile,
  desiredBots: number,
  mapId: string,
  handlers: MatchHandlers,
): MatchConnection {
  const worker = new Worker(new URL("@skirmish/worker.ts", import.meta.url), {
    type: "module",
  });

  worker.addEventListener("message", (event: MessageEvent<ServerMessage>) => {
    const message = event.data;
    switch (message.type) {
      case "bootstrap":
        handlers.onBootstrap(message.payload);
        break;
      case "snapshot":
        handlers.onSnapshot(message.payload);
        break;
      case "patch":
        handlers.onPatch(message.payload);
        break;
      case "error":
        handlers.onError(message.message);
        break;
      default:
        break;
    }
  });

  worker.postMessage({
    type: "start-skirmish",
    payload: {
      roomId: `skirmish-${Math.random().toString(36).slice(2, 7)}`,
      profile,
      desiredBots,
      mapId,
    },
  });

  return {
    sendIntent: (intent) => worker.postMessage({ type: "intent", intent }),
    requestSync: () => worker.postMessage({ type: "request-sync" }),
    close: () => worker.terminate(),
  };
}

export async function fetchDirectory(baseHost: string): Promise<DirectoryEntry[]> {
  const response = await fetch(httpRoomUrl(baseHost, "__directory__"));
  if (!response.ok) return [];
  const data = (await response.json()) as { entries: DirectoryEntry[] };
  return data.entries;
}

export async function upsertDirectoryEntry(baseHost: string, entry: DirectoryEntry) {
  await fetch(httpRoomUrl(baseHost, "__directory__"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(entry),
  });
}

export async function removeDirectoryEntry(baseHost: string, roomId: string) {
  await fetch(`${httpRoomUrl(baseHost, "__directory__")}?roomId=${encodeURIComponent(roomId)}`, {
    method: "DELETE",
  });
}
