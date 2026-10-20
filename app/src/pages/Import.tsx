import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '@/store'
import {
  runImport,
  detectFormat,
  formatBytes,
  importFromText,
  importFromJson,
  type ExtractProgress,
} from '@/lib/importers'
import { applyAnswers, parseAnswers } from '@/lib/parser'
import { detectDuplicates } from '@/lib/dedupe'
import { CHAPTERS, TYPE_LABEL, TYPE_ORDER } from '@/lib/chapters'
import { cn } from '@/lib/utils'
import { navigate } from '@/lib/router'
import type { ParsedQuestion } from '@/lib/parser'

type Stage = 'idle' | 'extracting' | 'review' | 'done'
type Format = 'pdf' | 'docx' | 'text' | 'json'

interface Job {
  file?: File
  format: Format
  pages?: number
  imageCount?: number
  rawSize?: number
}

const PREVIEW_MAX = 400

const FORMAT_CARDS: Array<{
  id: Format
  icon: string
  title: string
  desc: string
  accept: string
  hint: string
}> = [
  {
    id: 'pdf',
    icon: '📄',
    title: 'PDF 文件',
    desc: '真题卷 / 同步练习题 PDF，自动提取题目与配图',
    accept: '.pdf,application/pdf',
    hint: '支持大文件（100MB+），图片走 Worker 解析',
  },
  {
    id: 'docx',
    icon: '📝',
    title: 'Word 文档',
    desc: '.docx 文档，提取文本与内嵌图片，按章节与题号解析',
    accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    hint: '由 mammoth.js 解析，浏览器本地完成',
  },
  {
    id: 'text',
    icon: '📃',
    title: '纯文本 / Markdown',
    desc: '粘贴题目文本，按「一、单选」「1. 题干」「A. 选项」解析',
    accept: '.txt,.md,text/plain,text/markdown',
    hint: '可直接拖入 .txt 或在文本框粘贴',
  },
  {
    id: 'json',
    icon: '🧩',
    title: 'JSON 题库',
    desc: '结构化字段（type/stem/options/answer/...），适合批量准备',
    accept: '.json,application/json',
    hint: '兼容 {questions:[...]} 或顶层数组，支持中英文题型',
  },
]

export default function Import() {
  const { questions, importQuestions } = useStore()
  const [stage, setStage] = useState<Stage>('idle')
  const [format, setFormat] = useState<Format | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [progress, setProgress] = useState<ExtractProgress>({
    phase: 'reading',
    current: 0,
    total: 100,
  })
  const [parsed, setParsed] = useState<ParsedQuestion[]>([])
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<number | null>(null)
  const [chapterFilter, setChapterFilter] = useState<'all' | 'low'>('all')
  const [globalChapter, setGlobalChapter] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [textPaste, setTextPaste] = useState('')
  const cancelRef = useRef<(() => void) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const answerInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    async (files: FileList | File[], fm?: Format) => {
      const arr = Array.from(files)
      if (!arr.length) {
        setError('请选择文件')
        return
      }
      const file = arr[0]
      const det = detectFormat(file)
      const useFormat: Format = fm || (det as Format) || 'pdf'
      setFormat(useFormat)
      setError('')
      setResult('')
      setStage('extracting')
      setJob({ format: useFormat, file, rawSize: file.size })

      try {
        const res = await runImport(file, useFormat, setProgress)
        setJob({
          format: useFormat,
          file,
          pages: res.meta.pages,
          imageCount: res.meta.imageCount,
          rawSize: res.meta.rawSize || file.size,
        })
        setParsed(res.questions)
        setExcluded(new Set())
        setStage('review')
      } catch (e) {
        setError(`解析失败：${(e as Error).message}`)
        setStage('idle')
      } finally {
        cancelRef.current = null
      }
    },
    [],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (!file) return
      const det = detectFormat(file)
      void handleFiles([file], (det as Format) || undefined)
    },
    [handleFiles],
  )

  const handlePasteImport = useCallback(async (fm: Format) => {
    if (!textPaste.trim()) {
      setError('请先粘贴文本内容')
      return
    }
    setError('')
    setResult('')
    setFormat(fm)
    setStage('extracting')
    setJob({ format: fm, rawSize: textPaste.length })
    try {
      const res = fm === 'json'
        ? await importFromJson(textPaste, '粘贴 JSON')
        : await importFromText(textPaste, '粘贴文本')
      setJob({ format: fm, rawSize: textPaste.length, imageCount: res.meta.imageCount })
      setParsed(res.questions)
      setExcluded(new Set())
      setStage('review')
    } catch (e) {
      setError(`解析失败：${(e as Error).message}`)
      setStage('idle')
    }
  }, [textPaste])

  const handleAnswerFile = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => /\.pdf$/i.test(f.name))
      if (!arr.length) return
      setStage('extracting')
      const file = arr[0]
      try {
        // 单独再走一遍 PDF，仅用作答案解析
        const res = await runImport(file, 'pdf', setProgress)
        // 把每题 raw 还原成行
        const lines = res.questions.flatMap((q) => [q.raw || q.stem])
        const pack = parseAnswers(lines)
        setParsed((prev) => {
          const next = prev.map((p) => ({ ...p }))
          applyAnswers(next, pack)
          return next
        })
        setResult('答案已关联并回填')
        setStage('review')
      } catch (e) {
        setError(`答案文件解析失败：${(e as Error).message}`)
        setStage('review')
      }
    },
    [],
  )

  const duplicates = useMemo(() => detectDuplicates(parsed, questions), [parsed, questions])

  const stats = useMemo(() => {
    const byType: Record<string, number> = {}
    let withAnswer = 0
    let lowConfidence = 0
    for (const p of parsed) {
      byType[p.type] = (byType[p.type] || 0) + 1
      if (p.answer.length) withAnswer++
      if (p.confidence !== 'high') lowConfidence++
    }
    return { byType, withAnswer, lowConfidence }
  }, [parsed])

  const visible = useMemo(
    () =>
      parsed
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => (chapterFilter === 'all' ? true : p.confidence !== 'high'))
        .slice(0, PREVIEW_MAX),
    [parsed, chapterFilter],
  )

  const commit = useCallback(() => {
    const batchId = `b_${Date.now().toString(36)}`
    const keep = parsed.filter((_, i) => !excluded.has(i))
    const r = importQuestions(keep, {
      source: job?.file?.name || (format === 'json' ? 'JSON 导入' : '文本导入'),
      chapterId: globalChapter || undefined,
      batchId,
    })
    setStage('done')
    setResult(`入库完成：新增 ${r.added} 题，跳过重复 ${r.skipped} 题`)
  }, [parsed, excluded, importQuestions, job, globalChapter, format])

  const withAnswerCount = parsed.filter((p) => p.answer.length).length
  const noAnswer = parsed.length > 0 && withAnswerCount === 0
  const currentCard = FORMAT_CARDS.find((c) => c.id === format)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">导入题库</h1>
        <p className="text-sm text-slate-500">
          支持 PDF / Word / 文本 / JSON 四种来源；拖入文件即可自动识别格式
        </p>
      </div>

      {stage === 'idle' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FORMAT_CARDS.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setFormat(c.id)
                  // 直接触发选择
                  setTimeout(() => inputRef.current?.click(), 0)
                }}
                className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm"
              >
                <div className="text-2xl">{c.icon}</div>
                <div className="mt-1.5 text-sm font-medium">{c.title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{c.desc}</div>
                <div className="mt-2 text-[11px] text-slate-400">{c.hint}</div>
              </button>
            ))}
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer rounded-2xl border-2 border-dashed border-blue-300 bg-white p-8 text-center transition hover:bg-blue-50/50"
          >
            <div className="text-3xl">📂</div>
            <div className="mt-2 text-sm font-medium">点击选择或拖拽文件到此处（自动识别格式）</div>
            <div className="mt-1 text-xs text-slate-500">PDF · DOCX · TXT · MD · JSON</div>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/json"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">粘贴文本 / JSON 直接导入</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handlePasteImport('text')}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                按文本解析
              </button>
              <button
                onClick={() => handlePasteImport('json')}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
              >
                按 JSON 解析
              </button>
            </div>
            <textarea
              value={textPaste}
              onChange={(e) => setTextPaste(e.target.value)}
              placeholder="粘贴题目文本 / JSON。支持 Markdown、Word 复制文本、在线搜题的题干…"
              rows={6}
              className="mt-2 w-full rounded-md border border-slate-300 p-2 text-[12px] outline-none focus:border-blue-500"
            />
          </section>
        </>
      )}

      {stage === 'extracting' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span>
              {currentCard?.icon} {currentCard?.title} ·{' '}
              {progress.phase === 'reading'
                ? '正在读取文件…'
                : progress.phase === 'structuring'
                  ? '正在结构化题目…'
                  : `正在解析第 ${progress.current} / ${progress.total} 页`}
            </span>
            <span className="text-slate-500">
              {progress.total ? Math.round((progress.current / progress.total) * 100) : 0}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-slate-100">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{
                width: `${progress.total ? Math.min(100, (progress.current / progress.total) * 100) : 10}%`,
              }}
            />
          </div>
          <div className="mt-3 text-xs text-slate-500">
            大文件解析需要一点时间，请不要关闭页面。
          </div>
          <button
            onClick={() => {
              cancelRef.current?.()
              setStage('idle')
            }}
            className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600"
          >
            取消
          </button>
        </div>
      )}

      {stage === 'review' && job && (
        <div className="space-y-4">
          {/* 汇总 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <span>
                来源：<b>{job.file?.name || (format === 'json' ? '粘贴 JSON' : '粘贴文本')}</b>
              </span>
              <span className="text-slate-500">
                {formatBytes(job.rawSize || 0)}
                {job.pages ? ` · ${job.pages} 页` : ''}
              </span>
              <span>
                识别题目：<b className="text-blue-600">{parsed.length}</b>
              </span>
              <span>
                含答案：<b className="text-emerald-600">{withAnswerCount}</b>
              </span>
              <span>
                待校对：<b className="text-amber-600">{stats.lowConfidence}</b>
              </span>
              <span>
                疑似重复：<b className="text-orange-600">{duplicates.size}</b>
              </span>
              {(job.imageCount || 0) > 0 && (
                <span>
                  提取配图：<b className="text-slate-700">{job.imageCount}</b>
                  <span className="text-slate-500">
                    （{parsed.filter((p) => p.images?.length).length} 道题已挂图）
                  </span>
                </span>
              )}
            </div>
            {noAnswer && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                未在该文件中发现答案区。若答案在另一个 PDF（如「答案.pdf」）中，可点击下方「关联答案文件」进行二次导入并自动按题号回填。
                <div className="mt-2">
                  <button
                    onClick={() => answerInputRef.current?.click()}
                    className="rounded-md bg-amber-600 px-3 py-1 text-white"
                  >
                    关联答案文件
                  </button>
                  <input
                    ref={answerInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => e.target.files && handleAnswerFile(e.target.files)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 批量设置 */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <span className="text-xs text-slate-600">列表筛选：</span>
            <button
              onClick={() => setChapterFilter('all')}
              className={cn(
                'rounded-md border px-2 py-1 text-xs',
                chapterFilter === 'all'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-300 text-slate-600',
              )}
            >
              全部
            </button>
            <button
              onClick={() => setChapterFilter('low')}
              className={cn(
                'rounded-md border px-2 py-1 text-xs',
                chapterFilter === 'low'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-300 text-slate-600',
              )}
            >
              仅待校对
            </button>
            <span className="mx-1 w-px self-stretch bg-slate-200" />
            <span className="text-xs text-slate-600">批量归属章节：</span>
            <select
              value={globalChapter}
              onChange={(e) => setGlobalChapter(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="">自动判断（推荐）</option>
              {CHAPTERS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.no}、{c.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                const next = new Set(excluded)
                parsed.forEach((p, i) => {
                  if (p.confidence !== 'high') next.add(i)
                })
                setExcluded(next)
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              排除所有待校对题
            </button>
            <button
              onClick={() => setExcluded(new Set())}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              全部选中
            </button>
            <span className="ml-auto text-xs text-slate-500">
              将入库 {parsed.length - excluded.size} 题
            </span>
          </div>

          {/* 列表 */}
          <div className="space-y-2">
            {visible.map(({ p, i }) => {
              const dup = duplicates.get(i)
              const skip = excluded.has(i)
              return (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg border bg-white',
                    skip ? 'border-slate-200 opacity-50' : 'border-slate-200',
                  )}
                >
                  <div className="flex items-start gap-2 p-3">
                    <input
                      type="checkbox"
                      checked={!skip}
                      onChange={() =>
                        setExcluded((prev) => {
                          const n = new Set(prev)
                          if (n.has(i)) n.delete(i)
                          else n.add(i)
                          return n
                        })
                      }
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                          {TYPE_LABEL[p.type]}
                        </span>
                        {p.confidence === 'high' ? (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                            识别完整
                          </span>
                        ) : (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-600">
                            {p.answer.length ? '待校对' : '缺答案'}
                          </span>
                        )}
                        {p.hasImageRef && (
                          <span className="rounded bg-orange-50 px-1.5 py-0.5 text-orange-600">
                            含图片引用
                          </span>
                        )}
                        {dup && (
                          <span className="rounded bg-orange-50 px-1.5 py-0.5 text-orange-600">
                            {dup.exact ? '与题库完全重复' : `疑似重复 ${Math.round(dup.similar * 100)}%`}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[13px] text-slate-700">{p.stem}</div>
                      {!!p.images?.length && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {p.images.map((src, k) => (
                            <img
                              key={k}
                              src={src}
                              alt={`配图 ${k + 1}`}
                              className="max-h-24 w-auto max-w-full rounded border border-slate-200 object-contain"
                            />
                          ))}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-slate-400">
                        选项 {p.options.length} 个 · 答案{' '}
                        {p.answer.length ? p.answer.join('') : '—'}
                        {p.images?.length ? ` · 配图 ${p.images.length} 张` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => setExpanded(expanded === i ? null : i)}
                      className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                    >
                      {expanded === i ? '收起' : '校对'}
                    </button>
                  </div>
                  {expanded === i && (
                    <Editor
                      q={p}
                      onChange={(nq) =>
                        setParsed((prev) => prev.map((x, j) => (j === i ? nq : x)))
                      }
                    />
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={commit}
              className="flex-1 rounded-md bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              确认入库（{parsed.length - excluded.size} 题）
            </button>
            <button
              onClick={() => {
                setStage('idle')
                setParsed([])
              }}
              className="rounded-md border border-slate-300 px-4 py-2.5 text-sm text-slate-600"
            >
              放弃
            </button>
          </div>
        </div>
      )}

      {stage === 'done' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <div className="text-3xl">✅</div>
          <div className="mt-2 text-sm font-medium text-emerald-800">{result}</div>
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => navigate('bank')}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white"
            >
              去题库管理查看
            </button>
            <button
              onClick={() => {
                setStage('idle')
                setParsed([])
              }}
              className="rounded-md border border-emerald-300 px-4 py-2 text-sm text-emerald-700"
            >
              继续导入
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 说明 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 text-xs leading-6 text-slate-600">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">识别规则说明</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>题型分节：识别「一、单项选择题 / 二、多项选择题 / 三、判断题 / 四、填空题 / 五、操作题」等标题</li>
          <li>题号：行首数字加「. 、 ．」，操作题支持 (1)(2) 小问与 (一)(二) 分组材料</li>
          <li>选项：兼容同行 tab 分隔、逐行排列、两列混排三种版式</li>
          <li>答案：支持文末「参考答案」题号对照表，以及真题「N.【精析】答案+解析」格式</li>
          <li>噪声过滤：自动剔除页眉页脚（如「计算机同步练习」「库课…·141·」）与孤立页码</li>
          <li>填空题：识别连续空格/下划线为空位，支持多空并列答案</li>
          <li>图片题：检测「如图 / 下图 / 图1」引用并标记；Word/PDF 中的真实图片会自动挂载</li>
          <li>JSON：type 支持「单选 / single」「多选 / multi」「判断 / judge」「填空 / fill」「操作 / operation」；answer 支持数组或字符串</li>
        </ul>
      </section>
    </div>
  )
}

/** 单题校对编辑器 */
function Editor({
  q,
  onChange,
}: {
  q: ParsedQuestion
  onChange: (q: ParsedQuestion) => void
}) {
  const patch = (p: Partial<ParsedQuestion>) => onChange({ ...q, ...p })

  return (
    <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-3">
      <div>
        <div className="mb-1 text-xs text-slate-500">题型</div>
        <select
          value={q.type}
          onChange={(e) => patch({ type: e.target.value as ParsedQuestion['type'] })}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-1 text-xs text-slate-500">题干</div>
        <textarea
          value={q.stem}
          onChange={(e) => patch({ stem: e.target.value })}
          rows={3}
          className="w-full rounded-md border border-slate-300 p-2 text-[13px] outline-none focus:border-blue-500"
        />
      </div>

      <div>
        <div className="mb-1 text-xs text-slate-500">选项（每行一条，格式 A. 内容）</div>
        <textarea
          value={q.options.map((o) => `${o.key}. ${o.text}`).join('\n')}
          onChange={(e) => {
            const opts = e.target.value
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => {
                const m = line.match(/^([A-Da-d])[.、．]\s*(.*)$/)
                return m
                  ? { key: m[1].toUpperCase(), text: m[2] }
                  : { key: '?', text: line }
              })
            patch({ options: opts })
          }}
          rows={Math.max(2, q.options.length)}
          className="w-full rounded-md border border-slate-300 p-2 text-[13px] outline-none focus:border-blue-500"
        />
      </div>

      <div>
        <div className="mb-1 text-xs text-slate-500">
          答案（客观题填字母，如 B 或 BD；填空题多空用、分隔）
        </div>
        <input
          value={q.answer.join('、')}
          onChange={(e) =>
            patch({
              answer: e.target.value
                .split(/[、,，\s]+/)
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
          className="h-9 w-full rounded-md border border-slate-300 px-2 text-[13px] outline-none focus:border-blue-500"
        />
      </div>

      <div>
        <div className="mb-1 text-xs text-slate-500">解析</div>
        <textarea
          value={q.explanation}
          onChange={(e) => patch({ explanation: e.target.value })}
          rows={2}
          className="w-full rounded-md border border-slate-300 p-2 text-[13px] outline-none focus:border-blue-500"
        />
      </div>

      <div className="rounded-md bg-white p-2 text-[11px] leading-5 text-slate-400">
        <div className="mb-1 text-slate-500">原文对照</div>
        <pre className="whitespace-pre-wrap break-all">{q.raw.slice(0, PREVIEW_MAX)}</pre>
      </div>
    </div>
  )
}