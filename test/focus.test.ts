import { describe, expect, test } from 'bun:test'

import { emptySaid, narrowToFocus, type EpicPart } from 'kehikot-module-protocol'

import { matching } from '../doors.ts'
import { rank } from '../sessions.ts'
import { NOUN, anchorOf, inHand, readFor, refsHeld, type Tied } from '../src/focus.ts'

/* What a session says it is tied to, and what is kept in hand. The rule that reads it is the protocol's. */

const part = (id: string, refs: string[], picked: boolean, more: Partial<EpicPart> = {}): EpicPart => ({ id, heading: id, refs, picked, ...more })
const row = (sessionId: string, refs?: string[]): Tied => ({ sessionId, refs })

const ROSTER = [row('seam', ['gh#10']), row('both', ['gh#10', 'gh#7']), row('tests', ['gh#7']), row('loose', []), row('old')]
const shown = (parts: EpicPart[], open: string | null = null, selection: string[] = []) =>
  narrowToFocus(parts, ROSTER, anchorOf, { keep: (one) => inHand(one, open, selection) }).shown.map((one) => one.sessionId)

describe('anchorOf', () => {
  test('a session is about every reference it names', () => {
    expect(anchorOf(row('both', ['gh#10', 'gh#7']))).toEqual([{ ref: 'gh#10' }, { ref: 'gh#7' }])
  })

  test('a session that names none answers nothing — never the whole epic', () => {
    expect(anchorOf(row('loose', []))).toEqual([])
    expect(anchorOf(row('old'))).toEqual([])
    expect(anchorOf({ sessionId: 'x', refs: null })).toEqual([])
  })
})

describe('the roster under a pick', () => {
  test('nothing picked is every session', () => {
    expect(shown([part('seam', ['gh#10'], false)])).toEqual(['seam', 'both', 'tests', 'loose', 'old'])
  })

  test('a picked part leaves the sessions on its references; a session on none is in no part', () => {
    expect(shown([part('seam', ['gh#10'], true), part('tests', ['gh#7'], false)])).toEqual(['seam', 'both'])
  })

  test('the same whichever way the host spells a part’s documents', () => {
    expect(shown([part('seam', ['gh#10'], true, { documents: ['docs/seam.md'], files: [] })])).toEqual(['seam', 'both'])
    expect(shown([part('seam', ['gh#10'], true, { files: ['chapters/seam.tex'] })])).toEqual(['seam', 'both'])
  })

  test('keep: the session whose transcript is open stays, in its place', () => {
    expect(shown([part('seam', ['gh#10'], true)], 'loose')).toEqual(['seam', 'both', 'loose'])
  })

  test('keep: the sessions on a selected reference stay', () => {
    expect(shown([part('seam', ['gh#10'], true)], null, ['gh#7'])).toEqual(['seam', 'both', 'tests'])
  })

  test('the sentence for a pick that leaves nothing is the protocol’s', () => {
    expect(shown([part('none', ['gh#99'], true)])).toEqual([])
    expect(emptySaid([part('none', ['gh#99'], true)], NOUN)).toBe('No session is in the picked part.')
  })
})

describe('what the server is asked', () => {
  test('every reference of every part, picked or not, once each', () => {
    expect(refsHeld([part('a', ['gh#10', 'gh#7'], true), part('b', ['gh#7', 'gh#12'], false)])).toEqual(['gh#10', 'gh#7', 'gh#12'])
  })

  test('a roster read for fewer references than are wanted is not yet the one to narrow', () => {
    expect(readFor(['gh#10', 'gh#7'], ['gh#7'])).toBe(true)
    expect(readFor(['gh#10'], ['gh#10', 'gh#7'])).toBe(false)
    expect(readFor(undefined, [])).toBe(true)
    expect(readFor(undefined, ['gh#7'])).toBe(false)
  })
})

describe('which references a session names', () => {
  const rows = rank([
    { id: 'a', sessionId: 'a', name: 'gh#10 the seam', cwd: '/p', kind: 'background', startedAt: 4, state: 'working' },
    { id: 'b', sessionId: 'b', name: 'tests', cwd: '/p', kind: 'background', startedAt: 3, state: 'working' },
    { id: 'c', sessionId: 'c', name: 'tidying', cwd: '/p', kind: 'background', startedAt: 2, state: 'working' },
    { id: 'd', sessionId: 'd', name: '', cwd: '/p', kind: 'background', startedAt: 1, state: 'working' },
  ])
  const openings: Record<string, string> = { a: 'look at the seam', b: 'run the tests for gh#7 and gh#10', c: 'tidy the readme', d: '' }
  const read = async (sessionId: string) => openings[sessionId] ?? ''
  const said = async (refs: string[], among: string[]) => (await matching(rows, refs, among, read)).rows.map((one) => [one.sessionId, one.refs])

  test('with nothing asked, nothing is read and nothing is named', async () => {
    expect(await said([], [])).toEqual([['a', []], ['b', []], ['c', []], ['d', []]])
  })

  test('`among` filters nothing: every session is answered, each with the references it names', async () => {
    expect(await said([], ['gh#10', 'gh#7', 'gh#12'])).toEqual([['a', ['gh#10']], ['b', ['gh#10', 'gh#7']], ['c', []], ['d', []]])
  })

  test('the selection still filters, and an opening that could not be read is kept for it', async () => {
    expect(await said(['gh#7'], ['gh#10'])).toEqual([['b', ['gh#7', 'gh#10']], ['d', ['gh#7']]])
  })
})
