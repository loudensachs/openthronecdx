import { useEffect, useRef } from "react";
import { Application, Color, Container, Graphics, Text } from "pixi.js";
import type { MapDefinition } from "@shared/maps/schema";
import type { MatchSnapshot } from "@shared/sim/types";

type BattlefieldProps = {
  snapshot: MatchSnapshot;
  me: string | null;
  selectedProvinceId: string | null;
  hoveredProvinceId: string | null;
  sendPreviewTargetId: string | null;
  onProvinceHover: (provinceId: string | null, clientX: number, clientY: number) => void;
  onProvincePointerDown: (provinceId: string) => void;
  onProvincePointerUp: (provinceId: string) => void;
};

const DEFAULT_COLORS = ["#d6c29b", "#a7815f", "#8a6a47"];

function colorForOwner(snapshot: MatchSnapshot, ownerId: string | null) {
  if (!ownerId) return "#5f584d";
  return snapshot.players[ownerId]?.bannerColor ?? "#7c6040";
}

export function PixiBattlefield({
  snapshot,
  me,
  selectedProvinceId,
  hoveredProvinceId,
  sendPreviewTargetId,
  onProvinceHover,
  onProvincePointerDown,
  onProvincePointerUp,
}: BattlefieldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const cameraRef = useRef({ x: 50, y: 40, scale: 0.8, dragging: false, lastX: 0, lastY: 0 });

  useEffect(() => {
    if (!hostRef.current) return;
    const app = new Application();
    let disposed = false;
    let onWheel: ((event: WheelEvent) => void) | null = null;
    let onPointerDown: ((event: PointerEvent) => void) | null = null;
    let onPointerUp: (() => void) | null = null;
    let onPointerMove: ((event: PointerEvent) => void) | null = null;

    void app.init({
      resizeTo: hostRef.current,
      antialias: true,
      background: new Color("#25180f"),
      resolution: window.devicePixelRatio || 1,
    }).then(() => {
      if (disposed || !hostRef.current) return;
      hostRef.current.appendChild(app.canvas);
      appRef.current = app;

      const camera = cameraRef.current;
      onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const delta = event.deltaY > 0 ? -0.08 : 0.08;
        camera.scale = Math.min(1.5, Math.max(0.45, camera.scale + delta));
      };
      onPointerDown = (event: PointerEvent) => {
        camera.dragging = true;
        camera.lastX = event.clientX;
        camera.lastY = event.clientY;
      };
      onPointerUp = () => {
        camera.dragging = false;
      };
      onPointerMove = (event: PointerEvent) => {
        if (!camera.dragging) return;
        const dx = event.clientX - camera.lastX;
        const dy = event.clientY - camera.lastY;
        camera.x += dx;
        camera.y += dy;
        camera.lastX = event.clientX;
        camera.lastY = event.clientY;
      };
      app.canvas.addEventListener("wheel", onWheel);
      app.canvas.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointermove", onPointerMove);

      app.ticker.add(() => {
        renderScene(
          app,
          snapshot,
          selectedProvinceId,
          hoveredProvinceId,
          sendPreviewTargetId,
          cameraRef.current,
          onProvinceHover,
          onProvincePointerDown,
          onProvincePointerUp,
        );
      });
    });

    return () => {
      disposed = true;
      if (onWheel) app.canvas.removeEventListener("wheel", onWheel);
      if (onPointerDown) app.canvas.removeEventListener("pointerdown", onPointerDown);
      if (onPointerUp) window.removeEventListener("pointerup", onPointerUp);
      if (onPointerMove) window.removeEventListener("pointermove", onPointerMove);
      app.destroy(true, { children: true });
      appRef.current = null;
    };
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    renderScene(
      app,
      snapshot,
      selectedProvinceId,
      hoveredProvinceId,
      sendPreviewTargetId,
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
    snapshot,
    me,
  ]);

  return <div className="battlefield-host" ref={hostRef} />;
}

function renderScene(
  app: Application,
  snapshot: MatchSnapshot,
  selectedProvinceId: string | null,
  hoveredProvinceId: string | null,
  sendPreviewTargetId: string | null,
  camera: { x: number; y: number; scale: number },
  onProvinceHover: BattlefieldProps["onProvinceHover"],
  onProvincePointerDown: BattlefieldProps["onProvincePointerDown"],
  onProvincePointerUp: BattlefieldProps["onProvincePointerUp"],
) {
  app.stage.removeChildren();

  const world = new Container();
  world.position.set(camera.x, camera.y);
  world.scale.set(camera.scale);
  app.stage.addChild(world);

  const background = new Graphics();
  background.rect(0, 0, snapshot.map.width, snapshot.map.height);
  background.fill({ color: 0x3a2619 });
  background.stroke({ color: 0x5d4330, width: 10 });
  world.addChild(background);

  for (let index = 0; index < 24; index += 1) {
    const grain = new Graphics();
    grain.circle(
      ((index * 71) % snapshot.map.width) + 20,
      ((index * 131) % snapshot.map.height) + 20,
      2 + (index % 5),
    );
    grain.fill({ color: index % 2 === 0 ? 0x4e3624 : 0x65462d, alpha: 0.12 });
    world.addChild(grain);
  }

  const byId = Object.fromEntries(snapshot.map.provinces.map((province) => [province.id, province]));

  Object.values(snapshot.routes).forEach((route) => {
    const path = route.path.map((provinceId) => byId[provinceId]?.center).filter(Boolean);
    const graphics = new Graphics();
    if (path.length > 1) {
      graphics.moveTo(path[0].x, path[0].y);
      for (let index = 1; index < path.length; index += 1) {
        graphics.lineTo(path[index].x, path[index].y);
      }
      graphics.stroke({ color: Color.shared.setValue(colorForOwner(snapshot, route.ownerId)).toNumber(), width: 4, alpha: 0.65 });
      const currentStep = Math.min(path.length - 1, Math.floor((route.progress / route.totalTicks) * (path.length - 1)));
      const marker = path[currentStep];
      graphics.circle(marker.x, marker.y, 6);
      graphics.fill({ color: 0xf6ddb8 });
    }
    world.addChild(graphics);
  });

  snapshot.map.provinces.forEach((province) => {
    const provinceState = snapshot.provinces[province.id];
    const ownerColor = colorForOwner(snapshot, provinceState.ownerId);
    const graphics = new Graphics();
    const polygon = province.polygon.flatMap((point) => [point.x, point.y]);
    graphics.poly(polygon);
    graphics.fill({
      color: Color.shared.setValue(ownerColor).toNumber(),
      alpha:
        selectedProvinceId === province.id
          ? 0.92
          : hoveredProvinceId === province.id
            ? 0.78
            : provinceState.ownerId
              ? 0.66
              : 0.38,
    });
    graphics.stroke({
      color: selectedProvinceId === province.id ? 0xf8ddb2 : 0x3a2416,
      width: selectedProvinceId === province.id ? 5 : 2,
      alpha: 1,
    });
    graphics.eventMode = "static";
    graphics.cursor = "pointer";
    graphics.on("pointerover", (event) => onProvinceHover(province.id, event.global.x, event.global.y));
    graphics.on("pointerout", (event) => onProvinceHover(null, event.global.x, event.global.y));
    graphics.on("pointerdown", () => onProvincePointerDown(province.id));
    graphics.on("pointerup", () => onProvincePointerUp(province.id));
    world.addChild(graphics);

    const label = new Text({
      text: `${province.name}\n${Math.floor(provinceState.levies)}`,
      style: {
        fontFamily: "\"Cinzel\", serif",
        fontSize: province.id === selectedProvinceId ? 15 : 13,
        fill: provinceState.ownerId ? "#fff6e7" : "#d4c5a5",
        align: "center",
        stroke: { color: "#24120a", width: 3 },
      },
    });
    label.anchor.set(0.5);
    label.position.set(province.center.x, province.center.y - 6);
    world.addChild(label);

    const sigil = new Graphics();
    sigil.circle(province.center.x, province.center.y + 21, 10);
    sigil.fill({ color: 0x25140b, alpha: 0.82 });
    sigil.stroke({ color: 0xe1c690, width: 2 });
    world.addChild(sigil);
  });

  if (selectedProvinceId && sendPreviewTargetId) {
    const from = byId[selectedProvinceId];
    const to = byId[sendPreviewTargetId];
    if (from && to) {
      const preview = new Graphics();
      preview.moveTo(from.center.x, from.center.y);
      preview.lineTo(to.center.x, to.center.y);
      preview.stroke({ color: 0xf6ddb8, width: 3, alpha: 0.7 });
      world.addChild(preview);
    }
  }
}
