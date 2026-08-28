import { describe, expect, test } from 'bun:test'

import { NO_PROMPT_FALLBACK, compose, runToken } from '../compose.ts'

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
    const { text, fromHost } = compose('## from roadmap.references\nReview these for security.', refs)
    expect(fromHost).toBe(true)
    /* Verbatim includes the host's own fragment headings. They are the host's
       composition and this module does not reformat somebody else's prompt. */
    expect(text.startsWith('## from roadmap.references\nReview these for security.')).toBe(true)
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
