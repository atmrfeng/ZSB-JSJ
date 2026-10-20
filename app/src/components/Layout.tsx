import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { hrefFor } from '@/lib/router'

const NAV = [
  { key: 'home', label: '首页', icon: '🏠' },
  { key: 'practice', label: '章节练习', icon: '📚' },
  { key: 'papers', label: '历年真题', icon: '📝' },
  { key: 'exam', label: '模拟考试', icon: '⏱️' },
  { key: 'wrong', label: '错题本', icon: '❌' },
  { key: 'favorite', label: '收藏', icon: '⭐' },
  { key: 'import', label: '导入题库', icon: '📥' },
  { key: 'seed', label: '种子管理', icon: '🌱' },
  { key: 'stats', label: '统计', icon: '📊' },
  { key: 'bank', label: '题库管理', icon: '🗂️' },
  { key: 'settings', label: '设置', icon: '⚙️' },
]

export function Layout({
  current,
  children,
}: {
  current: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <a
            href={hrefFor('')}
            className="flex items-center gap-2 font-bold text-slate-900"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-sm text-white">
              鲁
            </span>
            <span className="hidden text-base sm:inline">
              山东专升本计算机刷题站
            </span>
            <span className="text-base sm:hidden">刷题站</span>
          </a>
          <nav className="ml-auto hidden flex-1 items-center gap-1 overflow-x-auto md:flex">
            {NAV.map((n) => (
              <a
                key={n.key}
                href={hrefFor(n.key)}
                className={cn(
                  'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition',
                  current === n.key
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {n.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      {/* 移动端底部固定导航：两行布局，主导航 5 个 + 次导航 6 个水平滚动
          整体不再放在内容流末尾被覆盖，统一固定 + 加高 main 底部留白 */}
      <MobileBottomNav activeKey={current} />

      <main className="mx-auto max-w-6xl px-4 pb-44 pt-5 md:pb-10">{children}</main>
    </div>
  )
}

/**
 * 移动端底部导航：
 *   第 1 行：5 个主功能（首页 / 章节 / 真题 / 模拟 / 错题）
 *   第 2 行：剩余 6 个功能（收藏 / 导入 / 种子 / 统计 / 题库 / 设置）水平滚动
 *
 * 设计目标：
 *   - 不再在内容末尾追加「MobileMore」导致被底部 nav 遮挡
 *   - 两行整体固定在屏幕底部，主内容 pb-44 给足留白
 *   - md 以上整组隐藏，由顶部 nav 接管
 */
function MobileBottomNav({ activeKey }: { activeKey: string }) {
  const primary = NAV.slice(0, 5)
  const secondary = NAV.slice(5)
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(0,0,0,0.04)] md:hidden"
      style={{ WebkitTransform: 'translateZ(0)' }}
    >
      <nav
        aria-label="次要导航"
        className="flex items-center gap-1 overflow-x-auto border-b border-slate-100 px-2 py-1.5"
      >
        {secondary.map((n) => (
          <a
            key={n.key}
            href={hrefFor(n.key)}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[11px] transition',
              activeKey === n.key
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            <span className="text-sm leading-none">{n.icon}</span>
            {n.label}
          </a>
        ))}
      </nav>
      <nav
        aria-label="主要导航"
        className="grid grid-cols-5"
      >
        {primary.map((n) => (
          <a
            key={n.key}
            href={hrefFor(n.key)}
            className={cn(
              'flex flex-col items-center gap-0.5 py-2 text-[11px]',
              activeKey === n.key ? 'text-blue-600' : 'text-slate-500',
            )}
          >
            <span className="text-base leading-none">{n.icon}</span>
            {n.label}
          </a>
        ))}
      </nav>
    </div>
  )
}