/** 判分引擎：支持山东专升本特有的「多选少选扣 1 分」规则 */
import type { Question } from '@/types'

export interface GradeOutcome {
  correct: boolean
  score: number
  fullScore: number
  /** 主观题需要用户自评 */
  needSelfCheck: boolean
}

export function normalizeAnswer(s: string): string {
  return (s || '')
    .replace(/\s+/g, '')
    .replace(/[，,。.；;：:！!？?（）()【】\[\]「」“”"'’‘]/g, '')
    .toLowerCase()
}

/** 拆分可接受的多种写法：「Delete 或 Delete from」→ ['Delete','Delete from'] */
export function expandVariants(s: string): string[] {
  const parts = (s || '')
    .split(/\s*(?:或|\/|、|；)\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
  return parts.length ? parts : [s || '']
}

export function gradeQuestion(
  q: Question,
  user: string[],
  multiMode: 'sd' | 'strict' = 'sd',
): GradeOutcome {
  const fullScore = q.type === 'multi' ? 2 : q.type === 'operation' ? 2 : 1
  const base = { fullScore, needSelfCheck: false }

  if (q.type === 'single' || q.type === 'judge') {
    const userAns = (user[0] || '').trim()
    const correctAns = (q.answer[0] || '').trim()
    // 用户未作答 或 标准答案为空（待校对题）都按 0 分处理
    if (!userAns || !correctAns) {
      return { ...base, correct: false, score: 0 }
    }
    const ok = normalizeAnswer(userAns) === normalizeAnswer(correctAns)
    return { ...base, correct: ok, score: ok ? fullScore : 0 }
  }

  if (q.type === 'multi') {
    const correctSet = (q.answer || []).filter(Boolean)
    const userSet = (user || []).filter(Boolean)
    const extra = userSet.filter((u) => !correctSet.includes(u))
    if (extra.length) return { ...base, correct: false, score: 0 }
    const missing = correctSet.length - new Set(userSet).size
    if (missing <= 0) return { ...base, correct: true, score: fullScore }
    if (multiMode === 'sd') {
      // 山东规则：少选一个扣 1 分
      const score = Math.max(0, fullScore - missing)
      return { ...base, correct: false, score }
    }
    return { ...base, correct: false, score: 0 }
  }

  if (q.type === 'fill') {
    const n = Math.max(1, q.blankCount || q.answer.length || 1)
    let matched = 0
    for (let i = 0; i < n; i++) {
      const variants = expandVariants(q.answer[i] || '').map(normalizeAnswer)
      const u = normalizeAnswer(user[i] || '')
      if (u && variants.includes(u)) matched++
    }
    const correct = matched === n
    return {
      ...base,
      correct,
      score: Math.round((fullScore * matched) / n * 100) / 100,
      needSelfCheck: true,
    }
  }

  // 操作题：有选项时客观判分，无选项（简答/SQL）时自评
  if (q.options && q.options.length) {
    const userAns = (user[0] || '').trim()
    const correctAns = (q.answer[0] || '').trim()
    if (!userAns || !correctAns) {
      return { ...base, correct: false, score: 0, needSelfCheck: true }
    }
    const ok = normalizeAnswer(userAns) === normalizeAnswer(correctAns)
    return { ...base, correct: ok, score: ok ? fullScore : 0, needSelfCheck: true }
  }
  return { ...base, correct: false, score: 0, needSelfCheck: true }
}
