import { ask, type AskServerOptions } from 'kehikot-module-protocol/client'

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
 * Printed into `/app` by the process that serves it and carried by the
 * protocol's `ask()` on everything that is not a GET — here, the one call that
 * writes. See `TICKET` in `doors.ts` for what it protects and — more
 * importantly — what it does not.
 */

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
 * One question to this module's own server, with the failure turned into a value.
 *
 * The protocol's `ask()` never throws: nothing answering, a page older than its
 * server, and the server saying no are each a sentence, and the first two also
 * move the page's standing so the shared cover is drawn (`useServerStanding`).
 *
 * The doors spell their refusals `error`, which is where `ask()` reads the sentence — `/api/start`
 * answering "not started, and why" at 200 included.
 */
async function door<T>(path: string, options?: AskServerOptions): Promise<T | Refused> {
  const asked = await ask<T>(path, options)
  if (!asked.ok) return { ok: false, why: asked.error }
  if (asked.body && typeof asked.body === 'object') return asked.body
  return { ok: false, why: `${path} answered with something that was not a reply.` }
}

export const failed = (r: unknown): r is Refused =>
  typeof r === 'object' && r !== null && (r as { ok?: unknown }).ok === false

export function roster(refs: string[]): Promise<Roster | Refused> {
  /* `refs` are opaque strings the canvas chose and are encoded rather than
     trusted to be URL-safe: `!12` and `#131` both contain characters a query
     string reads as punctuation. */
  return door<Roster>('api/sessions', { query: { refs: refs.length ? refs.join(',') : null } })
}

export function thread(session: string, since: number): Promise<Thread | Refused> {
  return door<Thread>('api/transcript', { query: { session, since } })
}

export function scope(): Promise<ScopeSaid | Refused> {
  return door<ScopeSaid>('api/scope')
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
  return door<Started>('api/start', { body })
}
