// Short-TTL, browser-only cache for GET endpoints — every response here is
// scoped to the authenticated caller's role (and, for the Chair/NA
// endpoints, viewAsEmail), so `private` (never a shared/CDN cache) is
// required. The window matches the client's react-query `staleTime`
// (src/main.tsx) so the two caching layers behave consistently.
export const SHORT_PRIVATE_CACHE = { 'Cache-Control': 'private, max-age=20' }
