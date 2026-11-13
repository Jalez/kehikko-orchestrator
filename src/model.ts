import { LIMITS, type ActivityItem, type AgentMessage, type MessageTo } from 'kehikot-module-protocol'

import { ID } from '../manifest.ts'

/**
 * Everything the page decides, pure: the threads out of the messages, which questions wait, what
 * each session works on, the Inbox items, the footer, the header, how much fits in the container,
 * and the introduction. The page draws it; the tests read it.
 */

/* ---------------------------------------------------------------- *
 * The introduction
 * ---------------------------------------------------------------- */

/**
 * What this module says to an agent session the first time it reaches one (`messages.post` with
 * `once`, protocol 2.50.0): who it is, and the exact call to make. The host hands each session at
 * most one, ever.
 */
export const INTRO =
  'I’m Agent Questions on this kehikko — your person reads and answers here. Send questions, decisions and progress reports to me with '
  + `send_message to {"module": "${ID}"}: kind "question" (add up to ${LIMITS.MESSAGE_CHOICES} short choices when they fit), `
  + 'kind "report" for what you’re working on. Replies arrive in your terminal.'

/** How long an announcement at a place lasts before this page makes it again: the host keeps a message 14 days. */
export const ANNOUNCE_EVERY_MS = 7 * 24 * 60 * 60 * 1000

/** Whether to announce at this kehikko now: never announced, or longer ago than `ANNOUNCE_EVERY_MS`. */
export function shouldAnnounce(places: Record<string, number>, kehikko: string | null, now: number): boolean {
  if (!kehikko) return false
  const last = places[kehikko]
  return last === undefined || now - last >= ANNOUNCE_EVERY_MS
}

/* ---------------------------------------------------------------- *
 * Sessions and threads
 * ---------------------------------------------------------------- */

export interface SessionRef {
  module: string
  session: string
}

/** A session's key: its module and its id. */
export const keyOf = (ref: SessionRef): string => `${ref.module}\u0000${ref.session}`
export const refOf = (key: string): SessionRef => {
  const [module = '', session = ''] = key.split('\u0000')
  return { module, session }
}

/** The thread every message to a place or the project goes in. */
export const EVERYONE = 'everyone'

export type ThreadState = 'asks' | 'working' | 'quiet'

export interface Question {
  message: AgentMessage
  /** The answer, when the person gave one: their message that says `replyTo` this one. */
  answer: AgentMessage | null
}

export interface Thread {
  key: string
  /** The session, or null for the everyone thread. */
  ref: SessionRef | null
  /** The module's registered name, as the host stamped it. */
  name: string
  /** Where it was when it last wrote: epic and kehikko. */
  place: { epic: string | null; kehikko: string | null }
  messages: AgentMessage[]
  /** Its questions, oldest first, with their answers. */
  questions: Question[]
  /** What it last reported, or null. */
  report: AgentMessage | null
  state: ThreadState
  /** When anything last happened in it (ms). */
  last: number
  /** When its oldest unanswered question was asked (ms), or null. */
  waitingSince: number | null
}

/** How long after its last report a session is still "working" for the board, without other news. */
export const WORKING_FOR_MS = 30 * 60_000

const at = (message: AgentMessage): number => Date.parse(message.at) || 0

/** The thread a message belongs in: the session that sent it, the session it was sent to, or everyone. */
export function threadKeyOf(message: AgentMessage): string | null {
  if (message.from.module === ID) {
    const to: MessageTo = message.to
    if (to.session) return keyOf(to.session)
    return EVERYONE
  }
  if (message.to.module === ID && message.from.session) return keyOf({ module: message.from.module, session: message.from.session })
  return null
}

/** Whether a question has been answered: a message of the person's through this module that answers it. */
const answers = (question: AgentMessage, all: readonly AgentMessage[]): AgentMessage | null =>
  all.find((one) => one.from.module === ID && one.from.person && one.replyTo === question.id) ?? null

/**
 * The threads, out of every message this module reads (`messages.mine`): one per agent session that
 * wrote to it or was written to, and one for everyone. Introductions are not drawn as messages. Ordered:
 * a thread with a question waiting first (the longest waiting first), then the most recent.
 */
export function threadsOf(messages: readonly AgentMessage[], now: number): Thread[] {
  const byKey = new Map<string, Thread>()
  for (const message of messages) {
    if (message.once && message.from.module === ID) continue
    const key = threadKeyOf(message)
    if (!key) continue
    let thread = byKey.get(key)
    if (!thread) {
      const ref = key === EVERYONE ? null : refOf(key)
      thread = { key, ref, name: key === EVERYONE ? 'Everyone' : ref!.module, place: { epic: null, kehikko: null }, messages: [], questions: [], report: null, state: 'quiet', last: 0, waitingSince: null }
      byKey.set(key, thread)
    }
    thread.messages.push(message)
    thread.last = Math.max(thread.last, at(message))
    if (message.from.module !== ID) {
      thread.name = message.from.name || message.from.module
      thread.place = { epic: message.from.place.epic, kehikko: message.from.place.kehikko }
      if (message.kind === 'question') thread.questions.push({ message, answer: answers(message, messages) })
      if (message.kind === 'report') thread.report = message
    }
  }
  for (const thread of byKey.values()) {
    const open = thread.questions.filter((one) => !one.answer)
    thread.waitingSince = open.length ? at(open[0]!.message) : null
    thread.state = open.length ? 'asks' : thread.report && now - at(thread.report) < WORKING_FOR_MS ? 'working' : 'quiet'
  }
  return [...byKey.values()].sort((a, b) => {
    if ((a.waitingSince === null) !== (b.waitingSince === null)) return a.waitingSince === null ? 1 : -1
    if (a.waitingSince !== null && b.waitingSince !== null && a.waitingSince !== b.waitingSince) return a.waitingSince - b.waitingSince
    return b.last - a.last
  })
}

/** Every question still waiting, oldest first, with its thread. */
export function waiting(threads: readonly Thread[]): Array<{ thread: Thread; question: AgentMessage }> {
  return threads
    .flatMap((thread) => thread.questions.filter((one) => !one.answer).map((one) => ({ thread, question: one.message })))
    .sort((a, b) => at(a.question) - at(b.question))
}

/** The sessions working now, for the board: a fresh report and no question waiting. */
export const working = (threads: readonly Thread[]): Thread[] => threads.filter((one) => one.state === 'working')

/** The newest question in a thread still waiting, which typed words answer. */
export const openQuestion = (thread: Thread): AgentMessage | null => thread.questions.filter((one) => !one.answer).at(-1)?.message ?? null

/** The sessions that already know this module: they wrote to it. */
export const knowsUs = (messages: readonly AgentMessage[]): string[] =>
  [...new Set(messages.filter((one) => one.from.module !== ID && one.to.module === ID && one.from.session).map((one) => keyOf({ module: one.from.module, session: one.from.session! })))]

/* ---------------------------------------------------------------- *
 * Words
 * ---------------------------------------------------------------- */

export const shortId = (session: string): string => (session.length > 10 ? `${session.slice(0, 8)}…` : session)

export function placeWords(place: { epic: string | null; kehikko: string | null }): string {
  return [place.epic, place.kehikko ? `on ${place.kehikko}` : null].filter(Boolean).join(' ') || 'no place'
}

export const STATE_WORDS: Record<ThreadState, string> = { asks: 'Waiting for you', working: 'Working', quiet: 'Quiet' }

const cut = (text: string, most: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > most ? `${flat.slice(0, most - 1).trimEnd()}…` : flat
}

export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86_400)} d ago`
}

/* ---------------------------------------------------------------- *
 * The Inbox: one needs-you item per waiting question
 * ---------------------------------------------------------------- */

/**
 * What `activity.set` says: one `attention` item per unanswered question, withdrawn (left out) once
 * answered. Reports never ask for attention, so they are not here. The whole list every time.
 */
export function activityItems(threads: readonly Thread[]): ActivityItem[] {
  return waiting(threads)
    .slice(0, LIMITS.ACTIVITY_ITEMS ?? 50)
    .map(({ thread, question }) => ({
      id: `question-${question.id}`.slice(0, LIMITS.ACTIVITY_ID),
      state: 'attention' as const,
      label: cut(`${thread.name} asks: ${question.body}`, LIMITS.ACTIVITY_LABEL),
      detail: cut(question.choices.length ? `Choices: ${question.choices.join(' · ')}` : question.body, LIMITS.ACTIVITY_DETAIL),
      since: Date.parse(question.at) || undefined,
      group: 'questions',
    }))
}

/* ---------------------------------------------------------------- *
 * The rows: header (how it is set up) and footer (what is going on)
 * ---------------------------------------------------------------- */

export type View = 'all' | 'questions' | 'working'
export const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'all', label: 'All sessions' },
  { value: 'questions', label: 'Questions' },
  { value: 'working', label: 'Working on' },
]

/** The header: which threads are shown. Configuration, so the header (the rows rule). */
export function headerItems(view: View): unknown[] {
  return [{ kind: 'switch', id: 'view', label: 'Show', value: view, options: VIEWS.map((one) => ({ id: one.value, label: one.label })), agents: true }]
}

/** The footer: what is going on now — questions waiting, agents working, and any trouble. */
export function footerItems(threads: readonly Thread[], trouble: string | null): unknown[] {
  const asks = waiting(threads).length
  const busy = working(threads).length
  const items: unknown[] = [
    { kind: 'text', id: 'questions', text: `${asks} question${asks === 1 ? '' : 's'} waiting`, ...(asks ? { level: 'warn' } : {}) },
    { kind: 'text', id: 'working', text: `${busy} agent${busy === 1 ? '' : 's'} working`, align: 'center' },
  ]
  if (trouble) items.push({ kind: 'text', id: 'trouble', text: cut(trouble, LIMITS.FOOTER_TEXT), level: 'critical', align: 'end', tooltip: cut(trouble, LIMITS.FOOTER_TOOLTIP) })
  return items
}

/** Which threads a view shows. */
export function shown(threads: readonly Thread[], view: View): Thread[] {
  if (view === 'questions') return threads.filter((one) => one.state === 'asks')
  if (view === 'working') return threads.filter((one) => one.report !== null)
  return [...threads]
}

/* ---------------------------------------------------------------- *
 * How much fits
 * ---------------------------------------------------------------- */

export interface Box {
  width: number
  height: number
}

/**
 * - `glance` — under 220 px tall: the counts and the oldest waiting question with its choices.
 * - `list`   — under 560 px wide: one column; the threads, or the open one over them.
 * - `full`   — the threads beside the open one, and the board.
 */
export type Level = 'glance' | 'list' | 'full'

export function levelOf(box: Box | null): Level {
  if (!box) return 'full'
  if (box.height < 220) return 'glance'
  if (box.width < 560) return 'list'
  return 'full'
}

/* ---------------------------------------------------------------- *
 * Sending
 * ---------------------------------------------------------------- */

export type Target = { kind: 'session'; ref: SessionRef } | { kind: 'kehikko'; key: string } | { kind: 'epic'; epic: string } | { kind: 'everyone' }

export function toOf(target: Target): MessageTo {
  if (target.kind === 'session') return { session: target.ref }
  if (target.kind === 'kehikko') return { place: { kehikko: target.key } }
  if (target.kind === 'epic') return { place: { epic: target.epic } }
  return { project: true }
}

export function targetWords(target: Target, threads: readonly Thread[]): string {
  if (target.kind === 'session') {
    const thread = threads.find((one) => one.key === keyOf(target.ref))
    return `${thread?.name ?? target.ref.module} · ${shortId(target.ref.session)}`
  }
  if (target.kind === 'kehikko') return `Every session on ${target.key}`
  if (target.kind === 'epic') return `Every session in ${target.epic}`
  return 'Every session in the project'
}

/** The words a refusal from the host is turned into, for the person. */
export const NOT_ALLOWED =
  'Kehikot sends nothing as you from here yet. Turn on “Send messages to agent sessions as you” in Kehikot’s Settings › Modules › Agent Questions, then send again.'
