import { describe, expect, it } from "vitest";
import { MAPS } from "@shared/maps";

describe("map pack", () => {
  it("ships the three intended maps with the planned province counts", () => {
    const counts = Object.fromEntries(MAPS.map((map) => [map.id, map.provinces.length]));
    expect(counts["crownfall"]).toBe(40);
    expect(counts["thornmarch"]).toBe(48);
    expect(counts["ashen-strait"]).toBe(44);
  });

  it("keeps adjacency symmetric", () => {
    for (const map of MAPS) {
      const byId = Object.fromEntries(map.provinces.map((province) => [province.id, province]));
      for (const province of map.provinces) {
        for (const adjacentId of province.adjacency) {
          expect(byId[adjacentId].adjacency).toContain(province.id);
        }
      }
    }
  });
});
