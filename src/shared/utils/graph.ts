export function breadthFirstPath(
  start: string,
  target: string,
  adjacency: Record<string, string[]>,
  allow: (nodeId: string, isTarget: boolean) => boolean,
): string[] | null {
  const queue: string[] = [start];
  const cameFrom = new Map<string, string | null>([[start, null]]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === target) {
      const path: string[] = [];
      let node: string | null = current;
      while (node) {
        path.unshift(node);
        node = cameFrom.get(node) ?? null;
      }
      return path;
    }

    for (const next of adjacency[current] ?? []) {
      if (cameFrom.has(next)) continue;
      if (!allow(next, next === target)) continue;
      cameFrom.set(next, current);
      queue.push(next);
    }
  }

  return null;
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
