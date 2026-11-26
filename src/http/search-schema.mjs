import { z } from 'zod';

export const searchQuery = z.string().trim().min(3).max(240);

export const searchFilterShape = {
  audience: z.enum(['women', 'men', 'kids', 'unisex']).optional(),
  color: z.enum(['black', 'white', 'navy', 'red', 'green', 'blue']).optional(),
  maximumPriceCents: z.number().int().min(0).max(100_000_000).optional(),
};
