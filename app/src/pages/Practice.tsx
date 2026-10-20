import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { CHAPTERS, TYPE_ORDER, TYPE_LABEL } from '@/lib/chapters'
import { Runner } from '@/components/Runner'
import { QuestionStatic } from '@/components/QuestionView'
import { cn } from '@/lib/utils'
import { navigate } from '@/lib/router'
import type { QuestionType } from '@/types'

type PickMode = 'first' | 'random' | 'pick'

export default function Practice({ chapter: initChapter }: { chapter?: string }) {
  const { questions, settings } = useStore()
  const [chapter, setChapter] = useState<string>(initChapter || 'all')
  const [types, setTypes] = useState<QuestionType[]>([...TYPE_ORDER])
  const [pickMode, setPickMode] = useState<PickMode>('first')
  const [limit, setLimit] = useState<number>(0)
  const [customLimit, setCustomLimit] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [recite, setRecite] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const pool = useMemo(() => {
    return questions.filter((q) => {
      if (chapter !== 'all' && q.chapterId !== chapter) return false
      if (!types.includes(q.type)) return false
      return true
    })
  }, [questions, chapter, types])

  // 不同模式下的待做题目
  const list = useMemo(() => {
    if (pickMode === 'pick') {
      return pool.filter((q) => picked.has(q.id))
    }
    let arr = [...pool]
    if (pickMode === 'random') arr = shuffle(arr)
    if (limit > 0) arr = arr.slice(0, limit)
    return arr
  }, [pool, pickMode, limit, picked])

  // 默认全选所有 pool
  useEffect(() => {
    if (pickMode === 'pick' && picked.size === 0 && pool.length) {
      setPicked(new Set(pool.map((q) => q.id)))
    }
  }, [pickMode, pool, picked.size])

  // 切换章节/题型时清空 picked 避免遗留旧 id
  useEffect(() => {
    setPicked(new Set())
  }, [chapter, types])

  if (recite) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">背题模式 · {list.length} 题</div>
          <button onClick={() => setRecite(false)} className="text-sm text-blue-600">
            返回筛选
          </button>
        </div>
        {list.map((q, i) => (
          <QuestionStatic key={q.id} q={q} index={i} showAnswer />
        ))}
      </div>
    )
  }

  if (running) {
    return (
      <Runner
        questions={list}
        title="章节练习"
        mode="practice"
        scope={chapter}
        scopeName={chapter === 'all' ? '全部章节' : CHAPTERS.find((c) => c.id === chapter)?.name || ''}
        onExit={() => setRunning(false)}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">章节练习</h1>
        <p className="text-sm text-slate-500">
          按考纲章节与考点筛选题目；支持自定义题量、选题作答、即时判分
        </p>
      </div>

      <Section title="选择章节">
        <div className="flex flex-wrap gap-2">
          <Chip active={chapter === 'all'} onClick={() => setChapter('all')}>
            全部
          </Chip>
          {CHAPTERS.map((c) => (
            <Chip
              key={c.id}
              active={chapter === c.id}
              onClick={() => setChapter(c.id)}
            >
              {c.no}、{c.name}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="题型">
        <div className="flex flex-wrap gap-2">
          {TYPE_ORDER.map((t) => (
            <Chip
              key={t}
              active={types.includes(t)}
              onClick={() =>
                setTypes((prev) =>
                  prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                )
              }
            >
              {TYPE_LABEL[t]}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="出题方式">
        <div className="flex flex-wrap gap-2">
          <Chip active={pickMode === 'first'} onClick={() => setPickMode('first')}>
            顺序出题
          </Chip>
          <Chip active={pickMode === 'random'} onClick={() => setPickMode('random')}>
            随机抽题
          </Chip>
          <Chip active={pickMode === 'pick'} onClick={() => setPickMode('pick')}>
            选题作答
          </Chip>
        </div>
      </Section>

      {pickMode !== 'pick' && (
        <Section title="题量">
          <div className="flex flex-wrap items-center gap-2">
            {[0, 10, 20, 50].map((n) => (
              <Chip key={n} active={limit === n} onClick={() => setLimit(n)}>
                {n === 0 ? '全部' : `${n} 题`}
              </Chip>
            ))}
            <div className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs">
              <span className="text-slate-500">自定义：</span>
              <input
                type="number"
                min={1}
                max={pool.length || 9999}
                value={customLimit}
                onChange={(e) => {
                  const v = e.target.value
                  setCustomLimit(v)
                  const n = parseInt(v, 10)
                  if (!isNaN(n) && n > 0) setLimit(Math.min(n, pool.length || 9999))
                }}
                placeholder="任意题数"
                className="w-20 border-none bg-transparent text-xs outline-none"
              />
              <span className="text-slate-400">题</span>
            </div>
          </div>
        </Section>
      )}

      {pickMode === 'pick' && (
        <Section title={`选择题（已选 ${picked.size} / ${pool.length}）`}>
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              onClick={() => setPicked(new Set(pool.map((q) => q.id)))}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              全选
            </button>
            <button
              onClick={() => setPicked(new Set())}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              全不选
            </button>
            <button
              onClick={() => {
                const half = Math.ceil(pool.length / 2)
                setPicked(new Set(pool.slice(0, half).map((q) => q.id)))
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              选前一半
            </button>
            <button
              onClick={() =>
                setPicked(
                  new Set(
                    shuffle(pool)
                      .slice(0, Math.min(20, pool.length))
                      .map((q) => q.id),
                  ),
                )
              }
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              随机选 20
            </button>
            <span className="ml-auto text-xs text-slate-500">已选 {picked.size} 题</span>
          </div>
          <div className="max-h-80 space-y-1.5 overflow-auto rounded-md border border-slate-100 bg-slate-50/50 p-2">
            {pool.map((q, i) => (
              <label
                key={q.id}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-white',
                  picked.has(q.id) ? 'bg-white' : 'opacity-70',
                )}
              >
                <input
                  type="checkbox"
                  checked={picked.has(q.id)}
                  onChange={() =>
                    setPicked((prev) => {
                      const n = new Set(prev)
                      if (n.has(q.id)) n.delete(q.id)
                      else n.add(q.id)
                      return n
                    })
                  }
                  className="mt-0.5"
                />
                <span className="w-6 shrink-0 text-slate-400">{i + 1}.</span>
                <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                  {TYPE_LABEL[q.type]}
                </span>
                <span className="line-clamp-1 flex-1 text-slate-700">{q.stem}</span>
              </label>
            ))}
            {pool.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-400">当前筛选无题目</div>
            )}
          </div>
        </Section>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          当前筛选：<b className="text-blue-600">{pool.length}</b> 题
          <span className="text-slate-400">·</span>
          将出卷：<b className="text-emerald-600">{list.length}</b> 题
          {pickMode === 'random' && list.length > 0 && (
            <span className="text-slate-400">（已打乱）</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={!list.length}
            onClick={() => setRunning(true)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
          >
            开始答题（{list.length}）
          </button>
          <button
            disabled={!list.length}
            onClick={() => setRecite(true)}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            背题模式（{list.length}）
          </button>
          <button
            onClick={() => navigate('')}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            返回首页
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          立即反馈模式当前：
          <b className={cn(settings.immediateFeedback ? 'text-emerald-600' : 'text-slate-500')}>
            {settings.immediateFeedback ? '已开启' : '未开启'}
          </b>
          。可在「设置」中切换。
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2.5 text-sm font-semibold text-slate-700">{title}</h2>
      {children}
    </section>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition',
        active
          ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
          : 'border-slate-200 text-slate-600 hover:border-slate-300',
      )}
    >
      {children}
    </button>
  )
}

/** Fisher–Yates 洗牌（轻量） */
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}