/**
 * 题目文本解析器
 *
 * 支持两类主流资料版式：
 *  A. 智博同步练习：一、单项选择题 → 题号.(考点n)题干 → 选项 → 文末「参考答案」表格
 *  B. 库课历年真题：第Ⅰ卷/第Ⅱ卷 → 题型分节 → 题号.题干 → 选项；答案在「答案精析」区，
 *     格式为 `N.【精析】答案字母 解析内容`
 *
 * 该解析器同时被「内置题库构建」与「导入题库」复用，保证规则一致。
 */
import type { Option, QuestionType } from '@/types'

export interface ParsedQuestion {
  /** 资料内原始编号 */
  no: number
  type: QuestionType
  stem: string
  options: Option[]
  answer: string[]
  explanation: string
  material: string
  tags: string[]
  blankCount: number
  confidence: 'high' | 'low' | 'failed'
  hasImageRef: boolean
  /** 题目配图（dataURL 或资源路径） */
  images: string[]
  /** 该题起始行在原文 lines 中的下标，用于图片归属 */
  lineStart: number
  /** 该题在原文中的文本，用于校对时对照 */
  raw: string
}

const TYPE_MAP: Record<string, QuestionType> = {
  单项选择题: 'single',
  多项选择题: 'multi',
  判断题: 'judge',
  填空题: 'fill',
  操作题: 'operation',
  分析题: 'operation',
  综合应用题: 'operation',
  简答题: 'operation',
}

const TYPE_HEADER_RE = /^([一二三四五六七八九十])、(单项选择题|多项选择题|判断题|填空题|操作题|分析题|综合应用题|简答题)/
const Q_START_RE = /^(\d{1,3})[.、．]\s*(.*)$/
const OPT_RE = /(?:^|[\s\t　])([A-D])[.、．]\s*/g
const BLANK_RE = /\s{4,}|　+|_{3,}/g
const GROUP_RE = /^[(（]([一二三四五六七八九十])[)）]\s*(.*)$/

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

export function isNoiseLine(line: string, section?: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (/^\d{1,3}$/.test(t) && section !== 'operation') return true
  return NOISE.some((r) => r.test(t))
}

export function cleanText(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s*\(\s*[　\s]*\)/g, '（   ）')
    .trim()
}

export function normalizeForHash(s: string): string {
  let t = s.replace(/\s+/g, '')
  t = t.replace(/[，,。.、；;：:？?！!（）()【】\[\]「」“”"'’‘]/g, '')
  t = t.replace(/^[（(]?考点[\d、，,\s]*[)）]?/, '')
  t = t.replace(/^[（(]?附加题[)）]?/, '')
  const map: Record<string, string> = {
    '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
    '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
    'Ａ': 'A', 'Ｂ': 'B', 'Ｃ': 'C', 'Ｄ': 'D',
    'ａ': 'A', 'ｂ': 'B', 'ｃ': 'C', 'ｄ': 'D',
  }
  return t.replace(/[０-９Ａ-Ｄａ-ｄ]/g, (c) => map[c] || c)
}

export function splitOptions(text: string): { stem: string; options: Option[] } {
  OPT_RE.lastIndex = 0
  const matches: Array<{ key: string; start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = OPT_RE.exec(text)) !== null) {
    matches.push({ key: m[1], start: m.index, end: m.index + m[0].length })
  }
  if (!matches.length) return { stem: text.trim(), options: [] }
  const stem = text.slice(0, matches[0].start).trim()
  const options: Option[] = matches.map((mm, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length
    return { key: mm.key, text: text.slice(mm.end, end).trim() }
  })
  return { stem, options }
}

const IMG_RE = /如图|下图|图\s*\d|图[一二三四五六七八九十]/g

function detectImageRef(text: string): boolean {
  IMG_RE.lastIndex = 0
  return IMG_RE.test(text)
}

interface RawBlock {
  no: number
  type: QuestionType
  lines: string[]
  /** 起始行下标 */
  lineStart: number
}

export interface ParseResult {
  questions: ParsedQuestion[]
  /** 题型 → 该题型在原文中出现的顺序答案（用于无编号匹配） */
  orderedAnswers: Record<string, string[][]>
}

/** 解析「试题」部分 */
export function parseQuestions(lines: string[]): ParsedQuestion[] {
  const out: ParsedQuestion[] = []
  let currentType: QuestionType = 'single'
  let material: string[] = []
  let buf: RawBlock | null = null
  let lastNo = 0

  const flush = () => {
    if (!buf) return
    const text = buf.lines.join('\n')
    let { stem, options } = splitOptions(text)
    let blankCount = 1
    if (buf.type === 'fill') {
      const parts = stem.split(BLANK_RE)
      blankCount = Math.max(1, parts.length - 1)
      stem = stem.replace(BLANK_RE, '________')
    }
    stem = cleanText(stem)
    if (stem) {
      const tags: string[] = []
      // 仅剥离「(考点N)」「(附加题)」等占位符，不再当作考点标签——
      // 没有具体名称的考点标签对刷题毫无意义，且「考点1」「考点2」会让筛选列表显得很奇怪
      const tm = stem.match(/^[（(](考点[\d、，,\s]*|附加题)[）)]\s*/)
      if (tm) {
        stem = stem.slice(tm[0].length).trim()
      }
      // group（操作题分节标题，如「Word 操作题」「Excel 操作题」）仅用于控制材料归属，
      // 不再写入 tags，否则筛选列表会出现「整道题当成考点」的奇怪标签
      const hasAnswer = buf.type === 'operation' ? true : false
      out.push({
        no: buf.no,
        type: buf.type,
        stem,
        options: options.map((o) => ({ key: o.key, text: cleanText(o.text) })),
        answer: [],
        explanation: '',
        material: buf.type === 'operation' ? cleanText(material.join('\n')) : '',
        tags,
        blankCount,
        confidence: hasAnswer ? 'low' : 'low',
        hasImageRef: detectImageRef(text),
        images: [],
        lineStart: buf.lineStart,
        raw: text,
      })
    }
    buf = null
  }

  for (let li = 0; li < lines.length; li++) {
    const l = lines[li].trim()
    const tm = l.match(TYPE_HEADER_RE)
    if (tm) {
      flush()
      currentType = TYPE_MAP[tm[2]]
      material = []
      lastNo = 0
      continue
    }
    const gm = l.match(GROUP_RE)
    if (gm && currentType === 'operation') {
      // 操作题分节标题（如「(一) Word 操作题」）只起分节作用，
      // 不再写入 tags，也不作为材料正文的一部分
      flush()
      material = []
      continue
    }
    if (isNoiseLine(l, currentType)) continue
    const qm = l.match(Q_START_RE)
    if (qm) {
      const no = parseInt(qm[1], 10)
      const rest = qm[2]
      // 操作题材料中的表格行号（如 `1.` `2.`）不应视为新题目
      if (currentType === 'operation' && (no < 30 || no <= lastNo || rest.trim().length < 6)) {
        if (buf) buf.lines.push(l)
        else material.push(l)
        continue
      }
      flush()
      if (currentType !== 'operation') material = []
      lastNo = no
      buf = { no, type: currentType, lines: [rest], lineStart: li }
      continue
    }
    if (buf) buf.lines.push(l)
    else if (currentType === 'operation') material.push(l)
  }
  flush()
  return out
}

export interface AnswerPack {
  /** `${type}:${no}` → 答案 */
  byNo: Map<string, { answer: string[]; explanation: string }>
  /** 题型 → 按顺序的答案列表 */
  ordered: Record<string, string[][]>
}

/** 解析「参考答案 / 答案精析」部分 */
export function parseAnswers(lines: string[]): AnswerPack {
  const byNo = new Map<string, { answer: string[]; explanation: string }>()
  const ordered: Record<string, string[][]> = {}
  let type: QuestionType = 'single'
  let mode: 'num' | 'ans' | null = null
  let cur: { key: string; entry: { answer: string[]; explanation: string } } | null = null
  let pending: string[] = []

  const flushPending = () => {
    if (pending.length) {
      ordered[type] = ordered[type] || []
      ordered[type].push(pending)
      pending = []
    }
  }

  for (const raw of lines) {
    const l = raw.trim()
    const tm = l.match(TYPE_HEADER_RE)
    if (tm) {
      flushPending()
      type = TYPE_MAP[tm[2]]
      mode = null
      cur = null
      continue
    }
    if (isNoiseLine(l, type)) continue
    const gm = l.match(GROUP_RE)
    if (gm) {
      cur = null
      continue
    }
    // 真题格式：1.【精析】A 解析...
    const m = l.match(/^(\d{1,3})[.、．]\s*【精析】\s*([A-Da-d]+)?\s*(.*)$/)
    if (m) {
      flushPending()
      const no = parseInt(m[1], 10)
      const letters = (m[2] || '').toUpperCase()
      const entry = {
        answer: letters ? letters.split('').filter((c) => 'ABCD'.includes(c)) : [],
        explanation: m[3].trim(),
      }
      byNo.set(`${type}:${no}`, entry)
      cur = { key: `${type}:${no}`, entry }
      continue
    }
    // 填空题紧凑答案：1.答案1    2.答案2
    if (/^\d{1,3}[.、．]/.test(l)) {
      const hasTabOrGap = l.includes('\t') || /\s{3,}/.test(l)
      if (type === 'fill' || hasTabOrGap) {
        for (const part of l.split(/\t|\s{3,}/)) {
          const pm = part.trim().match(/^(\d{1,3})[.、．]\s*(.+)$/)
          if (pm) {
            byNo.set(`${type}:${parseInt(pm[1], 10)}`, {
              answer: [pm[2].trim()],
              explanation: '',
            })
          }
        }
        cur = null
        continue
      }
    }
    if (cur && cur.entry) {
      cur.entry.explanation = cur.entry.explanation
        ? cur.entry.explanation + l
        : l
    } else if (mode === 'ans' && l.length <= 6) {
      pending.push(l)
    }
    if (/^题号$/.test(l)) mode = 'num'
    else if (/^答案/.test(l) && l.length <= 6) mode = 'ans'
  }
  flushPending()
  return { byNo, ordered }
}

/** 将答案回填到题目（先按编号精确匹配，再按同题型顺序兜底） */
export function applyAnswers(qs: ParsedQuestion[], pack: AnswerPack): number {
  let hit = 0
  const counters: Record<string, number> = {}
  for (const q of qs) {
    const exact = pack.byNo.get(`${q.type}:${q.no}`)
    if (exact && exact.answer.length) {
      q.answer = exact.answer
      q.explanation = exact.explanation
      hit++
      continue
    }
    const list = pack.ordered[q.type]
    if (list) {
      const i = counters[q.type] || 0
      if (i < list.length) {
        const raw = list[i]
        const flat = raw.join('').toUpperCase()
        if (q.type === 'fill') q.answer = raw.slice(0, q.blankCount)
        else if (q.type === 'judge') q.answer = raw
        else q.answer = flat.split('').filter((c) => 'ABCD'.includes(c))
        counters[q.type] = i + 1
        hit++
      }
    }
  }
  for (const q of qs) {
    const expected =
      q.type === 'operation' ? 0 : q.type === 'multi' ? 2 : q.type === 'fill' ? q.blankCount : 1
    const ok = q.type === 'operation' ? !!q.answer.length || !!q.explanation : q.answer.length >= Math.min(1, expected)
    q.confidence = ok ? 'high' : 'low'
  }
  return hit
}

/** 一次性解析整篇文档（自动识别是否含答案区） */
export function parseDocument(rawLines: string[], source: string): ParsedQuestion[] {
  const lines = rawLines.filter((l) => !isNoiseLine(l))
  let ansIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/\s+/g, '')
    if (t === '参考答案' || t === '答案精析') {
      ansIdx = i
      break
    }
  }
  const qLines = ansIdx >= 0 ? lines.slice(0, ansIdx) : lines
  const aLines = ansIdx >= 0 ? lines.slice(ansIdx) : []
  const qs = parseQuestions(qLines)
  if (aLines.length) {
    applyAnswers(qs, parseAnswers(aLines))
  }
  return qs.map((q) => ({ ...q, source: source }))
}
