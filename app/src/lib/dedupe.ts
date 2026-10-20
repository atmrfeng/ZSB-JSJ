/** 重复题目检测：精确哈希 + 二元组相似度 */
import type { Question } from '@/types'
import { normalizeForHash, type ParsedQuestion } from './parser'

/** FNV-1a 32bit ×2 → 16 位十六进制 */
export function hashStem(stem: string): string {
  const s = normalizeForHash(stem)
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 = (h2 + Math.imul(c + i, 0x85ebca6b)) >>> 0
    h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>()
  if (s.length < 2) {
    if (s) set.add(s)
    return set
  }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}

/** Dice 系数，0~1 */
export function similarity(a: string, b: string): number {
  const sa = bigrams(normalizeForHash(a))
  const sb = bigrams(normalizeForHash(b))
  if (!sa.size || !sb.size) return 0
  let inter = 0
  for (const g of sa) if (sb.has(g)) inter++
  return (2 * inter) / (sa.size + sb.size)
}

export interface DupMatch {
  index: number
  existing: Question
  similar: number
  exact: boolean
}

/**
 * 检测待入库题目与已有题库的重复情况。
 * exact === true 表示题干完全一致；similar >= 0.82 视为疑似重复。
 */
export function detectDuplicates(
  parsed: ParsedQuestion[],
  existing: Question[],
): Map<number, DupMatch> {
  const result = new Map<number, DupMatch>()
  const byHash = new Map<string, Question>()
  for (const q of existing) byHash.set(q.id, q)

  parsed.forEach((p, i) => {
    const h = hashStem(p.stem)
    const hit = byHash.get(h)
    if (hit) {
      result.set(i, { index: i, existing: hit, similar: 1, exact: true })
      return
    }
    let best: Question | null = null
    let bestScore = 0
    const head = normalizeForHash(p.stem).slice(0, 60)
    if (head.length >= 12) {
      for (const q of existing) {
        if (q.type !== p.type) continue
        const s = similarity(p.stem, q.stem)
        if (s > bestScore) {
          bestScore = s
          best = q
        }
      }
    }
    if (best && bestScore >= 0.82) {
      result.set(i, { index: i, existing: best, similar: bestScore, exact: false })
    }
  })
  return result
}
