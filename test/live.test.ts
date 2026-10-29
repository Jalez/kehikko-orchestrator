import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { watching } from 'kehikot-module-protocol/serve'

import { NEWS, ROSTER_EVENTS, ROSTER_TOPIC, TRANSCRIPT_EVENTS, forgetSaid, stopWatching, stream, transcriptTopic } from '../live.ts'
import { useProjectsDir } from '../transcript.ts'

/**
 * The server's side of "the page never polls": the streams, called as the doors call them, with an
 * `emit` that collects what a page would hear, while Claude Code's files are written under them.
 */

const was = { projects: process.env.CLAUDE_PROJECTS_DIR, sessions: process.env.CLAUDE_SESSIONS_DIR }
const scratch = mkdtempSync(join(tmpdir(), 'orchestrator-live-'))
const projects = join(scratch, 'projects')
const live = join(scratch, 'sessions')
const folder = join(projects, '-some-project')
const session = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const line = (text: string) => `${JSON.stringify({ type: 'assistant', timestamp: '2026-10-29T09:00:00Z', message: { content: [{ type: 'text', text }] } })}\n`

/* Long enough for a watcher's event and the settle. */
const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms))

/*
 * The file system tells a new watcher of writes made just before it existed (macOS's FSEvents
 * delivers late). So each test lets those arrive, forgets them, and counts from there.
 */
const quiet = async () => {
  await settle(300)
  forgetSaid()
}

const open = (path: string, query = '') => {
  const heard: unknown[] = []
  const opened = stream('GET', path, new URLSearchParams(query), (event) => heard.push(event), null)
  if (!opened || !('close' in opened)) throw new Error(`${path} is not a stream`)
  return { heard, close: opened.close }
}

beforeAll(() => {
  mkdirSync(folder, { recursive: true })
  mkdirSync(live, { recursive: true })
  writeFileSync(join(folder, `${session}.jsonl`), line('hello'))
  useProjectsDir(projects)
  process.env.CLAUDE_SESSIONS_DIR = live
})

afterEach(() => {
  stopWatching()
  forgetSaid()
})

afterAll(() => {
  /* Put back what was found, never `delete` on a value somebody else set. */
  if (was.projects === undefined) delete process.env.CLAUDE_PROJECTS_DIR
  else useProjectsDir(was.projects)
  if (was.sessions === undefined) delete process.env.CLAUDE_SESSIONS_DIR
  else process.env.CLAUDE_SESSIONS_DIR = was.sessions
  rmSync(scratch, { recursive: true, force: true })
})

describe('the roster stream', () => {
  test('opens with the news once, and tells of a new transcript, a grown one, and a session changing state', async () => {
    const page = open(ROSTER_EVENTS)
    expect(page.heard).toEqual([NEWS])
    expect(watching(ROSTER_TOPIC)).toBe(1)
    await quiet()
    const base = page.heard.length

    /* A session started somewhere: its transcript appears. */
    writeFileSync(join(folder, 'ffffffff-0000-0000-0000-000000000000.jsonl'), line('started'))
    await settle()
    expect(page.heard.length).toBe(base + 1)

    /* Claude Code writing a session's state (working → waiting). Past the roster's gap, said too. */
    await quiet()
    writeFileSync(join(live, '4242.json'), JSON.stringify({ sessionId: session, status: 'idle' }))
    await settle()
    expect(page.heard.length).toBe(base + 2)

    page.close()
    expect(watching(ROSTER_TOPIC)).toBe(0)
  })

  test('nothing moving says nothing: no news on a clock', async () => {
    const page = open(ROSTER_EVENTS)
    await quiet()
    const base = page.heard.length
    await settle(1000)
    expect(page.heard.length).toBe(base)
    page.close()
  })

  test('a burst of writes is one piece of news, and the next is held to the gap', async () => {
    const page = open(ROSTER_EVENTS)
    await quiet()
    const base = page.heard.length
    for (let i = 0; i < 20; i++) appendFileSync(join(folder, `${session}.jsonl`), line(`line ${i}`))
    await settle()
    expect(page.heard.length).toBe(base + 1)
    appendFileSync(join(folder, `${session}.jsonl`), line('more'))
    await settle()
    /* Inside the roster's gap: not yet. */
    expect(page.heard.length).toBe(base + 1)
    page.close()
  })
})

describe('the transcript stream', () => {
  test('opens with the news, and tells that session’s page when its transcript grows, and not another’s', async () => {
    const page = open(TRANSCRIPT_EVENTS, `session=${session}`)
    const other = open(TRANSCRIPT_EVENTS, 'session=someone-else')
    expect(page.heard).toEqual([NEWS])
    expect(watching(transcriptTopic(session))).toBe(1)
    await quiet()
    const base = page.heard.length

    appendFileSync(join(folder, `${session}.jsonl`), line('a reply'))
    await settle()
    expect(page.heard.length).toBe(base + 1)
    expect(other.heard).toEqual([NEWS])

    /* The next line, after the transcript's gap, is news again. */
    await settle(1500)
    appendFileSync(join(folder, `${session}.jsonl`), line('another'))
    await settle(400)
    expect(page.heard.length).toBe(base + 2)

    page.close()
    other.close()
    expect(watching(transcriptTopic(session))).toBe(0)
  })

  test('another path, or no session, is not a stream', () => {
    expect(stream('GET', '/api/sessions', new URLSearchParams(), () => {}, null)).toBeNull()
    expect(stream('GET', TRANSCRIPT_EVENTS, new URLSearchParams(), () => {}, null)).toBeNull()
  })
})
