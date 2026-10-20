import { useEffect, useMemo, useState } from 'react'
import { getMeta } from '@/store'
import { useStore } from '@/store'
import type { Paper } from '@/types'

/** 真题卷列表：优先取导入时写入的 meta，否则从题目反推 */
export function usePapers(): Paper[] {
  const { questions, ready } = useStore()
  const [meta, setMeta] = useState<Paper[]>([])

  useEffect(() => {
    if (!ready) return
    getMeta().then((m) => setMeta(m.papers || []))
  }, [ready])

  return useMemo(() => {
    if (meta.length) return meta
    const map = new Map<string, Paper>()
    for (const q of questions) {
      if (!q.paperId) continue
      const year = Number(q.paperId.replace(/\D/g, '')) || 0
      if (!map.has(q.paperId)) {
        map.set(q.paperId, {
          id: q.paperId,
          name: `${year} 年真题卷`,
          subject: '计算机文化基础',
          year,
          duration: 120,
          totalScore: 100,
          questionIds: [],
        })
      }
      map.get(q.paperId)!.questionIds.push(q.id)
    }
    return [...map.values()].sort((a, b) => b.year - a.year)
  }, [meta, questions])
}
