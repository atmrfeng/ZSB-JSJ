import { useMemo, useState } from 'react'
import { useStore } from '@/store'
import { CHAPTERS, TYPE_LABEL, TYPE_ORDER } from '@/lib/chapters'
import type { Question, QuestionType } from '@/types'

const PAGE_SIZE = 20

export default function Bank() {
  const { questions, deleteQuestions, deleteBySource, updateQuestion } = useStore()
  const [chapter, setChapter] = useState('all')
  const [type, setType] = useState<'all' | QuestionType>('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)

  const sources = useMemo(() => {
    const m = new Map<string, number>()
    for (const q of questions) m.set(q.source, (m.get(q.source) || 0) + 1)
    return [...m.entries()]
  }, [questions])

  const pool = useMemo(() => {
    const kw = keyword.trim()
    return questions.filter((q) => {
      if (chapter !== 'all' && q.chapterId !== chapter) return false
      if (type !== 'all' && q.type !== type) return false
      if (kw && !(q.stem + q.explanation + (q.material || '')).includes(kw))
        return false
      return true
    })
  }, [questions, chapter, type, keyword])

  const totalPages = Math.max(1, Math.ceil(pool.length / PAGE_SIZE))
  const list = pool.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">题库管理</h1>
        <p className="text-sm text-slate-500">
          共 {questions.length} 题 · 支持编辑、按来源清理、导出备份
        </p>
      </div>

      {/* 来源统计 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2.5 text-sm font-semibold text-slate-700">资料来源</h2>
        <div className="space-y-1.5">
          {sources.map(([s, n]) => (
            <div key={s} className="flex items-center gap-2 text-xs text-slate-600">
              <span className="min-w-0 flex-1 truncate">{s}</span>
              <span className="text-slate-400">{n} 题</span>
              <button
                onClick={() => {
                  if (window.confirm(`确定删除来源「${s}」下的 ${n} 道题目吗？`))
                    deleteBySource(s)
                }}
                className="rounded border border-red-200 px-1.5 py-0.5 text-red-600"
              >
                删除
              </button>
            </div>
          ))}
          {!sources.length && (
            <div className="text-xs text-slate-400">题库为空，请先导入资料</div>
          )}
        </div>
      </section>

      {/* 筛选 */}
      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <input
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value)
            setPage(0)
          }}
          placeholder="搜索题干 / 解析关键词"
          className="h-8 min-w-[180px] flex-1 rounded-md border border-slate-300 px-2 text-xs outline-none focus:border-blue-500"
        />
        <select
          value={chapter}
          onChange={(e) => {
            setChapter(e.target.value)
            setPage(0)
          }}
          className="h-8 rounded-md border border-slate-300 px-2 text-xs"
        >
          <option value="all">全部章节</option>
          {CHAPTERS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.no}、{c.name}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as 'all' | QuestionType)
            setPage(0)
          }}
          className="h-8 rounded-md border border-slate-300 px-2 text-xs"
        >
          <option value="all">全部题型</option>
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="text-xs text-slate-500">筛选出 {pool.length} 题</div>

      <div className="space-y-2">
        {list.map((q) => (
          <BankItem
            key={q.id}
            q={q}
            editing={editing === q.id}
            onEdit={() => setEditing(editing === q.id ? null : q.id)}
            onSave={(nq) => {
              updateQuestion(nq)
              setEditing(null)
            }}
            onDelete={() => deleteQuestions([q.id])}
          />
        ))}
      </div>

      {pool.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2 text-xs">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
          >
            上一页
          </button>
          <span>
            {page + 1} / {totalPages}
          </span>
          <button
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}

function BankItem({
  q,
  editing,
  onEdit,
  onSave,
  onDelete,
}: {
  q: Question
  editing: boolean
  onEdit: () => void
  onSave: (q: Question) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState<Question>(q)

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg border border-blue-200 bg-white p-3">
        <select
          value={draft.type}
          onChange={(e) => setDraft({ ...draft, type: e.target.value as QuestionType })}
          className="h-8 rounded-md border border-slate-300 px-2 text-xs"
        >
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
          ))}
        </select>
        <textarea
          value={draft.stem}
          onChange={(e) => setDraft({ ...draft, stem: e.target.value })}
          rows={3}
          className="w-full rounded-md border border-slate-300 p-2 text-[13px]"
        />
        <textarea
          value={draft.options.map((o) => `${o.key}. ${o.text}`).join('\n')}
          onChange={(e) =>
            setDraft({
              ...draft,
              options: e.target.value
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .map((l) => {
                  const m = l.match(/^([A-Da-d])[.、．]\s*(.*)$/)
                  return m
                    ? { key: m[1].toUpperCase(), text: m[2] }
                    : { key: '?', text: l }
                }),
            })
          }
          rows={Math.max(2, draft.options.length)}
          className="w-full rounded-md border border-slate-300 p-2 text-[13px]"
        />
        <input
          value={draft.answer.join('、')}
          onChange={(e) =>
            setDraft({
              ...draft,
              answer: e.target.value.split(/[、,，\s]+/).filter(Boolean),
            })
          }
          placeholder="答案"
          className="h-8 w-full rounded-md border border-slate-300 px-2 text-xs"
        />
        <textarea
          value={draft.explanation}
          onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
          rows={2}
          placeholder="解析"
          className="w-full rounded-md border border-slate-300 p-2 text-[13px]"
        />
        <div className="flex gap-2">
          <button
            onClick={() => onSave(draft)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white"
          >
            保存
          </button>
          <button
            onClick={onEdit}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs"
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
              {TYPE_LABEL[q.type]}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
              {CHAPTERS.find((c) => c.id === q.chapterId)?.name || '未分类'}
            </span>
            {q.confidence !== 'high' && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-600">待校对</span>
            )}
            {q.hasImageRef && (
              <span className="rounded bg-orange-50 px-1.5 py-0.5 text-orange-600">
                含图片引用
              </span>
            )}
          </div>
          <div className="line-clamp-2 text-[13px] text-slate-700">{q.stem}</div>
          <div className="mt-1 text-xs text-slate-400">
            答案 {q.answer.length ? q.answer.join('、') : '（待补充）'} · {q.source}
            {q.sourceRef ? ` ${q.sourceRef}` : ''}
          </div>
        </div>
        <button
          onClick={onEdit}
          className="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600"
        >
          编辑
        </button>
        <button
          onClick={() => {
            if (window.confirm('确定删除这道题目吗？')) onDelete()
          }}
          className="shrink-0 rounded border border-red-200 px-2 py-1 text-xs text-red-600"
        >
          删除
        </button>
      </div>
    </div>
  )
}
