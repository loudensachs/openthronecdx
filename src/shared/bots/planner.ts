import { BALANCE } from "@shared/config/balance";
import type { ClientIntent, MatchState, PlayerProfile } from "@shared/sim/types";

function ownedProvinceIds(state: MatchState, playerId: string) {
  return Object.values(state.provinces)
    .filter((province) => province.ownerId === playerId)
    .map((province) => province.id);
}

function hostileNeighbors(state: MatchState, playerId: string, provinceId: string) {
  const province = state.map.provinces.find((entry) => entry.id === provinceId);
  if (!province) return [];
  const coastalTargets = province.coastal
    ? state.map.seaLanes
        .filter((lane) => lane.from === provinceId || lane.to === provinceId)
        .map((lane) => (lane.from === provinceId ? lane.to : lane.from))
    : [];
  return [...province.adjacency, ...coastalTargets]
    .map((id) => state.provinces[id])
    .filter((entry): entry is typeof state.provinces[string] => Boolean(entry))
    .filter((entry) => entry.ownerId !== playerId);
}

function activeAllianceCount(state: MatchState, playerId: string) {
  return state.alliances.filter((alliance) => alliance.players.includes(playerId)).length;
}

function pendingRequestFor(state: MatchState, fromPlayerId: string, targetPlayerId: string) {
  return state.allianceRequests.some(
    (request) =>
      request.fromPlayerId === fromPlayerId && request.toPlayerId === targetPlayerId,
  );
}

export function getBotIntents(state: MatchState): ClientIntent[] {
  if (state.phase !== "active") return [];

  const intents: ClientIntent[] = [];

  for (const player of Object.values(state.players)) {
    if (!player.isBot || !player.difficulty || !player.botPersonality) continue;
    if (state.tick % BALANCE.botCadenceTicks[player.difficulty] !== 0) continue;
    intents.push(...planBotTurn(state, player));
  }

  return intents;
}

function planBotTurn(state: MatchState, player: PlayerProfile): ClientIntent[] {
  const provinces = ownedProvinceIds(state, player.id)
    .map((id) => state.provinces[id])
    .sort((a, b) => b.levies - a.levies);
  if (provinces.length === 0) return [];

  const intents: ClientIntent[] = [];
  const strongest = provinces[0];
  const neighbors = hostileNeighbors(state, player.id, strongest.id).sort(
    (a, b) => a.levies - b.levies,
  );
  const friendly = provinces.filter((province) => province.coinReserve >= 14);

  if (player.botPersonality === "warden" && friendly[0]) {
    intents.push({
      type: "change-building",
      playerId: player.id,
      provinceId: friendly[0].id,
      building: "fort",
    });
  }

  if (player.botPersonality === "chancellor") {
    const diplomaticTarget = state.scoreboard
      .filter((entry) => entry.playerId !== player.id && entry.alive)
      .sort((a, b) => a.provinces - b.provinces)[0];
    if (
      diplomaticTarget &&
      activeAllianceCount(state, player.id) < BALANCE.maxAllianceCount &&
      !pendingRequestFor(state, player.id, diplomaticTarget.playerId)
    ) {
      intents.push({
        type: "request-alliance",
        playerId: player.id,
        targetPlayerId: diplomaticTarget.playerId,
      });
    }
  }

  if (player.botPersonality === "raider" && neighbors[0]) {
    intents.push({
      type: "send-levies",
      playerId: player.id,
      fromProvinceId: strongest.id,
      toProvinceId: neighbors[0].id,
      ratio: 1,
    });
    return intents;
  }

  if (neighbors[0] && strongest.levies > 18) {
    intents.push({
      type: "send-levies",
      playerId: player.id,
      fromProvinceId: strongest.id,
      toProvinceId: neighbors[0].id,
      ratio: player.botPersonality === "warden" ? 0.5 : 0.25,
    });
  } else if (friendly[0] && friendly[0].coinReserve >= 14) {
    intents.push({
      type: "upgrade-building",
      playerId: player.id,
      provinceId: friendly[0].id,
    });
  }

  return intents;
}
