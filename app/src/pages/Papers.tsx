import { useMemo, useState } from 'react'
import { useStore } from '@/store'
import { usePapers } from '@/hooks/usePapers'
import { Runner } from '@/components/Runner'
import { TYPE_ORDER, TYPE_LABEL } from '@/lib/chapters'
import type { Question } from '@/types'

export default function Papers() {
  const { questions } = useStore()
  const papers = usePapers()
  const [running, setRunning] = useState<{ qs: Question[]; name: string; exam: boolean } | null>(null)

  const byId = useMemo(() => {
    const m: Record<string, Question> = {}
    for (const q of questions) m[q.id] = q
    return m
  }, [questions])

  if (running) {
    return (
      <Runner
        questions={running.qs}
        title={running.name}
        mode={running.exam ? 'exam' : 'practice'}
        durationMinutes={running.exam ? 120 : 0}
        scope={running.name}
        scopeName={running.name}
        onExit={() => setRunning(null)}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">历年真题</h1>
        <p className="text-sm text-slate-500">
          共 {papers.length} 套，建议先按「练习模式」做，考前用「考试模式」限时模拟
        </p>
      </div>

      {papers.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          暂无真题，可前往「导入题库」上传真题资料
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {papers.map((p) => {
          const qs = p.questionIds.map((id) => byId[id]).filter(Boolean)
          const counts = TYPE_ORDER.map((t) => ({
            t,
            n: qs.filter((q) => q.type === t).length,
          })).filter((x) => x.n > 0)
          return (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-base font-bold text-blue-700">{p.year} 年</div>
                  <div className="text-xs text-slate-500">{p.subject}</div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  {p.totalScore} 分 / {p.duration} 分钟
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-slate-600">
                {counts.map((c) => (
                  <span key={c.t} className="rounded bg-slate-100 px-1.5 py-0.5">
                    {TYPE_LABEL[c.t]} {c.n}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  disabled={!qs.length}
                  onClick={() =>
                    setRunning({ qs, name: `${p.year} 年真题`, exam: false })
                  }
                  className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  练习模式
                </button>
                <button
                  disabled={!qs.length}
                  onClick={() => setRunning({ qs, name: `${p.year} 年真题`, exam: true })}
                  className="flex-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  考试模式
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
