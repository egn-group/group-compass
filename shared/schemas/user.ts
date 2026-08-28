import { z } from 'zod'

// Must stay in sync with the Role enum in api/prisma/schema.prisma.
export const RoleSchema = z.enum(['Admin', 'Chair', 'NetworkAdvisor', 'ChairLeader', 'SalesLeader'])
export type RoleValue = z.infer<typeof RoleSchema>

export const UpsertUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  initials: z.string().min(1),
  roles: z.array(RoleSchema).min(1),
})
export type UpsertUserInput = z.infer<typeof UpsertUserSchema>

export const UserSchema = z.object({
  email: z.string().email(),
  name: z.string(),
  initials: z.string(),
  roles: z.array(RoleSchema),
})
export type UserDto = z.infer<typeof UserSchema>
