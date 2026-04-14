import type * as Party from "partykit/server";
import { getMapById } from "@shared/maps";
import type {
  ClientMessage,
  DirectoryEntry,
  DirectoryListing,
  ServerMessage,
} from "@shared/net/protocol";
import {
  applyLobbyIntent,
  cloneMatchState,
  createLobby,
  createMatchState,
  joinLobby,
  leaveLobby,
  tickMatch,
} from "@shared/sim/engine";
import { createPatch, createSnapshot } from "@shared/sim/patch";
import type { ClientIntent, LobbyState, MatchState, PlayerProfile } from "@shared/sim/types";

const DIRECTORY_ROOM_ID = "__directory__";
const RECONNECT_GRACE_MS = 45_000;

interface ConnectionMeta {
  sessionId: string;
  playerId: string;
}

export default class OpenThroneParty implements Party.Server {
  private connections = new Set<Party.Connection>();
  private connectionMeta = new Map<Party.Connection, ConnectionMeta>();
  private disconnectedAt = new Map<string, number>();
  private lobby: LobbyState | null = null;
  private match: MatchState | null = null;
  private queuedIntents: ClientIntent[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private directory = new Map<string, DirectoryEntry>();

  constructor(readonly room: Party.Room) {}

  onConnect(connection: Party.Connection) {
    this.connections.add(connection);
  }

  onClose(connection: Party.Connection) {
    this.connections.delete(connection);
    const meta = this.connectionMeta.get(connection);
    if (!meta) return;
    this.connectionMeta.delete(connection);

    if (this.match) {
      this.disconnectedAt.set(meta.sessionId, Date.now());
      return;
    }

    if (this.lobby) {
      this.lobby = leaveLobby(this.lobby, meta.playerId);
      this.broadcast({ type: "lobby", payload: this.lobby });
    }
  }

  async onRequest(request: Party.Request): Promise<Response> {
    if (this.room.id !== DIRECTORY_ROOM_ID) {
      return new Response(
        JSON.stringify({
          roomId: this.room.id,
          active: Boolean(this.match),
          players: this.lobby?.slots.length ?? Object.keys(this.match?.players ?? {}).length ?? 0,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    if (request.method === "GET") {
      return json({ entries: Array.from(this.directory.values()) satisfies DirectoryListing["entries"] });
    }

    if (request.method === "POST") {
      const entry = (await request.json()) as DirectoryEntry;
      this.directory.set(entry.roomId, entry);
      return json({ ok: true });
    }

    if (request.method === "DELETE") {
      const url = new URL(request.url);
      const roomId = url.searchParams.get("roomId");
      if (roomId) {
        this.directory.delete(roomId);
      }
      return json({ ok: true });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }

  onMessage(rawMessage: string, connection: Party.Connection) {
    let message: ClientMessage;
    try {
      message = JSON.parse(rawMessage) as ClientMessage;
    } catch {
      connection.send(JSON.stringify({ type: "error", message: "Invalid message." } satisfies ServerMessage));
      return;
    }

    if (message.type === "join") {
      this.handleJoin(connection, message.profile);
      return;
    }

    if (this.room.id === DIRECTORY_ROOM_ID) {
      if (message.type === "request-sync") {
        connection.send(JSON.stringify({ type: "directory", payload: { entries: Array.from(this.directory.values()) } } satisfies ServerMessage));
      }
      return;
    }

    const meta = this.connectionMeta.get(connection);
    if (!meta) {
      connection.send(JSON.stringify({ type: "error", message: "Join room first." } satisfies ServerMessage));
      return;
    }

    if (message.type === "ping") {
      connection.send(JSON.stringify({ type: "pong", now: message.now } satisfies ServerMessage));
      return;
    }

    if (message.type === "request-sync" && this.match) {
      connection.send(JSON.stringify({ type: "snapshot", payload: createSnapshot(this.match, meta.playerId) } satisfies ServerMessage));
      return;
    }

    if (message.type === "intent") {
      if (this.match) {
        this.queuedIntents.push(message.intent);
        return;
      }

      if (this.lobby) {
        this.lobby = applyLobbyIntent(this.lobby, message.intent);
        this.broadcast({ type: "lobby", payload: this.lobby });
        if (this.lobby.started) {
          this.startMatch();
        }
      }
    }
  }

  private handleJoin(connection: Party.Connection, serializedProfile: string) {
    const profile = JSON.parse(serializedProfile) as PlayerProfile;

    if (this.match) {
      const reconnectedPlayer = Object.values(this.match.players).find(
        (player) => player.sessionId === profile.sessionId,
      );
      if (!reconnectedPlayer) {
        connection.send(JSON.stringify({ type: "error", message: "This match has already begun." } satisfies ServerMessage));
        return;
      }

      const lastSeen = this.disconnectedAt.get(profile.sessionId) ?? Date.now();
      if (Date.now() - lastSeen > RECONNECT_GRACE_MS) {
        connection.send(JSON.stringify({ type: "error", message: "Reconnect window has expired." } satisfies ServerMessage));
        return;
      }

      this.connectionMeta.set(connection, {
        sessionId: profile.sessionId,
        playerId: reconnectedPlayer.id,
      });
      connection.send(
        JSON.stringify({
          type: "snapshot",
          payload: createSnapshot(this.match, reconnectedPlayer.id),
        } satisfies ServerMessage),
      );
      return;
    }

    if (!this.lobby) {
      const privacy = this.room.id.startsWith("hall-") ? "public" : "private";
      this.lobby = createLobby(this.room.id, profile, "crownfall", privacy);
    } else {
      this.lobby = joinLobby(this.lobby, profile);
    }

    this.connectionMeta.set(connection, {
      sessionId: profile.sessionId,
      playerId: profile.id,
    });

    connection.send(
      JSON.stringify({
        type: "bootstrap",
        payload: {
          lobby: this.lobby,
          snapshot: null,
        },
      } satisfies ServerMessage),
    );
    this.broadcast({ type: "lobby", payload: this.lobby });
  }

  private startMatch() {
    if (!this.lobby || this.match) return;
    this.match = createMatchState(this.room.id, this.lobby, getMapById(this.lobby.selectedMapId));
    this.broadcastSnapshot();
    this.tickTimer = setInterval(() => {
      if (!this.match) return;
      const previous = cloneMatchState(this.match);
      this.match = tickMatch(this.match, this.queuedIntents);
      this.queuedIntents = [];
      const patch = createPatch(previous, this.match);
      this.broadcast({ type: "patch", payload: patch });
      if (this.match.phase === "finished" && this.tickTimer) {
        clearInterval(this.tickTimer);
        this.tickTimer = null;
      }
    }, 100);
  }

  private broadcastSnapshot() {
    if (!this.match) return;
    for (const connection of this.connections) {
      const meta = this.connectionMeta.get(connection);
      connection.send(
        JSON.stringify({
          type: "snapshot",
          payload: createSnapshot(this.match, meta?.playerId ?? null),
        } satisfies ServerMessage),
      );
    }
  }

  private broadcast(message: ServerMessage) {
    const serialized = JSON.stringify(message);
    for (const connection of this.connections) {
      connection.send(serialized);
    }
  }
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
