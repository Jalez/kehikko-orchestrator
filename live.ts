import { existsSync, watch, type FSWatcher } from 'node:fs'

import { events, publish, watching } from 'kehikot-module-protocol/serve'

import { forgetRoster } from './sessions.ts'
import { noticeTranscript, root } from './transcript.ts'

/**
 * Telling the page that the roster or the open transcript changed, over one held stream each: the
 * page never asks on a clock (protocol 2.32.0, `events`/`subscribe`). What travels is that there IS
 * news; the page reads `/api/sessions` or `/api/transcript` again, the doors it already reads.
 *
 * Nothing here is this module's to write: the news is Claude Code writing its own files. So while a
 * page follows either topic, the server watches the two folders it already reads from:
 *
 * - the transcripts folder (`root()` in `transcript.ts`), recursively. A `<folder>/<session>.jsonl`
 *   appearing or growing is news for the roster (a new session, a new last line) and for that
 *   session's transcript;
 * - Claude Code's live-session folder (`~/.claude/sessions/`, one file per running process), which
 *   is where a session going from working to waiting or ending is written. It is read only to be
 *   told; the roster itself is still `claude agents --json` (`sessions.ts`). A machine without it is
 *   told by the transcripts alone.
 *
 * Both watchers are made when a page starts following and closed at their next event once nobody
 * follows any more.
 */

export const ROSTER_EVENTS = '/api/sessions/events'
export const TRANSCRIPT_EVENTS = '/api/transcript/events'

/** The news itself. The page re-reads on any event; the first is sent as a stream opens. */
export const NEWS = { changed: true } as const

export const ROSTER_TOPIC = 'roster'
export const transcriptTopic = (session: string) => `transcript:${session}`

/**
 * The least time between two pieces of news on one topic. The roster's re-read forks `claude agents`
 * (`sessions.ts`), so a session writing its transcript many times a second is said at most this
 * often — never more than the old four-second poll, and not at all while nothing moves. The open
 * transcript costs a `stat` and a tail read, and is what somebody is watching.
 */
export const ROSTER_GAP_MS = 3000
export const TRANSCRIPT_GAP_MS = 300
/* A write, then the next line of the same turn, is one piece of news. */
const SETTLE_MS = 50

/** Where Claude Code keeps one file per running session. Read at call time, so a test can move it. */
export function sessionsDir(): string {
  if (process.env.CLAUDE_SESSIONS_DIR) return process.env.CLAUDE_SESSIONS_DIR
  const config = process.env.CLAUDE_CONFIG_DIR ?? `${process.env.HOME ?? ''}/.claude`
  return `${config}/sessions`
}

const pending = new Map<string, ReturnType<typeof setTimeout>>()
const lastSaid = new Map<string, number>()

/**
 * Say `topic` changed, at most once per `gap`: at once (after a settle) when it was quiet, else
 * when the gap since the last is up. One one-shot timer per topic; nothing repeats.
 */
function say(topic: string, gap: number, before?: () => void): void {
  if (pending.has(topic) || watching(topic) === 0) return
  const wait = Math.max(SETTLE_MS, (lastSaid.get(topic) ?? 0) + gap - Date.now())
  pending.set(
    topic,
    setTimeout(() => {
      pending.delete(topic)
      lastSaid.set(topic, Date.now())
      before?.()
      publish(topic, NEWS)
    }, wait),
  )
}

/* The roster's caches would otherwise answer the re-read with what they held before the change. */
const rosterChanged = () => say(ROSTER_TOPIC, ROSTER_GAP_MS, forgetRoster)

const followed = new Set<string>()

/** Is any page following anything here? */
function anyone(): boolean {
  if (watching(ROSTER_TOPIC) > 0) return true
  for (const session of followed) {
    if (watching(transcriptTopic(session)) > 0) return true
    followed.delete(session)
  }
  return false
}

/** One change under the transcripts folder. `name` is relative to it, or null when not said. */
function transcriptsMoved(name: string | null): void {
  if (name === null) {
    rosterChanged()
    for (const session of followed) say(transcriptTopic(session), TRANSCRIPT_GAP_MS)
    return
  }
  const parts = name.split(/[\\/]/)
  /* `<folder>/<session>.jsonl` and nothing deeper: a subagent's own file is not on the roster. */
  if (parts.length !== 2 || !parts[1]!.endsWith('.jsonl')) return
  const session = parts[1]!.slice(0, -'.jsonl'.length)
  noticeTranscript(session)
  rosterChanged()
  say(transcriptTopic(session), TRANSCRIPT_GAP_MS)
}

const watchers = new Map<string, FSWatcher>()

function open(key: string, folder: string, recursive: boolean, moved: (name: string | null) => void): void {
  if (watchers.has(key) || !existsSync(folder)) return
  try {
    const watcher = watch(folder, { recursive }, (_kind, name) => {
      if (!anyone()) return stopWatching()
      moved(name === null ? null : String(name))
    })
    watcher.on('error', () => {
      watcher.close()
      watchers.delete(key)
    })
    watchers.set(key, watcher)
  } catch {
    /* A folder that cannot be watched: the page still reads on every open and every show. */
  }
}

/** Make the watchers, if they are not made yet. A folder that does not exist yet is tried at the next stream. */
function follow(): void {
  open('transcripts', root(), true, transcriptsMoved)
  open('sessions', sessionsDir(), false, () => rosterChanged())
}

/** Stop every watcher and timer (tests, and once nobody follows). */
export function stopWatching(): void {
  for (const watcher of watchers.values()) watcher.close()
  watchers.clear()
  for (const timer of pending.values()) clearTimeout(timer)
  pending.clear()
}

/** Forget what is waiting to be said and when each topic was last said (tests). */
export function forgetSaid(): void {
  for (const timer of pending.values()) clearTimeout(timer)
  pending.clear()
  lastSaid.clear()
}

/** The doors' `stream` option: `/api/sessions/events` and `/api/transcript/events?session=…`. */
export const stream = events((path, query) => {
  if (path === ROSTER_EVENTS) {
    follow()
    return { topic: ROSTER_TOPIC, initial: NEWS }
  }
  if (path === TRANSCRIPT_EVENTS) {
    const session = query.get('session')
    if (!session) return null
    followed.add(session)
    follow()
    return { topic: transcriptTopic(session), initial: NEWS }
  }
  return null
})
