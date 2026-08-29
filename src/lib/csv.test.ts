import { describe, expect, it } from 'vitest'
import { decodeUtf8Strict, headerIndex, parseCsv, sniffDelimiter } from './csv'

function toBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer
}

describe('decodeUtf8Strict', () => {
  it('decodes valid UTF-8', () => {
    const result = decodeUtf8Strict(toBuffer('hello æøå'))
    expect(result.ok).toBe(true)
    expect(result.text).toBe('hello æøå')
  })

  it('strips a leading BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('hello')])
    const result = decodeUtf8Strict(withBom.buffer)
    expect(result.ok).toBe(true)
    expect(result.bom).toBe(true)
    expect(result.text).toBe('hello')
  })

  it('rejects invalid UTF-8 (e.g. a Windows-1252 export) instead of mangling it', () => {
    // 0xE6 alone is not valid UTF-8 (it's 'æ' in Windows-1252, but starts a
    // 3-byte UTF-8 sequence that never completes here).
    const bad = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0xe6])
    const result = decodeUtf8Strict(bad.buffer)
    expect(result.ok).toBe(false)
    expect(result.byteVal).toBe(0xe6)
  })
})

describe('sniffDelimiter', () => {
  it('detects semicolon-delimited headers (the real export format)', () => {
    expect(sniffDelimiter('"EGN Group Name";"EGN Group Id";"Partner Code"\n"a";"1";"DK"')).toBe(';')
  })

  it('detects comma-delimited headers', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',')
  })
})

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a;b;c\n1;2;3\n', ';')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('handles embedded delimiters and newlines inside quoted fields', () => {
    const text = 'name;profile\n"Group A";"Line one; still same field\nLine two"\n'
    expect(parseCsv(text, ';')).toEqual([
      ['name', 'profile'],
      ['Group A', 'Line one; still same field\nLine two'],
    ])
  })

  it('unescapes doubled quotes inside a quoted field', () => {
    expect(parseCsv('a\n"she said ""hi"""\n', ';')).toEqual([['a'], ['she said "hi"']])
  })

  it('drops blank trailing lines', () => {
    expect(parseCsv('a;b\n1;2\n\n', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('headerIndex', () => {
  it('maps header names to column positions', () => {
    expect(headerIndex(['EGN Group Name', 'EGN Group Id'])).toEqual({ 'EGN Group Name': 0, 'EGN Group Id': 1 })
  })

  it('strips a leading BOM character from the first header', () => {
    expect(headerIndex(['﻿EGN Group Name'])).toEqual({ 'EGN Group Name': 0 })
  })
})
