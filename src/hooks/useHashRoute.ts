import { useCallback, useEffect, useState } from 'react'

function read(): string {
  return window.location.hash.replace(/^#\/?/, '') || 'dashboard'
}

/** Router hash sederhana (cocok untuk GitHub Pages tanpa konfigurasi server). */
export function useHashRoute(): [string, (route: string) => void] {
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => setRoute(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const navigate = useCallback((r: string) => {
    window.location.hash = `/${r}`
  }, [])
  return [route, navigate]
}
