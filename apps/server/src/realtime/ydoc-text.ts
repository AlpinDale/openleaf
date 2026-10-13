import type * as Y from 'yjs'

/** Replaces only the differing middle, preserving relative anchors elsewhere. */
export function replaceYText(ytext: Y.Text, next: string) {
  const prev = ytext.toString()
  if (prev === next) return
  let start = 0
  const max = Math.min(prev.length, next.length)
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start))
    start++
  let endPrev = prev.length
  let endNext = next.length
  while (
    endPrev > start &&
    endNext > start &&
    prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)
  ) {
    endPrev--
    endNext--
  }
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--
  if (endPrev < prev.length && isLowSurrogate(prev.charCodeAt(endPrev))) {
    endPrev++
    endNext++
  }
  if (endPrev > start) ytext.delete(start, endPrev - start)
  if (endNext > start) ytext.insert(start, next.slice(start, endNext))
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff
