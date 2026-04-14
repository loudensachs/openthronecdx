export function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seedInput: string | number) {
  let seed = typeof seedInput === "number" ? seedInput >>> 0 : hashString(seedInput);
  return () => {
    seed += 0x6d2b79f5;
    let result = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBetween(random: () => number, min: number, max: number) {
  return min + (max - min) * random();
}

export function randomInt(random: () => number, min: number, max: number) {
  return Math.floor(randomBetween(random, min, max + 1));
}

export function sample<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}
