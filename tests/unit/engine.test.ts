import { describe, expect, it } from "vitest";
import { getMapById } from "@shared/maps";
import { applyIntents, createLobby, createMatchState, joinLobby, tickMatch } from "@shared/sim/engine";
import type { PlayerProfile } from "@shared/sim/types";

function player(id: string, name: string): PlayerProfile {
  return {
    id,
    sessionId: id,
    name,
    bannerColor: "#8b2f2a",
    crest: "crown",
    isBot: false,
  };
}

describe("simulation engine", () => {
  it("captures adjacent neutral provinces through routed levy movement", () => {
    const host = player("p1", "Host");
    const lobby = createLobby("room-1", host, "crownfall", "private");
    const match = createMatchState("room-1", { ...lobby, desiredBots: 0, started: true }, getMapById("crownfall"));

    let current = applyIntents(match, [
      {
        type: "send-levies",
        playerId: host.id,
        fromProvinceId: "cf_r0c0",
        toProvinceId: "cf_r0c1",
        ratio: 0.5,
      },
    ]);

    for (let index = 0; index < 12; index += 1) {
      current = tickMatch(current, []);
    }

    expect(current.provinces["cf_r0c1"].ownerId).toBe(host.id);
  });

  it("forms and breaks alliances with a truce window", () => {
    const host = player("p1", "Host");
    const rival = player("p2", "Rival");
    let lobby = createLobby("room-2", host, "crownfall", "private");
    lobby = joinLobby(lobby, rival);
    const match = createMatchState("room-2", { ...lobby, desiredBots: 0, started: true }, getMapById("crownfall"));

    let current = applyIntents(match, [
      { type: "request-alliance", playerId: host.id, targetPlayerId: rival.id },
    ]);
    const requestId = current.allianceRequests[0]?.id;
    expect(requestId).toBeTruthy();

    current = applyIntents(current, [
      { type: "respond-alliance", playerId: rival.id, requestId: requestId!, accept: true },
    ]);
    expect(current.alliances).toHaveLength(1);

    current = applyIntents(current, [
      { type: "break-alliance", playerId: host.id, targetPlayerId: rival.id },
    ]);
    expect(current.alliances).toHaveLength(0);
    expect(current.truces).toHaveLength(1);
    expect(current.truces[0].expiresAtTick).toBeGreaterThan(current.tick);
  });
});
