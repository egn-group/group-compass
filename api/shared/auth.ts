// Server-side identity + role resolution, shared by every api/* function.
//
// SWA (Azure Static Web Apps) authenticates the caller at its edge and, for a
// managed Functions deployment like this one (api/ inside the same SWA
// resource), is the only way to reach these functions. SWA itself sets the
// x-ms-client-principal header after validating the Entra ID token,
// overwriting anything a client tries to send — so this header is a
// trustworthy source of "who is calling", unlike anything in the request
// body.
//
// Role is NOT part of that header — it lives in our own User table. So
// authorization is two steps: decode the header to get the caller's email,
// then look that email up ourselves. Never trust a role field sent in a
// request body.

import type { HttpRequest } from '@azure/functions'
import { PrismaClient, type User } from '@prisma/client'
import { errorResponse, type ApiError } from './errors'

export const prisma = new PrismaClient()

export interface Principal {
  userId: string | null
  email: string
}

/** Decode the SWA-injected client principal header, or null if missing/malformed. */
export function getPrincipal(req: HttpRequest): Principal | null {
  const header = req.headers?.['x-ms-client-principal']
  if (!header) return null
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf-8')
    const principal = JSON.parse(decoded) as { userId?: string; userDetails?: string }
    if (!principal?.userDetails) return null
    return { userId: principal.userId ?? null, email: principal.userDetails.toLowerCase() }
  } catch {
    return null
  }
}

/** Guard: caller must be authenticated. Returns a response to short-circuit with, or null if OK. */
export function requireAuth(req: HttpRequest): ApiError | null {
  if (!getPrincipal(req)) return errorResponse(401, 'Not authenticated.')
  return null
}

/** Look up a User by email (case-insensitive — emails are stored lowercased). */
export function getUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } })
}

/** Guard: caller must be an Admin per their own stored User record. */
export function requireAdmin(user: Pick<User, 'roles'> | null): ApiError | null {
  if (!user?.roles.includes('Admin')) return errorResponse(403, 'Admin access required.')
  return null
}

/** Guard: caller must be a Network Advisor per their own stored User record. */
export function requireNetworkAdvisor(user: Pick<User, 'roles'> | null): ApiError | null {
  if (!user?.roles.includes('NetworkAdvisor')) return errorResponse(403, 'Network Advisor access required.')
  return null
}

/** Guard: caller must be an Admin or Chair Leader per their own stored User record. */
export function requireAdminOrChairLeader(user: Pick<User, 'roles'> | null): ApiError | null {
  if (!user?.roles.includes('Admin') && !user?.roles.includes('ChairLeader')) {
    return errorResponse(403, 'Admin or Chair Leader access required.')
  }
  return null
}

/** Guard: caller must be a Chair per their own stored User record. */
export function requireChair(user: Pick<User, 'roles'> | null): ApiError | null {
  if (!user?.roles.includes('Chair')) return errorResponse(403, 'Chair access required.')
  return null
}
