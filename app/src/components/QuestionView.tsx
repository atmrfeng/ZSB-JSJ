import { cn } from '@/lib/utils'
import type { Question } from '@/types'
import type { GradeOutcome } from '@/lib/grade'

/** 题目配图列表：支持点击放大查看 */
export function QuestionImages({ images }: { images?: string[] }) {
  if (!images || !images.length) return null
  return (
    <div className="mb-3 flex flex-wrap gap-3">
      {images.map((src, i) => (
        <a
          key={`${src}-${i}`}
          href={src}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-lg border border-slate-200 bg-white"
          title="点击查看原图"
        >
          <img
            src={src}
            alt={`题目配图 ${i + 1}`}
            loading="lazy"
            className="max-h-72 w-auto max-w-full cursor-zoom-in object-contain"
          />
        </a>
      ))}
    </div>
  )
}

interface Props {
  q: Question
  index: number
  answer: string[]
  onChange: (a: string[]) => void
  locked: boolean
  showResult: boolean
  result?: GradeOutcome
  selfChecked?: boolean | null
  onSelfCheck?: (ok: boolean) => void
}

export function QuestionView({
  q,
  index,
  answer,
  onChange,
  locked,
  showResult,
  result,
  selfChecked,
  onSelfCheck,
}: Props) {
  const isMulti = q.type === 'multi'
  const hasOptions = q.options && q.options.length > 0

  const toggle = (key: string) => {
    if (locked) return
    if (isMulti) {
      const has = answer.includes(key)
      onChange(has ? answer.filter((x) => x !== key) : [...answer, key].sort())
    } else {
      onChange([key])
    }
  }

  const letterClass = (key: string) => {
    const selected = answer.includes(key)
    const isCorrect = q.answer.includes(key)
    if (showResult) {
      if (isCorrect && selected) return 'bg-emerald-600 text-white border-emerald-600'
      if (isCorrect) return 'bg-emerald-50 text-emerald-700 border-emerald-300'
      if (selected) return 'bg-red-500 text-white border-red-500'
      return 'border-slate-300 text-slate-500'
    }
    return selected
      ? 'bg-blue-600 text-white border-blue-600'
      : 'border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600'
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
          第 {index + 1} 题
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5">
          {q.type === 'single'
            ? '单选'
            : q.type === 'multi'
              ? '多选'
              : q.type === 'judge'
                ? '判断'
                : q.type === 'fill'
                  ? '填空'
                  : '操作'}
        </span>
        {q.hasImageRef && (
          <span className="rounded bg-orange-50 px-2 py-0.5 text-orange-600">
            含图片引用
          </span>
        )}
      </div>

      {q.material && (
        <div className="mb-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap">
          {q.material}
        </div>
      )}

      <QuestionImages images={q.images} />

      <div className="mb-4 text-[15px] leading-7 text-slate-800 whitespace-pre-wrap">
        {q.stem}
      </div>

      {hasOptions ? (
        <div className="space-y-2">
          {q.options.map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={locked}
              onClick={() => toggle(o.key)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-[14px] leading-6 transition',
                letterClass(o.key),
                locked && 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                  letterClass(o.key),
                )}
              >
                {o.key}
              </span>
              <span className="flex-1">{o.text}</span>
            </button>
          ))}
        </div>
      ) : q.type === 'fill' ? (
        <div className="space-y-2">
          {Array.from({ length: Math.max(1, q.blankCount || 1) }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-sm text-slate-500">
                第 {i + 1} 空
              </span>
              <input
                value={answer[i] || ''}
                disabled={locked}
                onChange={(e) => {
                  const next = [...answer]
                  next[i] = e.target.value
                  onChange(next)
                }}
                placeholder="请输入答案"
                className="h-9 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500"
              />
            </div>
          ))}
        </div>
      ) : (
        <textarea
          value={answer[0] || ''}
          disabled={locked}
          onChange={(e) => onChange([e.target.value])}
          rows={3}
          placeholder="请写出你的操作思路或答案"
          className="w-full rounded-md border border-slate-300 p-3 text-sm outline-none focus:border-blue-500"
        />
      )}

      {showResult && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="mb-1 font-medium text-slate-700">
              参考答案：
              <span className="text-emerald-700">
                {q.answer.length ? q.answer.join('、') : '（待补充）'}
              </span>
            </div>
          </div>
          {q.explanation && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-sm leading-6 text-slate-700">
                <span className="font-medium text-blue-700">解析：</span>
                {q.explanation}
              </div>
            )}
          {result?.needSelfCheck && onSelfCheck && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-600">这道题你：</span>
              <button
                type="button"
                onClick={() => onSelfCheck(true)}
                className={cn(
                  'rounded-md border px-3 py-1',
                  selfChecked === true
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-slate-300 text-slate-600',
                )}
              >
                答对了
              </button>
              <button
                type="button"
                onClick={() => onSelfCheck(false)}
                className={cn(
                  'rounded-md border px-3 py-1',
                  selfChecked === false
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'border-slate-300 text-slate-600',
                )}
              >
                答错了
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 只读展示（用于背题模式 / 预览） */
export function QuestionStatic({
  q,
  index,
  showAnswer,
}: {
  q: Question
  index: number
  showAnswer: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 text-xs text-slate-500">第 {index + 1} 题</div>
      {q.material && (
        <div className="mb-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap">
          {q.material}
        </div>
      )}
      <QuestionImages images={q.images} />
      <div className="mb-3 text-[15px] leading-7 text-slate-800 whitespace-pre-wrap">
        {q.stem}
      </div>
      {q.options?.length ? (
        <div className="space-y-1.5">
          {q.options.map((o) => (
            <div
              key={o.key}
              className={cn(
                'flex gap-2 rounded-md px-2 py-1.5 text-sm',
                showAnswer && q.answer.includes(o.key)
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-slate-700',
              )}
            >
              <span className="font-semibold">{o.key}.</span>
              <span>{o.text}</span>
            </div>
          ))}
        </div>
      ) : null}
      {showAnswer && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
          <span className="font-medium text-slate-700">参考答案：</span>
          <span className="text-emerald-700">
            {q.answer.length ? q.answer.join('、') : '（待补充）'}
          </span>
          {q.explanation && (
            <div className="mt-2 text-slate-600">{q.explanation}</div>
          )}
        </div>
      )}
    </div>
  )
}
