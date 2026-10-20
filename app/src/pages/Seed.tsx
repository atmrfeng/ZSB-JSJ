/**
 * 种子题库管理
 *
 * 三条能力，核心是第 ① 条：
 *   ① 从资料文件生成 seed —— 选定 PDF / Word / 文本 / JSON（可多选）→ 浏览器里解析
 *      → 直接输出 seed-bank.json（或「json + 图片」的 zip 包）→ 手动替换 GitHub 仓库里的
 *      app/public/data/seed-bank.json，所有用户刷新后同步
 *   ② 从本地 IndexedDB 题库导出 seed —— 之前零散导入的题目一次性整理成种子
 *   ③ 合并外部 seed 到本地 —— 拿到别人的种子按题干哈希去重入库
 *
 * 图片策略说明（关键）：
 *   浏览器从 PDF / Word 里抽出来的图是 dataURL（base64），直接写进 JSON 会让文件动辄几十 MB，
 *   GitHub 网页端单文件上限 25 MB，根本传不上去。所以默认「精简」不嵌图；
 *   需要保留图时用「图片分离包」，图片单独存 img/ 目录，JSON 里只留路径。
 */
import { useMemo, useRef, useState } from 'react'
import { useStore, getMeta } from '@/store'
import { questionRepo } from '@/lib/db'
import { CHAPTERS, TYPE_LABEL, classifyChapter } from '@/lib/chapters'
import { hashStem } from '@/lib/dedupe'
import { runImport, detectFormat, formatBytes, type ExtractProgress } from '@/lib/importers'
import { createZip, dataUrlToBytes, downloadBlob, type ZipEntry } from '@/lib/zip'
import { cn } from '@/lib/utils'
import type { Question } from '@/types'

type ImgMode = 'strip' | 'zip' | 'embed'
type PanelKey = 'file' | 'local' | 'merge'

interface BuiltSeed {
  /** 种子 JSON 文本 */
  json: string
  questions: Question[]
  /** 「图片分离」模式下抽出来的图片文件 */
  imageFiles: ZipEntry[]
  imgMode: ImgMode
  /** 参与生成的文件名 */
  sources: string[]
  /** 生成时跳过的题数（题干为空或重复） */
  dropped: number
  imgCount: number
}

const MODE_TIP: Record<ImgMode, { title: string; desc: string; warn?: string }> = {
  strip: {
    title: '精简（推荐）',
    desc: '不写入图片数据，只保留「含图」标记。文件最小，GitHub 网页端可直接上传。',
  },
  zip: {
    title: '图片分离包',
    desc: '图片单独存到 img/ 目录，JSON 里只留路径。压缩包里含 seed-bank.json + img + 上传说明。',
    warn: '上传时需要把 seed-bank.json 和 img 文件夹一起传到 app/public/data/ 目录。',
  },
  embed: {
    title: '内嵌图片',
    desc: '图片以 base64 直接写进 JSON，单文件即可分发，但体积会明显变大。',
    warn: 'GitHub 网页端单文件上限 25 MB，超出后只能用命令行 git 推送。',
  },
}

const EMPTY_PROGRESS: ExtractProgress = { phase: 'reading', current: 0, total: 100 }

export default function Seed() {
  const { questions, records, ready } = useStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const seedInputRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState<PanelKey | null>('file')
  const [imgMode, setImgMode] = useState<ImgMode>('strip')
  const [busy, setBusy] = useState(false)
  const [busyHint, setBusyHint] = useState('')
  const [progress, setProgress] = useState<ExtractProgress>(EMPTY_PROGRESS)
  const [built, setBuilt] = useState<BuiltSeed | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const stats = useMemo(() => {
    const byChapter: Record<string, number> = {}
    const byType: Record<string, number> = {}
    const bySource = new Map<string, number>()
    let withImg = 0
    let withAns = 0
    let embedded = 0
    for (const q of questions) {
      byChapter[q.chapterId] = (byChapter[q.chapterId] || 0) + 1
      byType[q.type] = (byType[q.type] || 0) + 1
      bySource.set(q.source || '未分类', (bySource.get(q.source || '未分类') || 0) + 1)
      if (q.images?.length) {
        withImg++
        if (q.images.some((s) => s.startsWith('data:'))) embedded++
      }
      if (q.answer?.length) withAns++
    }
    return { byChapter, byType, bySource, withImg, withAns, embedded }
  }, [questions])

  /** 把「从文件解析」或「本地题库」的题目集打包成种子 */
  const pack = (list: Question[], mode: ImgMode, sources: string[], dropped: number): BuiltSeed => {
    const imageFiles: ZipEntry[] = []
    let imgCount = 0
    const folderCache = new Map<string, string>()

    const safeFolder = (src: string) => {
      const hit = folderCache.get(src)
      if (hit) return hit
      const base = src.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[^\w一-龥-]+/g, '_')
      const folder = (base || 'seed').slice(0, 28)
      folderCache.set(src, folder)
      return folder
    }

    const out: Question[] = list.map((q) => {
      const imgs = q.images || []
      if (mode === 'strip') {
        return { ...q, images: [], hasImageRef: q.hasImageRef || imgs.length > 0 }
      }
      if (mode === 'embed') {
        imgCount += imgs.length
        return { ...q, hasImageRef: q.hasImageRef || imgs.length > 0 }
      }
      // zip：图片抽出来，JSON 里换成分发路径
      const folder = safeFolder(q.source || 'seed')
      const paths: string[] = []
      imgs.forEach((src, i) => {
        if (src.startsWith('data:')) {
          try {
            const { data, ext } = dataUrlToBytes(src)
            const name = `img/${folder}/${q.id.slice(0, 8)}_${i + 1}.${ext}`
            imageFiles.push({ name, data })
            paths.push(`/data/img/${folder}/${q.id.slice(0, 8)}_${i + 1}.${ext}`)
            imgCount++
          } catch {
            /* 解析失败的图片直接丢弃，不影响题目 */
          }
        } else {
          paths.push(src)
          imgCount++
        }
      })
      return { ...q, images: paths, hasImageRef: q.hasImageRef || paths.length > 0 }
    })

    const payload = {
      version: 1,
      chapters: CHAPTERS.map((c) => ({ id: c.id, no: c.no, name: c.name })),
      papers: [] as unknown[],
      questions: out,
    }
    return {
      json: JSON.stringify(payload),
      questions: out,
      imageFiles,
      imgMode: mode,
      sources,
      dropped,
      imgCount,
    }
  }

  /** ① 从资料文件（可多选）解析生成种子 */
  const buildFromFiles = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    setErr('')
    setMsg('')
    setBuilt(null)
    setProgress(EMPTY_PROGRESS)
    try {
      const collected: Question[] = []
      const seen = new Set<string>()
      const sources: string[] = []
      const skippedFiles: string[] = []
      let dropped = 0

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi]
        setBusyHint(`第 ${fi + 1}/${files.length} 个文件：${file.name}`)
        const fmt = detectFormat(file)
        if (!fmt) {
          skippedFiles.push(`${file.name}（格式不支持）`)
          continue
        }
        const res = await runImport(file, fmt, (p) =>
          setProgress({ ...p, total: p.total || 1 }),
        )
        sources.push(file.name)
        const now = Date.now()
        for (const p of res.questions) {
          const stem = p.stem?.trim()
          if (!stem) {
            dropped++
            continue
          }
          const id = hashStem(stem)
          if (seen.has(id)) {
            dropped++
            continue
          }
          seen.add(id)
          collected.push({
            id,
            type: p.type,
            stem,
            options: p.options || [],
            answer: p.answer || [],
            explanation: p.explanation || '',
            material: p.material || '',
            chapterId: classifyChapter(stem + (p.material || '')),
            tags: [],
            source: file.name,
            sourceRef: p.no ? `第${p.no}题` : '',
            blankCount: p.blankCount || 1,
            images: p.images || [],
            hasImageRef: p.hasImageRef || !!p.images?.length,
            confidence: p.answer.length ? 'high' : 'low',
            createdAt: now,
          })
        }
      }

      if (!collected.length) {
        throw new Error(
          `没能解析出题目${skippedFiles.length ? `；${skippedFiles.join('、')}` : ''}`,
        )
      }

      const result = pack(collected, imgMode, sources, dropped)
      setBuilt(result)
      setProgress({ phase: 'done', current: 100, total: 100 })
      setMsg(
        `已解析 ${collected.length} 题${dropped ? `，跳过 ${dropped} 题（空题干或重复）` : ''}` +
          `${skippedFiles.length ? `；${skippedFiles.join('、')}` : ''}。` +
          `点击下方按钮保存种子文件，再替换 GitHub 仓库里的 app/public/data/seed-bank.json。`,
      )
    } catch (e) {
      setErr(`生成失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
      setBusyHint('')
    }
  }

  /** ② 从本地 IndexedDB 导出种子 */
  const buildFromLocal = async () => {
    setBusy(true)
    setErr('')
    setMsg('')
    setBuilt(null)
    try {
      const qs = await questionRepo.all()
      if (!qs.length) throw new Error('本地题库为空，先去「导入题库」导入资料')
      const cleaned = qs.map((q) => {
        const { batchId: _b, createdAt: _c, ...rest } = q
        return rest as Question
      })
      const sources = [...new Set(cleaned.map((q) => q.source || '未分类'))]
      const result = pack(cleaned, imgMode, sources, 0)
      // 本地导出时把试卷元数据一起带上
      const meta = await getMeta()
      const payload = JSON.parse(result.json) as {
        papers?: unknown[]
        questions: Question[]
      }
      payload.papers = meta.papers || []
      result.json = JSON.stringify(payload)
      setBuilt(result)
      setMsg(
        `已按 seed-bank.json 格式整理 ${cleaned.length} 题。` +
          `把它提交到仓库的 app/public/data/seed-bank.json 后，所有访问者刷新即可看到。`,
      )
    } catch (e) {
      setErr(`导出失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /** ③ 合并外部种子到本地 */
  const mergeSeedIntoLocal = async (file: File) => {
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const data = JSON.parse(await file.text())
      const incoming = (Array.isArray(data) ? data : data.questions) as Question[]
      if (!Array.isArray(incoming)) throw new Error('JSON 中未找到 questions 字段')
      const existing = await questionRepo.all()
      const ids = new Set(existing.map((q) => q.id))
      const toAdd: Question[] = []
      let skipped = 0
      for (const q of incoming) {
        if (!q.stem) continue
        const id = q.id || hashStem(q.stem)
        if (ids.has(id)) {
          skipped++
          continue
        }
        toAdd.push({
          ...q,
          id,
          chapterId: q.chapterId || classifyChapter(q.stem),
          images: Array.isArray(q.images) ? q.images : [],
          createdAt: Date.now(),
        })
        ids.add(id)
      }
      if (toAdd.length) await questionRepo.save(toAdd)
      setMsg(
        `合并完成：新增 ${toAdd.length} 题，跳过 ${skipped} 题（题干重复）。刷新页面后生效。`,
      )
    } catch (e) {
      setErr(`合并失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const downloadBuilt = (b: BuiltSeed) => {
    const stamp = new Date().toISOString().slice(0, 10)
    if (b.imgMode === 'zip') {
      const jsonBytes = new TextEncoder().encode(b.json)
      const entries: ZipEntry[] = [
        { name: 'seed-bank.json', data: jsonBytes },
        ...b.imageFiles,
        { name: '上传说明.txt', data: new TextEncoder().encode(uploadGuideText(b)) },
      ]
      downloadBlob(createZip(entries), `seed-upload_${stamp}.zip`)
    } else {
      downloadBlob(new Blob([b.json], { type: 'application/json' }), `seed-bank_${stamp}.json`)
    }
    setMsg((m) => `${m || ''}\n已开始下载，请在浏览器的下载目录里找文件。`.trim())
  }

  const jsonBytes = built ? new Blob([built.json]).size : 0

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">种子题库管理</h1>
        <p className="mt-1 text-[13px] leading-6 text-slate-500">
          在浏览器里把 PDF / Word / 文本 / JSON 资料<b>直接变成 seed-bank.json</b>
          ，下载后替换 GitHub 仓库里的 <code>app/public/data/seed-bank.json</code>
          ，所有访问者刷新页面即可同步到新题目。
        </p>
      </div>

      {/* ---------- 概览 ---------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">本地题库概览</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="总题数" value={questions.length} />
          <Stat label="含答案" value={stats.withAns} tone="ok" />
          <Stat label="含图片" value={stats.withImg} />
          <Stat label="已作答" value={Object.keys(records).length} />
        </div>
        {stats.embedded > 0 && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-700">
            本地题库里有 {stats.embedded} 题的图片是 base64 内嵌的。导出种子时建议选
            「图片分离包」或「精简」，否则 JSON 会非常大。
          </p>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[13px] text-blue-600 hover:text-blue-700">
            查看章节 / 题型 / 来源分布
          </summary>
          <div className="mt-3 space-y-4">
            <div className="space-y-2">
              {CHAPTERS.map((c) => {
                const n = stats.byChapter[c.id] || 0
                const pct = questions.length ? Math.round((n / questions.length) * 100) : 0
                return (
                  <div key={c.id} className="rounded-lg bg-slate-50/70 p-2.5">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <div className="min-w-0 flex-1 text-[13px] text-slate-700">
                        <span className="font-medium">{c.no}、</span>
                        <span>{c.name}</span>
                      </div>
                      <div className="shrink-0 text-xs tabular-nums text-slate-500">
                        <b className="text-slate-800">{n}</b> 题 · {pct}%
                      </div>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded bg-slate-200">
                      <div
                        className="h-full rounded bg-blue-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              {Object.entries(TYPE_LABEL).map(([k, label]) => (
                <div key={k} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="text-slate-500">{label}</div>
                  <div className="text-base font-semibold text-slate-800">
                    {stats.byType[k] || 0}
                  </div>
                </div>
              ))}
            </div>
            <div className="max-h-40 space-y-1 overflow-auto text-xs text-slate-600">
              {[...stats.bySource.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([src, n]) => (
                  <div key={src} className="flex items-center gap-2 border-b border-slate-100 py-1">
                    <span className="min-w-0 flex-1 truncate">{src}</span>
                    <span className="shrink-0 text-slate-400">{n} 题</span>
                  </div>
                ))}
              {!stats.bySource.size && <div className="py-2 text-slate-400">（本地题库为空）</div>}
            </div>
          </div>
        </details>
      </section>

      {/* ---------- ① 从资料文件生成 ---------- */}
      <Panel
        step="①"
        title="从资料文件生成 seed-bank.json"
        desc="选定 PDF / Word / 文本 / JSON（可多选）→ 浏览器解析 → 下载种子文件。整个过程不写入本地题库。"
        open={open === 'file'}
        onToggle={() => setOpen(open === 'file' ? null : 'file')}
      >
        <DropZone
          busy={busy}
          onPick={() => fileInputRef.current?.click()}
          onFiles={(fs) => void buildFromFiles(fs)}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/json,text/plain"
          className="hidden"
          onChange={(e) => {
            const fs = Array.from(e.target.files || [])
            if (fs.length) void buildFromFiles(fs)
            e.target.value = ''
          }}
        />
        <ImageModePicker value={imgMode} onChange={setImgMode} disabled={busy} />

        {busy && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate">
                {busyHint || '正在处理…'}
                {progress.phase === 'parsing' && `（第 ${progress.current}/${progress.total} 页）`}
              </span>
              <span className="shrink-0 tabular-nums">
                {Math.min(100, Math.round((progress.current / (progress.total || 1)) * 100))}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-blue-100">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{
                  width: `${Math.min(100, Math.round((progress.current / (progress.total || 1)) * 100))}%`,
                }}
              />
            </div>
          </div>
        )}
      </Panel>

      {/* ---------- ② 从本地题库导出 ---------- */}
      <Panel
        step="②"
        title="从本地题库导出 seed-bank.json"
        desc="把已经导入到本机的题目一次性整理成种子文件，格式与仓库里的完全一致。"
        open={open === 'local'}
        onToggle={() => setOpen(open === 'local' ? null : 'local')}
      >
        <ImageModePicker value={imgMode} onChange={setImgMode} disabled={busy} />
        <button
          onClick={buildFromLocal}
          disabled={busy || !ready || !questions.length}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          {busy ? '处理中…' : `整理本地 ${questions.length} 题为种子`}
        </button>
        {!questions.length && (
          <p className="text-xs text-slate-400">本地题库为空，先到「导入题库」导入资料。</p>
        )}
      </Panel>

      {/* ---------- ③ 合并种子到本地 ---------- */}
      <Panel
        step="③"
        title="合并 seed-bank.json 到本地"
        desc="拿到别人分享或仓库里更新的种子文件，按题干哈希去重后并入本机题库。"
        open={open === 'merge'}
        onToggle={() => setOpen(open === 'merge' ? null : 'merge')}
      >
        <button
          onClick={() => seedInputRef.current?.click()}
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
        >
          选择 seed-bank.json
        </button>
        <input
          ref={seedInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void mergeSeedIntoLocal(f)
            e.target.value = ''
          }}
        />
        <p className="text-xs text-slate-400">合并只影响这台设备的 IndexedDB，不会改动 GitHub。</p>
      </Panel>

      {/* ---------- 结果 ---------- */}
      {built && (
        <section className="rounded-xl border border-emerald-300 bg-emerald-50/60 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-emerald-800">种子已生成</h2>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">
              {MODE_TIP[built.imgMode].title}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Stat label="题目数" value={built.questions.length} />
            <Stat label="文件体积" value={0} text={formatBytes(jsonBytes)} />
            <Stat label="含图片" value={built.imgCount} />
            <Stat label="跳过" value={built.dropped} />
          </div>

          {jsonBytes > 25 * 1024 * 1024 && built.imgMode !== 'zip' && (
            <p className="mt-2 rounded-md bg-amber-100 px-3 py-2 text-[12px] leading-5 text-amber-800">
              文件 {formatBytes(jsonBytes)} 超过 GitHub 网页端 25 MB 单文件上限，
              建议改用「图片分离包」模式重新生成。
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => downloadBuilt(built)}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
            >
              {built.imgMode === 'zip' ? '下载 seed-upload.zip' : '下载 seed-bank.json'}
            </button>
            <button
              onClick={() => setBuilt(null)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              清空结果
            </button>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer select-none text-[13px] text-emerald-700 hover:text-emerald-800">
              预览前 5 题
            </summary>
            <ol className="mt-2 space-y-2 text-[12px] leading-6 text-slate-700">
              {built.questions.slice(0, 5).map((q, i) => (
                <li key={q.id} className="rounded-lg bg-white p-2.5">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                      {TYPE_LABEL[q.type] || q.type}
                    </span>
                    <span className="text-slate-400">{q.source}</span>
                    {q.answer?.length ? (
                      <span className="text-emerald-600">答案 {q.answer.join(' / ')}</span>
                    ) : (
                      <span className="text-amber-600">缺答案</span>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap">
                    {i + 1}. {q.stem}
                  </div>
                </li>
              ))}
            </ol>
          </details>

          {built.sources.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              来源：{built.sources.join('、')}
            </p>
          )}
        </section>
      )}

      {msg && (
        <div className="whitespace-pre-line rounded-lg border border-blue-200 bg-blue-50 p-3 text-[12px] leading-6 text-blue-700">
          {msg}
        </div>
      )}
      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] leading-6 text-red-700">
          {err}
        </div>
      )}

      {/* ---------- 上传 GitHub 简明步骤 ---------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 text-[12px] leading-6 text-slate-600">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          拿到种子文件后怎么同步给所有人
        </h2>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            打开 GitHub 仓库，进入 <code>app/public/data/</code> 目录
          </li>
          <li>
            点 <b>Add file ▸ Upload files</b>，把 <code>seed-bank.json</code>
            （同名会直接覆盖）拖进去；图片分离包还要一起拖入 <code>img</code> 文件夹
          </li>
          <li>拉到页面底部，填 Commit 信息，点 Commit changes</li>
          <li>
            Actions 会自动构建部署，等绿色对勾后（约 1–2 分钟）访问 Pages 网址
          </li>
          <li>
            所有人刷新页面即可看到新题；本机已有的题按题干哈希去重，不会重复
          </li>
        </ol>
      </section>
    </div>
  )
}

/* ---------------- 子组件 ---------------- */

function Panel({
  step,
  title,
  desc,
  open,
  onToggle,
  children,
}: {
  step: string
  title: string
  desc: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'rounded-xl border bg-white',
        open ? 'border-blue-300 shadow-sm' : 'border-slate-200',
      )}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-4 text-left"
        aria-expanded={open}
      >
        <span
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
            open ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500',
          )}
        >
          {step}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-800">{title}</span>
          <span className="mt-0.5 block text-[12px] leading-5 text-slate-500">{desc}</span>
        </span>
        <span className={cn('mt-1 shrink-0 text-slate-400 transition', open && 'rotate-180')}>
          ▾
        </span>
      </button>
      {open && <div className="space-y-3 border-t border-slate-100 p-4">{children}</div>}
    </section>
  )
}

function DropZone({
  busy,
  onPick,
  onFiles,
}: {
  busy: boolean
  onPick: () => void
  onFiles: (files: File[]) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const fs = Array.from(e.dataTransfer.files || [])
        if (fs.length && !busy) onFiles(fs)
      }}
      onClick={() => !busy && onPick()}
      className={cn(
        'cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition',
        over ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100',
        busy && 'pointer-events-none opacity-50',
      )}
    >
      <div className="text-2xl">📄</div>
      <div className="mt-1 text-sm font-medium text-slate-700">
        点击选择文件，或把资料拖到这里
      </div>
      <div className="mt-1 text-[12px] text-slate-500">
        支持 PDF / Word(.docx) / 文本(.txt .md) / JSON，可一次选多个
      </div>
    </div>
  )
}

function ImageModePicker({
  value,
  onChange,
  disabled,
}: {
  value: ImgMode
  onChange: (m: ImgMode) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[12px] font-medium text-slate-600">图片处理方式</div>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {(['strip', 'zip', 'embed'] as ImgMode[]).map((m) => {
          const t = MODE_TIP[m]
          return (
            <button
              key={m}
              type="button"
              disabled={disabled}
              onClick={() => onChange(m)}
              className={cn(
                'rounded-lg border p-2.5 text-left transition disabled:opacity-50',
                value === m
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border',
                    value === m ? 'border-blue-600 bg-blue-600' : 'border-slate-300',
                  )}
                >
                  {value === m && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="text-[13px] font-medium text-slate-800">{t.title}</span>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-slate-500">{t.desc}</div>
            </button>
          )
        })}
      </div>
      {MODE_TIP[value].warn && (
        <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] leading-4 text-amber-700">
          {MODE_TIP[value].warn}
        </p>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  text,
}: {
  label: string
  value: number
  tone?: 'ok'
  text?: string
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-lg font-semibold tabular-nums',
          tone === 'ok' ? 'text-emerald-600' : 'text-slate-800',
        )}
      >
        {text ?? value}
      </div>
    </div>
  )
}

/** 图片分离包里附带的说明文本 */
function uploadGuideText(b: BuiltSeed): string {
  return [
    '山东专升本刷题站 —— 种子上传说明',
    '',
    `本包包含 seed-bank.json（${b.questions.length} 题）与 img/ 图片目录。`,
    '',
    '上传步骤（GitHub 网页端，无需 git 命令行）：',
    '1. 打开仓库，进入 app/public/data/ 目录',
    '2. 点击 Add file ▸ Upload files',
    '3. 把本包里的 seed-bank.json 和 img 文件夹一起拖进上传区',
    '    （同名文件会直接覆盖，旧题会被替换成新题）',
    '4. 页面底部填写 Commit 说明，点击 Commit changes',
    '5. 顶部 Actions 页签出现绿色对勾后（约 1-2 分钟）即部署完成',
    '',
    '注意：GitHub 网页端单文件上限 25 MB；如果 seed-bank.json 超限，',
    '请回到「种子管理」页改用「精简」模式重新生成。',
    '',
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
  ].join('\r\n')
}
