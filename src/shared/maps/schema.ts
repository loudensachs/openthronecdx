import { z } from "zod";

export const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const provinceSchema = z.object({
  id: z.string(),
  name: z.string(),
  polygon: z.array(pointSchema).min(3),
  center: pointSchema,
  adjacency: z.array(z.string()),
  terrain: z.enum(["plains", "forest", "hills", "marsh", "water"]),
  building: z.enum(["castle", "village", "fort", "tower"]),
  buildingLevel: z.number().int().min(1).max(3),
  spawnSlot: z.number().int().min(0).nullable(),
  strategicValue: z.number().min(0).max(5),
});

export const mapDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  atmosphere: z.string(),
  provinces: z.array(provinceSchema).min(1),
});

export const rawProvinceSchema = z.object({
  id: z.string(),
  name: z.string(),
  row: z.number().int().min(0),
  col: z.number().int().min(0),
  widthUnits: z.number().int().min(1).default(1),
  heightUnits: z.number().int().min(1).default(1),
  terrain: z.enum(["plains", "forest", "hills", "marsh", "water"]),
  building: z.enum(["castle", "village", "fort", "tower"]),
  buildingLevel: z.number().int().min(1).max(3),
  spawnSlot: z.number().int().min(0).nullable(),
  strategicValue: z.number().min(0).max(5),
});

export const rawMapDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  atmosphere: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  grid: z.object({
    rows: z.number().int().positive(),
    cols: z.number().int().positive(),
    cellWidth: z.number().positive(),
    cellHeight: z.number().positive(),
    inset: z.number().min(0).default(6),
  }),
  provinces: z.array(rawProvinceSchema).min(1),
  blockedEdges: z.array(z.tuple([z.string(), z.string()])).default([]),
  bridgeEdges: z.array(z.tuple([z.string(), z.string()])).default([]),
});

export type MapPoint = z.infer<typeof pointSchema>;
export type ProvinceDefinition = z.infer<typeof provinceSchema>;
export type MapDefinition = z.infer<typeof mapDefinitionSchema>;
export type RawProvinceDefinition = z.infer<typeof rawProvinceSchema>;
export type RawMapDefinition = z.infer<typeof rawMapDefinitionSchema>;
