import { useMemo } from 'react'
import { useStore } from '@/store'
import { usePapers } from '@/hooks/usePapers'
import { CHAPTERS } from '@/lib/chapters'
import { navigate } from '@/lib/router'
import { daysUntil } from '@/lib/date'

export default function Home() {
  const { questions, records, attempts, settings, ready } = useStore()
  const papers = usePapers()

  const stats = useMemo(() => {
    let done = 0
    let correct = 0
    let wrongCount = 0
    for (const q of questions) {
      const r = records[q.id]
      if (r?.seen) {
        done++
        if (r.lastWrongAt && r.lastAt && r.lastWrongAt >= r.lastAt) wrongCount++
      }
    }
    // 累计正确率按历史记录计
    for (const r of Object.values(records)) {
      if (r.seen) correct += Math.max(0, r.seen - r.wrong)
    }
    const total = Object.values(records).reduce((s, r) => s + r.seen, 0)
    return {
      total: questions.length,
      done,
      wrongCount,
      accuracy: total ? Math.round((correct / total) * 100) : 0,
      attempts: attempts.length,
    }
  }, [questions, records, attempts])

  const favorites = Object.values(records).filter((r) => r.favorited).length
  const left = settings.examDate ? daysUntil(settings.examDate) : null

  const chapterCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const q of questions) m[q.chapterId] = (m[q.chapterId] || 0) + 1
    return m
  }, [questions])

  return (
    <div className="space-y-5">
      {/* 倒计时 */}
      <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-600 to-indigo-600 p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm opacity-90">距离考试还有</div>
            <div className="text-4xl font-bold">
              {left !== null ? left : '--'}
              <span className="ml-1 text-base font-normal opacity-90">天</span>
            </div>
            <div className="mt-1 text-xs opacity-80">
              {settings.examDate ? `考试日期 ${settings.examDate}` : '前往「设置」填写考试日期即可开启倒计时'}
            </div>
          </div>
          <div className="text-right text-xs opacity-90">
            <div>题库 {stats.total} 题</div>
            <div>真题 {papers.length} 套</div>
          </div>
        </div>
      </section>

      {/* 数据概览 */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="已做题目" value={stats.done} unit="题" />
        <Card label="错题总数" value={stats.wrongCount} unit="题" tone="bad" />
        <Card label="收藏题目" value={favorites} unit="题" />
        <Card label="累计正确率" value={stats.accuracy} unit="%" />
      </section>

      {/* 快捷入口 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">开始刷题</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Entry icon="📚" title="章节练习" desc="按考纲章节 / 考点" onClick={() => navigate('practice')} />
          <Entry icon="📝" title="历年真题" desc="2020–2026 共 7 套" onClick={() => navigate('papers')} />
          <Entry icon="⏱️" title="模拟考试" desc="限时 120 分钟" onClick={() => navigate('exam')} />
          <Entry icon="❌" title="错题本" desc="自动收录错题" onClick={() => navigate('wrong')} />
          <Entry icon="⭐" title="我的收藏" desc="重点题目回顾" onClick={() => navigate('favorite')} />
          <Entry icon="📥" title="导入题库" desc="PDF / Word / 文本 / JSON" onClick={() => navigate('import')} />
          <Entry icon="📊" title="学习统计" desc="正确率与趋势" onClick={() => navigate('stats')} />
          <Entry icon="🗂️" title="题库管理" desc="编辑与清理" onClick={() => navigate('bank')} />
        </div>
      </section>

      {/* 章节进度 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">章节题量</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CHAPTERS.map((c) => {
            const n = chapterCounts[c.id] || 0
            const max = Math.max(1, ...Object.values(chapterCounts))
            return (
              <button
                key={c.id}
                onClick={() => navigate(`practice?chapter=${c.id}`)}
                className="rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-blue-300"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {c.no}、{c.name}
                  </span>
                  <span className="text-xs text-slate-500">{n} 题</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100">
                  <div
                    className="h-full rounded bg-blue-500"
                    style={{ width: `${(n / max) * 100}%` }}
                  />
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {!ready && <div className="text-center text-sm text-slate-400">题库加载中…</div>}
    </div>
  )
}

function Card({
  label,
  value,
  unit,
  tone,
}: {
  label: string
  value: number
  unit: string
  tone?: 'bad'
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={
          'mt-1 text-2xl font-bold ' +
          (tone === 'bad' ? 'text-red-600' : 'text-slate-900')
        }
      >
        {value}
        <span className="ml-0.5 text-xs font-normal text-slate-400">{unit}</span>
      </div>
    </div>
  )
}

function Entry({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: string
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow"
    >
      <div className="text-2xl">{icon}</div>
      <div className="mt-1.5 text-sm font-medium">{title}</div>
      <div className="text-xs text-slate-500">{desc}</div>
    </button>
  )
}
