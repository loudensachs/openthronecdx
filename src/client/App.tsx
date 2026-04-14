import { useEffect, useMemo, useState } from "react";
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

type Screen = "landing" | "multiplayer" | "skirmish" | "match";
type Tab = "kingdom" | "diplomacy" | "build" | "chronicle";

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
  const [hoverPoint, setHoverPoint] = useState({ x: 0, y: 0 });
  const [sendPreviewTargetId, setSendPreviewTargetId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("kingdom");
  const [paused, setPaused] = useState(false);

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
  const hoveredProvince = snapshot && hoveredProvinceId ? snapshot.provinces[hoveredProvinceId] : null;
  const hoveredProvinceMeta = snapshot?.map.provinces.find((province) => province.id === hoveredProvinceId) ?? null;

  const ownedProvinceIds = useMemo(
    () =>
      snapshot
        ? Object.values(snapshot.provinces)
            .filter((province) => province.ownerId === me)
            .map((province) => province.id)
        : [],
    [me, snapshot],
  );

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
    const nextConnection = connectPartyRoom(runtimeHost, roomId, profile, wireHandlers());
    setConnection(nextConnection);
    setLobby(null);
    setSnapshot(null);
    setScreen("multiplayer");
  }

  function startSkirmish() {
    const nextConnection = connectSkirmish(profile, desiredBots, selectedMapId, wireHandlers());
    setConnection(nextConnection);
    setScreen("match");
  }

  function sendIntent(intent: ClientIntent) {
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

  const selectedMap = MAPS.find((map) => map.id === selectedMapId) ?? MAPS[0];
  const myScore = snapshot?.scoreboard.find((entry) => entry.playerId === me) ?? null;
  const alliancePartners = snapshot?.alliances.filter((alliance) => alliance.players.includes(me)) ?? [];

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
            <div className="top-chip">Coins {myScore?.coins ?? 0}</div>
            <div className="top-chip">Tick {snapshot.tick}</div>
          </div>

          <PixiBattlefield
            snapshot={snapshot}
            me={me}
            selectedProvinceId={selectedProvinceId}
            hoveredProvinceId={hoveredProvinceId}
            sendPreviewTargetId={sendPreviewTargetId}
            onProvinceHover={(provinceId, x, y) => {
              setHoveredProvinceId(provinceId);
              setHoverPoint({ x, y });
              if (selectedProvinceId && provinceId) {
                setSendPreviewTargetId(provinceId);
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
            <div className="hover-card parchment-float" style={{ left: hoverPoint.x + 20, top: hoverPoint.y + 20 }}>
              <strong>{hoveredProvinceMeta.name}</strong>
              <span>{hoveredProvinceMeta.terrain}</span>
              <span>Levies {Math.floor(hoveredProvince.levies)}</span>
              <span>{hoveredProvince.building} Lv.{hoveredProvince.buildingLevel}</span>
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
                  <div className="scoreboard-list">
                    {snapshot.scoreboard.map((entry) => (
                      <div key={entry.playerId} className="score-row">
                        <span>{snapshot.players[entry.playerId]?.name ?? entry.playerId}</span>
                        <span>{entry.provinces} lands</span>
                        <span>{entry.levies} levies</span>
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
                      <p>
                        Province {selectedProvince.id} holds {Math.floor(selectedProvince.coinReserve)} coin.
                      </p>
                      <div className="build-grid">
                        {(["village", "fort", "tower"] as BuildingKind[]).map((building) => (
                          <button
                            key={building}
                            className="wax-button"
                            onClick={() =>
                              sendIntent({
                                type: "change-building",
                                playerId: me,
                                provinceId: selectedProvince.id,
                                building,
                              })
                            }
                          >
                            {building}
                          </button>
                        ))}
                      </div>
                      <button
                        className="royal-button"
                        onClick={() =>
                          sendIntent({
                            type: "upgrade-building",
                            playerId: me,
                            provinceId: selectedProvince.id,
                          })
                        }
                      >
                        Upgrade {selectedProvince.building} to Lv.{selectedProvince.buildingLevel + 1}
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
                  <div className="menu-actions">
                    <button
                      className="iron-button"
                      onClick={() => {
                        connection?.close();
                        setConnection(null);
                        setLobby(null);
                        setSnapshot(null);
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
