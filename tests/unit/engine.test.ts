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
    const source = Object.values(match.provinces).find((province) => province.ownerId === host.id)!;
    const sourceMeta = match.map.provinces.find((province) => province.id === source.id)!;
    const target = sourceMeta.adjacency
      .map((id) => match.provinces[id])
      .find((province) => province.ownerId !== host.id)!;

    let current = applyIntents(match, [
      {
        type: "send-levies",
        playerId: host.id,
        fromProvinceId: source.id,
        toProvinceId: target.id,
        ratio: 0.5,
      },
    ]);

    for (let index = 0; index < 32; index += 1) {
      current = tickMatch(current, []);
    }

    expect(current.provinces[target.id].ownerId).toBe(host.id);
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

  it("allows coastal sea-lane transfers when land adjacency is absent", () => {
    const host = player("p1", "Host");
    const rival = player("p2", "Rival");
    let lobby = createLobby("room-3", host, "ashen-strait", "private");
    lobby = joinLobby(lobby, rival);
    const match = createMatchState("room-3", { ...lobby, desiredBots: 0, started: true }, getMapById("ashen-strait"));
    const lane = match.map.seaLanes[0]!;
    match.provinces[lane.from].ownerId = host.id;
    match.provinces[lane.from].levies = 30;
    match.provinces[lane.to].ownerId = rival.id;
    match.provinces[lane.to].levies = 8;
    const hostProvince = match.provinces[lane.from];
    const targetId = lane.from === hostProvince.id ? lane.to : lane.from;

    const next = applyIntents(match, [
      {
        type: "send-levies",
        playerId: host.id,
        fromProvinceId: hostProvince.id,
        toProvinceId: targetId,
        ratio: 0.5,
      },
    ]);

    const route = Object.values(next.routes)[0];
    expect(route).toBeTruthy();
    expect(route.mode).toBe("sea");
  });

  it("does not charge coins when reselecting the current building", () => {
    const host = player("p1", "Host");
    const lobby = createLobby("room-4", host, "crownfall", "private");
    const match = createMatchState("room-4", { ...lobby, desiredBots: 0, started: true }, getMapById("crownfall"));
    const province = Object.values(match.provinces).find((entry) => entry.ownerId === host.id)!;
    const beforeCoins = province.coinReserve;
    const beforeLevel = province.buildingLevel;
    const beforeBuilding = province.building;

    const next = applyIntents(match, [
      {
        type: "change-building",
        playerId: host.id,
        provinceId: province.id,
        building: beforeBuilding,
      },
    ]);

    expect(next.provinces[province.id].coinReserve).toBe(beforeCoins);
    expect(next.provinces[province.id].buildingLevel).toBe(beforeLevel);
    expect(next.provinces[province.id].building).toBe(beforeBuilding);
  });
});
