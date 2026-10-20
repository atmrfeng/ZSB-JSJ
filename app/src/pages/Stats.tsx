import { useMemo } from 'react'
import { useStore } from '@/store'
import { CHAPTERS } from '@/lib/chapters'
import { formatDate, formatDuration } from '@/lib/date'
import { cn } from '@/lib/utils'

export default function Stats() {
  const { questions, records, attempts } = useStore()

  const overview = useMemo(() => {
    const recs = Object.values(records)
    const seen = recs.reduce((s, r) => s + r.seen, 0)
    const wrong = recs.reduce((s, r) => s + r.wrong, 0)
    return {
      seen,
      wrong,
      accuracy: seen ? Math.round(((seen - wrong) / seen) * 100) : 0,
      covered: questions.filter((q) => (records[q.id]?.seen || 0) > 0).length,
    }
  }, [records, questions])

  const byChapter = useMemo(() => {
    const map: Record<string, { total: number; done: number; wrong: number }> = {}
    for (const q of questions) {
      const r = records[q.id]
      const e = (map[q.chapterId] = map[q.chapterId] || { total: 0, done: 0, wrong: 0 })
      e.total++
      if (r?.seen) e.done++
      if (r?.lastWrongAt && (!r.lastAt || r.lastWrongAt >= r.lastAt)) e.wrong++
    }
    return CHAPTERS.map((c) => ({
      chapter: c.name,
      ...(map[c.id] || { total: 0, done: 0, wrong: 0 }),
    }))
  }, [questions, records])

  const trend = useMemo(() => {
    return [...attempts]
      .sort((a, b) => a.finishedAt - b.finishedAt)
      .slice(-15)
      .map((a) => ({
        date: formatDate(a.finishedAt).slice(5),
        accuracy: a.total ? Math.round((a.correct / a.total) * 100) : 0,
        score: a.fullScore ? Math.round((a.score / a.fullScore) * 100) : 0,
      }))
  }, [attempts])

  const maxAcc = Math.max(10, ...trend.map((t) => t.accuracy))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">学习统计</h1>
        <p className="text-sm text-slate-500">数据保存在本机浏览器，不会上传</p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="题库总量" value={questions.length} />
        <StatCard label="已练习" value={overview.covered} />
        <StatCard label="累计作答" value={overview.seen} unit="次" />
        <StatCard label="累计正确率" value={overview.accuracy} unit="%" tone="ok" />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">章节掌握度</h2>
        <div className="space-y-2">
          {byChapter.map((c) => {
            const rate = c.done ? Math.round(((c.done - c.wrong) / c.done) * 100) : 0
            const cover = c.total ? Math.round((c.done / c.total) * 100) : 0
            return (
              <div key={c.chapter} className="text-xs">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium text-slate-700">{c.chapter}</span>
                  <span className="text-slate-500">
                    已练 {c.done}/{c.total} · 正确率 {rate}%
                  </span>
                </div>
                <div className="flex h-2 overflow-hidden rounded bg-slate-100">
                  <div className="bg-blue-400" style={{ width: `${cover}%` }} />
                  <div
                    className={cn('bg-emerald-400', rate < 60 && 'bg-amber-400')}
                    style={{ width: `${Math.max(0, (cover * rate) / 100)}%`, marginLeft: `-${Math.max(0, (cover * rate) / 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">正确率趋势（最近 15 次）</h2>
        {trend.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">
            还没有练习记录，先去做几套题吧
          </div>
        ) : (
          <div className="flex h-40 items-end gap-1.5">
            {trend.map((t, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full text-center text-[10px] text-slate-500">
                  {t.accuracy}%
                </div>
                <div
                  className="w-full rounded-t bg-blue-500"
                  style={{ height: `${(t.accuracy / maxAcc) * 100}px` }}
                />
                <div className="text-[9px] text-slate-400">{t.date}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">练习记录</h2>
        {attempts.length === 0 ? (
          <div className="py-4 text-center text-xs text-slate-400">暂无记录</div>
        ) : (
          <div className="space-y-1.5">
            {attempts.slice(0, 20).map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 border-b border-slate-100 pb-1.5 text-xs"
              >
                <span className="text-slate-400">{formatDate(a.finishedAt)}</span>
                <span className="font-medium">{a.scopeName}</span>
                <span className="text-slate-500">
                  {a.correct}/{a.total} 题
                </span>
                <span className="ml-auto text-emerald-600">
                  {a.score}/{a.fullScore} 分
                </span>
                <span className="text-slate-400">{formatDuration(a.duration)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  unit,
  tone,
}: {
  label: string
  value: number
  unit?: string
  tone?: 'ok'
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={cn(
          'mt-1 text-2xl font-bold',
          tone === 'ok' ? 'text-emerald-600' : 'text-slate-900',
        )}
      >
        {value}
        {unit && <span className="ml-0.5 text-xs font-normal text-slate-400">{unit}</span>}
      </div>
    </div>
  )
}

