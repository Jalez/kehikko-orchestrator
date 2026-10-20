import { describe, expect, test } from 'bun:test'

import { NO_PROMPT_FALLBACK, compose, placeOf, runToken, title } from '../compose.ts'

/**
 * What a session is told. The page renders this and the server sends it, so
 * these assertions are the "what you read is what it was told" claim written
 * down.
 */
describe('the opening prompt', () => {
  const refs = [
    { ref: 'gh#131', kind: 'issue', title: 'the greeting race' },
    { ref: 'gh#105', kind: 'pull request', title: '' },
  ]

  test('puts the host’s prompt first, verbatim', () => {
    const { text, fromHost } = compose('## from kehikot.references\nReview these for security.', refs)
    expect(fromHost).toBe(true)
    /* Verbatim includes the host's own fragment headings. They are the host's
       composition and this module does not reformat somebody else's prompt. */
    expect(text.startsWith('## from kehikot.references\nReview these for security.')).toBe(true)
  })

  test('names every selected reference, with its kind where one is known', () => {
    const { text } = compose('do the thing', refs)
    expect(text).toContain('- gh#131: issue — the greeting race')
    expect(text).toContain('- gh#105: pull request')
  })

  test('keeps a reference the host could not identify rather than dropping it', () => {
    /* The selection is the person's. A ref this module could not name is still
       one they picked, and leaving it out because a host did not answer would
       be quietly editing what they asked for. */
    const { text } = compose('do the thing', [{ ref: '!12', kind: '', title: '' }])
    expect(text).toContain('- !12')
  })

  test('a null prompt is an ordinary state with visible words in its place', () => {
    const { text, fromHost } = compose(null, refs)
    expect(fromHost).toBe(false)
    expect(text.startsWith(NO_PROMPT_FALLBACK)).toBe(true)
  })

  test('an empty prompt is the same state as a null one', () => {
    expect(compose('   ', refs).fromHost).toBe(false)
  })

  test('says so when nothing is selected, rather than saying nothing', () => {
    expect(compose('go', []).text).toContain('No references were selected')
  })

  test('ends with the run token, which is how the roster finds this session again', () => {
    const { text } = compose('go', refs)
    expect(text.trimEnd().endsWith(runToken(['gh#131', 'gh#105']))).toBe(true)
    expect(runToken([])).toBe('kehikko-run:nothing-selected')
  })
})

/**
 * What a session is named. The page shows it and the server makes it from the same place, so these
 * are the "what you read is what it is called" claim, and the issue's rules for it (#14).
 */
describe('the name a session starts with', () => {
  const parts = [
    { heading: 'Titles', refs: ['gh#14'], picked: false },
    { heading: 'Roster', refs: ['gh#9'], picked: false },
  ]
  const context = { kehikko: { name: 'Main' }, project: 'kehikko-orchestrator', epic: 'session-titles', parts }

  test('is the kehikko, the project, the epic and the part, in that order', () => {
    expect(title(placeOf(context, ['gh#14']))).toBe('Main · kehikko-orchestrator · session-titles · Titles')
  })

  test('names the picked parts when parts are picked, whatever the references', () => {
    const picked = { ...context, parts: [parts[0]!, { ...parts[1]!, picked: true }] }
    expect(placeOf(picked, ['gh#14']).parts).toEqual(['Roster'])
  })

  test('with nothing picked and no part listing a reference, it is the epic as a whole', () => {
    expect(title(placeOf(context, []))).toBe('Main · kehikko-orchestrator · session-titles')
  })

  test('carries no reference, so no MR, PR or issue number', () => {
    const name = title(placeOf(context, ['gh#14', 'gl!2640'])) ?? ''
    expect(name).not.toContain('#')
    expect(name).not.toContain('!')
  })

  test('leaves out what is not known, and is nothing when nothing is', () => {
    expect(title(placeOf({ project: 'p', epic: null }, []))).toBe('p')
    expect(title(placeOf(null, ['gh#14']))).toBeNull()
    expect(title({ kehikko: '  ', project: '', parts: [] })).toBeNull()
    expect(title(null)).toBeNull()
  })

  test('is one short line, whatever it is made of', () => {
    const name = title({ kehikko: 'a\nb\tc', project: 'x'.repeat(500), epic: 'e', parts: ['one', 'two'] }) ?? ''
    expect(name).not.toMatch(/[\n\t]/)
    expect(name.startsWith('a b c · ')).toBe(true)
    expect(name.length).toBeLessThanOrEqual(160)
    expect(name).toContain('…')
    expect(title({ parts: ['one', 'two'] })).toBe('one, two')
  })
})
