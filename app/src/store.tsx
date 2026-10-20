import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Attempt, Question, QuestionRecord, Settings } from '@/types'
import {
  attemptRepo,
  DEFAULT_SETTINGS,
  loadSettings,
  questionRepo,
  recordRepo,
  saveSettings,
} from '@/lib/db'
import { classifyChapter } from '@/lib/chapters'
import { hashStem } from '@/lib/dedupe'
import type { ParsedQuestion } from '@/lib/parser'

interface ImportOptions {
  source: string
  chapterId?: string
  paperId?: string
  batchId?: string
}

interface StoreValue {
  ready: boolean
  questions: Question[]
  records: Record<string, QuestionRecord>
  attempts: Attempt[]
  settings: Settings
  byId: (id: string) => Question | undefined
  recordAnswer: (qid: string, answer: string[], correct: boolean) => void
  toggleFavorite: (qid: string) => void
  setMastered: (qid: string, v: boolean) => void
  finishSession: (a: Omit<Attempt, 'id'>) => void
  importQuestions: (parsed: ParsedQuestion[], o: ImportOptions) => { added: number; skipped: number }
  deleteQuestions: (ids: string[]) => void
  deleteBySource: (source: string) => void
  updateQuestion: (q: Question) => void
  updateSettings: (s: Partial<Settings>) => void
  resetAll: () => Promise<void>
  clearAttempts: () => Promise<void>
}

const StoreCtx = createContext<StoreValue | null>(null)

/**
 * 修正图片路径的 BASE_URL。
 *
 * seed-bank.json 里的图片路径（如 /data/img/zhenti/image2.jpeg）是相对站点根的绝对路径，
 * 在 GitHub Pages 部署到子路径（如 https://xxx.github.io/sdzkb/）下会解析成 404。
 * 这里把根相对路径转换为跟 `import.meta.env.BASE_URL` 兼容的形式：
 *   - 「/data/img/x.jpg」→ 「./data/img/x.jpg」（base='./'）或「data/img/x.jpg」
 *   - 「http://...」「data:...」「./...」原样保留
 *   - 「/absolute-non-data」一律加 base 前缀
 */
function fixImageBase(images: string[]): string[] {
  const base = import.meta.env.BASE_URL || './'
  // base 通常是 './' 或 '/repo-name/'
  // 把 /data/... 转换成 「./data/...」对历史数据兼容；对 base='/repo/' 则是 '/repo/data/...'
  const strip = base.replace(/\/$/, '')
  const prefix = base === './' ? './' : `${strip}/`
  return images.map((src) => {
    if (!src) return src
    if (src.startsWith('data:')) return src
    if (src.startsWith('http://') || src.startsWith('https://')) return src
    if (src.startsWith('//')) return src
    if (src.startsWith('/')) {
      // 根相对 → 加 Vite base 前缀
      return `${prefix}${src.slice(1)}`
    }
    return src
  })
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [questions, setQuestions] = useState<Question[]>([])
  const [records, setRecords] = useState<Record<string, QuestionRecord>>({})
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  const seedIfEmpty = useCallback(async () => {
    const n = await questionRepo.count()
    if (n > 0) return
    const base = import.meta.env.BASE_URL || './'
    const res = await fetch(`${base}data/seed-bank.json`)
    if (!res.ok) return
    const data = await res.json()
    const now = Date.now()
    const qs: Question[] = (data.questions || []).map((q: Question) => ({
      ...q,
      chapterId: q.chapterId || classifyChapter(q.stem),
      images: Array.isArray(q.images) ? fixImageBase(q.images as string[]) : [],
      createdAt: now,
    }))
    await questionRepo.save(qs)
    const meta = await getMeta()
    await putMeta({ ...meta, papers: data.papers || [],
      seeded: true,
      imagesVersion: 3,
    })
  }, [])

  /** 给老版本构建的种子题库补图 + 清理无具体名称的考点 tag + 修正图片 BASE_URL */
  const patchSeedImages = useCallback(async () => {
    const meta = await getMeta()
    const SCHEMA = 3  // 1 = 图片补图；2 = 图片 + tag 净化（清除「考点N」「附加题」「XX 操作题」）；3 = 加图片 BASE_URL 归一化
    if ((meta.imagesVersion || 0) >= SCHEMA) return
    const base = import.meta.env.BASE_URL || './'
    const res = await fetch(`${base}data/seed-bank.json`)
    if (!res.ok) return
    const data = await res.json()
    const imgs = new Map<string, string[]>()
    for (const q of data.questions || []) {
      if (Array.isArray(q.images) && q.images.length && q.id) {
        imgs.set(q.id, fixImageBase(q.images as string[]))
      }
    }
    try {
      const all = await questionRepo.all()
      let dirty = false
      for (const q of all) {
        // 1) 老数据缺图：用 seed-bank.json 补
        if (!q.images?.length && imgs.has(q.id)) {
          q.images = imgs.get(q.id) as string[]
          q.hasImageRef = true
          dirty = true
        }
        // 1.5) 老数据图是绝对路径「/data/img/...」，部署到 GitHub Pages 子路径下会 404
        const fixed = q.images?.length
          ? fixImageBase(q.images as string[])
          : q.images
        if (fixed && q.images && fixed.some((v, i) => v !== q.images?.[i])) {
          q.images = fixed
          dirty = true
        }
        // 2) 老数据带「考点N」「附加题」「XX 操作题」类占位 tag：清空
        const tags = q.tags || []
        const cleaned = tags.filter(
          (t) => !/^考点\d/.test(t) && t !== '附加题' && !t.endsWith('操作题'),
        )
        if (cleaned.length !== tags.length) {
          q.tags = cleaned
          dirty = true
        }
      }
      if (dirty) await questionRepo.save(all)
      await putMeta({ ...meta, imagesVersion: SCHEMA })
    } catch (e) {
      console.error('补图/清理 tags 失败', e)
    }
  }, [])

  const refresh = useCallback(async () => {
    const [qs, rs, as, st] = await Promise.all([
      questionRepo.all(),
      recordRepo.all(),
      attemptRepo.all(),
      loadSettings(),
    ])
    setQuestions(qs)
    setRecords(Object.fromEntries(rs.map((r) => [r.qid, r])))
    setAttempts(as.sort((a, b) => b.finishedAt - a.finishedAt))
    setSettings(st)
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        await seedIfEmpty()
        await patchSeedImages()
        await refresh()
      } catch (e) {
        console.error('初始化失败', e)
      } finally {
        setReady(true)
      }
    })()
  }, [refresh, seedIfEmpty, patchSeedImages])

  const byId = useCallback((id: string) => questions.find((q) => q.id === id), [questions])

  const recordAnswer = useCallback(
    (qid: string, answer: string[], correct: boolean) => {
      setRecords((prev) => {
        const old = prev[qid] || {
          qid,
          seen: 0,
          wrong: 0,
          favorited: false,
          mastered: false,
          lastAnswer: [],
        }
        const next: QuestionRecord = {
          ...old,
          seen: old.seen + 1,
          wrong: old.wrong + (correct ? 0 : 1),
          lastAt: Date.now(),
          lastWrongAt: correct ? old.lastWrongAt : Date.now(),
          lastAnswer: answer,
          mastered: correct ? true : false,
        }
        void recordRepo.save([next])
        return { ...prev, [qid]: next }
      })
    },
    [],
  )

  const toggleFavorite = useCallback((qid: string) => {
    setRecords((prev) => {
      const old = prev[qid] || {
        qid,
        seen: 0,
        wrong: 0,
        favorited: false,
        mastered: false,
        lastAnswer: [],
      }
      const next = { ...old, favorited: !old.favorited }
      void recordRepo.save([next])
      return { ...prev, [qid]: next }
    })
  }, [])

  const setMastered = useCallback((qid: string, v: boolean) => {
    setRecords((prev) => {
      const old = prev[qid] || {
        qid,
        seen: 0,
        wrong: 0,
        favorited: false,
        mastered: false,
        lastAnswer: [],
      }
      const next = { ...old, mastered: v }
      void recordRepo.save([next])
      return { ...prev, [qid]: next }
    })
  }, [])

  const finishSession = useCallback((a: Omit<Attempt, 'id'>) => {
    const item: Attempt = { ...a, id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }
    setAttempts((prev) => {
      void attemptRepo.save([item])
      return [item, ...prev]
    })
  }, [])

  const importQuestions = useCallback(
    (parsed: ParsedQuestion[], o: ImportOptions) => {
      const now = Date.now()
      const incoming: Question[] = []
      let skipped = 0
      const seenInBatch = new Set<string>()
      for (const p of parsed) {
        const id = hashStem(p.stem)
        if (!p.stem) continue
        if (questions.some((q) => q.id === id) || seenInBatch.has(id)) {
          skipped++
          continue
        }
        seenInBatch.add(id)
        incoming.push({
          id,
          type: p.type,
          stem: p.stem,
          options: p.options,
          answer: p.answer,
          explanation: p.explanation,
          material: p.material,
          chapterId: o.chapterId || classifyChapter(p.stem + p.material),
          tags: p.tags,
          source: o.source,
          sourceRef: p.no ? `第${p.no}题` : '',
          paperId: o.paperId,
          blankCount: p.blankCount || 1,
          confidence: p.answer.length ? 'high' : 'low',
          images: p.images || [],
          hasImageRef: p.hasImageRef || Boolean(p.images?.length),
          batchId: o.batchId,
          createdAt: now,
        })
      }
      if (incoming.length) {
        setQuestions((prev) => [...incoming, ...prev])
        void questionRepo.save(incoming)
      }
      return { added: incoming.length, skipped }
    },
    [questions],
  )

  const deleteQuestions = useCallback((ids: string[]) => {
    const set = new Set(ids)
    setQuestions((prev) => prev.filter((q) => !set.has(q.id)))
    void questionRepo.remove(ids)
  }, [])

  const deleteBySource = useCallback((source: string) => {
    setQuestions((prev) => {
      const ids = prev.filter((q) => q.source === source).map((q) => q.id)
      void questionRepo.remove(ids)
      return prev.filter((q) => q.source !== source)
    })
  }, [])

  const updateQuestion = useCallback((q: Question) => {
    setQuestions((prev) => prev.map((x) => (x.id === q.id ? q : x)))
    void questionRepo.save([q])
  }, [])

  const updateSettings = useCallback((s: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...s }
      void saveSettings(next)
      return next
    })
  }, [])

  const resetAll = useCallback(async () => {
    await questionRepo.clear()
    await recordRepo.clear()
    await attemptRepo.clear()
    setQuestions([])
    setRecords({})
    setAttempts([])
    await seedIfEmpty()
    await refresh()
  }, [refresh, seedIfEmpty])

  const clearAttempts = useCallback(async () => {
    await attemptRepo.clear()
    setAttempts([])
    await recordRepo.clear()
    setRecords({})
  }, [])

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      questions,
      records,
      attempts,
      settings,
      byId,
      recordAnswer,
      toggleFavorite,
      setMastered,
      finishSession,
      importQuestions,
      deleteQuestions,
      deleteBySource,
      updateQuestion,
      updateSettings,
      resetAll,
      clearAttempts,
    }),
    [
      ready,
      questions,
      records,
      attempts,
      settings,
      byId,
      recordAnswer,
      toggleFavorite,
      setMastered,
      finishSession,
      importQuestions,
      deleteQuestions,
      deleteBySource,
      updateQuestion,
      updateSettings,
      resetAll,
      clearAttempts,
    ],
  )

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore(): StoreValue {
  const v = useContext(StoreCtx)
  if (!v) throw new Error('useStore 必须在 StoreProvider 内使用')
  return v
}

// ---------- meta 辅助（试卷列表） ----------
import { STORE_META, getOne, putOne } from '@/lib/db'
import type { Paper } from '@/types'

export interface MetaShape {
  key: string
  papers?: Paper[]
  seeded?: boolean
  /** 题库配图补丁版本，用于给已入库的旧数据补图 */
  imagesVersion?: number
}

export async function getMeta(): Promise<MetaShape> {
  const m = await getOne<MetaShape>(STORE_META, 'bank')
  return m || { key: 'bank' }
}

export async function putMeta(m: MetaShape): Promise<void> {
  await putOne(STORE_META, m)
}
