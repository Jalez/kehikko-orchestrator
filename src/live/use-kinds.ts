import { useEffect, useRef, useState } from 'react'

import { kindsOf, type Known } from '@/live/kinds.ts'

/**
 * ref -> what it is, from the host's `live.get`, for the refs this page will name.
 *
 * The one thing this module asks its host, and so the one piece of the old
 * `use-kehikot.ts` that is still its own: the connection, the grace, the theme
 * and the flattened context are the protocol's `useHost` now.
 *
 * ## Keyed to the epic CHANGING, and to a greeting
 *
 * Context is not only "the reader moved". It carries the selection and the
 * prompt, so the host sends one every time somebody ticks a checkbox or edits a
 * prompt — several a second while typing — and asking `live.get` on each would
 * be a request per keystroke for an answer that cannot have changed. A greeting
 * asks again even on the same epic: it is a new conversation with the host.
 *
 * ## Which reading is the current one
 *
 * Epics switch faster than a slow host answers, and an answer to the previous
 * epic arriving after the answer to this one would quietly replace it. The
 * effect's own `alive` is that guard.
 *
 * Empty when the question has not been asked, was refused, or the epic has no
 * reading. All three cost the same thing — a word in a prompt.
 */
export function useKinds(
  epic: string | null,
  greetings: number,
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): Record<string, Known> {
  const [kinds, setKinds] = useState<Record<string, Known>>({})
  const empty = useRef<Record<string, Known>>({})

  useEffect(() => {
    if (!greetings) return
    if (!epic) {
      setKinds(empty.current)
      return
    }
    let alive = true
    /*
     * Both spellings of the same name. `methodParams['live.get']` takes
     * `{ epic }` in the protocol as it stands; the hosts this workspace runs
     * today read `params.slug` and refuse anything else. Each reads the key it
     * knows and neither sees a conflicting value. The second key comes out when
     * no host in the field reads it.
     */
    void request('live.get', { epic, slug: epic })
      .then((data) => {
        if (alive) setKinds(kindsOf(data))
      })
      .catch(() => {
        if (alive) setKinds(empty.current)
      })
    return () => {
      alive = false
    }
  }, [epic, greetings, request])

  return kinds
}
