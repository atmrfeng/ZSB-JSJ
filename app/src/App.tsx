import { useEffect } from 'react'
import './App.css'
import { Layout } from '@/components/Layout'
import { useRoute } from '@/lib/router'
import { StoreProvider, useStore } from '@/store'
import Home from '@/pages/Home'
import Practice from '@/pages/Practice'
import Papers from '@/pages/Papers'
import Exam from '@/pages/Exam'
import Wrong from '@/pages/Wrong'
import Favorite from '@/pages/Favorite'
import Bank from '@/pages/Bank'
import Import from '@/pages/Import'
import Seed from '@/pages/Seed'
import Stats from '@/pages/Stats'
import Settings from '@/pages/Settings'

function Content() {
  const route = useRoute()
  const { ready } = useStore()

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [route.name])

  if (!ready) {
    return (
      <Layout current={route.name}>
        <div className="py-20 text-center text-sm text-slate-400">正在加载题库…</div>
      </Layout>
    )
  }

  let page = <Home />
  switch (route.name) {
    case 'home':
      page = <Home />
      break
    case 'practice':
      page = <Practice chapter={route.chapter} />
      break
    case 'papers':
      page = <Papers />
      break
    case 'exam':
      page = <Exam />
      break
    case 'wrong':
      page = <Wrong />
      break
    case 'favorite':
      page = <Favorite />
      break
    case 'bank':
      page = <Bank />
      break
    case 'import':
      page = <Import />
      break
    case 'seed':
      page = <Seed />
      break
    case 'stats':
      page = <Stats />
      break
    case 'settings':
      page = <Settings />
      break
  }

  return <Layout current={route.name}>{page}</Layout>
}

export default function App() {
  return (
    <StoreProvider>
      <Content />
    </StoreProvider>
  )
}
