import { z } from 'zod'

export const GetMeResponseSchema = z.object({
  email: z.string().email(),
})
export type GetMeResponse = z.infer<typeof GetMeResponseSchema>
