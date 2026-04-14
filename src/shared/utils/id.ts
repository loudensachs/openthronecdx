let localCounter = 0;

export function createId(prefix: string): string {
  localCounter += 1;
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${localCounter}`;
}

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}
