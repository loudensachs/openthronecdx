import type { RuntimeConfig } from "@shared/sim/types";

function normalizeHost(host: string) {
  if (!host) return "";
  return host.replace(/\/+$/, "");
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const envHost = normalizeHost(import.meta.env.VITE_PARTYKIT_HOST ?? "");
  if (envHost) {
    return { partykitHost: envHost };
  }

  try {
    const response = await fetch("/api/runtime-config");
    if (!response.ok) {
      throw new Error(`runtime-config ${response.status}`);
    }
    const data = (await response.json()) as RuntimeConfig;
    return {
      partykitHost: normalizeHost(data.partykitHost),
    };
  } catch {
    return {
      partykitHost: "http://127.0.0.1:1999",
    };
  }
}

export function wsUrl(baseHost: string, roomId: string) {
  const host = baseHost.replace(/^http/, "ws");
  return `${host}/parties/main/${roomId}`;
}

export function httpRoomUrl(baseHost: string, roomId: string) {
  return `${baseHost}/parties/main/${roomId}`;
}
