import { describe, expect, test } from 'bun:test'
import { AGENT_SAYS_MAX, LIMITS, activityItemSchema, agentMessageSchema, footerItemsSchema, headerItemsSchema, messagePostParams, type AgentMessage } from 'kehikot-module-protocol'

import { AGENT_SAYS, ID, MANIFEST } from '../manifest.ts'
import {
  ANNOUNCE_EVERY_MS,
  EVERYONE,
  INTRO,
  WORKING_FOR_MS,
  activityItems,
  footerItems,
  headerItems,
  keyOf,
  knowsUs,
  levelOf,
  openQuestion,
  shouldAnnounce,
  shown,
  threadsOf,
  toOf,
  waiting,
  working,
} from '../src/model.ts'

const NOW = Date.parse('2026-11-04T12:00:00Z')
let ids = 0
const message = (over: Record<string, unknown> = {}): AgentMessage =>
  agentMessageSchema.parse({
    id: ++ids,
    at: new Date(NOW - 60_000).toISOString(),
    from: { module: 'kehikot.claude', name: 'Claude', session: 's1', place: { epic: 'methods', parts: [], kehikko: 'writing' } },
    to: { module: ID },
    thread: null,
    body: 'hello',
    ...over,
  })
const fromPerson = (over: Record<string, unknown> = {}): AgentMessage =>
  message({ from: { module: ID, name: 'Agent Questions', session: null, place: { epic: null, parts: [], kehikko: null }, person: true }, to: { session: { module: 'kehikot.claude', session: 's1' } }, ...over })
const codex = { module: 'kehikot.codex', name: 'Codex', session: 'c1', place: { epic: 'results', parts: [], kehikko: 'writing' } }

describe('what agents are told', () => {
  test('agentSays fits, and names the exact call', () => {
    expect(AGENT_SAYS.length).toBeLessThanOrEqual(AGENT_SAYS_MAX)
    expect(MANIFEST.agentSays).toBe(AGENT_SAYS)
    expect(AGENT_SAYS).toContain(`send_message to {module: "${ID}"}`)
    expect(AGENT_SAYS).toContain('kind "question"')
    expect(AGENT_SAYS).toContain('"report"')
  })
  test('the introduction names the tool, the address, the kinds and the choices limit, and is a valid post', () => {
    expect(INTRO).toContain(`send_message to {"module": "${ID}"}`)
    expect(INTRO).toContain('kind "question"')
    expect(INTRO).toContain(`up to ${LIMITS.MESSAGE_CHOICES} short choices`)
    expect(INTRO).toContain('kind "report"')
    expect(messagePostParams.safeParse({ body: INTRO, to: { place: { kehikko: 'writing' } }, once: true }).success).toBe(true)
  })
  test('announced at a kehikko once a week at most, never without one', () => {
    expect(shouldAnnounce({}, 'writing', NOW)).toBe(true)
    expect(shouldAnnounce({ writing: NOW - 1000 }, 'writing', NOW)).toBe(false)
    expect(shouldAnnounce({ writing: NOW - ANNOUNCE_EVERY_MS }, 'writing', NOW)).toBe(true)
    expect(shouldAnnounce({}, null, NOW)).toBe(false)
  })
})

describe('threads', () => {
  test('one per session, the person’s answers in the asking session’s thread, the rest under everyone', () => {
    const q = message({ kind: 'question', choices: ['A', 'B'], body: 'Which?' })
    const a = fromPerson({ body: 'A', replyTo: q.id })
    const all = fromPerson({ to: { project: true }, body: 'Stop for lunch' })
    const other = message({ from: codex, kind: 'report', body: 'Parser' })
    const threads = threadsOf([q, a, all, other], NOW)
    expect(threads.map((one) => one.key).sort()).toEqual([EVERYONE, keyOf({ module: 'kehikot.claude', session: 's1' }), keyOf({ module: 'kehikot.codex', session: 'c1' })].sort())
    const claude = threads.find((one) => one.ref?.session === 's1')!
    expect(claude.messages.map((one) => one.body)).toEqual(['Which?', 'A'])
    expect(claude.questions[0]!.answer?.body).toBe('A')
    expect(claude.state).not.toBe('asks')
    expect(claude.name).toBe('Claude')
    expect(claude.place).toEqual({ epic: 'methods', kehikko: 'writing' })
  })
  test('the introductions are not drawn as messages', () => {
    const intro = message({ from: { module: ID, name: 'Agent Questions', session: null, place: { epic: null, parts: [], kehikko: null } }, to: { session: { module: 'kehikot.claude', session: 's1' } }, once: true, body: INTRO })
    expect(threadsOf([intro], NOW)).toEqual([])
  })
  test('unanswered questions first, the longest waiting first; then the most recent', () => {
    const recent = message({ from: codex, body: 'just a note', at: new Date(NOW - 1000).toISOString() })
    const older = message({ kind: 'question', body: 'old?', at: new Date(NOW - 600_000).toISOString() })
    const newer = message({ from: { ...codex, session: 'c2' }, kind: 'question', body: 'new?', at: new Date(NOW - 60_000).toISOString() })
    const threads = threadsOf([recent, older, newer], NOW)
    expect(threads.map((one) => one.messages.at(-1)!.body)).toEqual(['old?', 'new?', 'just a note'])
    expect(waiting(threads).map((one) => one.question.body)).toEqual(['old?', 'new?'])
  })
  test('working from a fresh report; quiet once it is old; a waiting question wins', () => {
    const report = message({ kind: 'report', body: 'Refactoring auth', at: new Date(NOW - 60_000).toISOString() })
    expect(threadsOf([report], NOW)[0]!.state).toBe('working')
    expect(working(threadsOf([report], NOW))).toHaveLength(1)
    expect(threadsOf([report], NOW + WORKING_FOR_MS)[0]!.state).toBe('quiet')
    expect(threadsOf([report, message({ kind: 'question', body: '?' })], NOW)[0]!.state).toBe('asks')
  })
  test('the open question typed words answer is the newest unanswered one', () => {
    const q1 = message({ kind: 'question', body: 'one?' })
    const q2 = message({ kind: 'question', body: 'two?' })
    const [thread] = threadsOf([q1, q2], NOW)
    expect(openQuestion(thread!)?.body).toBe('two?')
    const [after] = threadsOf([q1, q2, fromPerson({ replyTo: q2.id, body: 'yes' })], NOW)
    expect(openQuestion(after!)?.body).toBe('one?')
  })
  test('views', () => {
    const threads = threadsOf([message({ kind: 'question', body: '?' }), message({ from: codex, kind: 'report', body: 'r' }), message({ from: { ...codex, session: 'c9' }, body: 'n' })], NOW)
    expect(shown(threads, 'all')).toHaveLength(3)
    expect(shown(threads, 'questions')).toHaveLength(1)
    expect(shown(threads, 'working')).toHaveLength(1)
  })
  test('the sessions that wrote here know this module', () => {
    expect(knowsUs([message(), message(), fromPerson()])).toEqual([keyOf({ module: 'kehikot.claude', session: 's1' })])
  })
  test('where a message goes', () => {
    expect(toOf({ kind: 'session', ref: { module: 'kehikot.claude', session: 's1' } })).toEqual({ session: { module: 'kehikot.claude', session: 's1' } })
    expect(toOf({ kind: 'kehikko', key: 'writing' })).toEqual({ place: { kehikko: 'writing' } })
    expect(toOf({ kind: 'epic', epic: 'methods' })).toEqual({ place: { epic: 'methods' } })
    expect(toOf({ kind: 'everyone' })).toEqual({ project: true })
  })
})

describe('the needs-you lifecycle', () => {
  test('a question raises one attention item; answering it withdraws it; a report never asks', () => {
    const q = message({ kind: 'question', choices: ['A', 'B'], body: 'Which database?' })
    const report = message({ from: codex, kind: 'report', body: 'Working on the parser' })
    const before = activityItems(threadsOf([q, report], NOW))
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ id: `question-${q.id}`, state: 'attention', label: 'Claude asks: Which database?', detail: 'Choices: A · B' })
    for (const item of before) expect(activityItemSchema.safeParse(item).success).toBe(true)
    const after = activityItems(threadsOf([q, report, fromPerson({ replyTo: q.id, body: 'A' })], NOW))
    expect(after).toEqual([])
  })
  test('a long question is clipped to the label', () => {
    const [item] = activityItems(threadsOf([message({ kind: 'question', body: 'x'.repeat(500) })], NOW))
    expect(item!.label.length).toBeLessThanOrEqual(LIMITS.ACTIVITY_LABEL)
  })
})

describe('the rows', () => {
  test('the header: what is shown, a switch an agent may press', () => {
    const parsed = headerItemsSchema.safeParse(headerItems('questions'))
    expect(parsed.success).toBe(true)
  })
  test('the footer: questions waiting and agents working, and trouble', () => {
    const threads = threadsOf([message({ kind: 'question', body: '?' }), message({ from: codex, kind: 'report', body: 'r' })], NOW)
    const items = footerItemsSchema.parse(footerItems(threads, null)) as Array<{ id: string; text: string }>
    expect(items.map((one) => one.text)).toEqual(['1 question waiting', '1 agent working'])
    expect(footerItemsSchema.parse(footerItems([], 'Could not read messages')).map((one) => one.id)).toEqual(['questions', 'working', 'trouble'])
    expect((footerItemsSchema.parse(footerItems([], null))[0] as { text: string }).text).toBe('0 questions waiting')
  })
})

describe('how much fits', () => {
  test('levels', () => {
    expect(levelOf(null)).toBe('full')
    expect(levelOf({ width: 800, height: 150 })).toBe('glance')
    expect(levelOf({ width: 380, height: 600 })).toBe('list')
    expect(levelOf({ width: 700, height: 600 })).toBe('full')
  })
})
