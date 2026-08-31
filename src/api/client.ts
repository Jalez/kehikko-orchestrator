import type { Row } from '../../doors.ts'
import type { Event } from '../../transcript.ts'

export type { Event, Row }

/**
 * This module's own doors, as the page calls them.
 *
 * ## Relative paths, always
 *
 * Every URL here is relative, and that is not a style choice. This page is
 * served at `/app` by the same process that answers `/api`, and it is framed by
 * a host at whatever address that host wrote down. A relative path is resolved
 * against the document the browser just fetched, which is a fact in both cases;
 * an absolute one would be a guess in the second. It is also what makes these
 * calls same-origin, which under `storage: true` is the difference between a
 * request with no CORS involved at all and a request that needs the module to
 * offer itself to strangers. See `manifest.ts`.
 *
 * ## The ticket
 *
 * Read once, out of the document, and sent on the one call that writes. See
 * `TICKET` in `doors.ts` for what it protects and — more importantly — what it
 * does not.
 */

/**
 * The write ticket, printed into `/app` by the process that serves it.
 *
 * Read at module load rather than per call. If it is missing the page is not
 * being served by this module's own server — somebody is running `vite` and
 * hitting `/index.html`, or the document has been copied somewhere — and the
 * honest thing is an empty string, which `POST /api/start` refuses with a
 * sentence that says to reload. Guessing would turn a misconfiguration into a
 * silent 403 nobody can explain.
 */
export const TICKET: string = (() => {
  if (typeof document === 'undefined') return ''
  const tag = document.getElementById('orchestrator-ticket')
  if (!tag?.textContent) return ''
  try {
    const parsed: unknown = JSON.parse(tag.textContent)
    return typeof parsed === 'string' ? parsed : ''
  } catch {
    return ''
  }
})()

/** What every door answers with when it is refusing. */
export interface Refused {
  ok: false
  why: string
}

export interface Roster {
  ok: true
  /** Whether ORCHESTRATOR_DIRS named anything, so the page can tell two empties apart. */
  scoped: boolean
  dirs: string[]
  refs: string[]
  /** How many sessions there are before the selection filter. */
  total: number
  /** How many were actually compared against the selection. */
  considered: number
  /** Whether older sessions were left out of that comparison. */
  cut: boolean
  sessions: Row[]
}

export interface Thread {
  ok: true
  touchedAt: number
  unchanged?: boolean
  events: Event[]
  why?: string
}

export interface Started {
  ok: boolean
  pid?: number
  argv?: string[]
  dir?: string
  token?: string
  why?: string
}

export interface ScopeSaid {
  ok: true
  dirs: string[]
  rejected: { path: string; why: string }[]
  variable: string
}

/**
 * One fetch, with the failure turned into a value.
 *
 * A thrown `TypeError: Failed to fetch` in a component is a blank container and a
 * line in a console nobody has open. What every caller here wants instead is a
 * sentence, so a dead server reads the same way as a refusal: something on
 * screen saying what did not happen.
 */
async function ask<T>(path: string, init?: RequestInit): Promise<T | Refused> {
  try {
    const response = await fetch(path, init)
    const data: unknown = await response.json()
    if (data && typeof data === 'object') return data as T | Refused
    return { ok: false, why: `${path} answered with something that was not a reply.` }
  } catch {
    return { ok: false, why: `This module’s own server did not answer ${path}. It may have stopped.` }
  }
}

export const failed = (r: unknown): r is Refused =>
  typeof r === 'object' && r !== null && (r as { ok?: unknown }).ok === false

export function roster(refs: string[]): Promise<Roster | Refused> {
  /* `refs` are opaque strings the canvas chose and are encoded rather than
     trusted to be URL-safe: `!12` and `#131` both contain characters a query
     string reads as punctuation. */
  const query = refs.length ? `?refs=${encodeURIComponent(refs.join(','))}` : ''
  return ask<Roster>(`api/sessions${query}`)
}

export function thread(session: string, since: number): Promise<Thread | Refused> {
  return ask<Thread>(`api/transcript?session=${encodeURIComponent(session)}&since=${since}`)
}

export function scope(): Promise<ScopeSaid | Refused> {
  return ask<ScopeSaid>('api/scope')
}

/**
 * Start a session.
 *
 * The prompt sent is exactly the string the page displayed. Composing it on the
 * server and displaying something composed on the client would mean the two
 * could drift, and the drift would be invisible: a person would read one thing
 * and an agent would be told another. So the composition happens once, in
 * `compose()`, the page renders its output, and this posts the same characters.
 */
export function start(body: { prompt: string; dir: string; refs: string[] }): Promise<Started | Refused> {
  return ask<Started>('api/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-orchestrator-ticket': TICKET },
    body: JSON.stringify(body),
  })
}
