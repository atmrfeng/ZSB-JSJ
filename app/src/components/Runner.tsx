import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { QuestionView, QuestionStatic } from './QuestionView'
import { gradeQuestion, type GradeOutcome } from '@/lib/grade'
import { useStore } from '@/store'
import type { Question } from '@/types'

export interface SessionSummary {
  total: number
  correct: number
  score: number
  fullScore: number
  duration: number
  wrongIds: string[]
}

interface Props {
  questions: Question[]
  title: string
  mode: 'practice' | 'exam'
  durationMinutes?: number
  scope: string
  scopeName: string
  onExit: () => void
}

export function Runner({
  questions,
  title,
  mode,
  durationMinutes = 0,
  scope,
  scopeName,
  onExit,
}: Props) {
  const { settings, recordAnswer, finishSession } = useStore()
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [index, setIndex] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [skipped, setSkipped] = useState<Record<string, boolean>>({})
  const [selfCheck, setSelfCheck] = useState<Record<string, boolean>>({})
  const [marked, setMarked] = useState<Record<string, boolean>>({})
  const [showSheet, setShowSheet] = useState(false)
  const [startTime] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState(0)

  const immediate = mode === 'practice' && settings.immediateFeedback

  const totalSeconds = durationMinutes * 60

  useEffect(() => {
    if (mode !== 'exam' || submitted || !totalSeconds) return
    const timer = setInterval(() => {
      const e = Math.floor((Date.now() - startTime) / 1000)
      setElapsed(e)
      if (e >= totalSeconds) {
        clearInterval(timer)
        doSubmit()
      }
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, submitted, totalSeconds])

  const q = questions[index]
  const answered = useMemo(
    () => questions.filter((qq) => (answers[qq.id] || []).filter(Boolean).length > 0).length,
    [questions, answers],
  )
  const skippedCount = useMemo(
    () => Object.values(skipped).filter(Boolean).length,
    [skipped],
  )

  const results = useMemo(() => {
    const m: Record<string, GradeOutcome> = {}
    for (const qq of questions) {
      m[qq.id] = gradeQuestion(qq, answers[qq.id] || [], settings.multiMode)
    }
    return m
  }, [questions, answers, settings.multiMode])

  // 即时判分：选中答案后自动锁题 + 显示结果（仅 practice + 立即反馈开关）
  const tryImmediateReveal = useCallback(
    (qq: Question, a: string[]) => {
      if (!immediate) return
      const has = a.filter(Boolean).length > 0
      if (!has) return
      // 填空题要求每个空都填了
      if (qq.type === 'fill' && qq.blankCount > 0 && a.filter(Boolean).length < qq.blankCount) return
      if (!revealed[qq.id]) {
        setRevealed((p) => ({ ...p, [qq.id]: true }))
        // 立即记录作答
        const ok = gradeQuestion(qq, a, settings.multiMode).correct
        recordAnswer(qq.id, a, ok)
      }
    },
    [immediate, revealed, settings.multiMode, recordAnswer],
  )

  const finalCorrect = useCallback(
    (qq: Question) => {
      if (selfCheck[qq.id] !== undefined) return selfCheck[qq.id]
      return results[qq.id]?.correct ?? false
    },
    [selfCheck, results],
  )

  const doSubmit = useCallback(() => {
    if (submitted) return
    setSubmitted(true)
    const summary: SessionSummary = {
      total: questions.length,
      correct: 0,
      score: 0,
      fullScore: 0,
      duration: Math.floor((Date.now() - startTime) / 1000),
      wrongIds: [],
    }
    for (const qq of questions) {
      const r = results[qq.id]
      const ok = selfCheck[qq.id] !== undefined ? selfCheck[qq.id] : r.correct
      const score = selfCheck[qq.id] === false ? 0 : selfCheck[qq.id] === true ? r.fullScore : r.score
      summary.fullScore += r.fullScore
      summary.score += score
      if (ok) summary.correct++
      else summary.wrongIds.push(qq.id)
      const a = answers[qq.id] || []
      if (a.filter(Boolean).length) recordAnswer(qq.id, a, ok)
    }
    finishSession({
      mode: mode === 'exam' ? 'exam' : (scope.startsWith('ch') ? 'chapter' : 'paper'),
      scope,
      scopeName,
      startedAt: startTime,
      finishedAt: Date.now(),
      total: summary.total,
      correct: summary.correct,
      score: Math.round(summary.score * 10) / 10,
      fullScore: summary.fullScore,
      duration: summary.duration,
    })
  }, [
    submitted,
    questions,
    results,
    selfCheck,
    answers,
    recordAnswer,
    finishSession,
    startTime,
    mode,
    scope,
    scopeName,
  ])

  if (!q) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        暂无符合筛选条件的题目
        <button className="mt-4 block w-full text-blue-600" onClick={onExit}>
          返回
        </button>
      </div>
    )
  }

  const remain = Math.max(0, totalSeconds - elapsed)
  const mm = String(Math.floor(remain / 60)).padStart(2, '0')
  const ss = String(remain % 60).padStart(2, '0')

  const setAnswer = (a: string[]) => {
    setAnswers((p) => ({ ...p, [q.id]: a }))
    if (skipped[q.id]) setSkipped((p) => ({ ...p, [q.id]: false }))
    tryImmediateReveal(q, a)
  }
  const isRevealed = mode === 'exam' ? submitted : !!revealed[q.id]
  const out = results[q.id]

  const skipCurrent = () => {
    if (!q) return
    setSkipped((p) => ({ ...p, [q.id]: true }))
    // 自动跳到下一题
    if (index + 1 < questions.length) setIndex(index + 1)
  }

  if (submitted) {
    return (
      <ResultView
        title={title}
        questions={questions}
        results={results}
        selfCheck={selfCheck}
        summary={{
          total: questions.length,
          correct: questions.filter((x) => finalCorrect(x)).length,
          score: questions.reduce(
            (s, x) =>
              s +
              (selfCheck[x.id] === false
                ? 0
                : selfCheck[x.id] === true
                  ? results[x.id].fullScore
                  : results[x.id].score),
            0,
          ),
          fullScore: questions.reduce((s, x) => s + results[x.id].fullScore, 0),
          duration: Math.floor((Date.now() - startTime) / 1000),
          wrongIds: questions.filter((x) => !finalCorrect(x)).map((x) => x.id),
        }}
        onExit={onExit}
      />
    )
  }

  return (
    <div>
      {/* 顶部信息条 */}
      <div className="sticky top-[57px] z-30 -mx-4 mb-4 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            退出
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{title}</div>
            <div className="text-xs text-slate-500">
              进度 {index + 1}/{questions.length} · 已答 {answered}
              {skippedCount > 0 && (
                <span className="ml-2 text-amber-600">· 跳过 {skippedCount}</span>
              )}
            </div>
          </div>
          {mode === 'exam' && totalSeconds > 0 && (
            <div
              className={cn(
                'rounded-md px-2.5 py-1 font-mono text-sm',
                remain < 300 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-700',
              )}
            >
              {mm}:{ss}
            </div>
          )}
          <button
            onClick={() => setShowSheet(true)}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            答题卡
          </button>
          {mode === 'exam' && (
            <button
              onClick={doSubmit}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
            >
              交卷
            </button>
          )}
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded bg-slate-100">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${((index + 1) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      {immediate && (
        <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-700">
          ⚡ 立即反馈模式：作答后自动判分并显示答案；选错仍可继续修改重答。
        </div>
      )}

      <QuestionView
        q={q}
        index={index}
        answer={answers[q.id] || []}
        onChange={setAnswer}
        locked={isRevealed}
        showResult={isRevealed}
        result={out}
        selfChecked={selfCheck[q.id]}
        onSelfCheck={(ok) => setSelfCheck((p) => ({ ...p, [q.id]: ok }))}
      />

      <div className="mt-4 flex items-center gap-2">
        <button
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
        >
          上一题
        </button>
        {mode === 'practice' && !isRevealed && (
          <button
            onClick={() => {
              setRevealed((p) => ({ ...p, [q.id]: true }))
              const ok = out?.correct ?? false
              recordAnswer(q.id, answers[q.id] || [], ok)
            }}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
          >
            确认作答
          </button>
        )}
        {mode === 'practice' && (
          <button
            onClick={() => setMarked((p) => ({ ...p, [q.id]: !p[q.id] }))}
            className={cn(
              'rounded-md border px-3 py-2 text-sm',
              marked[q.id] ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-600',
            )}
          >
            {marked[q.id] ? '取消标记' : '标记'}
          </button>
        )}
        {mode === 'practice' && (
          <button
            onClick={skipCurrent}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            跳过此题
          </button>
        )}
        <div className="ml-auto">
          {index + 1 >= questions.length ? (
            mode === 'exam' ? (
              <button
                onClick={doSubmit}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
              >
                交卷
              </button>
            ) : (
              <button onClick={onExit} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                完成
              </button>
            )
          ) : (
            <button
              onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              下一题
            </button>
          )}
        </div>
      </div>

      {showSheet && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-center sm:justify-center">
          <div className="max-h-[80vh] w-full overflow-auto rounded-t-2xl bg-white p-4 sm:max-w-lg sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-medium">答题卡</div>
              <button onClick={() => setShowSheet(false)} className="text-sm text-slate-500">
                关闭
              </button>
            </div>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
              {questions.map((qq, i) => {
                const ans = answers[qq.id] || []
                const done = ans.filter(Boolean).length > 0
                const skip = !!skipped[qq.id]
                const cls = submitted
                  ? finalCorrect(qq)
                    ? 'bg-emerald-500 text-white'
                    : 'bg-red-500 text-white'
                  : done
                    ? 'bg-blue-600 text-white'
                    : skip
                      ? 'bg-amber-100 text-amber-700 border border-amber-300'
                      : 'bg-slate-100 text-slate-600'
                return (
                  <button
                    key={qq.id}
                    onClick={() => {
                      setIndex(i)
                      setShowSheet(false)
                    }}
                    className={cn('aspect-square rounded-md text-xs font-medium', cls)}
                    title={skip ? '已跳过' : done ? '已作答' : '未作答'}
                  >
                    {i + 1}
                  </button>
                )
              })}
            </div>
            {mode === 'exam' && (
              <button
                onClick={() => {
                  setShowSheet(false)
                  doSubmit()
                }}
                className="mt-4 w-full rounded-md bg-blue-600 py-2.5 text-sm text-white hover:bg-blue-700"
              >
                确认交卷
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ResultView({
  title,
  questions,
  results,
  selfCheck,
  summary,
  onExit,
}: {
  title: string
  questions: Question[]
  results: Record<string, GradeOutcome>
  selfCheck: Record<string, boolean>
  summary: SessionSummary
  onExit: () => void
}) {
  const [tab, setTab] = useState<'all' | 'wrong'>('all')
  const list = tab === 'all' ? questions : questions.filter((q) => summary.wrongIds.includes(q.id))
  const rate = summary.total ? Math.round((summary.correct / summary.total) * 100) : 0

  return (
    <div>
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm text-slate-500">{title} · 成绩报告</div>
        <div className="mt-2 flex items-end gap-4">
          <div className="text-4xl font-bold text-blue-600">
            {Math.round((summary.score / (summary.fullScore || 1)) * 100)}
          </div>
          <div className="pb-1 text-sm text-slate-500">分（百分制）</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="总题数" value={summary.total} />
          <Stat label="答对" value={summary.correct} tone="ok" />
          <Stat label="答错" value={summary.total - summary.correct} tone="bad" />
          <Stat label="正确率" value={`${rate}%`} />
          <Stat label="得分" value={`${Math.round(summary.score * 10) / 10}/${summary.fullScore}`} />
          <Stat
            label="用时"
            value={`${Math.floor(summary.duration / 60)}分${summary.duration % 60}秒`}
          />
        </div>
        <button
          onClick={onExit}
          className="mt-4 w-full rounded-md bg-blue-600 py-2.5 text-sm text-white hover:bg-blue-700"
        >
          返回
        </button>
      </div>

      <div className="mb-3 flex gap-2 text-sm">
        <button
          onClick={() => setTab('all')}
          className={cn(
            'rounded-md border px-3 py-1',
            tab === 'all' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600',
          )}
        >
          全部
        </button>
        <button
          onClick={() => setTab('wrong')}
          className={cn(
            'rounded-md border px-3 py-1',
            tab === 'wrong' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600',
          )}
        >
          只看错题（{summary.wrongIds.length}）
        </button>
      </div>

      <div className="space-y-3">
        {list.map((q) => {
          const ok = selfCheck[q.id] !== undefined ? selfCheck[q.id] : results[q.id]?.correct
          return (
            <div key={q.id}>
              <div
                className={cn(
                  'mb-1.5 flex items-center gap-2 text-xs',
                  ok ? 'text-emerald-600' : 'text-red-600',
                )}
              >
                <span
                  className={cn(
                    'grid h-5 w-5 place-items-center rounded-full text-white',
                    ok ? 'bg-emerald-500' : 'bg-red-500',
                  )}
                >
                  {ok ? '✓' : '✕'}
                </span>
                {ok ? '回答正确' : '回答错误'}
                {results[q.id]?.needSelfCheck && selfCheck[q.id] === undefined && (
                  <span className="text-slate-400">（主观题，请对照参考答案自评）</span>
                )}
              </div>
              <QuestionStatic q={q} index={questions.indexOf(q)} showAnswer />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'ok' | 'bad'
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={cn(
          'text-base font-semibold',
          tone === 'ok' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-slate-800',
        )}
      >
        {value}
      </div>
    </div>
  )
}
