import { z } from 'zod'

export function receiveStateMaxBytes(maxProjectStateBytes: number) {
  return Math.ceil((maxProjectStateBytes * 4) / 3) + 8 * 1024 * 1024 + 4096
}

export function receiveStateSchema(maxProjectStateBytes: number) {
  return z
    .object({
      version: z.literal(1),
      beforeHead: z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .nullable(),
      state: z
        .string()
        .regex(/^[A-Za-z0-9+/]*={0,2}$/)
        .max(Math.ceil((maxProjectStateBytes * 4) / 3) + 4),
      clientId: z.number().int().min(0).max(0xffffffff),
      docIdsByPath: z.array(z.tuple([z.string(), z.uuid()])).max(10_000),
      maxProjectStateBytes: z.literal(maxProjectStateBytes),
    })
    .strict()
}
