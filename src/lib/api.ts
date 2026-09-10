export async function apiGet<T>(url: string, notOkMessage: string, headers?: HeadersInit): Promise<T> {
  // no-store: freshness is react-query's job (staleTime + invalidateQueries
  // after every mutation), not the browser's HTTP cache. The two used to
  // coexist via a matching Cache-Control max-age on the API, but that let
  // the browser's cache silently serve a pre-mutation response to the very
  // fetch() invalidateQueries triggers to get a fresh one — e.g. Reassign
  // saving successfully but the list/detail still showing the old Chair/NA
  // for up to 20s. Bypassing the browser cache here makes react-query's
  // in-memory cache the single source of truth for read freshness.
  const res = await fetch(url, { headers, cache: 'no-store' })
  if (!res.ok) throw new Error(`${notOkMessage} (${res.status}).`)
  return res.json() as Promise<T>
}
