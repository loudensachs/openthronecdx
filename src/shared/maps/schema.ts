import { z } from "zod";

export const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const provinceSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  continent: z.string(),
  polygon: z.array(pointSchema).min(3),
  center: pointSchema,
  adjacency: z.array(z.string()),
  terrain: z.enum(["plains", "forest", "hills", "marsh", "water"]),
  building: z.enum(["castle", "village", "fort", "tower"]),
  buildingLevel: z.number().int().min(1).max(3),
  spawnSlot: z.number().int().min(0).nullable(),
  strategicValue: z.number().min(0).max(5),
  coastal: z.boolean(),
});

export const landmassSchema = z.object({
  id: z.string(),
  name: z.string(),
  polygon: z.array(pointSchema).min(3),
});

export const seaLaneSchema = z.object({
  from: z.string(),
  to: z.string(),
  controlPoint: pointSchema,
});

export const mapDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  atmosphere: z.string(),
  landmasses: z.array(landmassSchema),
  seaLanes: z.array(seaLaneSchema),
  provinces: z.array(provinceSchema).min(1),
});

export type MapPoint = z.infer<typeof pointSchema>;
export type ProvinceDefinition = z.infer<typeof provinceSchema>;
export type LandmassDefinition = z.infer<typeof landmassSchema>;
export type SeaLaneDefinition = z.infer<typeof seaLaneSchema>;
export type MapDefinition = z.infer<typeof mapDefinitionSchema>;
