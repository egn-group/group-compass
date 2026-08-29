// Ported from prototypes/group-dna-live-prototype/public/import-groups.html
// (itself ported from prototypes/Data Import Prototype.html) — real, already
// exercised against the real Salesforce export sample
// (prototypes/DK-Groups-export-UTF8-sample.csv). Logic kept as close to the
// original as possible; only typed and split into named functions.

export interface Utf8DecodeResult {
  ok: boolean
  text: string
  bom: boolean
  bytePos: number
  byteVal: number
  sample: string
}

/** Strict UTF-8 decode — fails (rather than silently mangling) on invalid bytes. */
export function decodeUtf8Strict(buf: ArrayBuffer): Utf8DecodeResult {
  const b = new Uint8Array(buf)
  const off = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0
  const v = b.subarray(off)
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(v), bom: off > 0, bytePos: -1, byteVal: 0, sample: '' }
  } catch {
    let pos = -1
    let val = 0
    const loose = new TextDecoder('utf-8').decode(v)
    const bad = loose.indexOf('�')
    for (let i = 0; i < v.length; i++) {
      if (v[i] >= 0x80) {
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(v.subarray(i, Math.min(i + 4, v.length)))
        } catch {
          pos = i + off
          val = v[i]
          break
        }
      }
    }
    return { ok: false, text: '', bom: off > 0, bytePos: pos, byteVal: val, sample: bad >= 0 ? loose.substr(Math.max(0, bad - 30), 70) : '' }
  }
}

/** Sniffs the delimiter from the header line (semicolon, comma, or tab). */
export function sniffDelimiter(text: string): string {
  let line = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') inQuotes = !inQuotes
    if (!inQuotes && (c === '\n' || c === '\r')) break
    line += c
  }
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 }
  inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && c in counts) counts[c]++
  }
  let best = ';'
  let n = -1
  for (const d of Object.keys(counts)) {
    if (counts[d] > n) {
      n = counts[d]
      best = d
    }
  }
  return n > 0 ? best : ';'
}

/** Quote-aware CSV parser — handles embedded delimiters/newlines inside quoted fields. */
export function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === delim) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''))
}

/** Maps a header row to column index, stripping a leading BOM if present. */
export function headerIndex(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {}
  header.forEach((h, i) => {
    idx[String(h ?? '').replace(/^﻿/, '').trim()] = i
  })
  return idx
}
