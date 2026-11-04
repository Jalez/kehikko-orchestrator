import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { messageMineResult, messageSendResult, type AgentMessage } from 'kehikot-module-protocol'
import { ask } from 'kehikot-module-protocol/client'
import { useHost } from 'kehikot-module-protocol/client/react'

import { ID } from '../manifest.ts'
import {
  INTRO,
  NOT_ALLOWED,
  activityItems,
  footerItems,
  headerItems,
  keyOf,
  knowsUs,
  levelOf,
  openQuestion,
  shouldAnnounce,
  shown,
  threadsOf,
  toOf,
  waiting,
  working,
  type Target,
  type View,
} from './model.ts'
import { useBox } from './use-box.ts'
import { Board, Composer, QuestionCard, ThreadList, ThreadView, type Choose } from './view.tsx'

/**
 * The page: the person's one place to talk with their agent sessions.
 *
 * Everything goes through the host (protocol 2.50.0): `messages.mine` to read what sessions sent
 * here and what was sent from here, `messages.post` for this module's introduction, `messages.say`
 * for the person's own words — which the host marks as theirs only for a press in this page — and
 * `activity.set` for a needs-you item per question waiting. The header picks what is shown; the
 * footer says how many questions wait and how many agents work.
 */

/** How often the page reads new messages while it is on screen. The host offers a module no push for them. */
export const READ_EVERY_MS = 4000

/** What the page needs from the host: the protocol's `useHost`, narrowed, so a test can stand in. */
export interface Bridge {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
  header(items: unknown[]): void
  footer(items: unknown[]): void
  activity(items: unknown[]): void
  projectId: string | null
  epic: string | null
  kehikko: string | null
  visible: boolean
}

/** Where this module remembers whom it introduced itself to (its own server, `/api/introduced`). */
export interface IntroStore {
  read(project: string): Promise<{ sessions: Record<string, number>; places: Record<string, number> }>
  note(project: string, add: { sessions?: string[]; places?: string[] }): Promise<void>
}

export const serverIntroStore: IntroStore = {
  async read(project) {
    const asked = await ask<{ sessions?: Record<string, number>; places?: Record<string, number> }>('/api/introduced', { query: { project } })
    return asked.ok ? { sessions: asked.body.sessions ?? {}, places: asked.body.places ?? {} } : { sessions: {}, places: {} }
  },
  async note(project, add) {
    await ask('/api/introduced', { body: { project, ...add } })
  },
}

const refusedWords = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function Orchestrator({ bridge, store = serverIntroStore, view, now: clock = Date.now }: { bridge: Bridge; store?: IntroStore; view: View; now?: () => number }) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [targetIndex, setTargetIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [now, setNow] = useState(() => clock())
  const introduced = useRef<Set<string>>(new Set())
  const last = useRef(0)
  const project = bridge.projectId
  const rootRef = useRef<HTMLDivElement | null>(null)
  const box = useBox(rootRef)
  const level = levelOf(box)

  /* ---- reading ---- */

  const read = useCallback(async () => {
    try {
      const fresh: AgentMessage[] = []
      let since: number | undefined = last.current || undefined
      for (let round = 0; round < 20; round++) {
        const got = messageMineResult.parse(await bridge.request('messages.mine', since === undefined ? {} : { since }))
        fresh.push(...got.messages)
        const newest = got.messages.at(-1)?.id
        if (newest !== undefined) since = newest
        if (!got.more || newest === undefined) break
      }
      if (fresh.length) {
        last.current = Math.max(last.current, ...fresh.map((one) => one.id))
        setMessages((was) => {
          const byId = new Map(was.map((one) => [one.id, one]))
          for (const one of fresh) byId.set(one.id, one)
          return [...byId.values()].sort((a, b) => a.id - b.id)
        })
      }
      setTrouble(null)
    } catch (error) {
      setTrouble(`Could not read messages: ${refusedWords(error)}`)
    }
    setNow(clock())
  }, [bridge, clock])

  useEffect(() => {
    last.current = 0
    setMessages([])
    void read()
  }, [project, read])

  useEffect(() => {
    if (!bridge.visible) return
    const timer = setInterval(() => void read(), READ_EVERY_MS)
    return () => clearInterval(timer)
  }, [bridge.visible, read])

  /* ---- the introduction: announced at this kehikko; the host hands each session at most one, ever ---- */

  useEffect(() => {
    if (!project) return
    let gone = false
    void (async () => {
      const known = await store.read(project).catch(() => ({ sessions: {}, places: {} }))
      if (gone) return
      for (const key of Object.keys(known.sessions)) introduced.current.add(key)
      if (!shouldAnnounce(known.places, bridge.kehikko, clock())) return
      try {
        const sent = messageSendResult.parse(await bridge.request('messages.post', { to: { place: { kehikko: bridge.kehikko } }, once: true, body: INTRO }))
        if (sent.outcome === 'sent') await store.note(project, { places: [bridge.kehikko!] })
      } catch {
        /* A host before 2.50.0, or none: the agentSays line still tells every session. */
      }
    })()
    return () => {
      gone = true
    }
  }, [project, bridge, store, clock])

  /* Sessions that wrote here already know this module: no introduction for them. */
  useEffect(() => {
    if (!project) return
    const fresh = knowsUs(messages).filter((key) => !introduced.current.has(key))
    if (!fresh.length) return
    for (const key of fresh) introduced.current.add(key)
    void store.note(project, { sessions: fresh }).catch(() => {})
  }, [messages, project, store])

  /* ---- what is decided ---- */

  const threads = useMemo(() => threadsOf(messages, now), [messages, now])
  const visibleThreads = useMemo(() => shown(threads, view), [threads, view])
  const openThread = threads.find((one) => one.key === open) ?? null

  const targets = useMemo<Target[]>(() => {
    const out: Target[] = []
    if (openThread?.ref) out.push({ kind: 'session', ref: openThread.ref })
    for (const thread of threads) if (thread.ref && thread !== openThread) out.push({ kind: 'session', ref: thread.ref })
    if (bridge.kehikko) out.push({ kind: 'kehikko', key: bridge.kehikko })
    if (bridge.epic) out.push({ kind: 'epic', epic: bridge.epic })
    out.push({ kind: 'everyone' })
    return out
  }, [threads, openThread, bridge.kehikko, bridge.epic])

  useEffect(() => setTargetIndex(0), [open])

  useEffect(() => bridge.header(headerItems(view)), [bridge, view])
  useEffect(() => bridge.footer(footerItems(threads, trouble)), [bridge, threads, trouble])
  useEffect(() => bridge.activity(activityItems(threads)), [bridge, threads])

  /* ---- sending, as the person ---- */

  const sayAsPerson = useCallback(
    async (target: Target, body: string, answering: AgentMessage | null) => {
      setBusy(true)
      setSaid(null)
      try {
        /* The first word to a session: the introduction, before the person's message (once, ever). */
        if (target.kind === 'session' && project && !introduced.current.has(keyOf(target.ref))) {
          const key = keyOf(target.ref)
          const intro = messageSendResult.safeParse(await bridge.request('messages.post', { to: toOf(target), once: true, body: INTRO }).catch(() => null))
          if (intro.success && intro.data.outcome === 'sent') {
            introduced.current.add(key)
            void store.note(project, { sessions: [key] }).catch(() => {})
          }
        }
        const params: Record<string, unknown> = { to: toOf(target), body }
        if (answering) {
          params.replyTo = answering.id
          if (answering.thread) params.thread = answering.thread
        }
        const sent = messageSendResult.parse(await bridge.request('messages.say', params))
        if (sent.outcome === 'sent') setSaid('Sent.')
        else setSaid(/allowed/.test(sent.why) ? NOT_ALLOWED : `Not sent: ${sent.why}`)
      } catch (error) {
        setSaid(`Not sent: ${refusedWords(error)}`)
      } finally {
        setBusy(false)
        void read()
      }
    },
    [bridge, project, store, read],
  )

  const choose: Choose = useCallback(
    (question, thread, choice) => {
      if (!thread.ref) return
      void sayAsPerson({ kind: 'session', ref: thread.ref }, choice, question)
    },
    [sayAsPerson],
  )

  const index = Math.min(targetIndex, targets.length - 1)
  const target = targets[index]!
  const answering = target.kind === 'session' && openThread?.ref && keyOf(target.ref) === openThread.key ? openQuestion(openThread) : null
  const composer = (
    <Composer
      targets={targets}
      target={index}
      onTarget={setTargetIndex}
      threads={threads}
      answering={answering}
      busy={busy}
      send={(body) => void sayAsPerson(target, body, answering)}
      said={said}
    />
  )
  const asks = waiting(threads)

  /* ---- drawing, by how much fits ---- */

  if (level === 'glance') {
    const first = asks[0]
    return (
      <div ref={rootRef} className="bg-background text-foreground h-full overflow-auto p-2" data-level="glance">
        {first ? (
          <QuestionCard thread={first.thread} question={first.question} choose={choose} busy={busy} now={now} />
        ) : (
          <p className="text-muted-foreground text-sm">No questions waiting. {working(threads).length} working.</p>
        )}
      </div>
    )
  }

  const list = (
    <>
      {asks.length && !openThread ? (
        <section aria-label="Questions waiting" className="flex flex-col gap-2 p-2">
          {asks.slice(0, 3).map(({ thread, question }) => (
            <QuestionCard key={question.id} thread={thread} question={question} choose={choose} busy={busy} now={now} onOpen={() => setOpen(thread.key)} />
          ))}
        </section>
      ) : null}
      <ThreadList threads={visibleThreads} open={open} onOpen={setOpen} now={now} />
    </>
  )

  if (level === 'list') {
    return (
      <div ref={rootRef} className="bg-background text-foreground flex h-full min-w-0 flex-col" data-level="list">
        <div className="min-h-0 flex-1 overflow-auto">
          {openThread ? (
            <>
              <button type="button" className="text-muted-foreground hover:text-foreground px-3 pt-2 text-xs" onClick={() => setOpen(null)}>
                ← All sessions
              </button>
              <ThreadView thread={openThread} choose={choose} busy={busy} now={now} />
            </>
          ) : view === 'working' ? (
            <Board threads={threads} now={now} />
          ) : (
            list
          )}
        </div>
        {composer}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="bg-background text-foreground grid h-full min-w-0 grid-cols-[minmax(200px,2fr)_3fr]" data-level="full">
      <aside className="border-border flex min-h-0 min-w-0 flex-col overflow-auto border-r">
        {list}
        <Board threads={threads} now={now} />
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {openThread ? (
            <ThreadView thread={openThread} choose={choose} busy={busy} now={now} />
          ) : (
            <p className="text-muted-foreground p-3 text-sm">Pick a session to read its conversation, or write to a place or everyone below.</p>
          )}
        </div>
        {composer}
      </main>
    </div>
  )
}

export function App() {
  const [view, setView] = useState<View>('all')
  const host = useHost(ID, {
    onPress: (press) => {
      if (press.item !== 'view') return 'This container has no such item.'
      if (press.value === 'all' || press.value === 'questions' || press.value === 'working') {
        setView(press.value)
        return true
      }
      return 'Show all sessions, the questions, or what they work on.'
    },
    onGoto: (_message, answerBack) => answerBack(false, 'This container holds conversations with agent sessions, not references.'),
  })
  const { request, header, footer, activity, projectId, epic, kehikko, visible } = host
  const bridge = useMemo<Bridge>(
    () => ({
      request: (method, params = {}) => request(method, params),
      header: (items) => header(items as never),
      footer: (items) => footer(items as never),
      activity: (items) => activity(items as never),
      projectId,
      epic,
      kehikko: kehikko?.key ?? null,
      visible,
    }),
    [request, header, footer, activity, projectId, epic, kehikko?.key, visible],
  )
  return <Orchestrator bridge={bridge} view={view} />
}
