import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { resetServerStanding } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'

/**
 * The page's own state, driven for real.
 *
 * The host is played by `postMessage` — the same greeting and context a host
 * sends — and the server's answers by a fake `fetch`, so a test can move the
 * canvas, stop the server and refuse a read between renders.
 */
const session = {
  sessionId: 's1',
  id: 's1',
  name: 'the session',
  cwd: '/work/repo',
  state: 'working',
  startedAt: 0,
  over: false,
  free: false,
  said: null,
}

const realFetch = globalThis.fetch
/** What the fake server does next: answer, throw as a stopped one does, or refuse the roster. */
let server: 'up' | 'down' | 'refusing' = 'up'
let asked: { url: string; headers: Record<string, string>; body?: unknown }[] = []
/** The directories the fake server may start a session in, and whether it does. */
let dirs: string[] = []
let starts = false

const settle = (ms: number) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))))
const say = async (type: 'kehikot.hello' | 'kehikot.context', context: Record<string, unknown>) => {
  const full = { epic: null, theme: 'dark', selection: [], ...context }
  await act(async () => {
    window.postMessage(
      type === 'kehikot.hello'
        ? { type, protocol: 2, session: 's', state: null, context: full }
        : { type, protocol: 2, ...full },
      '*',
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}
const cover = () => document.querySelector('[data-cover]')
/* What the page said to its host about its header, and the answers to presses. */
type Heard = { type: string; items?: { id: string; kind: string; confirm?: boolean; agents?: boolean; state?: string; result?: string | null; disabled?: string | null }[]; id?: string; ok?: boolean; why?: string }
let heard: Heard[] = []
const listen = (event: MessageEvent) => {
  const data = event.data as { type?: string } | null
  if (data && (data.type === 'kehikot.header' || data.type === 'kehikot.pressed')) heard.push(data as Heard)
}
const declared = () => heard.filter((one) => one.type === 'kehikot.header')
const startItem = () => declared().at(-1)?.items?.find((one) => one.id === 'start')
const pressStart = async (id = 'p1', item = 'start') => {
  await act(async () => {
    window.postMessage({ type: 'kehikot.press', protocol: 2, id, item }, '*')
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

beforeEach(() => {
  heard = []
  window.addEventListener('message', listen)
  localStorage.removeItem('kehikot.orchestrator.header-drawn')
  server = 'up'
  asked = []
  dirs = []
  starts = false
  sessionStorage.clear()
  resetServerStanding()
  globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string>; body?: unknown }) => {
    asked.push({ url, headers: init?.headers ?? {}, body: init?.body })
    if (server === 'down') throw new TypeError('Load failed')
    if (url.startsWith('api/sessions')) {
      if (server === 'refusing') return Response.json({ ok: false, error: 'The roster is read with GET.' }, { status: 405 })
      return Response.json({ ok: true, scoped: dirs.length > 0, dirs, refs: [], total: 1, considered: 1, cut: false, sessions: [session] })
    }
    if (url.startsWith('api/transcript')) {
      return Response.json({ ok: true, touchedAt: 1, events: [{ role: 'agent', kind: 'said', tool: '', text: 'transcript line' }] })
    }
    if (url.startsWith('api/start')) {
      if (starts) return Response.json({ ok: true, pid: 4242, argv: ['claude', '--bg', 'x'] })
      return Response.json({ ok: false, error: 'ORCHESTRATOR_DIRS is not set, so nothing can be started.' })
    }
    return Response.json({ ok: true, dirs: [], rejected: [], variable: '' })
  }) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  window.removeEventListener('message', listen)
  globalThis.fetch = realFetch
  document.documentElement.className = ''
})

/*
 * First in the file, and the first two tests first in it, on purpose: the client's mailbox keeps
 * the last greeting for a late mount and has no way to forget one, so `waiting` and `unhosted`
 * can only be seen before any test in this file has greeted the page.
 */
describe('the not-ready moments, each as the one shared cover', () => {
  test('before anything has greeted the page it is waiting, and the roster is not drawn over it', async () => {
    render(<App />)
    await settle(30)
    expect(cover()?.getAttribute('data-cover')).toBe('waiting')
    expect(document.body.textContent).toContain('Waiting for Kehikot…')
    expect(document.body.textContent).not.toContain('Nothing is framing this page')
  })

  test('unframed it needs no host: the roster is drawn, under a sentence saying what cannot reach it', async () => {
    render(<App />)
    await settle(800)
    expect(cover()).toBeNull()
    expect(document.body.textContent).toContain('Nothing is framing this page, so no selection and no prompt can reach it.')
    expect(screen.getByText('the session')).toBeDefined()
  })

  test('greeted with no project and no epic it is simply the roster, in the host’s theme', async () => {
    render(<App />)
    await say('kehikot.hello', { project: null, projectPath: null, theme: 'dark' })
    expect(cover()).toBeNull()
    expect(screen.getByText('the session')).toBeDefined()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    await say('kehikot.context', { theme: 'light' })
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('the roster not read yet is the loading cover', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const answering = globalThis.fetch
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      await held
      return answering(...args)
    }) as unknown as typeof fetch
    render(<App />)
    await say('kehikot.hello', {})
    expect(cover()?.getAttribute('data-cover')).toBe('loading')
    release()
    await waitFor(() => expect(cover()?.getAttribute('data-cover') ?? null).toBeNull())
  })

  test('its own server not answering says so, and Try again asks again', async () => {
    server = 'down'
    render(<App />)
    await say('kehikot.hello', {})
    expect(cover()?.getAttribute('data-cover')).toBe('down')
    expect(document.body.textContent).toContain('Orchestrator’s own server is not answering.')
    server = 'up'
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(cover()).toBeNull()
    expect(screen.getByText('the session')).toBeDefined()
  })

  test('a server that stops under a prompt somebody edited covers the pane and keeps the words', async () => {
    render(<App />)
    await say('kehikot.hello', {})
    const box = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'my own words' } })
    server = 'down'
    await act(async () => {
      fireEvent.click(await screen.findByText('the session'))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(cover()?.getAttribute('data-cover')).toBe('down')
    /* Hidden, not unmounted: the same element, with what was typed still in it. */
    expect(document.body.contains(box)).toBe(true)
    expect(box.value).toBe('my own words')
  })

  test('a read the server refuses is said in its own words, in the legend, with no cover', async () => {
    server = 'refusing'
    render(<App />)
    await say('kehikot.hello', {})
    expect(cover()).toBeNull()
    expect(document.body.textContent).toContain('The roster is read with GET.')
  })
})

test('a session opened by hand closes when the epic changes', async () => {
  render(<App />)
  await say('kehikot.hello', { epic: 'a' })
  fireEvent.click(await screen.findByText('the session'))
  await screen.findByText('transcript line')

  await say('kehikot.context', { epic: 'b' })

  await waitFor(() => expect(screen.queryByText('transcript line')).toBeNull())
  expect(document.querySelector('[aria-current="true"]')).toBeNull()
})

describe('this page asking its own server', () => {
  test('a start answered "not started, and why" at 200 is that sentence, and the write carried the shared ticket header', async () => {
    const { start } = await import('../src/api/client.ts')
    const said = await start({ prompt: 'x', dir: '/nowhere', refs: [] })
    expect(said).toEqual({ ok: false, why: 'ORCHESTRATOR_DIRS is not set, so nothing can be started.' })
    const sent = asked.find((one) => one.url.startsWith('api/start'))
    expect(sent?.headers).toHaveProperty('x-module-ticket')
    expect(sent?.headers).not.toHaveProperty('x-orchestrator-ticket')
  })

  test('nothing answering is one plain sentence rather than a thrown fetch', async () => {
    const { thread } = await import('../src/api/client.ts')
    server = 'down'
    expect(await thread('s1', 0)).toEqual({ ok: false, why: 'This app’s own server is not answering.' })
  })
})

/*
 * A reload is played as an unmount and a fresh mount: the mailbox gives the new page the last
 * greeting, as a host greets a reloaded frame, and `sessionStorage` is what a reload leaves.
 */
describe('the name a session is started with (#14)', () => {
  const part = (id: string, heading: string, refs: string[], picked: boolean) => ({ id, heading, refs, picked })

  test('is shown before the press, and what is posted is where the session is from', async () => {
    dirs = ['/work/one']
    starts = true
    render(<App />)
    await say('kehikot.hello', {
      project: 'orch',
      projectPath: '/work/one',
      epic: 'session-titles',
      kehikko: { id: 1, name: 'Main' },
      parts: [part('titles', 'Titles', ['gh#14'], true), part('roster', 'Roster', ['gh#9'], false)],
    })
    await waitFor(() => expect(document.querySelector('[data-title]')?.textContent).toBe('named Main · orch · session-titles · Titles'))
    await waitFor(() => expect(startItem()?.disabled).toBeNull())
    await pressStart()
    await waitFor(() => expect(asked.some((one) => one.url.startsWith('api/start'))).toBe(true))
    const sent = asked.find((one) => one.url.startsWith('api/start'))
    expect(JSON.parse(String(sent?.body)).place).toEqual({ kehikko: 'Main', project: 'orch', epic: 'session-titles', parts: ['Titles'] })
  })
})

describe('what somebody was in the middle of survives the page reloading under it', () => {
  const here = { project: 'p', projectPath: '/tmp/p', epic: 'a', prompt: 'Do the thing.' }
  const box = async () => (await screen.findByRole('textbox')) as HTMLTextAreaElement
  /* The one draft a project has, as the tab holds it: by target, under the name this module has always used. */
  const draft = () => (JSON.parse(sessionStorage.getItem('kehikot.orchestrator.draft:/tmp/p') ?? '{}') as { prompt?: unknown }).prompt ?? null
  const reload = async () => {
    cleanup()
    render(<App />)
    await settle(60)
  }

  test('an edited prompt is still in the box after a reload, with the directory chosen beside it', async () => {
    dirs = ['/work/one', '/work/two']
    render(<App />)
    await say('kehikot.hello', here)
    const first = await box()
    expect(first.value).toContain('Do the thing.')
    fireEvent.change(first, { target: { value: 'my own words' } })
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: '/work/two' } })
    expect(draft()).toMatchObject({ text: 'my own words', dir: '/work/two' })

    await reload()
    expect((await box()).value).toBe('my own words')
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('/work/two'))
  })

  test('with a project id the draft is held under the id, so a rename keeps it', async () => {
    const id = '33333333-3333-4333-8333-333333333333'
    render(<App />)
    await say('kehikot.hello', { ...here, projectId: id })
    fireEvent.change(await box(), { target: { value: 'kept across a rename' } })
    expect(JSON.parse(sessionStorage.getItem(`kehikot.orchestrator.draft:${id}`) ?? '{}')).toMatchObject({ prompt: { text: 'kept across a rename' } })
    expect(sessionStorage.getItem('kehikot.orchestrator.draft:/tmp/p')).toBeNull()

    cleanup()
    render(<App />)
    await settle(60)
    await say('kehikot.hello', { ...here, projectPath: '/tmp/renamed', projectId: id })
    expect((await box()).value).toBe('kept across a rename')
  })

  test('an untouched prompt holds nothing, and an emptied or put-back one is forgotten', async () => {
    render(<App />)
    await say('kehikot.hello', here)
    const first = await box()
    const composed = first.value
    expect(draft()).toBeNull()
    fireEvent.change(first, { target: { value: 'half a thought' } })
    expect(draft()).not.toBeNull()
    fireEvent.change(first, { target: { value: '  ' } })
    expect(draft()).toBeNull()
    fireEvent.change(first, { target: { value: 'again' } })
    fireEvent.change(first, { target: { value: composed } })
    expect(draft()).toBeNull()

    await reload()
    expect((await box()).value).toBe(composed)
  })

  test('sending it forgets it', async () => {
    dirs = ['/work/one']
    starts = true
    render(<App />)
    await say('kehikot.hello', here)
    fireEvent.change(await box(), { target: { value: 'send these words' } })
    expect(draft()).not.toBeNull()
    await waitFor(() => expect(startItem()?.disabled).toBeNull())
    await pressStart()
    await waitFor(() => expect(startItem()?.result).toBe('Started · pid 4242'))
    /* What ran is still said, in the page: nobody should have to read the source to find out. */
    expect(document.body.textContent).toContain('"claude","--bg","x"')
    expect(draft()).toBeNull()
  })

  test('Start is the header’s: confirmed by the host, never pressed by an agent, and the page has no button for it', async () => {
    dirs = ['/work/one']
    render(<App />)
    await say('kehikot.hello', here)
    await waitFor(() => expect(startItem()).toBeDefined())
    expect(startItem()).toMatchObject({ kind: 'run', confirm: true, state: 'idle', disabled: null })
    expect(startItem()?.agents).not.toBe(true)
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  test('it says why it cannot be started, in the item: no directory, or an empty prompt', async () => {
    dirs = []
    render(<App />)
    await say('kehikot.hello', here)
    await waitFor(() => expect(startItem()?.disabled).toContain('No working directory is configured'))
    await pressStart('p9')
    expect(heard.filter((one) => one.type === 'kehikot.pressed').at(-1)).toMatchObject({ id: 'p9', ok: false })
    expect(asked.some((one) => one.url.startsWith('api/start'))).toBe(false)
    dirs = ['/work/one']
    await say('kehikot.context', { ...here, project: 'p2' })
  })

  test('typing in the prompt declares nothing again', async () => {
    dirs = ['/work/one']
    render(<App />)
    await say('kehikot.hello', here)
    await waitFor(() => expect(startItem()).toBeDefined())
    const count = declared().length
    const b = await box()
    fireEvent.change(b, { target: { value: 'one' } })
    fireEvent.change(b, { target: { value: 'one two' } })
    fireEvent.change(b, { target: { value: 'one two three' } })
    await settle(100)
    expect(declared().length).toBe(count)
  })

  test('the page’s own control is there until a host has pressed an item', async () => {
    dirs = ['/work/one']
    render(<App />)
    await say('kehikot.hello', here)
    await waitFor(() => expect(startItem()).toBeDefined())
    expect(document.querySelector('[data-header-fallback]')).not.toBeNull()
    await pressStart('p3')
    expect(document.querySelector('[data-header-fallback]')).toBeNull()
  })

  test('a new prompt from the host still replaces an edit, as it always did, and the edit is forgotten', async () => {
    render(<App />)
    await say('kehikot.hello', here)
    fireEvent.change(await box(), { target: { value: 'my own words' } })
    await say('kehikot.context', { ...here, prompt: 'Do another thing.' })
    expect((await box()).value).toContain('Do another thing.')
    expect(draft()).toBeNull()
    /* And going back does not bring it back from nowhere. */
    await say('kehikot.context', here)
    expect((await box()).value).toContain('Do the thing.')
    expect((await box()).value).not.toContain('my own words')
  })

  test('a draft held for another prompt is not shown over this one', async () => {
    sessionStorage.setItem('kehikot.orchestrator.draft:/tmp/p', JSON.stringify({ prompt: { base: 'something else', text: 'stale words', dir: '' } }))
    render(<App />)
    await say('kehikot.hello', here)
    expect((await box()).value).toContain('Do the thing.')
  })

  test('what an older build of this page left in the tab is not read as something else, and goes with the next thing held', async () => {
    sessionStorage.setItem('kehikot.orchestrator.draft:/tmp/p', JSON.stringify({ base: 'Do the thing.', text: 'old words', dir: '/work/one' }))
    sessionStorage.setItem('kehikot.orchestrator.open:/tmp/p', JSON.stringify({ epic: 'a', session: 's1' }))
    render(<App />)
    await say('kehikot.hello', { ...here, epic: 'session' })
    expect((await box()).value).not.toContain('old words')
    expect(screen.queryByText('transcript line')).toBeNull()
    fireEvent.change(await box(), { target: { value: 'new words' } })
    expect(JSON.parse(sessionStorage.getItem('kehikot.orchestrator.draft:/tmp/p') ?? '{}')).toEqual({ prompt: expect.objectContaining({ text: 'new words' }) })
    fireEvent.click(await screen.findByText('the session'))
    expect(JSON.parse(sessionStorage.getItem('kehikot.orchestrator.open:/tmp/p') ?? '{}')).toEqual({ session: { session: expect.any(String) } })
  })

  test('the open session is open again after a reload, and not after the epic has changed', async () => {
    render(<App />)
    await say('kehikot.hello', here)
    fireEvent.click(await screen.findByText('the session'))
    await screen.findByText('transcript line')

    await reload()
    await screen.findByText('transcript line')
    expect(document.querySelector('[aria-current="true"]')).not.toBeNull()

    await say('kehikot.context', { ...here, epic: 'b' })
    await waitFor(() => expect(screen.queryByText('transcript line')).toBeNull())
    expect(sessionStorage.getItem('kehikot.orchestrator.open:/tmp/p')).toBeNull()
  })

  test('with no storage to keep it in, the page works as it did', async () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    try {
      render(<App />)
      await say('kehikot.hello', here)
      const first = await box()
      fireEvent.change(first, { target: { value: 'my own words' } })
      expect(first.value).toBe('my own words')
      fireEvent.click(await screen.findByText('the session'))
      await screen.findByText('transcript line')
    } finally {
      if (real) Object.defineProperty(globalThis, 'sessionStorage', real)
    }
  })
})

describe('the page is told, never asks on a clock', () => {
  test('the roster and an open transcript are read as their streams open and on news, with no timer of the page’s own', async () => {
    const { openOn, tell } = await import('./event-source.ts')
    const realInterval = globalThis.setInterval
    let intervals = 0
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => (intervals++, realInterval(...args))) as typeof setInterval
    const reads = (path: string) => asked.filter((one) => one.url.startsWith(path)).length
    try {
      render(<App />)
      await say('kehikot.hello', { epic: 'a' })
      await act(async () => {
        fireEvent.click(screen.getByText('the session'))
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      /* Counted with no `waitFor` or `findBy` before it, which keep an interval of their own. */
      expect(intervals).toBe(0)
      expect(screen.getByText('transcript line')).toBeDefined()
      /* The page's EventSource is the fake one and fetches nothing, so every `api/sessions` here is a read. */
      const roster = reads('api/sessions')
      const thread = reads('api/transcript')
      expect(thread).toBe(1)

      /* Longer than either old poll (4 s roster, 1.5 s transcript would have read again by now). */
      await settle(1700)
      expect(reads('api/transcript')).toBe(thread)
      expect(reads('api/sessions')).toBe(roster)

      /* The server says the transcript grew, then that the roster moved: one read each. */
      await act(async () => void tell('api/transcript/events'))
      await settle(30)
      expect(reads('api/transcript')).toBe(thread + 1)
      await act(async () => void tell('api/sessions/events'))
      await settle(30)
      expect(reads('api/sessions')).toBe(roster + 1)
      expect(intervals).toBe(0)

      cleanup()
      expect(openOn('api/sessions/events').length + openOn('api/transcript/events').length).toBe(0)
    } finally {
      globalThis.setInterval = realInterval
    }
  })
})
