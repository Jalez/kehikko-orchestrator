import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { Kehikot } from '../src/wire/use-kehikot.ts'

/**
 * The page's own state, driven for real.
 *
 * The wire to the host is replaced by a mutable object and the server's
 * answers by a fake `fetch`, so a test can move the canvas between renders.
 */
let wire: Partial<Kehikot> = {}
mock.module('../src/wire/use-kehikot.ts', () => ({
  useKehikot: () => ({
    at: 'hosted',
    epic: null,
    selection: [],
    prompt: null,
    pinned: false,
    kinds: {},
    ...wire,
  }),
}))

const { App } = await import('../src/app.tsx')

afterEach(() => {
  cleanup()
  wire = {}
})

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

test('a session opened by hand closes when the epic changes', async () => {
  const transcripts: string[] = []
  globalThis.fetch = (async (url: string) => {
    if (url.startsWith('api/sessions')) {
      return Response.json({ ok: true, scoped: false, dirs: [], refs: [], total: 1, considered: 1, cut: false, sessions: [session] })
    }
    if (url.startsWith('api/transcript')) {
      transcripts.push(url)
      return Response.json({ ok: true, touchedAt: 1, events: [{ role: 'agent', kind: 'said', tool: '', text: 'transcript line' }] })
    }
    return Response.json({ ok: true, dirs: [], rejected: [], variable: '' })
  }) as unknown as typeof fetch

  wire = { epic: 'a' }
  const { rerender } = render(<App />)
  fireEvent.click(await screen.findByText('the session'))
  await screen.findByText('transcript line')

  wire = { epic: 'b' }
  rerender(<App />)

  await waitFor(() => expect(screen.queryByText('transcript line')).toBeNull())
  expect(document.querySelector('[aria-current="true"]')).toBeNull()
})
