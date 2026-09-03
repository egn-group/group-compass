export async function apiGet<T>(url: string, notOkMessage: string, headers?: HeadersInit): Promise<T> {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${notOkMessage} (${res.status}).`)
  return res.json() as Promise<T>
}
