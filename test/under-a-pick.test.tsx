import { afterEach, beforeEach, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { resetServerStanding } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'

/*
 * The page under a pick, driven as a host drives it. The fake server does what the real one does
 * with `among`: answers every session with the references it names of the ones asked.
 */

const NAMES: Record<string, string[]> = { seam: ['gh#10'], tests: ['gh#7'], loose: [] }
const realFetch = globalThis.fetch
let asked: string[] = []

const part = (id: string, refs: string[], picked: boolean, more: Record<string, unknown> = {}) => ({ id, heading: id, refs, picked, ...more })
const here = { project: 'p', projectPath: '/tmp/p', epic: 'a' }
const say = async (type: 'kehikot.hello' | 'kehikot.context', context: Record<string, unknown>) => {
  const full = { theme: 'dark', selection: [], ...here, ...context }
  await act(async () => {
    window.postMessage(type === 'kehikot.hello' ? { type, protocol: 2, session: 's', state: null, context: full } : { type, protocol: 2, ...full }, '*')
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
}
const drawn = () => [...document.querySelectorAll('button[aria-current], button.w-full')].map((button) => button.querySelector('span.flex-1')?.textContent)
const none = () => document.querySelector('[data-none-in-focus]')?.textContent ?? null

beforeEach(() => {
  asked = []
  sessionStorage.clear()
  resetServerStanding()
  globalThis.fetch = (async (url: string) => {
    asked.push(url)
    if (url.startsWith('api/sessions')) {
      const query = new URLSearchParams(url.split('?')[1] ?? '')
      const among = (query.get('among') ?? '').split(',').filter(Boolean)
      const refs = (query.get('refs') ?? '').split(',').filter(Boolean)
      const sessions = Object.entries(NAMES)
        .map(([name, names]) => ({ sessionId: name, id: name, name, cwd: '/work/repo', kind: '', state: 'working', startedAt: 0, over: false, free: false, said: null, refs: names.filter((ref) => among.includes(ref) || refs.includes(ref)) }))
        .filter((one) => !refs.length || one.refs.some((ref) => refs.includes(ref)))
      return Response.json({ ok: true, scoped: false, dirs: [], refs, among, total: 3, considered: 3, cut: false, sessions })
    }
    if (url.startsWith('api/transcript')) return Response.json({ ok: true, touchedAt: 1, events: [] })
    return Response.json({ ok: true, dirs: [], rejected: [], variable: '' })
  }) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
  document.documentElement.className = ''
})

test('nothing picked: every session, the server is not asked to compare anything, and nothing is said', async () => {
  render(<App />)
  await say('kehikot.hello', { parts: [part('seam', ['gh#10'], false)] })
  expect(drawn()).toEqual(['seam', 'tests', 'loose'])
  expect(asked.filter((url) => url.startsWith('api/sessions')).every((url) => !url.includes('among='))).toBe(true)
  expect(none()).toBeNull()
})

test('a picked part leaves the sessions on its references, and nothing on the page is about the pick', async () => {
  render(<App />)
  await say('kehikot.hello', { parts: [part('seam', ['gh#10'], true), part('tests', ['gh#7'], false)] })
  expect(drawn()).toEqual(['seam'])
  /* The server was asked about every part's references, not the picked ones: it is never told the pick. */
  expect(asked.some((url) => url.includes('among=gh%2310%2Cgh%237'))).toBe(true)
  expect(none()).toBeNull()
  expect(document.body.textContent).not.toMatch(/picked part|outside/i)
  expect(document.body.textContent).toContain('1 of 3')
})

test('the same from a host that sends documents with a part and one that sends only files', async () => {
  render(<App />)
  await say('kehikot.hello', { parts: [part('seam', ['gh#10'], true, { documents: ['docs/seam.md'], files: [] })] })
  expect(drawn()).toEqual(['seam'])
  await say('kehikot.context', { parts: [part('tests', ['gh#7'], true, { files: ['chapters/tests.tex'] })] })
  expect(drawn()).toEqual(['tests'])
})

test('the session whose transcript is open is kept under a pick that does not have it', async () => {
  render(<App />)
  await say('kehikot.hello', { parts: [part('seam', ['gh#10'], false)] })
  fireEvent.click(await screen.findByText('loose'))
  await say('kehikot.context', { parts: [part('seam', ['gh#10'], true)] })
  expect(drawn()).toEqual(['seam', 'loose'])
  expect(document.querySelector('[aria-current="true"]')?.textContent).toContain('loose')
})

test('a pick that leaves no session says the one sentence where the rows were, and unpicking brings them back', async () => {
  render(<App />)
  await say('kehikot.hello', { parts: [part('none', ['gh#99'], true)] })
  expect(drawn()).toEqual([])
  expect(none()).toBe('No session is in the picked part.')
  await say('kehikot.context', { parts: [part('none', ['gh#99'], true), part('more', [], true)] })
  expect(none()).toBe('No session is in the picked parts.')
  await say('kehikot.context', { parts: [part('none', ['gh#99'], false)] })
  expect(none()).toBeNull()
  expect(drawn()).toEqual(['seam', 'tests', 'loose'])
})

test('nothing open: the hint sits in the roster column and no empty pane is reserved; opening one brings the pane', async () => {
  render(<App />)
  await say('kehikot.hello', { parts: [] })
  const hint = document.querySelector('[data-pick-hint]')
  expect(hint?.textContent).toMatch(/Pick a session to follow/)
  /* The hint is inside the roster column, which is the only column. */
  expect(hint?.parentElement?.parentElement?.parentElement?.children.length).toBe(1)
  fireEvent.click(document.querySelector('button.w-full') as Element)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })
  expect(document.querySelector('[data-pick-hint]')).toBeNull()
})
