import { z } from "zod";

export const Uuid = z.string().uuid();
export const Money = z.number().or(z.string()).pipe(z.coerce.number());
export const IsoDate = z.string().datetime({ offset: true });

export const Pagination = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type Pagination = z.infer<typeof Pagination>;

export const SuccessOnly = z.object({ success: z.literal(true) });
