import { useEffect, useRef } from "react";
import { Application, Color, Container, Graphics, Text } from "pixi.js";
import type { ProvinceDefinition } from "@shared/maps/schema";
import type { MatchSnapshot } from "@shared/sim/types";

type BattlefieldProps = {
  snapshot: MatchSnapshot;
  me: string | null;
  selectedProvinceId: string | null;
  hoveredProvinceId: string | null;
  sendPreviewTargetId: string | null;
  tutorialHighlights: Array<{ provinceId: string; label: string }>;
  onCameraAction: (action: "pan" | "zoom") => void;
  onProvinceHover: (provinceId: string | null) => void;
  onProvincePointerDown: (provinceId: string) => void;
  onProvincePointerUp: (provinceId: string) => void;
  onEmptyLeftClick: () => void;
};

type CameraState = {
  x: number;
  y: number;
  scale: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
};

type LatestRenderState = Pick<
  BattlefieldProps,
  | "snapshot"
  | "me"
  | "selectedProvinceId"
  | "hoveredProvinceId"
  | "sendPreviewTargetId"
  | "tutorialHighlights"
  | "onCameraAction"
  | "onProvinceHover"
  | "onProvincePointerDown"
  | "onProvincePointerUp"
  | "onEmptyLeftClick"
>;

type ProvinceDisplay = {
  meta: ProvinceDefinition;
  polygon: number[];
  fill: Graphics;
  heraldicOutline: Graphics;
  label: Text;
  sigil: Graphics;
  purse: Text;
};

type SceneGraph = {
  world: Container;
  countryLabels: Text[];
  provinces: Record<string, ProvinceDisplay>;
  routeLayer: Container;
  overlayLayer: Container;
  byId: Record<string, ProvinceDefinition>;
};

const MIN_SCALE = 0.18;
const MAX_SCALE = 2.1;
const CAMERA_PADDING = 20;
const WORLD_LABEL_STYLE = {
  fontFamily: "\"Cinzel\", serif",
  fill: "#f0e0b8",
  align: "center" as const,
  stroke: { color: "#27160d", width: 4 },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function colorForOwner(snapshot: MatchSnapshot, ownerId: string | null) {
  if (!ownerId) return "#5f584d";
  return snapshot.players[ownerId]?.bannerColor ?? "#7c6040";
}

function terrainBaseTint(terrain: string) {
  switch (terrain) {
    case "forest":
      return 0x4b5b42;
    case "hills":
      return 0x71644d;
    case "marsh":
      return 0x596259;
    default:
      return 0x6a6658;
  }
}

function formatProvinceCoins(value: number) {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function blendHex(base: number, overlay: number, amount: number) {
  const clamped = clamp(amount, 0, 1);
  const br = (base >> 16) & 0xff;
  const bg = (base >> 8) & 0xff;
  const bb = base & 0xff;
  const or = (overlay >> 16) & 0xff;
  const og = (overlay >> 8) & 0xff;
  const ob = overlay & 0xff;
  const rr = Math.round(br + (or - br) * clamped);
  const rg = Math.round(bg + (og - bg) * clamped);
  const rb = Math.round(bb + (ob - bb) * clamped);
  return (rr << 16) | (rg << 8) | rb;
}

function pointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-6) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function quadraticPoint(
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
  t: number,
) {
  const mt = 1 - t;
  return {
    x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
    y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
  };
}

function drawSegmentedLine(
  graphics: Graphics,
  points: Array<{ x: number; y: number }>,
  color: number,
  width: number,
  dashLength: number,
  alpha: number,
) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const dashCount = Math.max(1, Math.floor(length / dashLength));
    for (let dash = 0; dash < dashCount; dash += 2) {
      const t1 = dash / dashCount;
      const t2 = Math.min(1, (dash + 1) / dashCount);
      graphics.moveTo(start.x + dx * t1, start.y + dy * t1);
      graphics.lineTo(start.x + dx * t2, start.y + dy * t2);
    }
  }
  graphics.stroke({ color, width, alpha });
}

function seaLaneControl(snapshot: MatchSnapshot, fromProvinceId: string, toProvinceId: string) {
  return snapshot.map.seaLanes.find(
    (lane) => lane.from === fromProvinceId && lane.to === toProvinceId,
  )?.controlPoint ??
    snapshot.map.seaLanes.find(
      (lane) => lane.from === toProvinceId && lane.to === fromProvinceId,
    )?.controlPoint ??
    null;
}

function screenToWorld(camera: CameraState, x: number, y: number) {
  return {
    x: (x - camera.x) / camera.scale,
    y: (y - camera.y) / camera.scale,
  };
}

function canvasPointFromClient(app: Application, clientX: number, clientY: number) {
  const rect = app.canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function viewportSize(app: Application) {
  const rect = app.canvas.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
  };
}

function clampCamera(
  camera: CameraState,
  viewportWidth: number,
  viewportHeight: number,
  snapshot: MatchSnapshot,
) {
  const scaledWidth = snapshot.map.width * camera.scale;
  const scaledHeight = snapshot.map.height * camera.scale;

  if (scaledWidth <= viewportWidth - CAMERA_PADDING * 2) {
    camera.x = (viewportWidth - scaledWidth) / 2;
  } else {
    camera.x = clamp(camera.x, viewportWidth - scaledWidth - CAMERA_PADDING, CAMERA_PADDING);
  }

  if (scaledHeight <= viewportHeight - CAMERA_PADDING * 2) {
    camera.y = (viewportHeight - scaledHeight) / 2;
  } else {
    camera.y = clamp(camera.y, viewportHeight - scaledHeight - CAMERA_PADDING, CAMERA_PADDING);
  }
}

function centerCamera(
  camera: CameraState,
  viewportWidth: number,
  viewportHeight: number,
  snapshot: MatchSnapshot,
) {
  const widthScale = (viewportWidth - CAMERA_PADDING * 2) / snapshot.map.width;
  const heightScale = (viewportHeight - CAMERA_PADDING * 2) / snapshot.map.height;
  camera.scale = clamp(Math.min(widthScale, heightScale, 0.8), MIN_SCALE, MAX_SCALE);
  camera.x = (viewportWidth - snapshot.map.width * camera.scale) / 2;
  camera.y = (viewportHeight - snapshot.map.height * camera.scale) / 2;
  clampCamera(camera, viewportWidth, viewportHeight, snapshot);
}

function provinceAtScreenPoint(
  snapshot: MatchSnapshot,
  camera: CameraState,
  screenX: number,
  screenY: number,
) {
  const worldPoint = screenToWorld(camera, screenX, screenY);
  for (let index = snapshot.map.provinces.length - 1; index >= 0; index -= 1) {
    const province = snapshot.map.provinces[index];
    if (pointInPolygon(worldPoint, province.polygon)) {
      return province.id;
    }
  }
  return null;
}

function destroyContainerChildren(container: Container) {
  const children = container.removeChildren();
  for (const child of children) {
    child.destroy({ children: true });
  }
}

function buildScene(app: Application, snapshot: MatchSnapshot): SceneGraph {
  app.stage.removeChildren().forEach((child) => child.destroy({ children: true }));

  const world = new Container();
  app.stage.addChild(world);

  const background = new Graphics();
  background.rect(0, 0, snapshot.map.width, snapshot.map.height);
  background.fill({ color: 0x0f2c38, alpha: 1 });
  background.stroke({ color: 0xc7a66e, width: 8, alpha: 0.3 });
  world.addChild(background);

  for (let index = 0; index < 28; index += 1) {
    const current = ((index * 127) % snapshot.map.width) + 18;
    const y = ((index * 211) % snapshot.map.height) + 26;
    const swell = new Graphics();
    swell.ellipse(current, y, 30 + (index % 7) * 7, 12 + (index % 4) * 3);
    swell.stroke({ color: 0x86adbb, width: 1, alpha: 0.045 });
    world.addChild(swell);
  }

  snapshot.map.landmasses.forEach((landmass) => {
    const polygon = landmass.polygon.flatMap((point) => [point.x, point.y]);

    const land = new Graphics();
    land.poly(polygon);
    land.fill({ color: 0x4d4b42, alpha: 0.97 });
    land.stroke({ color: 0x2a2219, width: 7, alpha: 0.42 });
    world.addChild(land);

    const coast = new Graphics();
    coast.poly(polygon);
    coast.stroke({ color: 0xc5ae84, width: 3, alpha: 0.55 });
    world.addChild(coast);

    const coastline = new Graphics();
    coastline.poly(polygon);
    coastline.stroke({ color: 0x1d1610, width: 4, alpha: 0.52 });
    world.addChild(coastline);
  });

  const routeLayer = new Container();
  const provinceLayer = new Container();
  const overlayLayer = new Container();
  world.addChild(routeLayer);
  world.addChild(provinceLayer);
  world.addChild(overlayLayer);

  const byId = Object.fromEntries(snapshot.map.provinces.map((province) => [province.id, province]));

  const groupedByCountry = new Map<string, { x: number; y: number; count: number }>();
  snapshot.map.provinces.forEach((province) => {
    const countryGroup = groupedByCountry.get(province.country) ?? { x: 0, y: 0, count: 0 };
    countryGroup.x += province.center.x;
    countryGroup.y += province.center.y;
    countryGroup.count += 1;
    groupedByCountry.set(province.country, countryGroup);
  });

  const countryLabels = Array.from(groupedByCountry.entries()).map(([country, group]) => {
    const label = new Text({
      text: country.toUpperCase(),
      style: {
        ...WORLD_LABEL_STYLE,
        fontSize: 22,
        letterSpacing: 3,
      },
    });
    label.anchor.set(0.5);
    label.position.set(group.x / group.count, group.y / group.count);
    label.alpha = 0.12;
    world.addChild(label);
    return label;
  });

  const provinces: Record<string, ProvinceDisplay> = {};
  snapshot.map.provinces.forEach((province) => {
    const polygon = province.polygon.flatMap((point) => [point.x, point.y]);
    const fill = new Graphics();
    const heraldicOutline = new Graphics();
    const sigil = new Graphics();
    const label = new Text({
      text: "",
      style: {
        fontFamily: "\"Cinzel\", serif",
        fontSize: 14,
        fill: "#fff6e7",
        align: "center",
        stroke: { color: "#24120a", width: 4 },
      },
    });
    label.anchor.set(0.5);
    label.position.set(province.center.x, province.center.y - 6);

    const purse = new Text({
      text: "",
      style: {
        fontFamily: "\"Source Serif 4\", serif",
        fontSize: 11,
        fill: "#f8e6b8",
        align: "center",
        stroke: { color: "#24120a", width: 3 },
      },
    });
    purse.anchor.set(0.5);
    purse.position.set(province.center.x, province.center.y + 39);

    provinceLayer.addChild(fill);
    provinceLayer.addChild(heraldicOutline);
    provinceLayer.addChild(label);
    provinceLayer.addChild(sigil);
    provinceLayer.addChild(purse);

    provinces[province.id] = {
      meta: province,
      polygon,
      fill,
      heraldicOutline,
      label,
      sigil,
      purse,
    };
  });

  return {
    world,
    countryLabels,
    provinces,
    routeLayer,
    overlayLayer,
    byId,
  };
}

function applyCameraToScene(scene: SceneGraph, camera: CameraState) {
  scene.world.position.set(camera.x, camera.y);
  scene.world.scale.set(camera.scale);
}

function updateCountryLabels(scene: SceneGraph, cameraScale: number) {
  for (const label of scene.countryLabels) {
    label.alpha = cameraScale < 0.9 ? 0.14 : 0.08;
    label.scale.set(cameraScale < 0.46 ? 1.18 : cameraScale < 0.7 ? 1.08 : 1);
    label.visible = cameraScale >= 0.2;
  }
}

function updateProvinceDisplays(
  scene: SceneGraph,
  snapshot: MatchSnapshot,
  me: string | null,
  selectedProvinceId: string | null,
  hoveredProvinceId: string | null,
  cameraScale: number,
) {
  for (const province of snapshot.map.provinces) {
    const provinceState = snapshot.provinces[province.id];
    const display = scene.provinces[province.id];
    const isMine = provinceState.ownerId === me;
    const isOwned = Boolean(provinceState.ownerId);
    const ownerTint = Color.shared.setValue(colorForOwner(snapshot, provinceState.ownerId)).toNumber();
    const fillColor = isOwned
      ? blendHex(
          terrainBaseTint(province.terrain),
          ownerTint,
          selectedProvinceId === province.id ? 0.8 : isMine ? 0.68 : 0.52,
        )
      : terrainBaseTint(province.terrain);

    display.fill.clear();
    display.fill.poly(display.polygon);
    display.fill.fill({
      color: fillColor,
      alpha:
        selectedProvinceId === province.id
          ? 0.98
          : isMine
            ? 0.95
            : hoveredProvinceId === province.id
              ? 0.9
              : isOwned
                ? 0.88
                : 0.78,
    });
    display.fill.stroke({
      color:
        selectedProvinceId === province.id
          ? 0xf8ddb2
          : isMine
            ? blendHex(ownerTint, 0xf0d9a7, 0.45)
            : hoveredProvinceId === province.id
              ? 0xe7d1a3
              : isOwned
                ? blendHex(ownerTint, 0x2d1a0d, 0.18)
                : 0x8d7354,
      width:
        selectedProvinceId === province.id
          ? 4.8
          : isMine
            ? 3.8
            : hoveredProvinceId === province.id
              ? 3.2
              : isOwned
                ? 2.6
                : 2.1,
      alpha: 0.95,
    });

    display.heraldicOutline.clear();
    display.heraldicOutline.visible = isMine;
    if (isMine) {
      display.heraldicOutline.poly(display.polygon);
      display.heraldicOutline.stroke({ color: 0xf2dfb4, width: 1.5, alpha: 0.5 });
    }

    const farZoom = cameraScale < 0.36;
    const midZoom = cameraScale < 0.58;
    display.label.visible = !farZoom;
    if (!farZoom) {
      display.label.text = midZoom
        ? `${Math.floor(provinceState.levies)}`
        : `${province.name}\n${Math.floor(provinceState.levies)}`;
      display.label.style.fontSize = midZoom ? 12 : province.id === selectedProvinceId ? 16 : 14;
      display.label.style.fill = isMine ? "#fff7dc" : isOwned ? "#fff1de" : "#d4c5a5";
      display.label.alpha = cameraScale < 0.48 ? 0.82 : 1;
    }

    display.sigil.clear();
    display.sigil.circle(province.center.x, province.center.y + 21, isMine ? 10.5 : 10);
    display.sigil.fill({ color: isOwned ? ownerTint : 0x25140b, alpha: isMine ? 0.9 : 0.82 });
    display.sigil.stroke({ color: isMine ? 0xf4d9a4 : 0xe1c690, width: isMine ? 2.8 : 2 });
    if (province.coastal) {
      display.sigil.moveTo(province.center.x - 5, province.center.y + 21);
      display.sigil.lineTo(province.center.x, province.center.y + 13);
      display.sigil.lineTo(province.center.x + 5, province.center.y + 21);
      display.sigil.stroke({ color: 0x86c7d8, width: 2, alpha: 0.8 });
    }

    display.purse.visible = isMine && cameraScale >= 0.84;
    if (display.purse.visible) {
      display.purse.text = `${formatProvinceCoins(provinceState.coinReserve)}c`;
    }
  }
}

function rebuildRoutesAndOverlay(
  scene: SceneGraph,
  snapshot: MatchSnapshot,
  selectedProvinceId: string | null,
  sendPreviewTargetId: string | null,
  tutorialHighlights: BattlefieldProps["tutorialHighlights"],
) {
  destroyContainerChildren(scene.routeLayer);
  destroyContainerChildren(scene.overlayLayer);

  const seaLaneGlow = new Graphics();
  const seaLaneGraphics = new Graphics();
  scene.routeLayer.addChild(seaLaneGlow);
  scene.routeLayer.addChild(seaLaneGraphics);

  for (const seaLane of snapshot.map.seaLanes) {
    const from = scene.byId[seaLane.from];
    const to = scene.byId[seaLane.to];
    if (!from || !to) continue;
    const curvePoints = Array.from({ length: 13 }, (_, index) =>
      quadraticPoint(from.center, seaLane.controlPoint, to.center, index / 12),
    );
    drawSegmentedLine(seaLaneGlow, curvePoints, 0x9dd2de, 5, 18, 0.06);
    drawSegmentedLine(seaLaneGraphics, curvePoints, 0xd6efe9, 2, 18, 0.18);
  }

  Object.values(snapshot.routes).forEach((route) => {
    const path = route.path.map((provinceId) => scene.byId[provinceId]?.center).filter(Boolean);
    const graphics = new Graphics();
    if (path.length > 1) {
      if (route.mode === "sea" && path.length === 2) {
        const lane = seaLaneControl(snapshot, route.fromProvinceId, route.toProvinceId);
        const control = lane ?? {
          x: (path[0].x + path[1].x) / 2,
          y: (path[0].y + path[1].y) / 2,
        };
        const curvePoints = Array.from({ length: 21 }, (_, index) =>
          quadraticPoint(path[0], control, path[1], index / 20),
        );
        graphics.moveTo(curvePoints[0].x, curvePoints[0].y);
        for (let index = 1; index < curvePoints.length; index += 1) {
          graphics.lineTo(curvePoints[index].x, curvePoints[index].y);
        }
        graphics.stroke({
          color: Color.shared.setValue(colorForOwner(snapshot, route.ownerId)).toNumber(),
          width: 3,
          alpha: 0.72,
        });
        const t = route.progress / route.totalTicks;
        const marker = quadraticPoint(path[0], control, path[1], t);
        graphics.circle(marker.x, marker.y, 8);
        graphics.fill({ color: 0xe8ead6, alpha: 0.95 });
        graphics.moveTo(marker.x - 7, marker.y + 6);
        graphics.lineTo(marker.x, marker.y - 10);
        graphics.lineTo(marker.x + 7, marker.y + 6);
        graphics.fill({
          color: Color.shared.setValue(colorForOwner(snapshot, route.ownerId)).toNumber(),
        });
      } else {
        graphics.moveTo(path[0].x, path[0].y);
        for (let index = 1; index < path.length; index += 1) {
          graphics.lineTo(path[index].x, path[index].y);
        }
        graphics.stroke({
          color: Color.shared.setValue(colorForOwner(snapshot, route.ownerId)).toNumber(),
          width: 4,
          alpha: 0.65,
        });
        const currentStep = Math.min(
          path.length - 1,
          Math.floor((route.progress / route.totalTicks) * (path.length - 1)),
        );
        const marker = path[currentStep];
        graphics.circle(marker.x, marker.y, 6);
        graphics.fill({ color: 0xf6ddb8 });
      }
      scene.routeLayer.addChild(graphics);
    } else {
      graphics.destroy();
    }
  });

  if (selectedProvinceId && sendPreviewTargetId) {
    const from = scene.byId[selectedProvinceId];
    const to = scene.byId[sendPreviewTargetId];
    if (from && to) {
      const preview = new Graphics();
      const lane = seaLaneControl(snapshot, selectedProvinceId, sendPreviewTargetId);
      if (lane && from.coastal && to.coastal) {
        const curvePoints = Array.from({ length: 18 }, (_, index) =>
          quadraticPoint(from.center, lane, to.center, index / 17),
        );
        drawSegmentedLine(preview, curvePoints, 0xe6f4f1, 3, 14, 0.7);
      } else {
        preview.moveTo(from.center.x, from.center.y);
        preview.lineTo(to.center.x, to.center.y);
        preview.stroke({ color: 0xf6ddb8, width: 3, alpha: 0.7 });
      }
      scene.overlayLayer.addChild(preview);
    }
  }

  tutorialHighlights.forEach((highlight) => {
    const province = scene.byId[highlight.provinceId];
    if (!province) return;

    const ring = new Graphics();
    ring.circle(province.center.x, province.center.y, 32);
    ring.stroke({ color: 0xf7e3af, width: 3, alpha: 0.85 });
    ring.circle(province.center.x, province.center.y, 42);
    ring.stroke({ color: 0x6d1f15, width: 2, alpha: 0.45 });
    scene.overlayLayer.addChild(ring);

    const label = new Text({
      text: highlight.label,
      style: {
        fontFamily: "\"Cinzel\", serif",
        fontSize: 13,
        fill: "#fff4dc",
        align: "center",
        stroke: { color: "#24120a", width: 3 },
      },
    });
    label.anchor.set(0.5);
    label.position.set(province.center.x, province.center.y - 44);
    scene.overlayLayer.addChild(label);
  });
}

function updateScene(scene: SceneGraph, latest: LatestRenderState, camera: CameraState) {
  applyCameraToScene(scene, camera);
  updateCountryLabels(scene, camera.scale);
  updateProvinceDisplays(
    scene,
    latest.snapshot,
    latest.me,
    latest.selectedProvinceId,
    latest.hoveredProvinceId,
    camera.scale,
  );
  rebuildRoutesAndOverlay(
    scene,
    latest.snapshot,
    latest.selectedProvinceId,
    latest.sendPreviewTargetId,
    latest.tutorialHighlights,
  );
}

export function PixiBattlefield({
  snapshot,
  me,
  selectedProvinceId,
  hoveredProvinceId,
  sendPreviewTargetId,
  tutorialHighlights,
  onCameraAction,
  onProvinceHover,
  onProvincePointerDown,
  onProvincePointerUp,
  onEmptyLeftClick,
}: BattlefieldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const sceneRef = useRef<SceneGraph | null>(null);
  const hoveredProvinceRef = useRef<string | null>(null);
  const lastMapKeyRef = useRef<string>("");
  const cameraRef = useRef<CameraState>({
    x: 50,
    y: 40,
    scale: 0.8,
    dragging: false,
    lastX: 0,
    lastY: 0,
  });
  const latestRef = useRef<LatestRenderState>({
    snapshot,
    me,
    selectedProvinceId,
    hoveredProvinceId,
    sendPreviewTargetId,
    tutorialHighlights,
    onCameraAction,
    onProvinceHover,
    onProvincePointerDown,
    onProvincePointerUp,
    onEmptyLeftClick,
  });

  latestRef.current = {
    snapshot,
    me,
    selectedProvinceId,
    hoveredProvinceId,
    sendPreviewTargetId,
    tutorialHighlights,
    onCameraAction,
    onProvinceHover,
    onProvincePointerDown,
    onProvincePointerUp,
    onEmptyLeftClick,
  };

  useEffect(() => {
    if (!hostRef.current) return;
    const app = new Application();
    let disposed = false;
    let onWheel: ((event: WheelEvent) => void) | null = null;
    let onPointerDown: ((event: PointerEvent) => void) | null = null;
    let onPointerUp: ((event: PointerEvent) => void) | null = null;
    let onPointerMove: ((event: PointerEvent) => void) | null = null;
    let onPointerLeave: (() => void) | null = null;
    let onContextMenu: ((event: MouseEvent) => void) | null = null;
    let onResize: (() => void) | null = null;
    let hasDragged = false;
    let activeButton: number | null = null;

    void app
      .init({
        resizeTo: hostRef.current,
        antialias: true,
        background: new Color("#25180f"),
        resolution: 1,
      })
      .then(() => {
        if (disposed || !hostRef.current) return;
        hostRef.current.appendChild(app.canvas);
        appRef.current = app;

        const scene = buildScene(app, latestRef.current.snapshot);
        sceneRef.current = scene;
        lastMapKeyRef.current = latestRef.current.snapshot.map.id;

        const camera = cameraRef.current;
        const viewport = viewportSize(app);
        centerCamera(camera, viewport.width, viewport.height, latestRef.current.snapshot);
        updateScene(scene, latestRef.current, camera);

        onWheel = (event: WheelEvent) => {
          event.preventDefault();
          const currentScene = sceneRef.current;
          if (!currentScene) return;
          const { x: screenX, y: screenY } = canvasPointFromClient(app, event.clientX, event.clientY);
          const worldX = (screenX - camera.x) / camera.scale;
          const worldY = (screenY - camera.y) / camera.scale;
          const nextScale = clamp(camera.scale * Math.exp(-event.deltaY * 0.00135), MIN_SCALE, MAX_SCALE);
          if (Math.abs(nextScale - camera.scale) < 0.0001) return;
          camera.scale = nextScale;
          camera.x = screenX - worldX * nextScale;
          camera.y = screenY - worldY * nextScale;
          const nextViewport = viewportSize(app);
          clampCamera(camera, nextViewport.width, nextViewport.height, latestRef.current.snapshot);
          updateScene(currentScene, latestRef.current, camera);
          latestRef.current.onCameraAction("zoom");
        };

        onPointerDown = (event: PointerEvent) => {
          const point = canvasPointFromClient(app, event.clientX, event.clientY);
          activeButton = event.button;

          if (event.button === 0) {
            const provinceId = provinceAtScreenPoint(latestRef.current.snapshot, camera, point.x, point.y);
            if (provinceId) {
              latestRef.current.onProvincePointerDown(provinceId);
            }
            return;
          }

          if (event.button !== 2) return;
          event.preventDefault();
          camera.dragging = true;
          hasDragged = false;
          camera.lastX = point.x;
          camera.lastY = point.y;
          app.canvas.style.cursor = "grabbing";
        };

        onPointerUp = (event?: PointerEvent) => {
          if (activeButton === 0 && event) {
            const point = canvasPointFromClient(app, event.clientX, event.clientY);
            const provinceId = provinceAtScreenPoint(
              latestRef.current.snapshot,
              cameraRef.current,
              point.x,
              point.y,
            );
            if (provinceId) {
              latestRef.current.onProvincePointerUp(provinceId);
            } else {
              latestRef.current.onEmptyLeftClick();
            }
          }
          activeButton = null;
          camera.dragging = false;
          app.canvas.style.cursor = hoveredProvinceRef.current ? "pointer" : "default";
        };

        onPointerMove = (event: PointerEvent) => {
          const rect = app.canvas.getBoundingClientRect();
          const insideCanvas =
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;

          if (camera.dragging) {
            const currentScene = sceneRef.current;
            if (!currentScene) return;
            const point = canvasPointFromClient(app, event.clientX, event.clientY);
            const dx = point.x - camera.lastX;
            const dy = point.y - camera.lastY;
            if (!hasDragged && Math.hypot(dx, dy) > 3) {
              latestRef.current.onCameraAction("pan");
              hasDragged = true;
            }
            camera.x += dx;
            camera.y += dy;
            camera.lastX = point.x;
            camera.lastY = point.y;
            const nextViewport = viewportSize(app);
            clampCamera(camera, nextViewport.width, nextViewport.height, latestRef.current.snapshot);
            applyCameraToScene(currentScene, camera);
            return;
          }

          if (!insideCanvas) {
            if (hoveredProvinceRef.current !== null) {
              hoveredProvinceRef.current = null;
              latestRef.current.onProvinceHover(null);
              app.canvas.style.cursor = "default";
            }
            return;
          }

          const point = canvasPointFromClient(app, event.clientX, event.clientY);
          const nextHoveredProvinceId = provinceAtScreenPoint(
            latestRef.current.snapshot,
            cameraRef.current,
            point.x,
            point.y,
          );
          if (hoveredProvinceRef.current !== nextHoveredProvinceId) {
            hoveredProvinceRef.current = nextHoveredProvinceId;
            latestRef.current.onProvinceHover(nextHoveredProvinceId);
            app.canvas.style.cursor = nextHoveredProvinceId ? "pointer" : "default";
          }
        };

        onPointerLeave = () => {
          if (hoveredProvinceRef.current !== null) {
            hoveredProvinceRef.current = null;
            latestRef.current.onProvinceHover(null);
          }
          if (!camera.dragging) {
            app.canvas.style.cursor = "default";
          }
        };

        onContextMenu = (event: MouseEvent) => event.preventDefault();
        onResize = () => {
          const currentScene = sceneRef.current;
          if (!currentScene) return;
          const nextViewport = viewportSize(app);
          clampCamera(camera, nextViewport.width, nextViewport.height, latestRef.current.snapshot);
          updateScene(currentScene, latestRef.current, camera);
        };

        app.canvas.addEventListener("wheel", onWheel);
        app.canvas.addEventListener("pointerdown", onPointerDown);
        app.canvas.addEventListener("contextmenu", onContextMenu);
        app.canvas.addEventListener("pointerleave", onPointerLeave);
        window.addEventListener("pointerup", onPointerUp as EventListener);
        window.addEventListener("pointermove", onPointerMove as EventListener);
        window.addEventListener("resize", onResize);
      });

    return () => {
      disposed = true;
      if (onWheel) app.canvas.removeEventListener("wheel", onWheel);
      if (onPointerDown) app.canvas.removeEventListener("pointerdown", onPointerDown);
      if (onContextMenu) app.canvas.removeEventListener("contextmenu", onContextMenu);
      if (onPointerLeave) app.canvas.removeEventListener("pointerleave", onPointerLeave);
      if (onPointerUp) window.removeEventListener("pointerup", onPointerUp as EventListener);
      if (onPointerMove) window.removeEventListener("pointermove", onPointerMove as EventListener);
      if (onResize) window.removeEventListener("resize", onResize);
      app.destroy(true, { children: true });
      appRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;

    if (lastMapKeyRef.current !== snapshot.map.id || !sceneRef.current) {
      sceneRef.current = buildScene(app, snapshot);
      lastMapKeyRef.current = snapshot.map.id;
      const viewport = viewportSize(app);
      centerCamera(cameraRef.current, viewport.width, viewport.height, snapshot);
    }

    const scene = sceneRef.current;
    if (!scene) return;
    const viewport = viewportSize(app);
    clampCamera(cameraRef.current, viewport.width, viewport.height, snapshot);
    updateScene(scene, latestRef.current, cameraRef.current);
  }, [snapshot]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    updateScene(scene, latestRef.current, cameraRef.current);
  }, [me, hoveredProvinceId, selectedProvinceId, sendPreviewTargetId, tutorialHighlights]);

  return <div className="battlefield-host" ref={hostRef} />;
}
