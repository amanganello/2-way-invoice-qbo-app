import { z } from "zod";

export const SyncStatusSchema = z.enum(["SYNCED", "PENDING", "PROCESSING", "CONFLICT", "ERROR"]);

export const SyncLinksQuerySchema = z.object({
  syncStatus: SyncStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export const SyncLinkParamsSchema = z.object({ id: z.string().min(1) });

export const ResolveConflictSchema = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("accept-internal") }),
  z.object({ strategy: z.literal("accept-qbo") }),
]);

export const QboInitialLoadQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  startPosition: z.coerce.number().int().min(1).default(1),
});
