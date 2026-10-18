import { z } from 'zod';
const text = z.string().max(200);
export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,199}$/);
export const idsSchema = z.array(idSchema).min(1).max(30000);
export const categorySchema = z.array(z.string().trim().min(1).max(80)).max(8);
export const tagsSchema = z.array(z.string().trim().min(1).max(80)).max(100).transform(v => [...new Set(v)]);
export const patchSchema = z.object({
  title: text.nullable().optional(), category: categorySchema.nullable().optional(),
  tags: tagsSchema.nullable().optional(), addTags: tagsSchema.optional(), removeTags: tagsSchema.optional(),
  favorite: z.boolean().optional(), reset: z.boolean().optional(),
}).strict();
export const scanModeSchema = z.enum(['all', 'latest']);
export const importOptionsSchema = z.object({ scanMode: scanModeSchema }).strict();
export const settingsSchema = z.object({ theme: z.enum(['dark', 'light', 'duel']).optional(), gamePath: z.string().max(32768).optional(), volume: z.number().min(0).max(1).optional(), onboardingComplete: z.boolean().optional(), scanMode: scanModeSchema.optional() }).strict();
export const engineRecordSchema = z.object({
  id: idSchema, mediaId: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  title: z.string().max(1000), originalName: z.string().max(1000), kind: z.enum(['sfx','music','voice']),
  form: text, category: categorySchema, tags: tagsSchema, duration: z.number().finite().min(0),
  sampleRate: z.number().int().min(0).max(768000), channels: z.number().int().min(0).max(64),
  peaks: z.array(z.number().finite().min(0).max(1)).max(4096), status: z.enum(['ready','unavailable','failed']),
  description: z.string().max(20000), relativePath: z.string().regex(/^assets\/audio\/[a-f0-9]{64}\.wav$/).nullable(), bytes: z.number().int().min(0),
  sources: z.array(z.object({ key: z.string().max(2000), bundle: z.string().max(2000), account: text, payloadHash: z.string().max(128) })).max(5000),
});
export const backupSchema = z.object({ schemaVersion: z.literal(1), libraryId: z.string(), categories: z.array(categorySchema).max(5000), records: z.array(z.object({ id: idSchema, patch: patchSchema })).max(100000) });
