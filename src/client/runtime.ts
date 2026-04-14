import type { RuntimeConfig } from "@shared/sim/types";

const FALLBACK_PARTYKIT_HOST = "https://openthronecdx.loudensachs.partykit.dev";

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
    if (!normalizeHost(data.partykitHost)) {
      return {
        partykitHost: FALLBACK_PARTYKIT_HOST,
      };
    }
    return {
      partykitHost: normalizeHost(data.partykitHost),
    };
  } catch {
    return {
      partykitHost:
        typeof window !== "undefined" && window.location.hostname === "localhost"
          ? "http://127.0.0.1:1999"
          : FALLBACK_PARTYKIT_HOST,
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
