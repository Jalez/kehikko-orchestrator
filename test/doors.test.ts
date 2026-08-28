import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TICKET, answer } from '../doors.ts'
import { readScope } from '../scope.ts'
import { useProjectsDir } from '../transcript.ts'
import { rank, under } from '../sessions.ts'

/**
 * The routing, asserted without binding a port.
 *
 * `doors.ts` holds the deciding and `vite.config.ts` holds the socket, which is
 * the split that makes this file possible. A test that had to start a server to
 * check that a POST without a ticket is refused would be a test nobody runs.
 */

const params = (q = '') => new URLSearchParams(q)
const empty = readScope({})

/**
 * A transcript fixture, written before anything else in this file runs.
 *
 * At the top level rather than inside the `describe` that uses it, and the
 * difference is not style. `transcript.ts` caches its directory index, and the
 * default root is the machine's own `~/.claude/projects` — so anything that
 * reads the index before `useProjectsDir` has been called caches HUNDREDS of
 * the developer's real sessions, holds them for four seconds, and this suite
 * finishes in under one. The symptom is every transcript assertion failing with
 * an empty list on a machine that has used Claude Code and passing on one that
 * has not, which is the worst kind of test to debug.
 *
 * A fixture rather than the machine's own transcripts, for the same reason: this
 * suite has to pass where Claude Code has never run.
 */
const projects = mkdtempSync(join(tmpdir(), 'orchestrator-projects-'))
const sessionId = '11111111-2222-3333-4444-555555555555'
{
  const folder = join(projects, '-some-project')
  mkdirSync(folder)
  writeFileSync(
    join(folder, `${sessionId}.jsonl`),
    [
      JSON.stringify({ type: 'user', timestamp: '2026-08-28T09:00:00Z', message: { content: 'look at gh#131' } }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-28T09:00:01Z',
        message: {
          content: [
            { type: 'text', text: 'Reading it now.' },
            /* `id` on the call and `tool_use_id` on the result: the two ends of
               one correlation, spelled differently, exactly as Claude Code
               writes them. This fixture said `tool_use_id` on both once, which
               made a broken correlation pass. Copied from a real transcript
               rather than from memory, which is how it was found. */
            { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/tmp/a.ts' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-08-28T09:00:02Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'export const a = 1' }] },
      }),
      /* Skipped: a sidechain is a subagent's conversation and not this one's. */
      JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'nope' }] } }),
      '',
    ].join('\n'),
  )
  useProjectsDir(projects)
}

describe('the health door', () => {
  test('says who is answering', async () => {
    const reply = await answer('GET', '/healthz', params(), null, null, empty)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { id: string }).id).toBe('roadmap.orchestrator')
  })
})

describe('paths this module does not own', () => {
  test('are null, so Vite goes on serving the page', async () => {
    expect(await answer('GET', '/src/main.tsx', params(), null, null, empty)).toBeNull()
    expect(await answer('GET', '/favicon.ico', params(), null, null, empty)).toBeNull()
  })
})

/**
 * The endpoint that starts a process. Every one of these is a way somebody
 * could otherwise get one started.
 */
describe('POST /api/start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orchestrator-start-'))
  const scope = readScope({ ORCHESTRATOR_DIRS: dir })

  test('is refused without the write ticket, before the body is even read', async () => {
    const reply = await answer('POST', '/api/start', params(), { dir, prompt: 'hello', refs: [] }, null, scope)
    expect(reply?.status).toBe(403)
    expect((reply?.body as { why: string }).why).toContain('write ticket')
  })

  test('is refused with the wrong ticket', async () => {
    const reply = await answer('POST', '/api/start', params(), { dir, prompt: 'x', refs: [] }, 'not-the-ticket', scope)
    expect(reply?.status).toBe(403)
  })

  test('is refused on GET', async () => {
    expect((await answer('GET', '/api/start', params(), null, TICKET, scope))?.status).toBe(405)
  })

  /**
   * The allow-list, through the door rather than through `scope.ts` directly.
   * This is the assertion that a request naming its own directory is refused
   * even when it carries a valid ticket — the ticket is a browser fence and was
   * never an authorization check, and the directory check is what actually
   * bounds the damage.
   */
  test('refuses a directory that is not on the list, ticket or no ticket', async () => {
    const reply = await answer(
      'POST',
      '/api/start',
      params(),
      { dir: '/etc', prompt: 'hello', refs: [] },
      TICKET,
      scope,
    )
    expect((reply?.body as { ok: boolean }).ok).toBe(false)
    expect((reply?.body as { why: string }).why).toContain('not one of the directories')
  })

  test('refuses everything when no directory is configured, and names the variable', async () => {
    const reply = await answer('POST', '/api/start', params(), { dir, prompt: 'hello', refs: [] }, TICKET, empty)
    expect((reply?.body as { ok: boolean }).ok).toBe(false)
    expect((reply?.body as { why: string }).why).toContain('ORCHESTRATOR_DIRS')
  })

  test('refuses an empty prompt rather than starting a session with nothing to do', async () => {
    const reply = await answer('POST', '/api/start', params(), { dir, prompt: '  ', refs: [] }, TICKET, scope)
    expect((reply?.body as { ok: boolean }).ok).toBe(false)
  })

  test('refuses an unreadable body', async () => {
    expect((await answer('POST', '/api/start', params(), null, TICKET, scope))?.status).toBe(400)
  })
})

describe('GET /api/scope', () => {
  test('says what it was given and what it threw out', async () => {
    const reply = await answer('GET', '/api/scope', params(), null, null, readScope({ ORCHESTRATOR_DIRS: '/no/such' }))
    const body = reply?.body as { dirs: string[]; rejected: { why: string }[] }
    expect(body.dirs).toEqual([])
    expect(body.rejected).toHaveLength(1)
  })
})

describe('GET /api/transcript', () => {
  const id = sessionId

  test('needs a session id', async () => {
    expect((await answer('GET', '/api/transcript', params(), null, null, empty))?.status).toBe(400)
  })

  test('reads prose, tool calls and tool results, oldest first', async () => {
    const reply = await answer('GET', '/api/transcript', params(`session=${id}`), null, null, empty)
    const body = reply?.body as { events: { kind: string; tool: string; text: string; role: string }[] }
    expect(body.events.map((e) => e.kind)).toEqual(['said', 'said', 'tool', 'result'])
    expect(body.events[0]?.text).toBe('look at gh#131')
    expect(body.events[2]?.tool).toBe('Read')
    expect(body.events[2]?.text).toBe('/tmp/a.ts')
    /* The result carries the name of the call it answered, which it does not
       have on the wire — only an id. See the second pass in `walk`. */
    expect(body.events[3]?.tool).toBe('Read')
    expect(body.events[3]?.text).toBe('export const a = 1')
  })

  test('a sidechain is left out', async () => {
    const reply = await answer('GET', '/api/transcript', params(`session=${id}`), null, null, empty)
    const body = reply?.body as { events: { text: string }[] }
    expect(body.events.some((e) => e.text === 'nope')).toBe(false)
  })

  test('an unchanged file is answered without re-reading it', async () => {
    const first = await answer('GET', '/api/transcript', params(`session=${id}`), null, null, empty)
    const at = (first?.body as { touchedAt: number }).touchedAt
    const again = await answer('GET', '/api/transcript', params(`session=${id}&since=${at}`), null, null, empty)
    expect((again?.body as { unchanged: boolean }).unchanged).toBe(true)
    expect((again?.body as { events: unknown[] }).events).toEqual([])
  })

  test('a session with no transcript is a sentence, not an error', async () => {
    const reply = await answer('GET', '/api/transcript', params('session=nobody'), null, null, empty)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { why: string }).why).toContain('No transcript for that session')
  })
})

/**
 * The roster's own arithmetic, which does not need a `claude` on the PATH.
 */
describe('ranking the roster', () => {
  const rows = [
    { id: 'a', sessionId: 'a', name: 'old done', cwd: '/p/thing', kind: 'background', startedAt: 1, state: 'done' },
    { id: 'b', sessionId: 'b', name: 'busy', cwd: '/p/thing', kind: 'background', startedAt: 2, state: 'working' },
    { id: 'c', sessionId: 'c', name: 'idle', cwd: '/p/other', kind: 'background', startedAt: 3, state: 'idle' },
    { id: 'd', sessionId: 'd', name: 'stuck', cwd: '/p/thing', kind: 'background', startedAt: 4, state: 'blocked' },
  ]

  test('puts what is running first, then what is free, then what is over', () => {
    expect(rank(rows).map((r) => r.id)).toEqual(['b', 'd', 'c', 'a'])
  })

  test('blocked is free rather than busy — it is a word about the work', () => {
    expect(rank(rows).find((r) => r.id === 'd')?.free).toBe(true)
  })

  test('scoping is on the path boundary, so a neighbouring checkout is not swallowed', () => {
    expect(under('/p/thing-notes/x', '/p/thing')).toBe(false)
    expect(under('/p/thing/x', '/p/thing')).toBe(true)
    expect(under('/p/thing', '/p/thing/')).toBe(true)
    expect(rank(rows, ['/p/thing']).map((r) => r.id)).toEqual(['b', 'd', 'a'])
  })

  test('no directories means unscoped, which is not the same as an empty roster', () => {
    expect(rank(rows, [])).toHaveLength(4)
  })
})
