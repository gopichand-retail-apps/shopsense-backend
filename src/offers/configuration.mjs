import { z } from 'zod';

const configurationSchema = z.object({
  maxAgeMinutes: z.coerce.number().int().min(1).max(10_080).default(1440),
});

export function readOfferConfiguration(environment = process.env) {
  return configurationSchema.parse({
    maxAgeMinutes: environment.SHOPSENSE_AVAILABILITY_MAX_AGE_MINUTES,
  });
}
