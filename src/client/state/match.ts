import type { MatchSnapshot, ServerPatch } from "@shared/sim/types";

export function applyPatch(snapshot: MatchSnapshot, patch: ServerPatch): MatchSnapshot {
  const provinces = { ...snapshot.provinces };
  for (const province of patch.changedProvinces) {
    provinces[province.id] = province;
  }

  return {
    ...snapshot,
    tick: patch.tick,
    phase: patch.phase,
    provinces,
    routes: Object.fromEntries(patch.routes.map((route) => [route.id, route])),
    scoreboard: patch.scoreboard,
    alliances: patch.alliances,
    allianceRequests: patch.allianceRequests,
    truces: patch.truces,
    victoryCountdown: patch.victoryCountdown,
    winnerCoalition: patch.winnerCoalition,
    paused: patch.paused,
    stats: patch.stats,
  };
}
