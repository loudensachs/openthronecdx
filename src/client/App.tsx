import { useEffect, useMemo, useRef, useState } from "react";
import { MAPS } from "@shared/maps";
import type { DirectoryEntry } from "@shared/net/protocol";
import { BALANCE, BANNER_COLORS, CRESTS, type BuildingKind } from "@shared/config/balance";
import type {
  ClientIntent,
  LobbyState,
  MatchBootstrap,
  MatchSnapshot,
  PlayerProfile,
} from "@shared/sim/types";
import { connectPartyRoom, connectSkirmish, fetchDirectory, removeDirectoryEntry, upsertDirectoryEntry, type MatchConnection } from "@client/net";
import { loadProfile, saveProfile } from "@client/profile";
import { loadRuntimeConfig } from "@client/runtime";
import { applyPatch } from "@client/state/match";
import { PixiBattlefield } from "@render/PixiBattlefield";
import type { ProvinceDefinition } from "@shared/maps/schema";

type Screen = "landing" | "multiplayer" | "skirmish" | "match";
type Tab = "kingdom" | "diplomacy" | "build" | "chronicle";
type CoinIndicator = {
  id: number;
  label: string;
  positive: boolean;
};
type TutorialPlan = {
  startProvinceId: string;
  expansionProvinceId: string | null;
  recommendedBuilding: BuildingKind;
  coastalProvinceId: string | null;
  coastalPartnerId: string | null;
};
type TutorialBaseline = {
  ownedCount: number;
  troopsSent: number;
  provinceStates: Record<string, { building: BuildingKind; buildingLevel: number }>;
};
type TutorialHighlight = {
  provinceId: string;
  label: string;
};

function formatCoins(value: number) {
  if (value >= 100) return Math.round(value).toString();
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(1);
}

function formatRate(value: number) {
  return `+${value.toFixed(1)}/s`;
}

function provinceIncomePerSecond(building: BuildingKind, buildingLevel: number) {
  return BALANCE.building[building].coinPerTick * buildingLevel * BALANCE.tickRate;
}

function provinceLeviesPerSecond(building: BuildingKind, buildingLevel: number) {
  return BALANCE.building[building].levyPerTick * buildingLevel * BALANCE.tickRate;
}

function tutorialProvinceName(snapshot: MatchSnapshot | null, provinceId: string | null) {
  if (!snapshot || !provinceId) return "the marked province";
  return snapshot.map.provinces.find((province) => province.id === provinceId)?.name ?? "the marked province";
}

function deriveTutorialPlan(snapshot: MatchSnapshot, me: string): TutorialPlan | null {
  const owned = snapshot.map.provinces.filter((province) => snapshot.provinces[province.id]?.ownerId === me);
  if (owned.length === 0) return null;

  const startProvince =
    owned.find((province) => snapshot.provinces[province.id]?.building === "castle") ?? owned[0];

  const expansionProvince =
    startProvince.adjacency
      .map((provinceId) => snapshot.map.provinces.find((province) => province.id === provinceId))
      .filter((province): province is ProvinceDefinition => Boolean(province))
      .sort((left, right) => {
        const leftOwned = snapshot.provinces[left.id]?.ownerId ? 1 : 0;
        const rightOwned = snapshot.provinces[right.id]?.ownerId ? 1 : 0;
        return leftOwned - rightOwned || left.strategicValue - right.strategicValue;
      })[0] ?? null;

  const recommendedBuilding =
    expansionProvince && snapshot.provinces[expansionProvince.id]?.building === "village"
      ? "tower"
      : "village";

  const coastalLane = snapshot.map.seaLanes.find((lane) => {
    const from = snapshot.map.provinces.find((province) => province.id === lane.from);
    const to = snapshot.map.provinces.find((province) => province.id === lane.to);
    return Boolean(from?.coastal && to?.coastal);
  });

  return {
    startProvinceId: startProvince.id,
    expansionProvinceId: expansionProvince?.id ?? null,
    recommendedBuilding,
    coastalProvinceId: coastalLane?.from ?? null,
    coastalPartnerId: coastalLane?.to ?? null,
  };
}

function makeTutorialBaseline(snapshot: MatchSnapshot, me: string): TutorialBaseline {
  return {
    ownedCount: Object.values(snapshot.provinces).filter((province) => province.ownerId === me).length,
    troopsSent: snapshot.stats.troopsSent[me] ?? 0,
    provinceStates: Object.fromEntries(
      Object.values(snapshot.provinces).map((province) => [
        province.id,
        {
          building: province.building,
          buildingLevel: province.buildingLevel,
        },
      ]),
    ),
  };
}

function createRoomId(publicLobby: boolean) {
  return `${publicLobby ? "hall" : "priv"}-${Math.random().toString(36).slice(2, 7)}`;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [profile, setProfile] = useState<PlayerProfile>(() => loadProfile());
  const [runtimeHost, setRuntimeHost] = useState("");
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [connection, setConnection] = useState<MatchConnection | null>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [selectedMapId, setSelectedMapId] = useState(MAPS[0].id);
  const [desiredBots, setDesiredBots] = useState(3);
  const [sendRatio, setSendRatio] = useState<0.25 | 0.5 | 1>(0.5);
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(null);
  const [hoveredProvinceId, setHoveredProvinceId] = useState<string | null>(null);
  const [sendPreviewTargetId, setSendPreviewTargetId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("kingdom");
  const [paused, setPaused] = useState(false);
  const [coinIndicators, setCoinIndicators] = useState<CoinIndicator[]>([]);
  const [tutorialMode, setTutorialMode] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const previousCoinsRef = useRef<number | null>(null);
  const coinGainBufferRef = useRef(0);
  const pendingSpendRef = useRef<{ label: string; expiresAtTick: number } | null>(null);
  const tutorialPlanRef = useRef<TutorialPlan | null>(null);
  const tutorialBaselineRef = useRef<TutorialBaseline | null>(null);
  const coinIndicatorIdRef = useRef(0);

  useEffect(() => {
    void loadRuntimeConfig().then(({ partykitHost }) => {
      setRuntimeHost(partykitHost);
      if (partykitHost) {
        void fetchDirectory(partykitHost).then(setDirectory).catch(() => undefined);
      }
    });
  }, []);

  useEffect(() => {
    saveProfile(profile);
  }, [profile]);

  useEffect(() => {
    return () => connection?.close();
  }, [connection]);

  useEffect(() => {
    if (!runtimeHost || !lobby || !snapshot || snapshot.phase !== "active") return;
    if (lobby.privacy === "public") {
      void removeDirectoryEntry(runtimeHost, lobby.roomId);
    }
  }, [lobby, runtimeHost, snapshot]);

  const me = snapshot?.me ?? profile.id;
  const selectedProvince = snapshot && selectedProvinceId ? snapshot.provinces[selectedProvinceId] : null;
  const selectedProvinceMeta = snapshot?.map.provinces.find((province) => province.id === selectedProvinceId) ?? null;
  const hoveredProvince = snapshot && hoveredProvinceId ? snapshot.provinces[hoveredProvinceId] : null;
  const hoveredProvinceMeta = snapshot?.map.provinces.find((province) => province.id === hoveredProvinceId) ?? null;
  const selectedMap = MAPS.find((map) => map.id === selectedMapId) ?? MAPS[0];
  const myScore = snapshot?.scoreboard.find((entry) => entry.playerId === me) ?? null;
  const alliancePartners = snapshot?.alliances.filter((alliance) => alliance.players.includes(me)) ?? [];
  const matchSeconds = snapshot ? Math.floor(snapshot.tick / 10) : 0;
  const matchMinutesLabel = `${Math.floor(matchSeconds / 60)}:${String(matchSeconds % 60).padStart(2, "0")}`;

  const ownedProvinceIds = useMemo(
    () =>
      snapshot
        ? Object.values(snapshot.provinces)
            .filter((province) => province.ownerId === me)
            .map((province) => province.id)
        : [],
    [me, snapshot],
  );

  const realmCoinIncome = useMemo(
    () =>
      snapshot
        ? Object.values(snapshot.provinces)
            .filter((province) => province.ownerId === me)
            .reduce(
              (sum, province) =>
                sum + provinceIncomePerSecond(province.building, province.buildingLevel),
              0,
            )
        : 0,
    [me, snapshot],
  );

  const selectedProvinceIncome = selectedProvince
    ? provinceIncomePerSecond(selectedProvince.building, selectedProvince.buildingLevel)
    : 0;

  const tutorialPlan = tutorialMode ? tutorialPlanRef.current : null;

  function pushCoinIndicator(label: string, positive: boolean) {
    const id = coinIndicatorIdRef.current + 1;
    coinIndicatorIdRef.current = id;
    setCoinIndicators((current) => [...current, { id, label, positive }].slice(-3));
    window.setTimeout(() => {
      setCoinIndicators((current) => current.filter((indicator) => indicator.id !== id));
    }, 1600);
  }

  function resetMatchUi() {
    setSelectedProvinceId(null);
    setHoveredProvinceId(null);
    setSendPreviewTargetId(null);
    setActiveTab("kingdom");
    setPanelOpen(true);
    setPaused(false);
    setCoinIndicators([]);
    previousCoinsRef.current = null;
    coinGainBufferRef.current = 0;
    pendingSpendRef.current = null;
    tutorialPlanRef.current = null;
    tutorialBaselineRef.current = null;
  }

  useEffect(() => {
    if (!tutorialMode || !snapshot || snapshot.phase !== "active") return;
    if (!tutorialPlanRef.current) {
      tutorialPlanRef.current = deriveTutorialPlan(snapshot, me);
    }
    if (!tutorialBaselineRef.current) {
      tutorialBaselineRef.current = makeTutorialBaseline(snapshot, me);
    }
  }, [me, snapshot, tutorialMode]);

  useEffect(() => {
    if (!snapshot || !myScore) {
      previousCoinsRef.current = null;
      return;
    }
    const previousCoins = previousCoinsRef.current;
    const currentCoins = myScore.coins;
    if (previousCoins !== null && currentCoins !== previousCoins) {
      const delta = currentCoins - previousCoins;
      if (delta !== 0) {
        if (delta > 0) {
          coinGainBufferRef.current += delta;
        } else {
          const pendingSpend = pendingSpendRef.current;
          const canExplainSpend =
            pendingSpend &&
            snapshot.tick <= pendingSpend.expiresAtTick;
          pushCoinIndicator(
            canExplainSpend ? `${delta} ${pendingSpend.label}` : `${delta} treasury`,
            false,
          );
          pendingSpendRef.current = null;
        }
      }
    }
    if (
      coinGainBufferRef.current > 0 &&
      (snapshot.tick % BALANCE.tickRate === 0 || coinGainBufferRef.current >= 4)
    ) {
      pushCoinIndicator(`+${coinGainBufferRef.current} treasury`, true);
      coinGainBufferRef.current = 0;
    }
    previousCoinsRef.current = currentCoins;
  }, [myScore, snapshot]);

  useEffect(() => {
    if (!tutorialMode || !snapshot || snapshot.phase !== "active") return;
    const plan = tutorialPlanRef.current;
    const baseline = tutorialBaselineRef.current;
    if (!plan || !baseline) return;

    const ownedCount = Object.values(snapshot.provinces).filter((province) => province.ownerId === me).length;
    const hasSentLevies = (snapshot.stats.troopsSent[me] ?? 0) > baseline.troopsSent;
    const hasChangedBuilding = Object.values(snapshot.provinces).some((province) => {
      if (province.ownerId !== me) return false;
      const initial = baseline.provinceStates[province.id];
      return initial ? province.building !== initial.building : false;
    });
    const hasUpgradedBuilding = Object.values(snapshot.provinces).some((province) => {
      if (province.ownerId !== me) return false;
      const initial = baseline.provinceStates[province.id];
      return initial ? province.buildingLevel > initial.buildingLevel : false;
    });

    if (tutorialStep === 1 && selectedProvinceId && snapshot.provinces[selectedProvinceId]?.ownerId === me) {
      setTutorialStep(2);
    } else if (tutorialStep === 2 && hasSentLevies) {
      setTutorialStep(3);
    } else if (tutorialStep === 3 && ownedCount > baseline.ownedCount) {
      setTutorialStep(4);
    } else if (
      tutorialStep === 4 &&
      activeTab === "build" &&
      selectedProvinceId &&
      snapshot.provinces[selectedProvinceId]?.ownerId === me
    ) {
      setTutorialStep(5);
    } else if (tutorialStep === 5 && hasChangedBuilding) {
      setTutorialStep(6);
    } else if (tutorialStep === 6 && hasUpgradedBuilding) {
      setTutorialStep(7);
    } else if (tutorialStep === 7 && hoveredProvinceMeta?.coastal) {
      setTutorialStep(8);
    }
  }, [activeTab, hoveredProvinceMeta?.coastal, me, selectedProvinceId, snapshot, tutorialMode, tutorialStep]);

  function wireHandlers() {
    return {
      onBootstrap: (payload: MatchBootstrap) => {
        setLobby(payload.lobby);
        if (payload.snapshot) {
          setSnapshot(payload.snapshot);
          setScreen("match");
        } else {
          setSnapshot(null);
        }
      },
      onLobby: (payload: LobbyState) => {
        setLobby(payload);
        if (payload.privacy === "public" && runtimeHost) {
          void upsertDirectoryEntry(runtimeHost, {
            roomId: payload.roomId,
            mapId: payload.selectedMapId,
            players: payload.slots.length,
            desiredBots: payload.desiredBots,
            privacy: payload.privacy,
            createdAt: payload.createdAt,
            hostName: payload.slots.find((slot) => slot.id === payload.hostId)?.name ?? "Host",
          });
        }
      },
      onSnapshot: (payload: MatchSnapshot) => {
        setSnapshot(payload);
        setScreen("match");
      },
      onPatch: (payload: Parameters<typeof applyPatch>[1]) => {
        setSnapshot((current) => (current ? applyPatch(current, payload) : current));
      },
      onError: (message: string) => setError(message),
    };
  }

  async function refreshDirectory() {
    if (!runtimeHost) return;
    const entries = await fetchDirectory(runtimeHost);
    setDirectory(entries);
  }

  function connectToPartyRoom(roomId: string) {
    if (!runtimeHost) return;
    setTutorialMode(false);
    setTutorialStep(0);
    resetMatchUi();
    const nextConnection = connectPartyRoom(runtimeHost, roomId, profile, wireHandlers());
    setConnection(nextConnection);
    setLobby(null);
    setSnapshot(null);
    setScreen("multiplayer");
  }

  function startSkirmish() {
    setTutorialMode(false);
    setTutorialStep(0);
    resetMatchUi();
    const nextConnection = connectSkirmish(profile, desiredBots, selectedMapId, wireHandlers());
    setConnection(nextConnection);
    setScreen("match");
  }

  function startTutorial() {
    setTutorialMode(true);
    setTutorialStep(0);
    resetMatchUi();
    setSelectedMapId("crownfall");
    setDesiredBots(1);
    setPanelOpen(true);
    setActiveTab("chronicle");
    const nextConnection = connectSkirmish(profile, 1, "crownfall", wireHandlers());
    setConnection(nextConnection);
    setScreen("match");
  }

  function sendIntent(intent: ClientIntent) {
    if (intent.type === "change-building") {
      pendingSpendRef.current = {
        label: `spent on ${intent.building}`,
        expiresAtTick: (snapshot?.tick ?? 0) + 8,
      };
    } else if (intent.type === "upgrade-building") {
      const province = snapshot?.provinces[intent.provinceId];
      if (province) {
        pendingSpendRef.current = {
          label: `spent on ${province.building} upgrade`,
          expiresAtTick: (snapshot?.tick ?? 0) + 8,
        };
      }
    }
    connection?.sendIntent(intent);
  }

  function toggleReady() {
    if (!lobby) return;
    const slot = lobby.slots.find((entry) => entry.id === profile.id);
    sendIntent({
      type: "toggle-ready",
      playerId: profile.id,
      ready: !(slot?.ready ?? false),
    });
  }

  function handleProvincePointerDown(provinceId: string) {
    if (!snapshot) return;
    const province = snapshot.provinces[provinceId];
    if (province.ownerId === me) {
      setSelectedProvinceId(provinceId);
      setSendPreviewTargetId(provinceId);
    }
  }

  function handleProvincePointerUp(provinceId: string) {
    if (!snapshot || !selectedProvinceId) return;
    if (selectedProvinceId !== provinceId) {
      sendIntent({
        type: "send-levies",
        playerId: me,
        fromProvinceId: selectedProvinceId,
        toProvinceId: provinceId,
        ratio: sendRatio,
      });
    }
    setSendPreviewTargetId(null);
  }

  const selectedProvinceUpgradeCost = selectedProvince
    ? BALANCE.building[selectedProvince.building].upgradeCost + selectedProvince.buildingLevel * 5
    : 0;
  const tutorialHighlights: TutorialHighlight[] = (() => {
    if (!tutorialMode || !tutorialPlan) return [];
    if (tutorialStep === 1) {
      return [{ provinceId: tutorialPlan.startProvinceId, label: "Select this realm" }];
    }
    if (tutorialStep === 2 && tutorialPlan.expansionProvinceId) {
      return [
        { provinceId: tutorialPlan.startProvinceId, label: "Send from here" },
        { provinceId: tutorialPlan.expansionProvinceId, label: "Claim this land" },
      ];
    }
    if (tutorialStep === 3 && tutorialPlan.expansionProvinceId) {
      return [{ provinceId: tutorialPlan.expansionProvinceId, label: "Wait for capture" }];
    }
    if (tutorialStep === 7 && tutorialPlan.coastalProvinceId) {
      return [
        { provinceId: tutorialPlan.coastalProvinceId, label: "Inspect this harbor" },
        ...(tutorialPlan.coastalPartnerId
          ? [{ provinceId: tutorialPlan.coastalPartnerId, label: "Sea lane destination" }]
          : []),
      ];
    }
    return [];
  })();

  const tutorialTitle = (() => {
    switch (tutorialStep) {
      case 0:
        return "Royal Tutor";
      case 1:
        return "Select Your Realm";
      case 2:
        return "Send Your First Levies";
      case 3:
        return "Watch the Capture";
      case 4:
        return "Open the Build Yard";
      case 5:
        return "Refit a Province";
      case 6:
        return "Upgrade the Works";
      case 7:
        return "Inspect the Coast";
      case 8:
        return "Lesson Complete";
      default:
        return "Royal Tutor";
    }
  })();

  const tutorialBody = (() => {
    if (!tutorialMode) return "";
    switch (tutorialStep) {
      case 0:
        return "This guided skirmish walks through expansion, province spending, and naval routes. The lesson waits for your moves.";
      case 1:
        return `Select ${tutorialProvinceName(snapshot, tutorialPlan?.startProvinceId ?? null)} to command your opening realm.`;
      case 2:
        return `From ${tutorialProvinceName(snapshot, tutorialPlan?.startProvinceId ?? null)}, send levies into ${tutorialProvinceName(snapshot, tutorialPlan?.expansionProvinceId ?? null)}. Drag from your province to the target.`;
      case 3:
        return "Routes resolve over time. Watch your banner march and the target change hands when the attack lands.";
      case 4:
        return "Open the Build tab and select one of your provinces. Every province keeps its own purse for local works.";
      case 5:
        return `Refit a province. A good first example is ${tutorialPlan?.recommendedBuilding ?? "village"}, which shows how costs and income change immediately.`;
      case 6:
        return "Upgrade any owned province once. The panel shows the exact coin cost before you commit.";
      case 7:
        return `Hover a coastal port such as ${tutorialProvinceName(snapshot, tutorialPlan?.coastalProvinceId ?? null)}. Coastal provinces can launch ships along the glowing sea lanes.`;
      case 8:
        return "You have completed the guided lesson. Keep playing this match or leave the lesson and start a fresh campaign.";
      default:
        return "";
    }
  })();

  const tutorialHint = (() => {
    switch (tutorialStep) {
      case 2:
        return "Tip: 50% send is selected by default, which is enough for early neutrals.";
      case 4:
        return "Tip: the top Treasury number is your whole realm. The Build tab uses the selected province's local purse.";
      case 5:
        return "Tip: villages mint the most coin, towers speed movement, forts harden defense.";
      case 7:
        return "Tip: drag open water to pan, mouse wheel to zoom, right-drag anywhere to reposition the camera.";
      default:
        return "";
    }
  })();

  return (
    <div className={`app-shell ${screen === "match" ? "in-match" : ""}`}>
      <div className="ambient-lights" />
      <div className="hero-grain" />

      {screen === "landing" && (
        <main className="landing-screen">
          <section className="hero-card parchment-panel">
            <span className="eyebrow">Real-Time Medieval Strategy</span>
            <h1>OpenThrone</h1>
            <p className="hero-copy">
              Seize provinces, forge alliances, and crown a coalition before rival realms swallow the map.
            </p>
            <div className="hero-actions">
              <button className="wax-button" onClick={startTutorial}>
                Learn to Rule
              </button>
              <button className="royal-button" onClick={() => setScreen("skirmish")}>
                Begin Skirmish
              </button>
              <button className="iron-button" onClick={() => setScreen("multiplayer")}>
                Enter the Hall
              </button>
            </div>
          </section>

          <section className="profile-card parchment-panel">
            <h2>Your Banner</h2>
            <div className="profile-grid">
              <label>
                Name
                <input
                  value={profile.name}
                  onChange={(event) => setProfile({ ...profile, name: event.target.value.slice(0, 18) })}
                />
              </label>
              <label>
                Crest
                <select
                  value={profile.crest}
                  onChange={(event) => setProfile({ ...profile, crest: event.target.value })}
                >
                  {CRESTS.map((crest) => (
                    <option key={crest} value={crest}>
                      {crest}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Banner
                <select
                  value={profile.bannerColor}
                  onChange={(event) => setProfile({ ...profile, bannerColor: event.target.value })}
                >
                  {BANNER_COLORS.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        </main>
      )}

      {screen === "skirmish" && (
        <main className="menu-screen">
          <section className="parchment-panel menu-panel">
            <h2>Single-Player Skirmish</h2>
            <p>{selectedMap.atmosphere}</p>
            <label>
              Map
              <select value={selectedMapId} onChange={(event) => setSelectedMapId(event.target.value)}>
                {MAPS.map((map) => (
                  <option key={map.id} value={map.id}>
                    {map.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bot Kingdoms
              <input
                type="range"
                min="2"
                max="6"
                value={desiredBots}
                onChange={(event) => setDesiredBots(Number(event.target.value))}
              />
              <strong>{desiredBots}</strong>
            </label>
            <div className="menu-actions">
              <button className="iron-button" onClick={() => setScreen("landing")}>
                Back
              </button>
              <button className="wax-button" onClick={startTutorial}>
                Guided Tutorial
              </button>
              <button className="royal-button" onClick={startSkirmish}>
                Start Campaign
              </button>
            </div>
          </section>
        </main>
      )}

      {screen === "multiplayer" && !snapshot && (
        <main className="menu-screen">
          {!lobby ? (
            <>
              <section className="parchment-panel menu-panel">
                <h2>Multiplayer Hall</h2>
                <p>Raise a private room code or post your banner to the public hall.</p>
                <div className="menu-actions">
                  <button className="royal-button" onClick={() => connectToPartyRoom(createRoomId(false))}>
                    Private Room
                  </button>
                  <button className="iron-button" onClick={() => connectToPartyRoom(createRoomId(true))}>
                    Public Hall
                  </button>
                </div>
                <label>
                  Join by code
                  <div className="join-row">
                    <input value={roomInput} onChange={(event) => setRoomInput(event.target.value)} />
                    <button className="wax-button" onClick={() => connectToPartyRoom(roomInput)}>
                      Join
                    </button>
                  </div>
                </label>
                <div className="menu-actions">
                  <button className="iron-button" onClick={() => setScreen("landing")}>
                    Back
                  </button>
                  <button className="wax-button" onClick={() => void refreshDirectory()}>
                    Refresh Hall
                  </button>
                </div>
              </section>
              <section className="parchment-panel menu-panel">
                <h2>Public Rooms</h2>
                <div className="public-list">
                  {directory.length === 0 && <p className="muted">No public halls are listed yet.</p>}
                  {directory.map((entry) => (
                    <button key={entry.roomId} className="hall-entry" onClick={() => connectToPartyRoom(entry.roomId)}>
                      <span>{entry.roomId}</span>
                      <span>{entry.mapId}</span>
                      <span>
                        {entry.players} + {entry.desiredBots} bots
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <section className="parchment-panel menu-panel">
              <h2>Lobby {lobby.roomId}</h2>
              <p className="muted">{MAPS.find((map) => map.id === lobby.selectedMapId)?.atmosphere}</p>
              <label>
                Map
                <select
                  value={lobby.selectedMapId}
                  disabled={lobby.hostId !== profile.id}
                  onChange={(event) =>
                    sendIntent({
                      type: "set-map",
                      playerId: profile.id,
                      mapId: event.target.value,
                    })
                  }
                >
                  {MAPS.map((map) => (
                    <option key={map.id} value={map.id}>
                      {map.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Bot fill
                <input
                  type="range"
                  min="0"
                  max="6"
                  value={lobby.desiredBots}
                  disabled={lobby.hostId !== profile.id}
                  onChange={(event) =>
                    sendIntent({
                      type: "set-bots",
                      playerId: profile.id,
                      desiredBots: Number(event.target.value),
                    })
                  }
                />
              </label>
              <div className="player-list">
                {lobby.slots.map((slot) => (
                  <div key={slot.id} className={`player-row ${slot.ready ? "ready" : ""}`}>
                    <span>{slot.name}</span>
                    <span>{slot.id === lobby.hostId ? "Host" : slot.ready ? "Ready" : "Waiting"}</span>
                  </div>
                ))}
              </div>
              <div className="menu-actions">
                <button className="wax-button" onClick={toggleReady}>
                  Toggle Ready
                </button>
                {lobby.hostId === profile.id && (
                  <button
                    className="royal-button"
                    onClick={() => sendIntent({ type: "start-match", playerId: profile.id })}
                  >
                    Start Match
                  </button>
                )}
                <button
                  className="iron-button"
                  onClick={() => {
                    connection?.close();
                    setConnection(null);
                    setLobby(null);
                    setTutorialMode(false);
                    setTutorialStep(0);
                    resetMatchUi();
                    if (runtimeHost) {
                      void removeDirectoryEntry(runtimeHost, lobby.roomId);
                    }
                  }}
                >
                  Leave
                </button>
              </div>
            </section>
          )}
        </main>
      )}

      {screen === "match" && snapshot && (
        <main className="match-screen">
          <div className="top-hud">
            <div className="top-chip">Room {snapshot.roomId}</div>
            <div className="top-chip">{snapshot.map.name}</div>
            <div className="top-chip">Alliances {alliancePartners.length}</div>
            <div className="top-chip treasury-chip">
              <span>Treasury {myScore ? formatCoins(myScore.coins) : "0.0"}c</span>
              <strong>{formatRate(realmCoinIncome)}</strong>
            </div>
            <div className="top-chip">Time {matchMinutesLabel}</div>
          </div>

          {coinIndicators.length > 0 && (
            <div className="coin-indicator-stack">
              {coinIndicators.map((indicator) => (
                <div
                  key={indicator.id}
                  className={`coin-indicator ${indicator.positive ? "positive" : "negative"}`}
                >
                  {indicator.label}
                </div>
              ))}
            </div>
          )}

          <PixiBattlefield
            snapshot={snapshot}
            me={me}
            selectedProvinceId={selectedProvinceId}
            hoveredProvinceId={hoveredProvinceId}
            sendPreviewTargetId={sendPreviewTargetId}
            tutorialHighlights={tutorialHighlights}
            onProvinceHover={(provinceId) => {
              setHoveredProvinceId(provinceId);
              if (selectedProvinceId && provinceId) {
                setSendPreviewTargetId(provinceId);
              } else if (!provinceId) {
                setSendPreviewTargetId(null);
              }
            }}
            onProvincePointerDown={handleProvincePointerDown}
            onProvincePointerUp={handleProvincePointerUp}
          />

          <div className="bottom-ratio-bar parchment-strip">
            {BALANCE.sendRatioOptions.map((ratio) => (
              <button
                key={ratio}
                className={`ratio-pill ${sendRatio === ratio ? "active" : ""}`}
                onClick={() => setSendRatio(ratio as 0.25 | 0.5 | 1)}
              >
                {Math.round(ratio * 100)}%
              </button>
            ))}
            <button
              className="ratio-pill"
              onClick={() => {
                const nextPaused = !paused;
                setPaused(nextPaused);
                sendIntent({ type: "toggle-pause", playerId: me, paused: nextPaused });
              }}
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button className="ratio-pill" onClick={() => setPanelOpen((current) => !current)}>
              {panelOpen ? "Hide Chronicle" : "Show Chronicle"}
            </button>
          </div>

          {hoveredProvince && hoveredProvinceMeta && (
            <div className="province-inspector parchment-panel">
              <strong>{hoveredProvinceMeta.name}</strong>
              <span>{hoveredProvinceMeta.country}</span>
              <span>{hoveredProvinceMeta.continent}</span>
              <span>
                {hoveredProvinceMeta.terrain}
                {hoveredProvinceMeta.coastal ? " • coastal port" : ""}
              </span>
              <span>
                {hoveredProvince.ownerId
                  ? snapshot.players[hoveredProvince.ownerId]?.name ?? "Held"
                  : "Neutral"}
              </span>
              <span>Levies {Math.floor(hoveredProvince.levies)}</span>
              <span>Purse {formatCoins(hoveredProvince.coinReserve)}c</span>
              <span>{hoveredProvince.building} Lv.{hoveredProvince.buildingLevel}</span>
            </div>
          )}

          {tutorialMode && snapshot.phase === "active" && (
            <div className="tutorial-card parchment-panel">
              <span className="eyebrow">Guided Tutorial</span>
              <h3>{tutorialTitle}</h3>
              <p>{tutorialBody}</p>
              {tutorialHint && <p className="tutorial-hint">{tutorialHint}</p>}
              {tutorialStep === 0 && (
                <button className="royal-button" onClick={() => setTutorialStep(1)}>
                  Begin Lesson
                </button>
              )}
              {tutorialStep === 8 && (
                <button
                  className="royal-button"
                  onClick={() => {
                    setTutorialMode(false);
                    setTutorialStep(0);
                    tutorialPlanRef.current = null;
                    tutorialBaselineRef.current = null;
                  }}
                >
                  Finish Lesson
                </button>
              )}
              {tutorialStep > 0 && tutorialStep < 8 && (
                <div className="tutorial-status">Waiting for your action...</div>
              )}
              <button
                className="iron-button small"
                onClick={() => {
                  setTutorialMode(false);
                  setTutorialStep(0);
                  tutorialPlanRef.current = null;
                  tutorialBaselineRef.current = null;
                }}
              >
                Skip Lesson
              </button>
            </div>
          )}

          {panelOpen && (
            <aside className="command-panel parchment-panel">
              <div className="panel-tabs">
                {(["kingdom", "diplomacy", "build", "chronicle"] as const).map((tab) => (
                  <button
                    key={tab}
                    className={activeTab === tab ? "active" : ""}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {activeTab === "kingdom" && (
                <div className="panel-body">
                  <h3>Kingdom Ledger</h3>
                  <p>Owned provinces: {ownedProvinceIds.length}</p>
                  <p>Treasury income: {formatRate(realmCoinIncome)}</p>
                  <div className="scoreboard-list">
                    {snapshot.scoreboard.map((entry) => (
                      <div key={entry.playerId} className="score-row">
                        <span>{snapshot.players[entry.playerId]?.name ?? entry.playerId}</span>
                        <span>{entry.provinces} lands</span>
                        <span>{entry.levies} levies</span>
                        <span>{entry.coins}c</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "diplomacy" && (
                <div className="panel-body">
                  <h3>Diplomacy</h3>
                  <div className="scoreboard-list">
                    {snapshot.scoreboard
                      .filter((entry) => entry.playerId !== me && entry.alive)
                      .map((entry) => {
                        const player = snapshot.players[entry.playerId];
                        const allied = snapshot.alliances.some(
                          (alliance) =>
                            alliance.players.includes(me) && alliance.players.includes(entry.playerId),
                        );
                        const incoming = snapshot.allianceRequests.find(
                          (request) => request.toPlayerId === me && request.fromPlayerId === entry.playerId,
                        );
                        return (
                          <div key={entry.playerId} className="diplomacy-row">
                            <strong>{player.name}</strong>
                            {!allied && !incoming && (
                              <button
                                className="wax-button small"
                                onClick={() =>
                                  sendIntent({
                                    type: "request-alliance",
                                    playerId: me,
                                    targetPlayerId: entry.playerId,
                                  })
                                }
                              >
                                Offer Alliance
                              </button>
                            )}
                            {incoming && (
                              <div className="inline-actions">
                                <button
                                  className="royal-button small"
                                  onClick={() =>
                                    sendIntent({
                                      type: "respond-alliance",
                                      playerId: me,
                                      requestId: incoming.id,
                                      accept: true,
                                    })
                                  }
                                >
                                  Accept
                                </button>
                                <button
                                  className="iron-button small"
                                  onClick={() =>
                                    sendIntent({
                                      type: "respond-alliance",
                                      playerId: me,
                                      requestId: incoming.id,
                                      accept: false,
                                    })
                                  }
                                >
                                  Decline
                                </button>
                              </div>
                            )}
                            {allied && (
                              <button
                                className="iron-button small"
                                onClick={() =>
                                  sendIntent({
                                    type: "break-alliance",
                                    playerId: me,
                                    targetPlayerId: entry.playerId,
                                  })
                                }
                              >
                                Break Pact
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {activeTab === "build" && (
                <div className="panel-body">
                  <h3>Build Yard</h3>
                  {!selectedProvince || selectedProvince.ownerId !== me ? (
                    <p>Select one of your provinces to issue works.</p>
                  ) : (
                    <>
                      <div className="build-summary">
                        <p>
                          <strong>{selectedProvinceMeta?.name ?? selectedProvince.id}</strong> holds{" "}
                          {formatCoins(selectedProvince.coinReserve)}c.
                        </p>
                        <p>Local income: {formatRate(selectedProvinceIncome)}</p>
                        <p>
                          Current works: {selectedProvince.building} Lv.{selectedProvince.buildingLevel}
                        </p>
                        <p className="muted build-note">
                          Each province pays for its own works. Treasury above is the sum across your realm.
                        </p>
                      </div>
                      <div className="build-grid">
                        {(["village", "fort", "tower"] as BuildingKind[]).map((building) => (
                          <button
                            key={building}
                            className="wax-button build-option"
                            disabled={
                              selectedProvince.coinReserve < BALANCE.building[building].upgradeCost ||
                              selectedProvince.building === building
                            }
                            onClick={() =>
                              sendIntent({
                                type: "change-building",
                                playerId: me,
                                provinceId: selectedProvince.id,
                                building,
                              })
                            }
                          >
                            <strong>{building}</strong>
                            <span>Cost {BALANCE.building[building].upgradeCost}c</span>
                            <span>Income {formatRate(provinceIncomePerSecond(building, 1))}</span>
                            <span>Levies {formatRate(provinceLeviesPerSecond(building, 1))}</span>
                            <span>
                              {selectedProvince.building === building
                                ? "Current works"
                                : selectedProvince.coinReserve < BALANCE.building[building].upgradeCost
                                  ? `Need ${Math.ceil(BALANCE.building[building].upgradeCost - selectedProvince.coinReserve)}c more`
                                  : "Refit province"}
                            </span>
                          </button>
                        ))}
                      </div>
                      <button
                        className="royal-button"
                        disabled={
                          selectedProvince.buildingLevel >= BALANCE.maxBuildingLevel ||
                          selectedProvince.coinReserve < selectedProvinceUpgradeCost
                        }
                        onClick={() =>
                          sendIntent({
                            type: "upgrade-building",
                            playerId: me,
                            provinceId: selectedProvince.id,
                          })
                        }
                      >
                        {selectedProvince.buildingLevel >= BALANCE.maxBuildingLevel
                          ? `${selectedProvince.building} is fully upgraded`
                          : `Upgrade ${selectedProvince.building} to Lv.${selectedProvince.buildingLevel + 1} • ${selectedProvinceUpgradeCost}c`}
                      </button>
                    </>
                  )}
                </div>
              )}

              {activeTab === "chronicle" && (
                <div className="panel-body">
                  <h3>Chronicle</h3>
                  <p>Drag from one of your provinces to any adjacent reachable province to send levies.</p>
                  <p>Use alliances to create a coalition, then hold every occupied province for 5 seconds.</p>
                  <p>Forests and hills defend well. Marshes slow movement. Towers make routes faster.</p>
                  <p>Every province keeps its own purse. Villages mint the most coin; the Treasury chip totals the whole realm.</p>
                  <p>Drag open water to pan the realm. Wheel zooms the world map in and out.</p>
                  <p>Coastal provinces can launch ships along glowing sea lanes, letting fleets cut across the realm.</p>
                  <div className="menu-actions">
                    <button className="wax-button" onClick={startTutorial}>
                      Restart Tutorial
                    </button>
                    <button
                      className="iron-button"
                      onClick={() => {
                        connection?.close();
                        setConnection(null);
                        setLobby(null);
                        setSnapshot(null);
                        setTutorialMode(false);
                        setTutorialStep(0);
                        resetMatchUi();
                        setScreen("landing");
                      }}
                    >
                      Return to Landing
                    </button>
                  </div>
                </div>
              )}
            </aside>
          )}

          {snapshot.phase === "finished" && (
            <div className="overlay-screen">
              <div className="parchment-panel result-panel">
                <h2>Throne Claimed</h2>
                <p>
                  {snapshot.winnerCoalition
                    ?.map((playerId) => snapshot.players[playerId]?.name ?? playerId)
                    .join(", ")}{" "}
                  rule the realm.
                </p>
                <p>Troops sent: {snapshot.stats.troopsSent[me] ?? 0}</p>
                <p>Provinces taken: {snapshot.stats.provincesCaptured[me] ?? 0}</p>
                <p>Alliances forged: {snapshot.stats.alliancesFormed}</p>
                <p>Alliances broken: {snapshot.stats.alliancesBroken}</p>
                <button
                  className="royal-button"
                  onClick={() => {
                    connection?.close();
                    setConnection(null);
                    setLobby(null);
                    setSnapshot(null);
                    setTutorialMode(false);
                    setTutorialStep(0);
                    resetMatchUi();
                    setScreen("landing");
                  }}
                >
                  Return to Court
                </button>
              </div>
            </div>
          )}
        </main>
      )}

      {error && (
        <div className="toast-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}
