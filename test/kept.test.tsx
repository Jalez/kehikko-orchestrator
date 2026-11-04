import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, renderHook } from '@testing-library/react'

import { useView } from '../src/app.tsx'

/**
 * The header's "show" switch is kept by the host for this container: it comes back from `kept`
 * (what the greeting carries) and a press writes it back with `remember`, the other keys kept.
 * The stand-in behaves as the protocol's `useHost` does: `remember` updates `kept` for the next render.
 */

afterEach(cleanup)

function keeper(start: unknown) {
  const host = {
    kept: start,
    remembered: [] as Array<{ next: unknown; after?: number }>,
    read: () => ({ kept: host.kept }),
    remember: (next: never, after?: number) => {
      host.remembered.push({ next, after })
      host.kept = next
    },
  }
  return host
}

test('the switch is restored from what the host kept', () => {
  const host = keeper({ view: 'working' })
  const { result } = renderHook(() => useView(host))
  expect(result.current[0]).toBe('working')
})

test('nothing kept, or something that is not a choice, shows all', () => {
  expect(renderHook(() => useView(keeper(null))).result.current[0]).toBe('all')
  expect(renderHook(() => useView(keeper({ view: 'everything' }))).result.current[0]).toBe('all')
})

test('a press writes the choice back, keeping what else was kept', () => {
  const host = keeper({ other: 1 })
  const { result, rerender } = renderHook(() => useView(host))
  let answer: unknown = null
  act(() => {
    answer = result.current[1]({ item: 'view', value: 'questions' })
  })
  expect(answer).toBe(true)
  expect(host.remembered.at(-1)?.next).toEqual({ other: 1, view: 'questions' })
  rerender()
  expect(result.current[0]).toBe('questions')
})

test('a press that is not a choice is refused and nothing is written', () => {
  const host = keeper({})
  const { result } = renderHook(() => useView(host))
  expect(result.current[1]({ item: 'view', value: 'nope' })).toContain('Show all sessions')
  expect(result.current[1]({ item: 'sort' })).toBe('This container has no such item.')
  expect(host.remembered).toEqual([])
})
