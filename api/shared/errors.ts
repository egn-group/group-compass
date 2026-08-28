// Shared error-response helper for every api/* function.
//
// Raw error text (Prisma/driver messages, connection details, stack-adjacent
// info) must never reach the caller — it leaks how the backend is wired
// together to anyone who can trigger a failure response, authenticated or
// not. Build responses through here so every failure path shares one shape,
// and log the real error server-side instead.

export interface ApiError {
  status: number
  body: string
}

export function errorResponse(status: number, message: string, details?: unknown): ApiError {
  return { status, body: JSON.stringify(details === undefined ? { error: message } : { error: message, details }) }
}

export function serverError(log: (...args: unknown[]) => void, err: unknown): ApiError {
  log(err)
  return errorResponse(500, 'Something went wrong. Please try again.')
}
