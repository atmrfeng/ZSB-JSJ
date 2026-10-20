/** PDF 文本提取：主线程调度 + Worker 执行 */
import PdfWorker from '@/workers/pdfWorker?worker'

export interface ExtractProgress {
  phase: 'reading' | 'parsing' | 'structuring' | 'done'
  current: number
  total: number
}

export interface PageImagePack {
  start: number
  end: number
  images: string[]
}

export interface ExtractResult {
  lines: string[]
  totalPages: number
  /** 平均每页字符数，用于判断是否为扫描版（无文本层） */
  charsPerPage: number
  /** 每页行区间与该页内嵌图片 */
  pageImages: PageImagePack[]
  /** 提取到的图片总数 */
  imageCount: number
}

export interface ExtractOptions {
  /** 是否提取 PDF 内嵌图片，默认 true */
  withImages?: boolean
  onProgress?: (p: ExtractProgress) => void
}

export function extractPdf(
  file: File,
  options?: ExtractOptions | ((p: ExtractProgress) => void),
): { promise: Promise<ExtractResult>; cancel: () => void } {
  const opts: ExtractOptions =
    typeof options === 'function' ? { onProgress: options } : options || {}
  const onProgress = opts.onProgress
  const worker = new PdfWorker()
  let cancelled = false

  const promise = new Promise<ExtractResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (cancelled) return
      if (d.type === 'progress') {
        onProgress?.({ phase: 'parsing', current: d.current, total: d.total })
      } else if (d.type === 'error') {
        worker.terminate()
        reject(new Error(d.message || 'PDF 解析失败'))
      } else if (d.type === 'done') {
        worker.terminate()
        const lines: string[] = d.lines || []
        const chars = lines.reduce((s, l) => s + l.length, 0)
        const pages = d.totalPages || 1
        const pageImages: PageImagePack[] = d.pageImages || []
        onProgress?.({ phase: 'done', current: pages, total: pages })
        resolve({
          lines,
          totalPages: pages,
          charsPerPage: Math.round(chars / pages),
          pageImages,
          imageCount: pageImages.reduce((s, p) => s + p.images.length, 0),
        })
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'PDF 解析线程异常'))
    }
    onProgress?.({ phase: 'reading', current: 0, total: 100 })
    worker.postMessage({ type: 'start', file, withImages: opts.withImages !== false })
  })

  return {
    promise,
    cancel: () => {
      cancelled = true
      worker.terminate()
    },
  }
}

/**
 * 把每页提取到的图片按行区间分配到题目上。
 * 同页多图多题时按绘制顺序与前后顺序均匀分配（图片通常出现在对应题目的上方）。
 */
export function attachPageImages<T extends { lineStart?: number; images?: string[] }>(
  questions: T[],
  pageImages: PageImagePack[],
): void {
  if (!pageImages?.length) return
  for (const pack of pageImages) {
    if (!pack.images?.length) continue
    const targets = questions
      .map((q, idx) => ({ idx, line: q.lineStart ?? -1 }))
      .filter((t) => t.line >= pack.start && t.line < pack.end)
    if (!targets.length) continue
    const k = pack.images.length
    const n = targets.length
    targets.forEach((t, order) => {
      const from = Math.floor((order * k) / n)
      const to = Math.floor(((order + 1) * k) / n)
      const slice = pack.images.slice(from, Math.max(from + 1, to))
      const q = questions[t.idx]
      q.images = [...(q.images || []), ...slice.filter((u) => !(q.images || []).includes(u))]
    })
  }
}

export function isScannedPdf(r: ExtractResult): boolean {
  return r.charsPerPage < 60
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
