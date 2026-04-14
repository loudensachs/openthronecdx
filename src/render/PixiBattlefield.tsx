import { useEffect, useRef } from "react";
import { Application, Color, Container, Graphics, Text } from "pixi.js";
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
  | "selectedProvinceId"
  | "hoveredProvinceId"
  | "sendPreviewTargetId"
  | "tutorialHighlights"
  | "onCameraAction"
  | "onProvinceHover"
  | "onProvincePointerDown"
  | "onProvincePointerUp"
>;

const MIN_SCALE = 0.45;
const MAX_SCALE = 1.55;
const CAMERA_PADDING = 16;
const WORLD_LABEL_STYLE = {
  fontFamily: "\"Cinzel\", serif",
  fill: "#f0e0b8",
  align: "center" as const,
  stroke: { color: "#27160d", width: 4 },
};

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

function seaLaneControl(snapshot: MatchSnapshot, fromProvinceId: string, toProvinceId: string) {
  return snapshot.map.seaLanes.find(
    (lane) => lane.from === fromProvinceId && lane.to === toProvinceId,
  )?.controlPoint ??
    snapshot.map.seaLanes.find(
      (lane) => lane.from === toProvinceId && lane.to === fromProvinceId,
    )?.controlPoint ??
    null;
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
  camera.scale = clamp(Math.min(widthScale, heightScale, 0.84), MIN_SCALE, MAX_SCALE);
  camera.x = (viewportWidth - snapshot.map.width * camera.scale) / 2;
  camera.y = (viewportHeight - snapshot.map.height * camera.scale) / 2;
  clampCamera(camera, viewportWidth, viewportHeight, snapshot);
}

export function PixiBattlefield({
  snapshot,
  selectedProvinceId,
  hoveredProvinceId,
  sendPreviewTargetId,
  tutorialHighlights,
  onCameraAction,
  onProvinceHover,
  onProvincePointerDown,
  onProvincePointerUp,
}: BattlefieldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
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
    selectedProvinceId,
    hoveredProvinceId,
    sendPreviewTargetId,
    tutorialHighlights,
    onCameraAction,
    onProvinceHover,
    onProvincePointerDown,
    onProvincePointerUp,
  });

  latestRef.current = {
    snapshot,
    selectedProvinceId,
    hoveredProvinceId,
    sendPreviewTargetId,
    tutorialHighlights,
    onCameraAction,
    onProvinceHover,
    onProvincePointerDown,
    onProvincePointerUp,
  };

  useEffect(() => {
    if (!hostRef.current) return;
    const app = new Application();
    let disposed = false;
    let onWheel: ((event: WheelEvent) => void) | null = null;
    let onPointerDown: ((event: PointerEvent) => void) | null = null;
    let onPointerUp: (() => void) | null = null;
    let onPointerMove: ((event: PointerEvent) => void) | null = null;
    let onContextMenu: ((event: MouseEvent) => void) | null = null;
    let hasDragged = false;

    void app.init({
      resizeTo: hostRef.current,
      antialias: true,
      background: new Color("#25180f"),
      resolution: 1,
    }).then(() => {
      if (disposed || !hostRef.current) return;
      hostRef.current.appendChild(app.canvas);
      appRef.current = app;

      const camera = cameraRef.current;
      const viewport = viewportSize(app);
      centerCamera(camera, viewport.width, viewport.height, latestRef.current.snapshot);
      onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const { x: screenX, y: screenY } = canvasPointFromClient(
          app,
          event.clientX,
          event.clientY,
        );
        const worldX = (screenX - camera.x) / camera.scale;
        const worldY = (screenY - camera.y) / camera.scale;
        const nextScale = clamp(
          camera.scale * Math.exp(-event.deltaY * 0.0014),
          MIN_SCALE,
          MAX_SCALE,
        );
        if (Math.abs(nextScale - camera.scale) < 0.0001) return;
        camera.scale = nextScale;
        camera.x = screenX - worldX * nextScale;
        camera.y = screenY - worldY * nextScale;
        const nextViewport = viewportSize(app);
        clampCamera(camera, nextViewport.width, nextViewport.height, latestRef.current.snapshot);
        latestRef.current.onCameraAction("zoom");
      };
      onPointerDown = (event: PointerEvent) => {
        const wantsPan = event.button === 2;
        if (!wantsPan) return;
        event.preventDefault();
        const point = canvasPointFromClient(app, event.clientX, event.clientY);
        camera.dragging = true;
        hasDragged = false;
        camera.lastX = point.x;
        camera.lastY = point.y;
        app.canvas.style.cursor = "grabbing";
      };
      onPointerUp = () => {
        camera.dragging = false;
        app.canvas.style.cursor = "default";
      };
      onPointerMove = (event: PointerEvent) => {
        if (!camera.dragging) return;
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
      };
      onContextMenu = (event: MouseEvent) => event.preventDefault();
      app.canvas.addEventListener("wheel", onWheel);
      app.canvas.addEventListener("pointerdown", onPointerDown);
      app.canvas.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointermove", onPointerMove);

      app.ticker.add(() => {
        const latest = latestRef.current;
        const nextViewport = viewportSize(app);
        clampCamera(cameraRef.current, nextViewport.width, nextViewport.height, latest.snapshot);
        renderScene(
          app,
          latest.snapshot,
          latest.selectedProvinceId,
          latest.hoveredProvinceId,
          latest.sendPreviewTargetId,
          latest.tutorialHighlights,
          cameraRef.current,
          latest.onProvinceHover,
          latest.onProvincePointerDown,
          latest.onProvincePointerUp,
        );
      });
    });

    return () => {
      disposed = true;
      if (onWheel) app.canvas.removeEventListener("wheel", onWheel);
      if (onPointerDown) app.canvas.removeEventListener("pointerdown", onPointerDown);
      if (onContextMenu) app.canvas.removeEventListener("contextmenu", onContextMenu);
      if (onPointerUp) window.removeEventListener("pointerup", onPointerUp);
      if (onPointerMove) window.removeEventListener("pointermove", onPointerMove);
      app.destroy(true, { children: true });
      appRef.current = null;
    };
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const viewport = viewportSize(app);
    clampCamera(cameraRef.current, viewport.width, viewport.height, snapshot);
    renderScene(
      app,
      snapshot,
      selectedProvinceId,
      hoveredProvinceId,
      sendPreviewTargetId,
      tutorialHighlights,
      cameraRef.current,
      onProvinceHover,
      onProvincePointerDown,
      onProvincePointerUp,
    );
  }, [
    hoveredProvinceId,
    onProvinceHover,
    onProvincePointerDown,
    onProvincePointerUp,
    selectedProvinceId,
    sendPreviewTargetId,
    tutorialHighlights,
    snapshot,
  ]);

  return <div className="battlefield-host" ref={hostRef} />;
}

function renderScene(
  app: Application,
  snapshot: MatchSnapshot,
  selectedProvinceId: string | null,
  hoveredProvinceId: string | null,
  sendPreviewTargetId: string | null,
  tutorialHighlights: BattlefieldProps["tutorialHighlights"],
  camera: { x: number; y: number; scale: number },
  onProvinceHover: BattlefieldProps["onProvinceHover"],
  onProvincePointerDown: BattlefieldProps["onProvincePointerDown"],
  onProvincePointerUp: BattlefieldProps["onProvincePointerUp"],
) {
  app.stage.removeChildren();
  const now = performance.now();

  const world = new Container();
  world.position.set(camera.x, camera.y);
  world.scale.set(camera.scale);
  app.stage.addChild(world);

  const background = new Graphics();
  background.rect(0, 0, snapshot.map.width, snapshot.map.height);
  background.fill({
    color: 0x0f2c38,
    alpha: 1,
  });
  background.stroke({ color: 0xc7a66e, width: 8, alpha: 0.3 });
  world.addChild(background);

  for (let index = 0; index < 52; index += 1) {
    const current = ((index * 73) % snapshot.map.width) + 18;
    const y = ((index * 131) % snapshot.map.height) + 26;
    const swell = new Graphics();
    swell.ellipse(current, y, 26 + (index % 7) * 5, 10 + (index % 5) * 2);
    swell.stroke({ color: 0x86adbb, width: 1, alpha: 0.05 });
    world.addChild(swell);
  }

  const byId = Object.fromEntries(snapshot.map.provinces.map((province) => [province.id, province]));
  const seaLaneGraphics = new Graphics();
  const seaLaneGlow = new Graphics();
  world.addChild(seaLaneGlow);
  world.addChild(seaLaneGraphics);

  snapshot.map.landmasses.forEach((landmass) => {
    const land = new Graphics();
    const polygon = landmass.polygon.flatMap((point) => [point.x, point.y]);
    land.poly(polygon);
    land.fill({ color: 0x4d4b42, alpha: 0.96 });
    land.stroke({ color: 0x2a2219, width: 7, alpha: 0.42 });
    world.addChild(land);

    const coast = new Graphics();
    coast.poly(polygon);
    coast.stroke({ color: 0xc5ae84, width: 3, alpha: 0.55 });
    world.addChild(coast);
  });

  const groupedByCountry = new Map<string, { x: number; y: number; count: number }>();
  snapshot.map.provinces.forEach((province) => {
    const countryGroup = groupedByCountry.get(province.country) ?? { x: 0, y: 0, count: 0 };
    countryGroup.x += province.center.x;
    countryGroup.y += province.center.y;
    countryGroup.count += 1;
    groupedByCountry.set(province.country, countryGroup);
  });

  groupedByCountry.forEach((group, country) => {
    const label = new Text({
      text: country.toUpperCase(),
      style: {
        ...WORLD_LABEL_STYLE,
        fontSize: camera.scale < 0.72 ? 26 : 22,
        letterSpacing: camera.scale < 0.72 ? 5 : 3,
      },
    });
    label.anchor.set(0.5);
    label.position.set(group.x / group.count, group.y / group.count);
    label.alpha = camera.scale < 0.95 ? 0.14 : 0.08;
    world.addChild(label);
  });

  for (const seaLane of snapshot.map.seaLanes) {
    const from = byId[seaLane.from];
    const to = byId[seaLane.to];
    if (!from || !to) continue;
    const curvePoints = Array.from({ length: 13 }, (_, index) =>
      quadraticPoint(from.center, seaLane.controlPoint, to.center, index / 12),
    );
    drawSegmentedLine(seaLaneGlow, curvePoints, 0x9dd2de, 5, 18, 0.06);
    drawSegmentedLine(seaLaneGraphics, curvePoints, 0xd6efe9, 2, 18, 0.18);
  }

  Object.values(snapshot.routes).forEach((route) => {
    const path = route.path.map((provinceId) => byId[provinceId]?.center).filter(Boolean);
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
    }
    world.addChild(graphics);
  });

  snapshot.map.provinces.forEach((province) => {
    const provinceState = snapshot.provinces[province.id];
    const ownerColor = colorForOwner(snapshot, provinceState.ownerId);
    const ownerTint = Color.shared.setValue(ownerColor).toNumber();
    const fillColor = provinceState.ownerId
      ? blendHex(terrainBaseTint(province.terrain), ownerTint, selectedProvinceId === province.id ? 0.68 : 0.42)
      : terrainBaseTint(province.terrain);
    const graphics = new Graphics();
    const polygon = province.polygon.flatMap((point) => [point.x, point.y]);
    graphics.poly(polygon);
    graphics.fill({
      color: fillColor,
      alpha: selectedProvinceId === province.id ? 0.96 : hoveredProvinceId === province.id ? 0.92 : 0.88,
    });
    graphics.stroke({
      color:
        selectedProvinceId === province.id
          ? 0xf8ddb2
          : hoveredProvinceId === province.id
            ? 0xe7d1a3
            : 0x8d7354,
      width: selectedProvinceId === province.id ? 4.5 : hoveredProvinceId === province.id ? 3.4 : 2.2,
      alpha: 0.95,
    });
    graphics.eventMode = "static";
    graphics.cursor = "pointer";
    graphics.on("pointerover", () => onProvinceHover(province.id));
    graphics.on("pointermove", () => onProvinceHover(province.id));
    graphics.on("pointerout", () => onProvinceHover(null));
    graphics.on("pointerdown", (event) => {
      if (event.button !== 0) return;
      onProvincePointerDown(province.id);
    });
    graphics.on("pointerup", (event) => {
      if (event.button !== 0) return;
      onProvincePointerUp(province.id);
    });
    world.addChild(graphics);

    const label = new Text({
      text:
        camera.scale < 0.7
          ? `${Math.floor(provinceState.levies)}`
          : `${province.name}\n${Math.floor(provinceState.levies)}`,
      style: {
        fontFamily: "\"Cinzel\", serif",
        fontSize:
          camera.scale < 0.7 ? 11 : province.id === selectedProvinceId ? 15 : 13,
        fill: provinceState.ownerId ? "#fff6e7" : "#d4c5a5",
        align: "center",
        stroke: { color: "#24120a", width: 4 },
      },
    });
    label.anchor.set(0.5);
    label.position.set(province.center.x, province.center.y - 6);
    label.alpha = camera.scale < 0.58 ? 0.78 : 1;
    world.addChild(label);

    const sigil = new Graphics();
    sigil.circle(province.center.x, province.center.y + 21, 10);
    sigil.fill({ color: 0x25140b, alpha: 0.82 });
    sigil.stroke({ color: 0xe1c690, width: 2 });
    if (province.coastal) {
      sigil.moveTo(province.center.x - 5, province.center.y + 21);
      sigil.lineTo(province.center.x, province.center.y + 13);
      sigil.lineTo(province.center.x + 5, province.center.y + 21);
      sigil.stroke({ color: 0x86c7d8, width: 2, alpha: 0.8 });
    }
    world.addChild(sigil);
  });

  if (selectedProvinceId && sendPreviewTargetId) {
    const from = byId[selectedProvinceId];
    const to = byId[sendPreviewTargetId];
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
      world.addChild(preview);
    }
  }

  snapshot.map.landmasses.forEach((landmass) => {
    const coastline = new Graphics();
    coastline.poly(landmass.polygon.flatMap((point) => [point.x, point.y]));
    coastline.stroke({ color: 0x1d1610, width: 4, alpha: 0.52 });
    world.addChild(coastline);
  });

  const pulse = 1 + Math.sin(now / 220) * 0.14;
  tutorialHighlights.forEach((highlight) => {
    const province = byId[highlight.provinceId];
    if (!province) return;
    const ring = new Graphics();
    ring.circle(province.center.x, province.center.y, 30 * pulse);
    ring.stroke({ color: 0xf7e3af, width: 3, alpha: 0.85 });
    ring.circle(province.center.x, province.center.y, 40 * pulse);
    ring.stroke({ color: 0x6d1f15, width: 2, alpha: 0.45 });
    world.addChild(ring);

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
    label.position.set(province.center.x, province.center.y - 42);
    world.addChild(label);
  });
}
