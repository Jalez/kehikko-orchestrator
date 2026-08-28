import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { kindsOf, type Known } from '@/live/kinds.ts'
import { HostRefused, connect, type Host, type Refusal } from './host.ts'

/**
 * The bridge, as one React value.
 *
 * `host.ts` is the wire and knows no React; this is the only file that turns
 * messages into state. Two places driving the same context would eventually
 * disagree about what is selected, and this module turns what is selected into
 * the opening words of a process — so "which selection is this" is the one
 * question it cannot afford to be confused about.
 *
 * ## The grace, and why there is one
 *
 * A page cannot know at load whether it is framed. It has to wait to find out,
 * because the greeting arrives when the host is ready rather than when we are,
 * and a page that concluded "nobody is there" in the first frame would say so
 * and then be greeted a moment later — the reader would see the honest
 * standalone paragraph flash past and be replaced, which teaches them that
 * paragraph is noise. So there is a `listening` state with its own words, it
 * lasts under a second, and only then does the page say the harder thing.
 *
 * It is not a spinner. It says what it is waiting for.
 */
const GREETING_GRACE_MS = 700

export interface Roadmap {
  /**
   * Three states, and the first is not a loading flag.
   *
   * `listening` means the question "is anything framing this page" has not been
   * answered. `unhosted` means it has been answered no, and the page then shows
   * every session on the machine and says plainly that no selection and no
   * prompt can reach it. `hosted` means a greeting arrived.
   */
  at: 'listening' | 'hosted' | 'unhosted'
  /** Which epic the host says is open, or null. Shown, and used for `live.get`. */
  epic: string | null
  /**
   * What the canvas has picked out, as the host last said it.
   *
   * Never what this page decided. This module does not declare `selection:set`
   * and never asks for a change — it is a consumer of the canvas's selection,
   * and the protocol's argument for why a selection is context rather than a
   * message between modules is the reason this field is read-only here.
   *
   * Empty is a real state and not an absence: "nothing is selected" is
   * something the canvas can move into, and a page that kept the last selection
   * forever would offer to start a session on work nobody is looking at.
   */
  selection: string[]
  /**
   * The prompt the host composed for this pane, or null.
   *
   * One string. This module declares `prompt: true` and therefore must work
   * when there is none, because on a host that offers no prompts there always
   * will be none — the protocol is explicit. Null is drawn as an ordinary
   * state with the fallback text shown in its place, so that what a session
   * would be told is readable either way.
   */
  prompt: string | null
  /** Whether the host has pinned this pane. Said out loud, because it is. */
  pinned: boolean
  /**
   * ref -> what it is, from `live.get`, for the refs this page will name.
   *
   * Empty when the question has not been asked, was refused, or the epic has no
   * reading. All three cost the same thing — a word in a prompt — so they are
   * not distinguished here; `kindsRefused` carries the sentence for the one
   * case a person can act on.
   */
  kinds: Record<string, Known>
  /** Why the kinds are missing, if a host said. Null when nothing went wrong. */
  kindsRefused: Refusal | null
}

export function useRoadmap(id: string): Roadmap {
  const [at, setAt] = useState<Roadmap['at']>('listening')
  const [epic, setEpic] = useState<string | null>(null)
  const [selection, setSelection] = useState<string[]>([])
  const [prompt, setPrompt] = useState<string | null>(null)
  const [pinned, setPinned] = useState(false)
  const [kinds, setKinds] = useState<Record<string, Known>>({})
  const [kindsRefused, setKindsRefused] = useState<Refusal | null>(null)
  const host = useRef<Host | null>(null)

  /**
   * Which reading is the current one.
   *
   * Epics switch faster than a slow host answers, and without this the answer
   * to the previous epic arrives after the answer to this one and quietly
   * replaces it — the right number of references, under the right title, about
   * the wrong work. Every answer checks that it is still the one being waited
   * for before it is allowed to become the page.
   */
  const asking = useRef(0)

  /**
   * The epic the last context put this page on.
   *
   * Kept because context is not only "the reader moved" any more. It carries
   * the selection and the prompt, so the host sends one every time somebody
   * ticks a checkbox or edits a prompt — several a second while typing. Asking
   * `live.get` on each of those would be a request per keystroke for an answer
   * that cannot have changed.
   *
   * So the fetch is keyed to the epic CHANGING. Three values and not two: a
   * slug, `null` for "the host says no epic is open", and `undefined` for "no
   * context has been read yet". Collapsing the last two would make the first
   * context of a conversation that names no epic look like a repeat of a state
   * the page was already in.
   */
  const standingOn = useRef<string | null | undefined>(undefined)

  const look = useCallback((slug: string) => {
    const mine = (asking.current += 1)
    setKindsRefused(null)
    const current = host.current
    if (!current) return
    void current
      /*
       * Both spellings of the same name.
       *
       * `methodParams['live.get']` takes `{ epic }` in the protocol as it
       * stands. The hosts this workspace runs today read `params.slug` and
       * refuse anything else with "needs a journey slug" — the package renamed
       * this material and the hosts have not all caught up. Sending only the
       * newer key would make this module correct and useless; sending only the
       * older one would make it wrong the day a host is updated.
       *
       * So it sends both, which no host can be confused by: each reads the key
       * it knows and neither sees a conflicting value, because there is one
       * name here spelled twice. The second key comes out when no host in the
       * field reads it.
       */
      .request('live.get', { epic: slug, slug })
      .then((data) => {
        if (asking.current !== mine) return
        setKinds(kindsOf(data))
      })
      .catch((error: unknown) => {
        if (asking.current !== mine) return
        setKinds({})
        setKindsRefused(
          error instanceof HostRefused
            ? error.refusal
            : { reason: 'failed', error: 'This module failed while reading the host’s answer.' },
        )
      })
  }, [])

  useEffect(() => {
    const arrived = (
      context: { epic: string | null; theme: 'light' | 'dark'; selection: string[]; prompt: string | null; pinned: boolean },
      greeting: boolean,
    ) => {
      setAt('hosted')
      /*
       * The theme is applied here rather than in a component, because it is a
       * fact about the document rather than about any part of it: the host says
       * light or dark and the root element carries it. `light` is set
       * explicitly as well as `dark`, so a host asking for light over a machine
       * set to dark actually gets it — see the media query in `index.css`.
       */
      const root = document.documentElement
      root.classList.toggle('dark', context.theme === 'dark')
      root.classList.toggle('light', context.theme === 'light')

      /*
       * Taken from every context, unconditionally, before anything decides
       * whether the epic moved. That order is the whole of "the page follows"
       * when the reader changes epic: the host clears the selection as part of
       * moving and says so in the same message that names the new epic, so a
       * page that read the selection only on the branch where the epic stayed
       * put would keep offering to start a session on the previous epic's refs.
       */
      setEpic(context.epic)
      setSelection(context.selection)
      setPrompt(context.prompt)
      setPinned(context.pinned)

      if (greeting) standingOn.current = undefined
      const moved = context.epic !== standingOn.current
      standingOn.current = context.epic
      if (!moved) return
      if (context.epic) look(context.epic)
      else setKinds({})
    }

    /**
     * The connection is stored BEFORE the greeting is acted on, and the order
     * is the whole of a bug that made another module in this workspace hang
     * forever.
     *
     * `connect` subscribes to the mailbox, and the mailbox replays what has
     * already arrived SYNCHRONOUSLY, inside that call. The greeting almost
     * always arrives before React mounts — that is the entire reason the
     * mailbox exists — so `onHello` fires on this line, before `host.current`
     * has been assigned. Anything that reads `host.current` then finds null and
     * returns early, and the page sits on a sentence that never changes. It
     * starts no timer either, so nothing ever times out: not a slow answer, not
     * a refusal, just a page that stopped.
     *
     * Worse, it worked often enough to look fine. When the host happened to
     * greet after this effect returned — a slow module, a reload, a busy
     * machine — the assignment had already happened and everything behaved. A
     * race whose good outcome is the common one is the kind that ships.
     *
     * So anything that fires too early is held and delivered the moment the
     * assignment is done. Not deferred to a microtask: that would fix the
     * symptom and leave the next reader to work out why the order mattered.
     */
    type Arrival = [
      context: { epic: string | null; theme: 'light' | 'dark'; selection: string[]; prompt: string | null; pinned: boolean },
      greeting: boolean,
    ]
    let ready = false
    /* A box rather than a bare `let`, and only because of the compiler: this is
       assigned inside a callback that `connect` invokes, which the flow analysis
       cannot see, so a plain variable is narrowed to `null` for the rest of this
       function and the replay below stops type-checking. */
    const early: { arrival: Arrival | null } = { arrival: null }
    const held = (...arrival: Arrival) => {
      if (ready) arrived(...arrival)
      else early.arrival = arrival
    }

    host.current = connect(id, {
      onHello: (context) => held(context, true),
      onContext: (context) => held(context, false),
      /* Nothing on this page is a reference, so there is nothing to walk to.
         Answered rather than left to the host's timeout — see the backstop in
         `host.ts`; a hundred milliseconds of a pane doing nothing is worse than
         a sentence. */
      onGoto: (_message, answerBack) =>
        answerBack(false, 'This pane lists sessions rather than references, so there is nothing here to walk to.'),
    })
    ready = true
    if (early.arrival) arrived(...early.arrival)

    const grace = setTimeout(() => setAt((was) => (was === 'listening' ? 'unhosted' : was)), GREETING_GRACE_MS)

    return () => {
      clearTimeout(grace)
      host.current?.stop()
      host.current = null
    }
  }, [id, look])

  return useMemo(
    () => ({ at, epic, selection, prompt, pinned, kinds, kindsRefused }),
    [at, epic, selection, prompt, pinned, kinds, kindsRefused],
  )
}
