import { useMemo, useState } from 'react'
import { useStore } from '@/store'
import { Runner } from '@/components/Runner'
import { CHAPTERS, TYPE_LABEL } from '@/lib/chapters'
import { cn } from '@/lib/utils'
import type { Question, QuestionType } from '@/types'

/** 山东真题标准结构 */
const STRUCTURE: Array<{ type: QuestionType; count: number; score: number }> = [
  { type: 'single', count: 20, score: 1 },
  { type: 'multi', count: 10, score: 2 },
  { type: 'judge', count: 10, score: 1 },
  { type: 'fill', count: 5, score: 2 },
  { type: 'operation', count: 10, score: 3 },
]

export default function Exam() {
  const { questions } = useStore()
  const [chapter, setChapter] = useState('all')
  const [running, setRunning] = useState(false)

  const paper = useMemo(() => {
    const base = questions.filter(
      (q) => chapter === 'all' || q.chapterId === chapter,
    )
    const picked: Question[] = []
    for (const s of STRUCTURE) {
      const arr = base.filter((q) => q.type === s.type)
      const shuffled = shuffle(arr).slice(0, s.count)
      picked.push(...shuffled)
    }
    return picked
  }, [questions, chapter, running])

  if (running) {
    return (
      <Runner
        questions={paper}
        title="模拟考试"
        mode="exam"
        durationMinutes={120}
        scope="exam"
        scopeName="模拟考试"
        onExit={() => setRunning(false)}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">模拟考试</h1>
      <p className="text-sm text-slate-500">
        按山东真题结构自动随机组卷，限时 120 分钟，交卷后查看成绩报告
      </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2.5 text-sm font-semibold text-slate-700">组卷范围</h2>
        <div className="flex flex-wrap gap-2">
          <Chip active={chapter === 'all'} onClick={() => setChapter('all')}>
            全部章节
          </Chip>
          {CHAPTERS.map((c) => (
            <Chip key={c.id} active={chapter === c.id} onClick={() => setChapter(c.id)}>
              {c.no}、{c.name}
            </Chip>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2.5 text-sm font-semibold text-slate-700">试卷结构</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1">题型</th>
              <th className="py-1">题量</th>
              <th className="py-1">每题分值</th>
              <th className="py-1">小计</th>
            </tr>
          </thead>
          <tbody>
            {STRUCTURE.map((s) => {
              const avail = questions.filter(
                (q) => q.type === s.type && (chapter === 'all' || q.chapterId === chapter),
              ).length
              return (
                <tr key={s.type} className="border-t border-slate-100">
                  <td className="py-1.5">{TYPE_LABEL[s.type]}</td>
                  <td className="py-1.5">
                    {Math.min(s.count, avail)}
                    {avail < s.count && (
                      <span className="ml-1 text-xs text-amber-600">
                        （题库仅 {avail} 题）
                      </span>
                    )}
                  </td>
                  <td className="py-1.5">{s.score} 分</td>
                  <td className="py-1.5">{Math.min(s.count, avail) * s.score} 分</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button
        onClick={() => setRunning(true)}
        className="w-full rounded-md bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700"
      >
        开始考试（120 分钟）
      </button>
    </div>
  )
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
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
