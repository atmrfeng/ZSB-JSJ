import { useMemo } from 'react'
import { useStore } from '@/store'
import { SetView } from '@/components/SetView'

export default function Favorite() {
  const { questions, records } = useStore()
  const list = useMemo(
    () => questions.filter((q) => records[q.id]?.favorited),
    [questions, records],
  )
  return (
    <SetView
      title="我的收藏"
      desc="刷题时点击星标即可收藏重点题目"
      questions={list}
      emptyText="还没有收藏的题目"
    />
  )
}
