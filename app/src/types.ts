/** 山东专升本计算机刷题站 · 数据模型 */

/** 题型：单选 / 多选 / 判断 / 填空 / 操作(含材料题、简答、SQL) */
export type QuestionType = 'single' | 'multi' | 'judge' | 'fill' | 'operation'

export const TYPE_LABEL: Record<QuestionType, string> = {
  single: '单选题',
  multi: '多选题',
  judge: '判断题',
  fill: '填空题',
  operation: '操作题',
}

export interface Option {
  key: string
  text: string
}

export interface Question {
  id: string
  /** 题型 */
  type: QuestionType
  /** 题干 */
  stem: string
  /** 选项（填空/简答类可为空） */
  options: Option[]
  /**
   * 标准答案。
   * 客观题为选项字母数组，如 ['A'] / ['B','D']；
   * 填空题为每空答案数组。
   */
  answer: string[]
  /** 解析 */
  explanation: string
  /** 材料题材料 */
  material: string
  /** 所属章节 id */
  chapterId: string
  /** 考点标签 */
  tags: string[]
  /** 来源（资料名） */
  source: string
  /** 来源内编号，如「2026年第12题」 */
  sourceRef: string
  /** 所属真题卷 id（练习题库为空） */
  paperId?: string
  /** 填空题空位数量 */
  blankCount: number
  /** 题目配图（URL 或 dataURL） */
  images: string[]
  /** 识别置信度：high 完整 / low 待校对 / failed 未识别 */
  confidence: 'high' | 'low' | 'failed'
  /** 导入批次号 */
  batchId?: string
  /** 题干中是否提及图片（如图/下图/图1 等关键词） */
  hasImageRef?: boolean
  createdAt: number
}

export interface QuestionRecord {
  qid: string
  /** 已做次数 */
  seen: number
  /** 错误次数 */
  wrong: number
  /** 最近一次做错时间 */
  lastWrongAt?: number
  /** 最近一次作答时间 */
  lastAt?: number
  /** 是否收藏 */
  favorited: boolean
  /** 是否已掌握（移出错题本） */
  mastered: boolean
  /** 最近一次自己的作答 */
  lastAnswer: string[]
}

export type PracticeMode = 'chapter' | 'paper' | 'exam' | 'wrong' | 'favorite'

export interface Attempt {
  id: string
  mode: PracticeMode
  /** 章节 id 或试卷 id */
  scope: string
  scopeName: string
  startedAt: number
  finishedAt: number
  total: number
  correct: number
  /** 得分 */
  score: number
  /** 满分 */
  fullScore: number
  /** 用时（秒） */
  duration: number
}

export interface Paper {
  id: string
  name: string
  subject: string
  year: number
  /** 考试时长（分钟） */
  duration: number
  totalScore: number
  questionIds: string[]
}

export interface Chapter {
  id: string
  no: string
  name: string
}

export interface Settings {
  /** 多选判分模式：sd 山东规则(少选扣1分) / strict 严格(全对才得分) */
  multiMode: 'sd' | 'strict'
  /** 练习模式：answer 答题模式 / recite 背题模式 */
  practiceMode: 'answer' | 'recite'
  /** 单题即时反馈 */
  immediateFeedback: boolean
  /** 考试倒计时目标日期 YYYY-MM-DD */
  examDate: string
  /** 每页题量 */
  pageSize: number
}
