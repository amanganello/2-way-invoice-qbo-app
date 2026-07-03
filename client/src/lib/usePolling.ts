import { useState, useEffect, useCallback, useRef } from 'react'

export interface PollingResult<T> {
  data: T | null
  error: Error | null
  loading: boolean
  refresh: () => void
}

export function usePolling<T>(fn: () => Promise<T>, intervalMs: number): PollingResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const doFetch = useCallback(async () => {
    try {
      const result = await fnRef.current()
      setData(result)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void doFetch()
    const id = setInterval(() => void doFetch(), intervalMs)
    return () => clearInterval(id)
  }, [doFetch, intervalMs])

  return { data, error, loading, refresh: doFetch }
}
