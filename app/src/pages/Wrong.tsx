import { useMemo } from 'react'
import { useStore } from '@/store'
import { SetView } from '@/components/SetView'

export default function Wrong() {
  const { questions, records } = useStore()
  const list = useMemo(
    () =>
      questions.filter((q) => {
        const r = records[q.id]
        if (!r) return false
        if (r.mastered) return false
        return !!r.lastWrongAt
      }),
    [questions, records],
  )
  return (
    <SetView
      title="错题本"
      desc="自动收录答错的题目，重做答对后自动移出"
      questions={list}
      emptyText="还没有错题，先去刷题吧！"
    />
  )
}
