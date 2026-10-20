import type { Chapter, Question, QuestionType } from '@/types'

export { TYPE_LABEL } from '@/types'

/** 山东专升本「计算机文化基础」考纲章节体系 */
export const CHAPTERS: Chapter[] = [
  { id: 'ch1', no: '一', name: '计算机基础知识' },
  { id: 'ch2', no: '二', name: '计算思维' },
  { id: 'ch3', no: '三', name: '操作系统（Windows 10）' },
  { id: 'ch4', no: '四', name: '字处理软件 Word 2016' },
  { id: 'ch5', no: '五', name: '电子表格 Excel 2016' },
  { id: 'ch6', no: '六', name: '演示文稿 PowerPoint 2016' },
  { id: 'ch7', no: '七', name: '数据库管理系统 Access 2016' },
  { id: 'ch8', no: '八', name: '计算机网络基础' },
  { id: 'ch9', no: '九', name: '信息安全' },
  { id: 'ch10', no: '十', name: '新一代信息技术' },
]

export const CHAPTER_MAP: Record<string, Chapter> = Object.fromEntries(
  CHAPTERS.map((c) => [c.id, c]),
)

export function chapterName(id?: string): string {
  if (!id) return '未分类'
  const c = CHAPTER_MAP[id]
  return c ? `${c.no}、${c.name}` : '未分类'
}

/** 关键词 → 章节（用于导入题目自动归类） */
const RULES: Array<[string, string[]]> = [
  ['ch7', ['数据库', 'SQL', 'sql', '关系模型', 'Access', '数据表', '主键', '实体', '二维表', '查询', 'SELECT', 'select', '元组', '属性', '关系运算', '投影', '窗体', '报表']],
  ['ch5', ['Excel', 'EXCEL', '工作簿', '工作表', '单元格', 'SUM(', 'SUMIF', 'AVERAGE', '图表', '排序', '筛选', '分类汇总', '数据透视', '填充柄', 'VLOOKUP', '绝对引用']],
  ['ch4', ['Word', 'WORD', '文档', '页眉', '页脚', '段落', '字体', '分栏', '首行缩进', '题注', '目录', '审阅', '替换', '大纲级别', '中文版式']],
  ['ch6', ['PowerPoint', '演示文稿', '幻灯片', '母版', '动画', '切换', '超链接', '排练计时', '幻灯片放映', 'SmartArt']],
  ['ch3', ['Windows', 'windows', '操作系统', '任务栏', '资源管理器', '文件', '文件夹', '回收站', '快捷方式', '注册表', '磁盘', '控制面板', '进程', '设备管理器', 'DPI', 'NTFS', '系统还原']],
  ['ch8', ['网络', 'IP', 'TCP', 'HTTP', 'HTML', '域名', 'URL', '协议', 'OSI', '局域网', '路由器', '交换机', '拓扑', '带宽', 'Wi-Fi', '无线', '子网', 'MAC地址', '统一资源定位符', '电子邮件', 'IPv', '调制解调', 'ADSL', 'FTTx', '会话层', '传输层', '标签']],
  ['ch9', ['信息安全', '病毒', '防火墙', '加密', '解密', '数字签名', '木马', '黑客', '认证', '访问控制', '证书', '对称加密', '非对称加密', '恶意软件', '公钥', '私钥']],
  ['ch10', ['物联网', '云计算', '大数据', '人工智能', 'AI', '区块链', '虚拟现实', 'VR', '量子计算', '机器学习', '深度学习', '算力', '5G', '新一代信息技术', '数据挖掘', '智能']],
  ['ch2', ['算法', '计算思维', '程序设计', '流程图', '数据结构', '抽象', '自动化', '递归', '时间复杂度', '栈', '队列', '伪代码', 'Python', 'C语言', '编译', '解释', '面向对象', '循环结构', '顺序结构', '选择结构', '分支结构', '高级语言']],
  ['ch1', ['计算机', 'CPU', '内存', '存储器', '二进制', '十六进制', '八进制', '字节', '字长', '多媒体', '像素', '分辨率', 'ASCII', '输入设备', '输出设备', '主板', 'GPU', '硬件', '软件系统', '系统软件', '应用软件', '机器语言', '指令', 'Cache', 'ROM', 'RAM']],
]

export function classifyChapter(text: string): string {
  for (const [cid, kws] of RULES) {
    for (const kw of kws) {
      if (text.includes(kw)) return cid
    }
  }
  return 'ch1'
}

export const TYPE_ORDER: QuestionType[] = ['single', 'multi', 'judge', 'fill', 'operation']

export const TYPE_SCORE: Record<QuestionType, number> = {
  single: 1,
  multi: 2,
  judge: 1,
  fill: 1,
  operation: 2,
}

export function countByType(qs: Question[]): Record<QuestionType, number> {
  const r: Record<string, number> = { single: 0, multi: 0, judge: 0, fill: 0, operation: 0 }
  for (const q of qs) r[q.type] = (r[q.type] || 0) + 1
  return r as Record<QuestionType, number>
}
