import { z } from 'zod'
import { RoleSchema } from './user'

export const GetMeResponseSchema = z.object({
  email: z.string().email(),
  // Null alongside roles: [] when the caller has signed in but has no User
  // row yet (not bootstrapped) — a real, expected state, not an error.
  name: z.string().nullable(),
  initials: z.string().nullable(),
  roles: z.array(RoleSchema),
})
export type GetMeResponse = z.infer<typeof GetMeResponseSchema>
