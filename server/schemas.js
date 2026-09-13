import { z } from 'zod';

const text = z.string().max(12000);
const short = z.string().max(500);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const characterSchema = z.object({ id, name: short, role: short, appearance: text, personality: text });
export const outlineSchema = z.object({
  title: short, logline: text, setting: text, conflict: text, ending: text,
  beats: z.array(z.object({ label: short, text })).min(3).max(6),
});
export const outlineResponse = z.object({ outline: outlineSchema, characters: z.array(characterSchema).min(1).max(6) });
export const proseResponse = z.object({ prose: z.string().min(30).max(24000) });
export const panelSchema = z.object({ title: short, shot: short, scene: text, action: text, mood: text, characterIds: z.array(id).max(6), dialogue: z.string().max(200), caption: z.string().max(200), prompt: text });
export const storyboardResponse = z.object({ panels: z.array(panelSchema).min(1).max(12) });
const asset = z.string().max(300).refine(v => !v || /^\/assets\/[a-f0-9-]+\.(png|jpg|webp)$/.test(v), '图片必须来自本地素材库');
const imageVersion = z.object({ id, image: asset, createdAt: short, prompt: text.optional(), model: short.optional() });
export const projectSchema = z.object({
  id, version: z.literal(2), revision: z.number().int().nonnegative(), title: z.string().min(1).max(160), idea: z.string().max(30000),
  genre: short, tone: short, audience: short, panelCount: z.number().int().min(1).max(12), wordCount: z.number().int().min(100).max(3000),
  styleId: short, customStyle: z.string().max(3000), size: z.enum(['1024x1024', '1536x1024', '1024x1536']), quality: z.enum(['low', 'medium', 'high']),
  layout: z.enum(['grid', 'strip', 'hero']), lettering: z.boolean(), outline: outlineSchema.nullable(), outlineApproved: z.boolean(), prose: z.string().max(30000),
  characters: z.array(characterSchema.extend({ reference: asset, referenceHistory: z.array(imageVersion).max(30) })).max(6),
  panels: z.array(panelSchema.extend({ id, image: asset, history: z.array(imageVersion).max(30), status: z.enum(['idle', 'generating', 'ready', 'error']), error: z.string().max(2000), bubbleX: z.number().min(0).max(80).default(8), bubbleY: z.number().min(0).max(80).default(8) })).max(12),
  createdAt: short, updatedAt: short,
});
export const settingsSchema = z.object({ textModel: z.string().regex(/^gpt-[a-zA-Z0-9._-]+$/).max(100), imageModel: z.string().regex(/^gpt-image-[a-zA-Z0-9._-]+$/).max(100), apiKey: z.string().max(500).optional(), clearKey: z.boolean().optional() });
