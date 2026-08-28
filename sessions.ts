import { execFile } from 'node:child_process'

/**
 * The Claude Code sessions on this machine.
 *
 * Salvaged from `roadmap/src/sessions.ts`, which is where the argument below
 * was worked out, and kept close to the original: two copies of a roster that
 * disagreed about what "busy" means would be two panes telling a person
 * different things about the same process.
 *
 * Better than asking agents to announce themselves: `claude agents --json`
 * already knows every session, its name, where it is running and whether it is
 * working. An agent that forgot to announce itself was invisible, and one whose
 * session died stayed on the roster until its presence expired — neither is
 * true here, because this is READ rather than DECLARED.
 *
 * Finished sessions are included. Most of the history is finished work, and it
 * is the history you go looking through; what is running now is a handful.
 *
 * ## What was left behind, and why
 *
 * The original carried a `mark` — a state letter that a labelling cron
 * (`~/.claude/scripts/rename-conversations.py`) writes at the front of a
 * session's name, from which the old page took a colour. It is gone here. That
 * letter is a convention of one person's machine, written by a script this
 * module does not ship and cannot see; a module that coloured its rows by it
 * would show grey on every machine but one and would never say why. The name is
 * shown as it is.
 *
 * `claimsToBeBusy` came over unchanged, because the reasoning attached to it is
 * the kind that gets re-derived wrongly.
 */

export interface Session {
  id: string
  sessionId: string
  name: string
  cwd: string
  kind: string
  startedAt: number
  /** Claude Code's own word: working, blocked, idle, done… */
  state: string
}

export interface Runner extends Session {
  /** Free to be handed something: alive, and not mid-task. */
  free: boolean
  /** Finished. Cannot be handed anything, but can still be read. */
  over: boolean
}

const BUSY = new Set(['working', 'running'])
const OVER = new Set(['done', 'failed', 'cancelled', 'canceled', 'stopped'])

/**
 * Whether the session is CLAIMING to be doing something right now.
 *
 * The distinction the original drew, and it is worth keeping the reasoning
 * rather than the conclusion. Two callers there each asked a different
 * question: one asked "is it one of the five finished words", which reads every
 * OTHER state — `blocked` above all — as if the session had said it was alive.
 * It had not. `blocked` is a report about the WORK, one of the three words the
 * roadmap's own protocol tells an agent to send; a blocked session with no
 * processes left is over, and treating it as busy left a run standing for two
 * days with no way to clear it but by hand.
 *
 * So: only these two states contradict "nothing is running". Everything else is
 * a word about the work.
 */
export function claimsToBeBusy(state: string): boolean {
  return BUSY.has(state)
}

/**
 * Reading the list means STARTING A PROCESS, and the page polls. A short cache
 * keeps that honest: shorter than a person notices, long enough that a burst of
 * repaints costs one read.
 *
 * It is also the reason `/api/sessions` is a GET that forks. That is unusual
 * enough to say out loud: the call is idempotent, reads nothing this module
 * owns, and writes nothing anywhere — but it is not free, and without this
 * cache a page left open would fork `claude` twice a second forever.
 */
let roster: { at: number; rows: Session[] } | null = null
const ROSTER_MS = 3000

/** Test seam: forget the cache, so a fixture can be swapped in mid-suite. */
export function forgetRoster(): void {
  roster = null
}

/**
 * Read one row defensively.
 *
 * `claude agents --json` is somebody else's program and its output is not this
 * module's to promise. A row with no session id is not a session this page can
 * open, so it is dropped; everything else is defaulted, because a session with
 * an unreadable name is still a session that is running and the person looking
 * for it needs to see the line.
 */
function readRow(raw: unknown): Session | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const sessionId = typeof r.sessionId === 'string' ? r.sessionId : ''
  if (!sessionId) return null
  return {
    id: typeof r.id === 'string' ? r.id : sessionId.slice(0, 8),
    sessionId,
    name: typeof r.name === 'string' ? r.name : '',
    cwd: typeof r.cwd === 'string' ? r.cwd : '',
    kind: typeof r.kind === 'string' ? r.kind : '',
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : 0,
    state: typeof r.state === 'string' ? r.state : '',
  }
}

/**
 * Ask Claude Code for its own roster.
 *
 * An argv array and never a string: nothing here is built from anything that
 * arrived over the wire, and keeping the shape argv-only means that stays true
 * by construction rather than by care. See the essay in `start.ts` — this is
 * the harmless end of the same rule.
 *
 * A non-zero exit or unparseable output is an empty roster rather than a throw,
 * and the caller says "nothing answered" rather than showing a stack trace: a
 * machine without `claude` on its PATH is a normal way for this module to be
 * run.
 *
 * ## `node:child_process`, and not `Bun.spawn`
 *
 * This is worth the paragraph, because the first version used `Bun.spawn` and
 * the failure was invisible. Everything in this repository is developed with
 * bun — `bun test`, `bun run typecheck`, `bun install` — so `Bun` is a global
 * that is always there while you are working on it. It is NOT there where this
 * code actually runs: `run.sh` ends in `bunx vite`, and `bunx` execs the `vite`
 * bin, which has a `#!/usr/bin/env node` shebang. The dev server is a NODE
 * process.
 *
 * So `Bun.spawn` threw `Bun is not defined`, the `catch` below turned that into
 * an empty roster exactly as it is meant to for a machine with no `claude`, and
 * the page reported "0 of 0 sessions on this machine" while `claude agents
 * --json --all` in a terminal listed a hundred and eighteen. Every test passed,
 * because the tests run under bun.
 *
 * The rule this leaves behind: nothing in the server half of this module may
 * use a `Bun.*` API. `transcript.ts` has the same note on its file reads for
 * the same reason.
 */
export async function sessions(): Promise<Session[]> {
  const now = Date.now()
  if (roster && now - roster.at < ROSTER_MS) return roster.rows
  let rows: Session[] = []
  try {
    const out = await new Promise<string>((done, fail) => {
      execFile('claude', ['agents', '--json', '--all'], { maxBuffer: 32 * 1024 * 1024 }, (error, stdout) =>
        error ? fail(error) : done(stdout),
      )
    })
    const parsed: unknown = JSON.parse(out)
    if (Array.isArray(parsed)) rows = parsed.map(readRow).filter((s): s is Session => s !== null)
  } catch {
    rows = []
  }
  roster = { at: now, rows }
  return rows
}

/**
 * Is this session running inside that directory?
 *
 * On the path boundary, not on the string: `/p/roadmap` must not swallow
 * `/p/roadmap-notes`, and a roster that quietly included a neighbouring
 * checkout would be the same wrong number in a smaller font.
 */
export function under(cwd: string, dir: string): boolean {
  const root = dir.replace(/\/+$/, '')
  return cwd === root || cwd.startsWith(`${root}/`)
}

/**
 * Everything on the list, the ones doing something first.
 *
 * A session under one of `dirs` is one working on this project; anything
 * elsewhere is somebody else's business. Passing none is UNSCOPED — every
 * session on the machine — and that is deliberately not the same as an empty
 * roster. The caller has to say which it means, and `/api/sessions` says so on
 * the wire (`scoped`) so the page can tell "nobody is working here" from
 * "nothing told me where here is".
 */
export function rank(all: Session[], dirs: string[] = []): Runner[] {
  return all
    .filter((s) => !dirs.length || dirs.some((dir) => under(s.cwd, dir)))
    .map((s) => ({ ...s, over: OVER.has(s.state), free: !BUSY.has(s.state) && !OVER.has(s.state) }))
    // Running first, then the rest newest first: the ones doing something are
    // the ones worth seeing without scrolling.
    .sort((a, b) => Number(a.over) - Number(b.over) || Number(a.free) - Number(b.free) || b.startedAt - a.startedAt)
}

export async function runners(dirs: string[] = []): Promise<Runner[]> {
  return rank(await sessions(), dirs)
}
