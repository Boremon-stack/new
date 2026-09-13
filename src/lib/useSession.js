import { useCallback, useState } from 'react'

// NFR-13 / Assumption 2.3: state survives a page refresh but NOT a new browser
// session -- matching "no persistent storage" in Section 11 (Out of Scope).
// ponytail: sessionStorage stands in for the Phase-2 PostgreSQL layer (R-03).
export function useSession(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key)
      return raw === null ? initial : JSON.parse(raw)
    } catch {
      return initial
    }
  })

  const set = useCallback(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        try {
          if (resolved === null || resolved === undefined) sessionStorage.removeItem(key)
          else sessionStorage.setItem(key, JSON.stringify(resolved))
        } catch {
          /* storage disabled (private mode) -- in-memory state still works */
        }
        return resolved
      })
    },
    [key],
  )

  return [value, set]
}
