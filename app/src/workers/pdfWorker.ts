/// <reference lib="webworker" />
/**
 * PDF 解析 Worker
 *
 * 职责：读取文件 → 逐页提取文本层 → 按坐标重组为行 → 提取嵌入图片 → 实时回报进度。
 * 全程在独立线程执行，因此 100MB 级别的真题 PDF 也不会卡住界面。
 */
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface StartMessage {
  type: 'start'
  file: File
  /** 是否同时提取页面中嵌入的图片（默认 true） */
  withImages?: boolean
}

export interface PageImagePack {
  /** 该页首行在 lines 中的下标 */
  start: number
  /** 该页末行下标 + 1 */
  end: number
  /** 该页内嵌图片（dataURL，按绘制顺序） */
  images: string[]
}

const post = (msg: Record<string, unknown>) =>
  (self as unknown as Worker).postMessage(msg)

/** 图片体积保护：单页最多提取图片数、整篇最多图片数、缩放上限宽 */
const MAX_IMG_PER_PAGE = 8
const MAX_IMG_TOTAL = 300
const MAX_IMG_WIDTH = 1000

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('图片转码失败'))
    fr.readAsDataURL(blob)
  })
}

async function canvasToDataUrl(canvas: OffscreenCanvas): Promise<string | null> {
  try {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 })
    return await blobToDataUrl(blob)
  } catch {
    return null
  }
}

/** 把 pdf.js 取出的图片对象转成 JPEG dataURL */
async function toDataUrl(img: unknown): Promise<string | null> {
  try {
    if (typeof OffscreenCanvas === 'undefined') return null
    const anyImg = img as {
      width?: number
      height?: number
      data?: Uint8ClampedArray | Uint8Array | number[]
    }
    if (img instanceof ImageBitmap) {
      if (img.width < 60 || img.height < 60) return null
      const scale = Math.min(1, MAX_IMG_WIDTH / img.width)
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img, 0, 0, w, h)
      return await canvasToDataUrl(canvas)
    }
    const w = anyImg?.width || 0
    const h = anyImg?.height || 0
    const data = anyImg?.data
    if (w && h && data) {
      if (w < 60 || h < 60) return null
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      const clamped =
        data instanceof Uint8ClampedArray
          ? data
          : new Uint8ClampedArray((data as ArrayLike<number>).length)
      if (!(data instanceof Uint8ClampedArray)) clamped.set(data as ArrayLike<number>)
      const ImageDataCtor = ImageData as unknown as new (
        data: Uint8ClampedArray,
        w: number,
        h: number,
      ) => ImageData
      ctx.putImageData(new ImageDataCtor(clamped, w, h), 0, 0)
      return await canvasToDataUrl(canvas)
    }
  } catch {
    return null
  }
  return null
}

/** 提取某页内嵌图片（按绘制顺序） */
async function extractPageImages(page: import('pdfjs-dist').PDFPageProxy): Promise<string[]> {
  try {
    const ops = await page.getOperatorList()
    const ids: string[] = []
    const paintOps = new Set<number>()
    const opTable = pdfjsLib.OPS as unknown as Record<string, number | undefined>
    for (const name of ['paintImageXObject', 'paintInlineImageXObject', 'paintXObject']) {
      const v = opTable[name]
      if (typeof v === 'number') paintOps.add(v)
    }
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (!paintOps.has(ops.fnArray[i])) continue
      const arg = ops.argsArray?.[i]?.[0]
      if (typeof arg === 'string' && arg && !ids.includes(arg)) ids.push(arg)
    }
    const out: string[] = []
    for (const id of ids.slice(0, MAX_IMG_PER_PAGE)) {
      try {
        const obj = await (page as unknown as { objs: { get: (k: string) => Promise<unknown> } }).objs.get(id)
        const url = await toDataUrl(obj)
        if (url) out.push(url)
      } catch {
        /* 单张失败忽略 */
      }
    }
    return out
  } catch {
    return []
  }
}

self.onmessage = async (e: MessageEvent<StartMessage>) => {
  if (e.data?.type !== 'start') return
  try {
    const file = e.data.file
    const withImages = e.data.withImages !== false
    post({ type: 'progress', current: 0, total: 100, phase: 'reading' })

    const buf = await file.arrayBuffer()
    const doc = await pdfjsLib.getDocument({ data: buf }).promise
    const total = doc.numPages
    const lines: string[] = []
    const pageImages: PageImagePack[] = []
    let imgCount = 0

    for (let p = 1; p <= total; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const items = content.items as Array<{
        str: string
        transform: number[]
        width: number
        hasEOL?: boolean
      }>

      // 按 y 坐标聚合成行
      const rows = new Map<number, Array<{ x: number; str: string }>>()
      for (const it of items) {
        if (!it.str) continue
        const y = Math.round(it.transform[5])
        if (!rows.has(y)) rows.set(y, [])
        rows.get(y)!.push({ x: it.transform[4], str: it.str })
      }

      const startLine = lines.length
      const ys = [...rows.keys()].sort((a, b) => b - a)
      for (const y of ys) {
        const row = rows.get(y)!.sort((a, b) => a.x - b.x)
        let line = ''
        for (const c of row) {
          if (!line) {
            line = c.str
            continue
          }
          const prev = line[line.length - 1]
          const next = c.str[0] || ''
          const needSpace = /[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next)
          line += (needSpace ? ' ' : '') + c.str
        }
        lines.push(line.replace(/[ \t]+/g, ' ').trim())
      }
      const endLine = lines.length

      const needImages = withImages && imgCount < MAX_IMG_TOTAL
      const imgs = needImages ? await extractPageImages(page) : []
      imgCount += imgs.length
      pageImages.push({ start: startLine, end: endLine, images: imgs })

      post({
        type: 'progress',
        current: p,
        total,
        phase: 'parsing',
        images: imgCount,
      })
    }

    post({ type: 'progress', current: total, total, phase: 'structuring' })
    post({ type: 'done', lines, totalPages: total, pageImages })
  } catch (err) {
    post({ type: 'error', message: (err as Error)?.message || String(err) })
  }
}
