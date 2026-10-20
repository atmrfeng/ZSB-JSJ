import { useRef, useState } from 'react'
import { useStore } from '@/store'
import { questionRepo, recordRepo, attemptRepo } from '@/lib/db'

export default function Settings() {
  const { settings, updateSettings, resetAll, clearAttempts, questions } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')

  const exportData = async () => {
    const [qs, rs, as] = await Promise.all([
      questionRepo.all(),
      recordRepo.all(),
      attemptRepo.all(),
    ])
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      questions: qs,
      records: rs,
      attempts: as,
    }
    const blob = new Blob([JSON.stringify(payload)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `题库备份_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMsg('已导出备份文件（含题目 + 作答记录 + 练习记录）')
  }

  const importData = async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (Array.isArray(data.questions)) await questionRepo.save(data.questions)
      if (Array.isArray(data.records)) await recordRepo.save(data.records)
      if (Array.isArray(data.attempts)) await attemptRepo.save(data.attempts)
      setMsg('导入成功，刷新页面后生效')
    } catch (e) {
      setMsg(`导入失败：${(e as Error).message}`)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">设置</h1>
        <p className="text-sm text-slate-500">题目与答题记录均保存在本机浏览器中</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">判分规则</h2>
        <div className="space-y-2 text-xs text-slate-600">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              checked={settings.multiMode === 'sd'}
              onChange={() => updateSettings({ multiMode: 'sd' })}
            />
            <span>
              <b>山东真题规则</b>：多选题「多选或未选均无分，少选一个扣 1 分」
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              checked={settings.multiMode === 'strict'}
              onChange={() => updateSettings({ multiMode: 'strict' })}
            />
            <span>
              <b>严格规则</b>：多选题必须全对才得分
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">练习偏好</h2>
        <div className="space-y-3 text-xs text-slate-600">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.immediateFeedback}
              onChange={(e) =>
                updateSettings({ immediateFeedback: e.target.checked })
              }
            />
            练习模式作答后立即显示答案与解析
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span>考试倒计时日期：</span>
            <input
              type="date"
              value={settings.examDate}
              onChange={(e) => updateSettings({ examDate: e.target.value })}
              className="h-8 rounded-md border border-slate-300 px-2 text-xs"
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">数据备份</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            onClick={exportData}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-white"
          >
            导出全部数据（JSON）
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-slate-300 px-3 py-1.5"
          >
            导入备份文件
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])}
          />
        </div>
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          题库较大时建议定期导出备份；清理浏览器数据会导致本地记录丢失。
          <br />
          「导出全部数据」含题目 + 答题记录 + 考试记录，是你的私人数据。云端种子分发请前往
          <b> 种子管理</b> 页。
        </p>
        <div className="mt-2 text-[11px] text-blue-600">
          💡 导出 seed-bank.json 与合并 seed 题目请前往「种子管理」页 →
        </div>
      </section>

      <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
        <h2 className="mb-3 text-sm font-semibold text-blue-700">GitHub Pages 部署说明</h2>
        <ol className="list-decimal space-y-1 pl-5 text-[12px] leading-6 text-slate-700">
          <li>
            在 GitHub 新建仓库（公开即可），把本项目根目录（<code>app/</code> 上层）
            全部文件 <code>push</code> 上去
          </li>
          <li>
            已附带 <code>.github/workflows/deploy.yml</code>，每次 push 到 <code>main</code>{' '}
            会自动构建并发布到 GitHub Pages
          </li>
          <li>
            站点默认开启「内置种子题库」：任何访问者打开页面都会自动加载{' '}
            <code>seed-bank.json</code> 作为起点
          </li>
          <li>
            想把自己导入的题目同步给所有人：<b>设置 → 按种子格式导出 → 把下载的 JSON 覆盖仓库的
            <code> app/public/data/seed-bank.json </code>→ push</b>；CI 会自动重新构建站点
          </li>
          <li>
            图题的图片走 <code>app/public/data/img/</code> 目录，随 dist 静态托管；导出题目时请把{' '}
            <code>images</code> 字段里的相对路径保留
          </li>
          <li>
            IndexedDB 数据仅本机持久化，<b>不同设备 / 浏览器 / 隐私模式</b>
            数据互不共享；云端只承担种子分发，答题记录请自行备份
          </li>
        </ol>
      </section>

      <section className="rounded-xl border border-red-100 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-red-600">危险操作</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            onClick={() => {
              if (window.confirm('确定清空所有答题记录吗？题目会保留。'))
                void clearAttempts()
            }}
            className="rounded-md border border-red-200 px-3 py-1.5 text-red-600"
          >
            清空答题记录
          </button>
          <button
            onClick={() => {
              if (window.confirm('确定恢复内置题库并清空全部自定义题目吗？'))
                void resetAll()
            }}
            className="rounded-md bg-red-600 px-3 py-1.5 text-white"
          >
            重置为内置题库（当前 {questions.length} 题）
          </button>
        </div>
      </section>

      {msg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
          {msg}
        </div>
      )}
    </div>
  )
}
