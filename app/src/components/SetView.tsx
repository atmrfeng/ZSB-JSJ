import { useMemo, useState } from 'react'
import { Runner } from './Runner'
import { QuestionStatic } from './QuestionView'
import { CHAPTERS, TYPE_ORDER, TYPE_LABEL } from '@/lib/chapters'
import { cn } from '@/lib/utils'
import type { Question, QuestionType } from '@/types'

interface Props {
  title: string
  desc: string
  questions: Question[]
  emptyText: string
}

export function SetView({ title, desc, questions, emptyText }: Props) {
  const [running, setRunning] = useState(false)
  const [recite, setRecite] = useState(false)
  const [chapter, setChapter] = useState('all')
  const [types, setTypes] = useState<QuestionType[]>([...TYPE_ORDER])

  const pool = useMemo(
    () =>
      questions.filter((q) => {
        if (chapter !== 'all' && q.chapterId !== chapter) return false
        if (!types.includes(q.type)) return false
        return true
      }),
    [questions, chapter, types],
  )

  if (running) {
    return (
      <Runner
        questions={pool}
        title={title}
        mode="practice"
        scope={title}
        scopeName={title}
        onExit={() => setRunning(false)}
      />
    )
  }

  if (recite) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">背题模式 · {pool.length} 题</div>
          <button onClick={() => setRecite(false)} className="text-sm text-blue-600">
            返回
          </button>
        </div>
        {pool.map((q, i) => (
          <QuestionStatic key={q.id} q={q} index={i} showAnswer />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="text-sm text-slate-500">{desc}</p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <Chip active={chapter === 'all'} onClick={() => setChapter('all')}>
          全部章节
        </Chip>
        {CHAPTERS.map((c) => (
          <Chip key={c.id} active={chapter === c.id} onClick={() => setChapter(c.id)}>
            {c.no}、{c.name}
          </Chip>
        ))}
        <span className="mx-1 w-px bg-slate-200" />
        {TYPE_ORDER.map((t) => (
          <Chip
            key={t}
            active={types.includes(t)}
            onClick={() =>
              setTypes((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))
            }
          >
            {TYPE_LABEL[t]}
          </Chip>
        ))}
      </div>

      {pool.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {emptyText}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setRunning(true)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              重练（{pool.length} 题）
            </button>
            <button
              onClick={() => setRecite(true)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              背题模式
            </button>
          </div>
          <div className="space-y-3">
            {pool.slice(0, 30).map((q, i) => (
              <QuestionStatic key={q.id} q={q} index={i} showAnswer />
            ))}
          </div>
          {pool.length > 30 && (
            <div className="text-center text-xs text-slate-400">
              仅预览前 30 题，点击「重练」可完整练习
            </div>
          )}
        </>
      )}
    </div>
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
