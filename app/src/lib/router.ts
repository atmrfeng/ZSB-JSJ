/** 极简 hash 路由：静态托管下任意子路径均可正常工作 */
import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'practice'; chapter?: string }
  | { name: 'papers' }
  | { name: 'exam' }
  | { name: 'wrong' }
  | { name: 'favorite' }
  | { name: 'bank' }
  | { name: 'import' }
  | { name: 'seed' }
  | { name: 'stats' }
  | { name: 'settings' }

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '')
  const [path, query] = h.split('?')
  const params = new URLSearchParams(query || '')
  const seg = path.split('/').filter(Boolean)
  if (!seg.length) return { name: 'home' }
  switch (seg[0]) {
    case 'practice':
      return { name: 'practice', chapter: params.get('chapter') || undefined }
    case 'papers':
      return { name: 'papers' }
    case 'exam':
      return { name: 'exam' }
    case 'wrong':
      return { name: 'wrong' }
    case 'favorite':
      return { name: 'favorite' }
    case 'bank':
      return { name: 'bank' }
    case 'import':
      return { name: 'import' }
    case 'seed':
      return { name: 'seed' }
    case 'stats':
      return { name: 'stats' }
    case 'settings':
      return { name: 'settings' }
    default:
      return { name: 'home' }
  }
}

export function hrefFor(route: string): string {
  return `#/${route}`
}

export function navigate(route: string) {
  window.location.hash = `#/${route}`
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
