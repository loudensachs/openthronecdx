import { BANNER_COLORS, CRESTS } from "@shared/config/balance";
import type { PlayerProfile } from "@shared/sim/types";

const STORAGE_KEY = "openthrone.profile";

function randomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomName() {
  const prefixes = ["Ash", "Iron", "Cedar", "Golden", "Storm", "Raven", "High", "Silver"];
  const suffixes = ["keep", "crown", "ford", "march", "ward", "spire", "thorn", "mere"];
  return `${randomItem(prefixes)}${randomItem(suffixes)}`;
}

export function createProfile(): PlayerProfile {
  const sessionId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    sessionId,
    name: randomName(),
    bannerColor: randomItem(BANNER_COLORS),
    crest: randomItem(CRESTS),
    isBot: false,
  };
}

export function loadProfile(): PlayerProfile {
  const cached = localStorage.getItem(STORAGE_KEY);
  if (!cached) {
    const profile = createProfile();
    saveProfile(profile);
    return profile;
  }

  try {
    return JSON.parse(cached) as PlayerProfile;
  } catch {
    const profile = createProfile();
    saveProfile(profile);
    return profile;
  }
}

export function saveProfile(profile: PlayerProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}
