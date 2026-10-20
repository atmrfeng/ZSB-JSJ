/**
 * 多格式题库导入统一接口
 *
 * 支持：
 *   1) PDF  ：走 pdf.js + Worker 解析（保留配图）
 *   2) DOCX ：mammoth.js 转 HTML，再走结构化解析
 *   3) 文本 ：TXT / Markdown，识别「一、单选 / 1.题干 / A.BCD」格式
 *   4) JSON ：严格 schema 校验；支持单文件备份导出格式（{questions:[...]}）
 */
import mammoth from 'mammoth'
import {
  extractPdf,
  attachPageImages,
  formatBytes,
  type ExtractProgress,
} from './pdf'
import {
  parseDocument,
  splitOptions,
  cleanText,
  normalizeForHash,
  type ParsedQuestion,
  applyAnswers,
  parseAnswers,
} from './parser'
import type { Question, QuestionType } from '@/types'

export interface ImportResult {
  questions: ParsedQuestion[]
  /** 用于统计/展示的额外元数据 */
  meta: {
    source: string
    fileType: 'pdf' | 'docx' | 'text' | 'json'
    pages?: number
    imageCount?: number
    rawSize?: number
    rawText?: string
  }
}

export type { ExtractProgress }

/** 拖入文件时自动判断格式 */
export function detectFormat(file: File): 'pdf' | 'docx' | 'text' | 'json' | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf'
  if (
    name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return 'docx'
  if (name.endsWith('.json') || file.type === 'application/json') return 'json'
  if (
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    file.type.startsWith('text/')
  )
    return 'text'
  return null
}

// ---------- PDF ----------

export async function importFromPdf(
  file: File,
  onProgress: (p: ExtractProgress) => void,
): Promise<ImportResult> {
  const { promise, cancel } = extractPdf(file, { withImages: true, onProgress })
  try {
    const res = await promise
    const qs = parseDocument(res.lines, file.name)
    attachPageImages(qs, res.pageImages)
    return {
      questions: qs,
      meta: {
        source: file.name,
        fileType: 'pdf',
        pages: res.totalPages,
        imageCount: res.imageCount,
      },
    }
  } catch (e) {
    if ((e as Error).name === 'Canceled') throw e
    throw e
  } finally {
    void cancel
  }
}

// ---------- DOCX ----------

/** mammoth 把 docx 转成 HTML。题干里 <img> 用 dataURL，选项与答案从纯文本中分离。 */
async function docxToHtml(buf: ArrayBuffer): Promise<{ html: string; text: string }> {
  const res = await mammoth.convertToHtml({ arrayBuffer: buf })
  const text = await mammoth.extractRawText({ arrayBuffer: buf })
  return { html: res.value, text: text.value }
}

/** 把 mammoth HTML 还原为题行（含 IMG_TOKEN 占位），并提取图片 dataURL */
function htmlToLinesWithImages(html: string): { lines: string[]; images: string[] } {
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<root>${html}</root>`, 'text/html')
  const root = doc.body
  const lines: string[] = []
  const images: string[] = []

  // 段块（含行内图片）+ 表格行
  const pushInline = (el: Element): string => {
    let out = ''
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.textContent || ''
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const t = (n as Element).tagName.toLowerCase()
        if (t === 'img') {
          const src = (n as HTMLImageElement).getAttribute('src') || ''
          if (src) images.push(src)
          out += '\x00IMG\x00'
        } else if (t === 'br') {
          out += '\n'
        } else if (t === 'p') {
          out += pushInline(n as Element)
          out += '\n'
        } else if (t === 'table') {
          out += pushTable(n as Element)
        } else {
          out += pushInline(n as Element)
        }
      }
    })
    return out
  }

  const pushTable = (tbl: Element): string => {
    let out = ''
    tbl.querySelectorAll('tr').forEach((tr) => {
      tr.querySelectorAll('th,td').forEach((td) => {
        out += pushInline(td as Element) + '\t'
      })
      out = out.replace(/\t$/, '') + '\n'
    })
    return out
  }

  root.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = (n.textContent || '').trim()
      if (t) lines.push(t)
      return
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const el = n as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'p') {
      const block = pushInline(el).trim()
      block.split(/\n+/).forEach((l) => l && lines.push(l))
    } else if (tag === 'table') {
      pushTable(el)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((l) => lines.push(l))
    } else if (tag === 'ol' || tag === 'ul') {
      el.querySelectorAll('li').forEach((li) => {
        const block = pushInline(li as Element).trim()
        block.split(/\n+/).forEach((l) => l && lines.push(l))
      })
    } else {
      const block = pushInline(el).trim()
      block.split(/\n+/).forEach((l) => l && lines.push(l))
    }
  })
  return { lines, images }
}

const DOCX_TYPE_HEADER_RE = /^([一二三四五六七八九十]+)、(单项选择题|多项选择题|判断题|填空题|操作题|分析题|综合应用题|简答题)/
const DOCX_Q_START_RE = /^(\d{1,3})[.、．]\s*(.*)$/

const IMG_RE = /如图|下图|图\s*\d|图[一二三四五六七八九十]/g
function detectImageRef(text: string): boolean {
  IMG_RE.lastIndex = 0
  return IMG_RE.test(text)
}
const NOISE: RegExp[] = [
  /^计算机同步练习$/,
  /库课/,
  /^·\d+·/,
  /·\d+·\s*$/,
  /^第[ⅠⅡ]卷$/,
  /^注意事项/,
  /^本试卷分为/,
  /^\d+[.、．]?答题前/,
  /^第Ⅰ卷每小题/,
  /^第Ⅱ卷答题/,
  /^\d+[.、．]?第Ⅰ卷每小题/,
  /^\d+[.、．]?第Ⅱ卷答题/,
  /^\d{4}—\d{4}年/,
  /^试题\s*精析$/,
  /^[^\u4e00-\u9fa5A-Za-z0-9]{0,3}$/,
]
function isNoiseLine(line: string, section?: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (/^\d{1,3}$/.test(t) && section !== 'operation') return true
  return NOISE.some((r) => r.test(t))
}

export async function importFromDocx(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer()
  const { html, text } = await docxToHtml(buf)
  const { lines, images } = htmlToLinesWithImages(html)
  // 同时把纯文本作为 fallback（应付无图片 docx）
  if (!lines.length && text) lines.push(...text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))

  const out: ParsedQuestion[] = []
  let currentType: QuestionType = 'single'
  let material: string[] = []
  let buf2: { no: number; type: QuestionType; lines: string[]; imgs: string[]; lineStart: number } | null = null
  let lastNo = 0
  let imgCursor = 0

  const flush = () => {
    if (!buf2) return
    const text = buf2.lines.join('\n')
    const { stem, options } = splitOptions(text)
    let blankCount = 1
    if (buf2.type === 'fill') {
      const parts = stem.split(/\s{4,}|　+|_{3,}/g)
      blankCount = Math.max(1, parts.length - 1)
    }
    const cleanedStem = cleanText(stem)
    if (cleanedStem) {
      const tags: string[] = []
      // 详见 parser.ts 同段注释：「(考点N)」「(附加题)」只是占位符，不当考点标签
      const tm = cleanedStem.match(/^[（(](考点[\d、，,\s]*|附加题)[）)]\s*/)
      let bodyStem = cleanedStem
      if (tm) {
        bodyStem = cleanedStem.slice(tm[0].length).trim()
      }
      // group 是操作题分节标题（如「Word 操作题」），仅用于材料归属，不写入 tags
      out.push({
        no: buf2.no,
        type: buf2.type,
        stem: bodyStem,
        options: options.map((o) => ({ key: o.key, text: cleanText(o.text) })),
        answer: [],
        explanation: '',
        material: buf2.type === 'operation' ? cleanText(material.join('\n')) : '',
        tags,
        blankCount,
        confidence: 'low',
        hasImageRef: detectImageRef(text) || buf2.imgs.length > 0,
        images: buf2.imgs.slice(),
        lineStart: buf2.lineStart,
        raw: text,
      })
    }
    buf2 = null
  }

  for (let li = 0; li < lines.length; li++) {
    const l = lines[li].trim()
    if (!l) continue
    const tm = l.match(DOCX_TYPE_HEADER_RE)
    if (tm) {
      flush()
      currentType =
        (tm[2] === '单项选择题'
          ? 'single'
          : tm[2] === '多项选择题'
            ? 'multi'
            : tm[2] === '判断题'
              ? 'judge'
              : tm[2] === '填空题'
                ? 'fill'
                : 'operation') as QuestionType
      // 详见 parser.ts：操作题分节标题不再写入 tags，也不作为材料正文的一部分
      material = []
      lastNo = 0
      continue
    }
    const gm = l.match(/^[(（]([一二三四五六七八九十])[)）]\s*(.*)$/)
    if (gm && currentType === 'operation') {
      flush()
      material = []
      continue
    }
    if (isNoiseLine(l, currentType)) continue
    const qm = l.match(DOCX_Q_START_RE)
    if (qm) {
      const no = parseInt(qm[1], 10)
      const rest = qm[2]
      if (currentType === 'operation' && (no < 30 || no <= lastNo || rest.trim().length < 6)) {
        if (buf2) buf2.lines.push(l)
        else material.push(l)
        continue
      }
      flush()
      if (currentType !== 'operation') material = []
      lastNo = no
      // 把该题至下一题之前遇到的图片一并收入
      const imgs: string[] = []
      while (imgCursor < images.length) {
        // 简单策略：每遇到新题，把到目前为止未分配的图片收归本题
        imgs.push(images[imgCursor])
        imgCursor++
        if (imgs.length >= 3) break // 单题图片上限，避免被前面段落的图污染
      }
      buf2 = { no, type: currentType, lines: [rest], imgs, lineStart: li }
      continue
    }
    if (buf2) buf2.lines.push(l)
    else if (currentType === 'operation') material.push(l)
  }
  flush()

  // 题目级附件图片合并：题干首段含 IMG_TOKEN 时，把剩余未分配图按行区间补到最后几题
  let orphan = images.slice(imgCursor)
  if (orphan.length) {
    const lastFew = out.slice(-Math.min(orphan.length, out.length))
    lastFew.forEach((q, i) => {
      if (i < orphan.length) q.images = [...(q.images || []), orphan[i]]
      q.hasImageRef = true
    })
  }

  return {
    questions: out,
    meta: {
      source: file.name,
      fileType: 'docx',
      rawSize: buf.byteLength,
      imageCount: images.length,
    },
  }
}

// ---------- 文本（TXT / Markdown） ----------

const TXT_TYPE_HEADER = /^#{0,3}\s*[一二三四五六七八九十]+[、.]\s*(单项选择题|多项选择题|判断题|填空题|操作题|分析题|综合应用题|简答题)/
const TXT_ANSWER_HEADER = /^\s*(参考答案|答案精析|答案)\s*$/

export async function importFromText(text: string, source = '文本导入'): Promise<ImportResult> {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim())
  // 分割试题区与答案区
  let ansIdx = -1
  for (let i = 0; i < rawLines.length; i++) {
    if (TXT_ANSWER_HEADER.test(rawLines[i])) {
      ansIdx = i
      break
    }
  }
  const qLines = ansIdx >= 0 ? rawLines.slice(0, ansIdx) : rawLines
  const aLines = ansIdx >= 0 ? rawLines.slice(ansIdx) : []

  const out: ParsedQuestion[] = []
  let currentType: QuestionType = 'single'
  let material: string[] = []
  let buf3: { no: number; type: QuestionType; lines: string[]; lineStart: number } | null = null
  let lastNo = 0

  const flush = () => {
    if (!buf3) return
    const text = buf3.lines.join('\n')
    const { stem, options } = splitOptions(text)
    let blankCount = 1
    if (buf3.type === 'fill') {
      const parts = stem.split(/\s{4,}|　+|_{3,}/g)
      blankCount = Math.max(1, parts.length - 1)
    }
    const cleanedStem = cleanText(stem)
    if (cleanedStem) {
      const tags: string[] = []
      // 详见 parser.ts：「(考点N)」「(附加题)」只是占位符，不写入 tags
      const tm = cleanedStem.match(/^[（(](考点[\d、，,\s]*|附加题)[）)]\s*/)
      let body = cleanedStem
      if (tm) {
        body = cleanedStem.slice(tm[0].length).trim()
      }
      // group 仅用于材料归属，不写入 tags
      out.push({
        no: buf3.no,
        type: buf3.type,
        stem: body,
        options: options.map((o) => ({ key: o.key, text: cleanText(o.text) })),
        answer: [],
        explanation: '',
        material: buf3.type === 'operation' ? cleanText(material.join('\n')) : '',
        tags,
        blankCount,
        confidence: 'low',
        hasImageRef: detectImageRef(text),
        images: [],
        lineStart: buf3.lineStart,
        raw: text,
      })
    }
    buf3 = null
  }

  for (let li = 0; li < qLines.length; li++) {
    const l = qLines[li]
    if (!l) continue
    const tm = l.match(TXT_TYPE_HEADER)
    if (tm) {
      flush()
      currentType =
        (tm[1] === '单项选择题'
          ? 'single'
          : tm[1] === '多项选择题'
            ? 'multi'
            : tm[1] === '判断题'
              ? 'judge'
              : tm[1] === '填空题'
                ? 'fill'
                : 'operation') as QuestionType
      // 详见 parser.ts：操作题分节标题不再写入 tags，也不作为材料正文的一部分
      material = []
      lastNo = 0
      continue
    }
    const gm = l.match(/^[(（]([一二三四五六七八九十])[)）]\s*(.*)$/)
    if (gm && currentType === 'operation') {
      flush()
      material = []
      continue
    }
    if (isNoiseLine(l, currentType)) continue
    const qm = l.match(DOCX_Q_START_RE)
    if (qm) {
      const no = parseInt(qm[1], 10)
      const rest = qm[2]
      if (currentType === 'operation' && (no < 30 || no <= lastNo || rest.trim().length < 6)) {
        if (buf3) buf3.lines.push(l)
        else material.push(l)
        continue
      }
      flush()
      if (currentType !== 'operation') material = []
      lastNo = no
      buf3 = { no, type: currentType, lines: [rest], lineStart: li }
      continue
    }
    if (buf3) buf3.lines.push(l)
    else if (currentType === 'operation') material.push(l)
  }
  flush()

  if (aLines.length) {
    const pack = parseAnswers(aLines)
    applyAnswers(out, pack)
  }
  return {
    questions: out,
    meta: {
      source,
      fileType: 'text',
      rawSize: text.length,
      rawText: text.length > 1500 ? text.slice(0, 1500) + '...' : text,
    },
  }
}

// ---------- JSON ----------

interface JsonQuestion {
  no?: number
  type?: string
  stem?: string
  options?: Array<{ key: string; text: string }> | string[]
  answer?: string | string[]
  explanation?: string
  material?: string
  tags?: string[]
  chapterId?: string
  source?: string
  blankCount?: number
  images?: string[]
}

/**
 * JSON 导入规则：
 *  1) 顶层 { questions: [...] }
 *  2) 或顶层就是数组
 *  3) options 支持 ["A. xx", ...] 或 [{key:"A",text:"xx"}]
 *  4) type 接受中文或英文
 *  5) answer 接受字符串 "AB" 或数组 ["A","B"]
 */
export async function importFromJson(text: string, source = 'JSON 导入'): Promise<ImportResult> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new Error('JSON 解析失败：' + (e as Error).message)
  }
  const arr: JsonQuestion[] = Array.isArray(raw)
    ? (raw as JsonQuestion[])
    : (raw as { questions?: JsonQuestion[] })?.questions
      ? (raw as { questions: JsonQuestion[] }).questions
      : []
  if (!arr.length) throw new Error('JSON 中未找到 questions 字段或为空数组')

  const TYPE_NAME_MAP: Record<string, QuestionType> = {
    单选题: 'single',
    单项选择题: 'single',
    single: 'single',
    多选题: 'multi',
    多项选择题: 'multi',
    multi: 'multi',
    判断题: 'judge',
    judge: 'judge',
    填空题: 'fill',
    fill: 'fill',
    操作题: 'operation',
    简答题: 'operation',
    分析题: 'operation',
    综合应用题: 'operation',
    operation: 'operation',
  }

  const out: ParsedQuestion[] = []
  arr.forEach((q, i) => {
    const stem = (q.stem || '').toString().trim()
    if (!stem) return
    const type = TYPE_NAME_MAP[(q.type || '').toString().trim()] || 'single'
    let options: { key: string; text: string }[] = []
    if (Array.isArray(q.options)) {
      options = q.options.map((o) => {
        if (typeof o === 'string') {
          const m = o.match(/^([A-Da-d])[.、．]?\s*(.*)$/)
          return m ? { key: m[1].toUpperCase(), text: m[2] } : { key: '?', text: o }
        }
        return { key: (o.key || '?').toUpperCase(), text: (o.text || '').toString() }
      })
    }
    let answer: string[] = []
    if (Array.isArray(q.answer)) answer = q.answer.map((x) => x.toString().trim()).filter(Boolean)
    else if (typeof q.answer === 'string')
      answer = q.answer.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean)
    const images = Array.isArray(q.images) ? q.images : []
    const tags = Array.isArray(q.tags) ? q.tags.map(String) : []
    out.push({
      no: q.no ?? i + 1,
      type,
      stem,
      options,
      answer,
      explanation: q.explanation || '',
      material: q.material || '',
      tags,
      blankCount: q.blankCount || 1,
      confidence: answer.length ? 'high' : 'low',
      hasImageRef: detectImageRef(stem) || images.length > 0,
      images,
      lineStart: i,
      raw: stem,
    })
  })

  return {
    questions: out,
    meta: { source, fileType: 'json', rawSize: text.length, rawText: text.slice(0, 600) + (text.length > 600 ? '...' : '') },
  }
}

// ---------- 入口分发 ----------

export async function runImport(
  file: File,
  format: 'pdf' | 'docx' | 'text' | 'json',
  onProgress: (p: ExtractProgress) => void,
): Promise<ImportResult> {
  if (format === 'pdf') return importFromPdf(file, onProgress)
  if (format === 'docx') return importFromDocx(file)
  if (format === 'text') {
    const t = await file.text()
    return importFromText(t, file.name)
  }
  if (format === 'json') {
    const t = await file.text()
    return importFromJson(t, file.name)
  }
  throw new Error('不支持的格式')
}

export { formatBytes }

// 重新导出 parseDocument 等方便旧逻辑
export {
  parseDocument,
  applyAnswers,
  parseAnswers,
  normalizeForHash,
}
export type { Question }