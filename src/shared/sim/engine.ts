import { BALANCE } from "@shared/config/balance";
import type { BuildingKind, Difficulty } from "@shared/config/balance";
import type { MapDefinition, ProvinceDefinition, SeaLaneDefinition } from "@shared/maps/schema";
import { getBotIntents } from "@shared/bots/planner";
import type {
  AllianceRequest,
  AllianceState,
  ClientIntent,
  LobbyState,
  MatchState,
  PlayerProfile,
  ProvinceState,
  RouteState,
  ScoreboardEntry,
  TruceState,
} from "@shared/sim/types";
import { breadthFirstPath, distance } from "@shared/utils/graph";
import { createId, pairKey } from "@shared/utils/id";

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function mapProvinceLookup(map: MapDefinition) {
  return Object.fromEntries(map.provinces.map((province) => [province.id, province]));
}

function buildAdjacency(map: MapDefinition) {
  return Object.fromEntries(map.provinces.map((province) => [province.id, province.adjacency]));
}

function buildSeaLaneLookup(map: MapDefinition) {
  const lookup = new Map<string, SeaLaneDefinition>();
  for (const lane of map.seaLanes) {
    lookup.set(pairKey(lane.from, lane.to), lane);
  }
  return lookup;
}

function provinceDefense(province: ProvinceDefinition, state: ProvinceState): number {
  return (
    BALANCE.terrainDefense[province.terrain] *
    BALANCE.building[state.building].defenseMultiplier *
    (1 + (state.buildingLevel - 1) * 0.18)
  );
}

function canTraverseFriendly(
  state: MatchState,
  playerId: string,
  provinceId: string,
  isTarget: boolean,
): boolean {
  const province = state.provinces[provinceId];
  if (!province) return false;
  if (isTarget) return true;
  if (!province.ownerId) return false;
  return province.ownerId === playerId || areAllied(state, playerId, province.ownerId);
}

function allCoalitionMembers(state: MatchState, startPlayerId: string): string[] {
  const seen = new Set<string>();
  const queue = [startPlayerId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const alliance of state.alliances) {
      if (alliance.players.includes(current)) {
        for (const playerId of alliance.players) {
          if (!seen.has(playerId)) queue.push(playerId);
        }
      }
    }
  }

  return Array.from(seen);
}

function aliveOwners(state: MatchState): string[] {
  return Array.from(
    new Set(
      Object.values(state.provinces)
        .map((province) => province.ownerId)
        .filter((ownerId): ownerId is string => Boolean(ownerId)),
    ),
  );
}

export function createLobby(
  roomId: string,
  host: PlayerProfile,
  selectedMapId: string,
  privacy: "public" | "private",
): LobbyState {
  return {
    roomId,
    hostId: host.id,
    privacy,
    selectedMapId,
    desiredBots: 2,
    started: false,
    createdAt: Date.now(),
    slots: [
      {
        ...host,
        ready: false,
        joinedAt: Date.now(),
      },
    ],
  };
}

export function joinLobby(lobby: LobbyState, player: PlayerProfile): LobbyState {
  const next = deepClone(lobby);
  const existing = next.slots.find((slot) => slot.sessionId === player.sessionId);
  if (existing) {
    Object.assign(existing, player);
    return next;
  }
  next.slots.push({
    ...player,
    ready: false,
    joinedAt: Date.now(),
  });
  return next;
}

export function leaveLobby(lobby: LobbyState, playerId: string): LobbyState {
  const next = deepClone(lobby);
  next.slots = next.slots.filter((slot) => slot.id !== playerId);
  if (next.hostId === playerId) {
    next.hostId = next.slots.sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id ?? null;
  }
  return next;
}

export function applyLobbyIntent(lobby: LobbyState, intent: ClientIntent): LobbyState {
  const next = deepClone(lobby);
  const actor = next.slots.find((slot) => slot.id === intent.playerId);
  if (!actor) return next;

  switch (intent.type) {
    case "toggle-ready":
      actor.ready = intent.ready;
      break;
    case "set-map":
      if (next.hostId === intent.playerId) next.selectedMapId = intent.mapId;
      break;
    case "set-bots":
      if (next.hostId === intent.playerId) {
        next.desiredBots = Math.max(0, Math.min(6, intent.desiredBots));
      }
      break;
    case "start-match":
      if (
        next.hostId === intent.playerId &&
        next.slots.length >= 1 &&
        next.slots.every((slot) => slot.id === next.hostId || slot.ready)
      ) {
        next.started = true;
      }
      break;
    default:
      break;
  }

  return next;
}

export function createMatchState(
  roomId: string,
  lobby: LobbyState,
  map: MapDefinition,
): MatchState {
  const players: Record<string, PlayerProfile> = {};
  const provinces: Record<string, ProvinceState> = {};
  const botCount = Math.max(0, lobby.desiredBots);

  const livePlayers = lobby.slots.map((slot) => {
    players[slot.id] = {
      id: slot.id,
      sessionId: slot.sessionId,
      name: slot.name,
      bannerColor: slot.bannerColor,
      crest: slot.crest,
      isBot: false,
    };
    return players[slot.id];
  });

  for (let index = 0; index < botCount; index += 1) {
    const botId = createId("bot");
    const personalities: PlayerProfile["botPersonality"][] = [
      "warden",
      "raider",
      "chancellor",
    ];
    const difficulties: Difficulty[] = ["squire", "baron", "king"];
    players[botId] = {
      id: botId,
      sessionId: botId,
      name: ["Warden", "Raider", "Chancellor"][index % 3] + ` ${index + 1}`,
      bannerColor: ["#5d4931", "#8b2f2a", "#41593f"][index % 3],
      crest: ["tower", "wolf", "crown"][index % 3],
      isBot: true,
      botPersonality: personalities[index % personalities.length],
      difficulty: difficulties[Math.min(2, Math.floor(index / 2))],
    };
    livePlayers.push(players[botId]);
  }

  for (const province of map.provinces) {
    const spawnPlayer = province.spawnSlot !== null ? livePlayers[province.spawnSlot] : undefined;
    provinces[province.id] = {
      id: province.id,
      ownerId: spawnPlayer?.id ?? null,
      levies: spawnPlayer
        ? BALANCE.ownedStartingLevies
        : province.building === "fort"
          ? BALANCE.neutralFortLevies
          : BALANCE.neutralStartingLevies,
      building: province.building,
      buildingLevel: province.buildingLevel,
      coinReserve: spawnPlayer ? BALANCE.ownedStartingCoins : 0,
    };
  }

  const state: MatchState = {
    roomId,
    map,
    phase: "active",
    tick: 0,
    players,
    provinces,
    routes: {},
    alliances: [],
    allianceRequests: [],
    truces: [],
    scoreboard: [],
    victoryCountdown: null,
    winnerCoalition: null,
    paused: false,
    stats: {
      alliancesFormed: 0,
      alliancesBroken: 0,
      troopsSent: {},
      provincesCaptured: {},
    },
  };

  state.scoreboard = computeScoreboard(state);
  return state;
}

export function cloneMatchState(state: MatchState): MatchState {
  return deepClone(state);
}

export function applyIntents(state: MatchState, intents: ClientIntent[]): MatchState {
  let next = deepClone(state);
  for (const intent of intents) {
    next = reduceIntent(next, intent);
  }
  return next;
}

function reduceIntent(state: MatchState, intent: ClientIntent): MatchState {
  if (state.phase !== "active") return state;
  const next = deepClone(state);
  const actor = next.players[intent.playerId];
  if (!actor) return next;

  switch (intent.type) {
    case "toggle-pause":
      next.paused = intent.paused;
      return next;
    case "send-levies":
      sendLevies(next, intent.playerId, intent.fromProvinceId, intent.toProvinceId, intent.ratio);
      return next;
    case "change-building":
      changeBuilding(next, intent.playerId, intent.provinceId, intent.building);
      return next;
    case "upgrade-building":
      upgradeBuilding(next, intent.playerId, intent.provinceId);
      return next;
    case "request-alliance":
      requestAlliance(next, intent.playerId, intent.targetPlayerId);
      return next;
    case "respond-alliance":
      respondAlliance(next, intent.playerId, intent.requestId, intent.accept);
      return next;
    case "break-alliance":
      breakAlliance(next, intent.playerId, intent.targetPlayerId);
      return next;
    default:
      return next;
  }
}

function sendLevies(
  state: MatchState,
  playerId: string,
  fromProvinceId: string,
  toProvinceId: string,
  ratio: number,
) {
  const fromProvince = state.provinces[fromProvinceId];
  const toProvince = state.provinces[toProvinceId];
  if (!fromProvince || !toProvince) return;
  if (fromProvince.ownerId !== playerId) return;
  if (fromProvince.levies < 2) return;
  if (fromProvinceId === toProvinceId) return;
  if (toProvince.ownerId === playerId && ratio === 0) return;

  const adjacency = buildAdjacency(state.map);
  const path = breadthFirstPath(fromProvinceId, toProvinceId, adjacency, (nodeId, isTarget) =>
    canTraverseFriendly(state, playerId, nodeId, isTarget),
  );

  const targetOwner = toProvince.ownerId;
  if (targetOwner && areTruced(state, playerId, targetOwner)) return;

  let routeMode: RouteState["mode"] = "land";
  let routePath = path;

  if (!routePath || routePath.length < 2) {
    const fromMeta = state.map.provinces.find((province) => province.id === fromProvinceId);
    const toMeta = state.map.provinces.find((province) => province.id === toProvinceId);
    const laneLookup = buildSeaLaneLookup(state.map);
    const lane = laneLookup.get(pairKey(fromProvinceId, toProvinceId));
    if (!fromMeta?.coastal || !toMeta?.coastal || !lane) return;
    routeMode = "sea";
    routePath = [fromProvinceId, toProvinceId];
  }

  const amount = Math.max(1, Math.floor(fromProvince.levies * ratio));
  if (amount <= 0) return;

  fromProvince.levies -= amount;
  const totalTicks =
    routeMode === "sea"
      ? computeSeaTravelTicks(state.map, fromProvinceId, toProvinceId, fromProvince.building)
      : computeTravelTicks(state.map, routePath, fromProvince.building);
  const routeId = createId("route");
  state.routes[routeId] = {
    id: routeId,
    ownerId: playerId,
    mode: routeMode,
    amount,
    fromProvinceId,
    toProvinceId,
    path: routePath,
    progress: 0,
    totalTicks,
  };
  state.stats.troopsSent[playerId] = (state.stats.troopsSent[playerId] ?? 0) + amount;
}

function computeTravelTicks(map: MapDefinition, path: string[], building: BuildingKind) {
  const byId = mapProvinceLookup(map);
  let total = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const current = byId[path[index]];
    const next = byId[path[index + 1]];
    total += Math.ceil(
      distance(current.center, next.center) /
        BALANCE.landTravelDivisor /
        (BALANCE.terrainTravel[next.terrain] * BALANCE.building[building].travelModifier),
    );
  }
  return Math.max(4, total);
}

function computeSeaTravelTicks(
  map: MapDefinition,
  fromProvinceId: string,
  toProvinceId: string,
  building: BuildingKind,
) {
  const byId = mapProvinceLookup(map);
  const from = byId[fromProvinceId];
  const to = byId[toProvinceId];
  const rawDistance = distance(from.center, to.center);
  return Math.max(
    8,
    Math.ceil(
      rawDistance /
        BALANCE.seaTravelDivisor /
        (BALANCE.boatTravelMultiplier * BALANCE.building[building].travelModifier),
    ),
  );
}

function changeBuilding(
  state: MatchState,
  playerId: string,
  provinceId: string,
  building: BuildingKind,
) {
  const province = state.provinces[provinceId];
  if (!province || province.ownerId !== playerId) return;
  if (province.building === "castle") return;
  if (province.building === building) return;
  const cost = BALANCE.building[building].upgradeCost;
  if (province.coinReserve < cost) return;
  province.coinReserve -= cost;
  province.building = building;
  province.buildingLevel = 1;
}

function upgradeBuilding(state: MatchState, playerId: string, provinceId: string) {
  const province = state.provinces[provinceId];
  if (!province || province.ownerId !== playerId) return;
  if (province.buildingLevel >= BALANCE.maxBuildingLevel) return;
  const cost = BALANCE.building[province.building].upgradeCost + province.buildingLevel * 5;
  if (province.coinReserve < cost) return;
  province.coinReserve -= cost;
  province.buildingLevel += 1;
}

function requestAlliance(state: MatchState, playerId: string, targetPlayerId: string) {
  if (!state.players[targetPlayerId] || targetPlayerId === playerId) return;
  if (areAllied(state, playerId, targetPlayerId)) return;
  if (activeAllianceCount(state, playerId) >= BALANCE.maxAllianceCount) return;
  if (activeAllianceCount(state, targetPlayerId) >= BALANCE.maxAllianceCount) return;
  if (areTruced(state, playerId, targetPlayerId)) return;
  if (
    state.allianceRequests.some(
      (request) =>
        request.fromPlayerId === playerId && request.toPlayerId === targetPlayerId,
    )
  ) {
    return;
  }
  state.allianceRequests.push({
    id: createId("alliance"),
    fromPlayerId: playerId,
    toPlayerId: targetPlayerId,
    createdTick: state.tick,
  });
}

function respondAlliance(
  state: MatchState,
  playerId: string,
  requestId: string,
  accept: boolean,
) {
  const requestIndex = state.allianceRequests.findIndex((request) => request.id === requestId);
  if (requestIndex === -1) return;
  const request = state.allianceRequests[requestIndex];
  if (request.toPlayerId !== playerId) return;
  state.allianceRequests.splice(requestIndex, 1);
  if (!accept) return;
  if (activeAllianceCount(state, request.fromPlayerId) >= BALANCE.maxAllianceCount) return;
  if (activeAllianceCount(state, request.toPlayerId) >= BALANCE.maxAllianceCount) return;
  state.alliances.push({
    pairKey: pairKey(request.fromPlayerId, request.toPlayerId),
    players: [request.fromPlayerId, request.toPlayerId],
    formedTick: state.tick,
  });
  state.stats.alliancesFormed += 1;
}

function breakAlliance(state: MatchState, playerId: string, targetPlayerId: string) {
  const key = pairKey(playerId, targetPlayerId);
  const before = state.alliances.length;
  state.alliances = state.alliances.filter((entry) => entry.pairKey !== key);
  if (state.alliances.length === before) return;
  state.truces.push({
    pairKey: key,
    players: [playerId, targetPlayerId].sort() as [string, string],
    expiresAtTick: state.tick + BALANCE.breakAllianceTruceTicks,
  });
  state.stats.alliancesBroken += 1;
}

function activeAllianceCount(state: MatchState, playerId: string) {
  return state.alliances.filter((alliance) => alliance.players.includes(playerId)).length;
}

export function areAllied(state: MatchState, a: string, b: string) {
  if (a === b) return true;
  return state.alliances.some((alliance) => alliance.pairKey === pairKey(a, b));
}

export function areTruced(state: MatchState, a: string, b: string) {
  const key = pairKey(a, b);
  return state.truces.some((truce) => truce.pairKey === key && truce.expiresAtTick > state.tick);
}

function resolveRouteArrival(state: MatchState, route: RouteState) {
  const target = state.provinces[route.toProvinceId];
  const targetDefinition = state.map.provinces.find((province) => province.id === route.toProvinceId);
  if (!target || !targetDefinition) return;

  if (!target.ownerId || target.ownerId === route.ownerId || areAllied(state, route.ownerId, target.ownerId)) {
    target.ownerId = route.ownerId;
    target.levies += route.amount;
    return;
  }

  const defenderPower = target.levies * provinceDefense(targetDefinition, target);
  const attackPower =
    route.amount *
    (!target.ownerId ? BALANCE.unownedCapturePenalty : BALANCE.occupiedCapturePenalty);

  if (attackPower > defenderPower) {
    const remainder = Math.max(1, Math.round((attackPower - defenderPower) / provinceDefense(targetDefinition, target)));
    const previousOwner = target.ownerId;
    target.ownerId = route.ownerId;
    target.levies = remainder;
    state.stats.provincesCaptured[route.ownerId] =
      (state.stats.provincesCaptured[route.ownerId] ?? 0) + 1;
    removeDeadAlliances(state, previousOwner);
  } else {
    target.levies = Math.max(1, Math.round((defenderPower - attackPower) / provinceDefense(targetDefinition, target)));
  }
}

function removeDeadAlliances(state: MatchState, playerId: string | null) {
  if (!playerId) return;
  const stillAlive = Object.values(state.provinces).some((province) => province.ownerId === playerId);
  if (stillAlive) return;
  state.alliances = state.alliances.filter((alliance) => !alliance.players.includes(playerId));
  state.allianceRequests = state.allianceRequests.filter(
    (request) => request.fromPlayerId !== playerId && request.toPlayerId !== playerId,
  );
  state.truces = state.truces.filter((truce) => !truce.players.includes(playerId));
}

function growProvince(state: MatchState, provinceDefinition: ProvinceDefinition, province: ProvinceState) {
  if (!province.ownerId) return;
  const building = BALANCE.building[province.building];
  province.levies = Math.round((province.levies + building.levyPerTick * province.buildingLevel) * 100) / 100;
  province.coinReserve = Math.round((province.coinReserve + building.coinPerTick * province.buildingLevel) * 100) / 100;
}

function computeScoreboard(state: MatchState): ScoreboardEntry[] {
  return Object.values(state.players)
    .map((player) => {
      const owned = Object.values(state.provinces).filter((province) => province.ownerId === player.id);
      return {
        playerId: player.id,
        provinces: owned.length,
        levies: Math.round(owned.reduce((sum, province) => sum + province.levies, 0)),
        coins: Math.round(owned.reduce((sum, province) => sum + province.coinReserve, 0)),
        alliances: activeAllianceCount(state, player.id),
        alive: owned.length > 0,
      };
    })
    .sort((a, b) => b.provinces - a.provinces || b.levies - a.levies);
}

function updateVictory(state: MatchState) {
  const owners = aliveOwners(state);
  if (owners.length === 0) {
    state.victoryCountdown = null;
    return;
  }

  const coalition = allCoalitionMembers(state, owners[0]);
  const allInCoalition = owners.every((ownerId) => coalition.includes(ownerId));

  if (!allInCoalition) {
    state.victoryCountdown = null;
    return;
  }

  if (
    state.victoryCountdown &&
    state.victoryCountdown.coalition.length === coalition.length &&
    state.victoryCountdown.coalition.every((playerId) => coalition.includes(playerId))
  ) {
    state.victoryCountdown.ticksRemaining -= 1;
  } else {
    state.victoryCountdown = {
      coalition,
      ticksRemaining: BALANCE.coalitionVictoryTicks,
    };
  }

  if (state.victoryCountdown.ticksRemaining <= 0) {
    state.phase = "finished";
    state.winnerCoalition = coalition;
  }
}

export function tickMatch(state: MatchState, externalIntents: ClientIntent[]): MatchState {
  let next = applyIntents(state, externalIntents);
  if (next.paused || next.phase !== "active") {
    return {
      ...next,
      scoreboard: computeScoreboard(next),
    };
  }

  next.tick += 1;
  next.truces = next.truces.filter((truce) => truce.expiresAtTick > next.tick);

  const botIntents = getBotIntents(next);
  if (botIntents.length > 0) {
    next = applyIntents(next, botIntents);
  }

  for (const provinceDefinition of next.map.provinces) {
    growProvince(next, provinceDefinition, next.provinces[provinceDefinition.id]);
  }

  for (const route of Object.values(next.routes)) {
    route.progress += 1;
    if (route.progress >= route.totalTicks) {
      resolveRouteArrival(next, route);
      delete next.routes[route.id];
    }
  }

  next.scoreboard = computeScoreboard(next);
  updateVictory(next);
  return next;
}
