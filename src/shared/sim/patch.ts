import type {
  MatchSnapshot,
  MatchState,
  ProvincePatch,
  ServerPatch,
} from "@shared/sim/types";

export function createSnapshot(state: MatchState, me: string | null): MatchSnapshot {
  return {
    roomId: state.roomId,
    map: state.map,
    phase: state.phase,
    tick: state.tick,
    me,
    players: state.players,
    provinces: state.provinces,
    routes: state.routes,
    alliances: state.alliances,
    allianceRequests: state.allianceRequests,
    truces: state.truces,
    scoreboard: state.scoreboard,
    victoryCountdown: state.victoryCountdown,
    winnerCoalition: state.winnerCoalition,
    paused: state.paused,
    stats: state.stats,
  };
}

export function createPatch(previous: MatchState, next: MatchState): ServerPatch {
  const changedProvinces: ProvincePatch[] = [];

  for (const province of Object.values(next.provinces)) {
    const previousProvince = previous.provinces[province.id];
    if (
      !previousProvince ||
      previousProvince.ownerId !== province.ownerId ||
      previousProvince.levies !== province.levies ||
      previousProvince.building !== province.building ||
      previousProvince.buildingLevel !== province.buildingLevel ||
      previousProvince.coinReserve !== province.coinReserve
    ) {
      changedProvinces.push({
        id: province.id,
        ownerId: province.ownerId,
        levies: province.levies,
        building: province.building,
        buildingLevel: province.buildingLevel,
        coinReserve: province.coinReserve,
      });
    }
  }

  return {
    tick: next.tick,
    phase: next.phase,
    changedProvinces,
    routes: Object.values(next.routes),
    scoreboard: next.scoreboard,
    alliances: next.alliances,
    allianceRequests: next.allianceRequests,
    truces: next.truces,
    victoryCountdown: next.victoryCountdown,
    winnerCoalition: next.winnerCoalition,
    paused: next.paused,
    stats: next.stats,
  };
}
