import { describe, expect, test } from 'bun:test'

import type { Roster, Row } from '../src/api/client.ts'
import { footerItems } from '../src/footer.ts'

const row = (over: Partial<Row>): Row => ({ id: 'a', sessionId: 's-a', name: 'fix the list', state: 'working', cwd: '/p', free: false, over: false, refs: [], said: null, ...over }) as Row
const list = (over: Partial<Roster> = {}): Roster => ({ ok: true, scoped: true, dirs: ['/p'], refs: [], total: 5, considered: 5, cut: false, sessions: [], ...over })

describe('the footer', () => {
  test('how many of how many, working and free, the one open; nothing pressable', () => {
    const rows = [row({}), row({ id: 'b', free: true, state: 'idle' }), row({ id: 'c', over: true, state: 'done' })]
    const items = footerItems({ list: list({ refs: ['gh#3'] }), rows, open: rows[0]!, why: null, pinned: false, epic: null })
    expect(items.find((i) => i.id === 'sessions')).toMatchObject({ text: '3 of 5 · gh#3' })
    expect(items.find((i) => i.id === 'working')).toMatchObject({ text: '1 working · 1 free', optional: true })
    expect(items.find((i) => i.id === 'open')).toMatchObject({ text: 'fix the list · working', align: 'end', tooltip: '/p' })
    expect(items.every((i) => i.kind === 'text')).toBe(true)
  })

  test('not scoped is a warning; held says what it keeps; older ones left out are in the tooltip', () => {
    const items = footerItems({ list: list({ scoped: false, dirs: [], cut: true, considered: 200 }), rows: [], open: null, why: null, pinned: true, epic: 'lists' })
    expect(items.find((i) => i.id === 'unscoped')).toMatchObject({ level: 'warn' })
    expect(items.find((i) => i.id === 'held')?.tooltip).toContain('lists')
    expect(items.find((i) => i.id === 'sessions')?.tooltip).toContain('Only the 200 most recent')
  })

  test('a roster that could not be read is one critical line; before the first read, nothing', () => {
    expect(footerItems({ list: null, rows: [], open: null, why: 'The server did not answer.', pinned: false, epic: null })).toEqual([expect.objectContaining({ level: 'critical' })])
    expect(footerItems({ list: null, rows: [], open: null, why: null, pinned: false, epic: null })).toEqual([])
  })
})
