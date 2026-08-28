import { randomUUID } from 'node:crypto'

import { ID, MANIFEST, VERSION } from './manifest.ts'
import { readScope, type Scope } from './scope.ts'
import { runners, type Runner } from './sessions.ts'
import { lastSaid, opening, stampFor, transcript, type Event } from './transcript.ts'
import { start } from './start.ts'

export { MANIFEST }

/**
 * Every decision this module makes about an HTTP request, with no socket in
 * sight.
 *
 * The middleware in `vite.config.ts` owns the socket and this file owns the
 * answers, so the whole of the routing can be asserted on in a test without
 * binding a port. It is the shape `kehikko-journeys` uses and it is the shape
 * that made its `doors.test.ts` possible.
 */

/**
 * The write ticket, minted once per process.
 *
 * ## What it does
 *
 * It is printed into `/app`, and `POST /api/start` refuses without it. This
 * module declares `storage: true` and therefore sends no CORS headers at all
 * (see the essay in `manifest.ts`), so a page on any other origin cannot read
 * `/app` and cannot learn this string. The ticket is what makes that fact bite
 * on the write path rather than only on the read path: without it, a form
 * posted from a stranger's page would be a cross-origin request the browser
 * sends anyway and only refuses to let the sender READ the answer of — which is
 * plenty, when the effect of the request is "a coding agent has been started".
 *
 * ## What it does not do
 *
 * It is not an authorization check and must never be described as one.
 * Anything on this machine running as this user can `curl http://127.0.0.1:7850/app`,
 * read the ticket out of the document, and use it. It is not subject to CORS,
 * because CORS is a rule the BROWSER keeps.
 *
 * That is not a hole this ticket could close, and it is worth being exact about
 * why it does not need to: a program on this machine running as this user can
 * already run `claude --bg` itself. This module grants it nothing it did not
 * have. The fence being kept here is the browser's — a tab somebody has open,
 * a page they clicked — and inside that fence the ticket is the difference
 * between "cannot read the answer" and "cannot make the request".
 *
 * New on every process start, so a ticket does not outlive the program that
 * issued it, and never written to disk.
 */
export const TICKET = randomUUID()

export interface Reply {
  status: number
  body: unknown
}

const ok = (body: unknown): Reply => ({ status: 200, body })
const refuse = (status: number, why: string): Reply => ({ status, body: { ok: false, why } })

/**
 * Openings never change once written, so they are remembered forever.
 *
 * `opening()` reads the head of a transcript file, and the filter below asks
 * for one per session. Without this, a page polling the roster every two
 * seconds would re-read the first 256KB of two hundred files every two seconds
 * to answer a question whose answer cannot have moved: the first user message
 * of a conversation is written once.
 *
 * `''` is deliberately NOT cached. It means "nothing was read" — a transcript
 * that has not appeared yet, most often for a session started three seconds ago
 * — and caching it would make a session this module just spawned permanently
 * unmatchable to the refs it was spawned for.
 */
const openings = new Map<string, string>()

async function openingOf(sessionId: string): Promise<string> {
  const had = openings.get(sessionId)
  if (had) return had
  const read = await opening(sessionId)
  if (read) openings.set(sessionId, read)
  return read
}

/**
 * How many sessions get their opening read when a filter is on.
 *
 * There are hundreds of sessions on a machine that has been used for a while,
 * and the ones a person is filtering for are recent. Reading every opening on
 * the first filtered request would be a two-second pause on a keystroke.
 *
 * The cost is stated rather than hidden: a session older than this many is not
 * matched against the selection, and the page says so when the cut is reached.
 * That is better than the alternative failure, which is a filter that appears
 * to work and silently stops considering a session nobody can see was skipped.
 */
const CONSIDER = 80

/**
 * Which of these sessions is about one of those references?
 *
 * ## Read rather than declared, again
 *
 * There is no registry saying "session X is working on gh#131", and building
 * one would repeat the mistake `sessions.ts` exists to avoid: a session that
 * forgot to register would be invisible, and a registration outliving its
 * session would be a ghost. What actually ties a session to a reference is that
 * somebody put the reference in the words the session was started with, and
 * that is written into the transcript once and never edited.
 *
 * So the match is a substring of the opening prompt. It is crude and it is
 * honest: a session this module started names its refs in a list it wrote, and
 * a session somebody started by hand that happens to mention `gh#131` in its
 * first message really is about `gh#131`. The name is searched too, because
 * Claude Code derives a session's name from its opening and a person renaming
 * one to `gh#131 auth bug` has said something worth honouring.
 *
 * ## An unreadable opening keeps the session
 *
 * `opening()` answers `''` for a transcript that is missing, unreadable, or has
 * not been written yet, and the salvaged comment on it is emphatic that callers
 * must read that as NOT KNOWN rather than NOT OURS. A session spawned four
 * seconds ago is exactly this case. Dropping it would mean pressing Start and
 * watching the list not change, which reads as a button that did nothing.
 */
async function matching(rows: Runner[], refs: string[]): Promise<{ rows: Runner[]; considered: number; cut: boolean }> {
  if (!refs.length) return { rows, considered: rows.length, cut: false }
  const head = rows.slice(0, CONSIDER)
  const kept: Runner[] = []
  await Promise.all(
    head.map(async (row) => {
      const text = `${row.name}\n${await openingOf(row.sessionId)}`
      if (!text.trim() || refs.some((ref) => text.includes(ref))) kept.push(row)
    }),
  )
  /* `Promise.all` finished them in whatever order they resolved, and the order
     of the roster is a decision `sessions.ts` made on purpose. */
  const order = new Map(head.map((r, i) => [r.sessionId, i]))
  kept.sort((a, b) => (order.get(a.sessionId) ?? 0) - (order.get(b.sessionId) ?? 0))
  return { rows: kept, considered: head.length, cut: rows.length > CONSIDER }
}

/**
 * A positive number from a query string, or the default.
 *
 * The explicit null-and-empty check is the whole of this function, and it is
 * here because `Number(null)` is `0` and `Number('')` is `0` — both finite,
 * both non-negative, both perfectly plausible-looking answers. An absent
 * `?limit=` therefore became a limit of ZERO, and the transcript endpoint
 * answered every request with an empty list while reporting a modification time
 * and an `ok: true`: the page drew "nothing has been written yet" over a
 * conversation that was six hundred turns long. It cost half an hour to find,
 * because every part of the system was behaving exactly as instructed.
 *
 * Zero is rejected rather than accepted, for the same reason: nobody asks for
 * none of something, so a zero on this wire is a mistake somewhere upstream and
 * the default is a better guess than the literal reading.
 */
function num(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export interface Row extends Runner {
  /** The last thing this session said in prose, for the roster caption. */
  said: Event | null
}

/**
 * Answer one request, or `null` for "that was not one of ours" — which the
 * middleware turns into `next()`, so Vite goes on serving the page.
 *
 * `scope` is passed in rather than read here so that a test can hand this a
 * directory list without setting an environment variable for the whole process.
 */
export async function answer(
  method: string,
  path: string,
  params: URLSearchParams,
  body: Record<string, unknown> | null,
  ticket: string | null,
  scope: Scope = readScope(),
): Promise<Reply | null> {
  if (path === '/healthz') return ok({ ok: true, id: ID, version: VERSION })

  if (path === '/api/scope') {
    return ok({ ok: true, dirs: scope.dirs, rejected: scope.rejected, variable: 'ORCHESTRATOR_DIRS' })
  }

  if (path === '/api/sessions') {
    if (method !== 'GET') return refuse(405, 'The roster is read with GET.')
    /* Refs arrive comma-separated because they are a filter in a URL and this
       endpoint is a GET. They are not parsed, validated or interpreted: a ref
       is an opaque string the canvas chose, and the only thing done with it
       here is a substring search. */
    const refs = (params.get('refs') ?? '').split(',').map((r) => r.trim()).filter(Boolean)
    const all = await runners(scope.dirs)
    const { rows, considered, cut } = await matching(all, refs)
    const withSaid: Row[] = await Promise.all(
      rows.slice(0, num(params.get('limit'), 60)).map(async (row) => ({
        ...row,
        said: await lastSaid(row.sessionId),
      })),
    )
    return ok({
      ok: true,
      /* Three facts the page needs to tell four situations apart: no sessions
         at all, no sessions HERE, no sessions matching the selection, and a
         selection whose match was cut short by the window above. */
      scoped: scope.dirs.length > 0,
      dirs: scope.dirs,
      refs,
      total: all.length,
      considered,
      cut,
      sessions: withSaid,
    })
  }

  if (path === '/api/transcript') {
    if (method !== 'GET') return refuse(405, 'A transcript is read with GET.')
    const session = params.get('session') ?? ''
    if (!session) return refuse(400, 'Which session? /api/transcript needs a session id.')
    const touchedAt = await stampFor(session)
    if (!touchedAt) {
      return ok({
        ok: true,
        touchedAt: 0,
        events: [],
        /* Not an error. Claude Code writes the transcript when the session
           starts saying things, so a session spawned a moment ago has none, and
           so does one whose files have been cleared. */
        why: 'No transcript for that session has been written on this machine yet.',
      })
    }
    /* The poll's cheap path: the page sends back the stamp it last saw, and an
       unchanged file costs one `stat` instead of reading four megabytes. Not a
       304, because the page is reading JSON rather than caching a document and
       a body saying "nothing moved" is easier to act on than a status. */
    const since = num(params.get('since'), 0)
    /* `since=0` is the page's own way of saying "I have nothing, send it all",
       and it is what a freshly opened session sends. It falls through the
       comparison below because 0 is falsy, which is deliberate rather than
       incidental: there is no modification time of zero on a file that exists. */
    if (since && since === touchedAt) return ok({ ok: true, touchedAt, unchanged: true, events: [] })
    return ok({ ok: true, touchedAt, unchanged: false, events: await transcript(session, num(params.get('limit'), 80)) })
  }

  if (path === '/api/start') {
    if (method !== 'POST') return refuse(405, 'Starting a session is a POST.')
    /* The ticket, before anything is read out of the body. See `TICKET` above
       for what this does and does not protect. */
    if (ticket !== TICKET) {
      return refuse(
        403,
        'That request did not carry this module’s write ticket. The ticket is printed into the page this module ' +
          'serves and is new on every start, so a page holding an old one only has to be reloaded.',
      )
    }
    if (!body) return refuse(400, 'That was not a request this module could read as JSON.')
    const dir = typeof body.dir === 'string' ? body.dir : ''
    const prompt = typeof body.prompt === 'string' ? body.prompt : ''
    const refs = Array.isArray(body.refs) ? body.refs.filter((r): r is string => typeof r === 'string') : []
    const started = await start({ prompt, dir, refs }, scope)
    /* 200 for a refusal that is about the request, because the page renders the
       sentence either way and a 4xx here would be indistinguishable in the
       browser's console from the module being broken. The `ok` field is the
       answer; the status says the module understood the question. */
    return ok(started)
  }

  return null
}

