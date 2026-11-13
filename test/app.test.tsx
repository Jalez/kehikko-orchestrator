import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { agentMessageSchema, type AgentMessage } from 'kehikot-module-protocol'

import { ID } from '../manifest.ts'
import { Orchestrator, type Bridge, type IntroStore } from '../src/app.tsx'
import { INTRO } from '../src/model.ts'

/**
 * The page against a stand-in host: the threads drawn from `messages.mine`, a choice pressed and
 * sent as the person's answer, the introduction before the first word to a session (once), the
 * announcement at the kehikko, and the needs-you item raised and withdrawn.
 */

const NOW = Date.parse('2026-11-04T12:00:00Z')

afterEach(cleanup)

let ids = 0
const message = (over: Record<string, unknown> = {}): AgentMessage =>
  agentMessageSchema.parse({
    id: ++ids,
    at: new Date(NOW - 60_000).toISOString(),
    from: { module: 'kehikot.claude', name: 'Claude', session: 'sess-1', place: { epic: 'methods', parts: [], kehikko: 'writing' } },
    to: { module: ID },
    thread: null,
    body: 'hello',
    ...over,
  })

interface Asked {
  method: string
  params: Record<string, unknown>
}

function standIn(start: AgentMessage[], introduced: string[] = []) {
  const kept = [...start]
  const asked: Asked[] = []
  const activity: unknown[][] = []
  const footers: unknown[][] = []
  const notes: Array<{ sessions?: string[]; places?: string[] }> = []
  const bridge: Bridge = {
    async request(method, params = {}) {
      asked.push({ method, params })
      if (method === 'messages.mine') {
        const since = typeof params.since === 'number' ? params.since : 0
        return { messages: kept.filter((one) => one.id > since), more: 0 }
      }
      if (method === 'messages.post') {
        const one = message({ from: { module: ID, name: 'Agent Questions', session: null, place: { epic: null, parts: [], kehikko: null } }, to: params.to, body: params.body, once: true })
        kept.push(one)
        return { outcome: 'sent', id: one.id, why: '' }
      }
      if (method === 'messages.say') {
        const one = message({ from: { module: ID, name: 'Agent Questions', session: null, place: { epic: null, parts: [], kehikko: null }, person: true }, ...params })
        kept.push(one)
        return { outcome: 'sent', id: one.id, why: '' }
      }
      throw new Error(`unexpected ${method}`)
    },
    header: () => {},
    footer: (items) => void footers.push(items),
    activity: (items) => void activity.push(items),
    projectId: 'proj-1',
    epic: 'methods',
    kehikko: 'writing',
    visible: false,
  }
  const store: IntroStore = {
    read: async () => ({ sessions: Object.fromEntries(introduced.map((key) => [key, 1])), places: {} }),
    note: async (_project, add) => void notes.push(add),
  }
  return { bridge, store, asked, activity, footers, notes, kept }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)))
}

describe('the Orchestrator page', () => {
  test('a question from a session is drawn first, with its choices, and raises a needs-you item', async () => {
    const q = message({ kind: 'question', choices: ['Postgres', 'SQLite'], body: 'Which database?' })
    const report = message({ from: { module: 'kehikot.codex', name: 'Codex', session: 'c-1', place: { epic: 'results', parts: [], kehikko: 'writing' } }, kind: 'report', body: 'Working on the parser' })
    const host = standIn([q, report])
    render(<Orchestrator bridge={host.bridge} store={host.store} view="all" now={() => NOW} />)
    await settle()
    const waiting = screen.getByRole('region', { name: 'Questions waiting' })
    expect(within(waiting).getByText('Which database?')).toBeTruthy()
    expect(within(waiting).getByRole('button', { name: 'Postgres' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Agent sessions' }).textContent).toContain('Waiting for you')
    expect(screen.getByRole('region', { name: 'Working on' }).textContent).toContain('Working on the parser')
    const items = host.activity.at(-1) as Array<{ state: string; id: string }>
    expect(items).toEqual([expect.objectContaining({ state: 'attention', id: `question-${q.id}` })])
    expect(JSON.stringify(host.footers.at(-1))).toContain('1 question waiting')
    expect(JSON.stringify(host.footers.at(-1))).toContain('1 agent working')
  })

  test('pressing a choice sends the person’s answer to that session, replying to the question, and withdraws the item', async () => {
    const q = message({ kind: 'question', choices: ['Postgres', 'SQLite'], body: 'Which database?', thread: 'db' })
    const host = standIn([q])
    render(<Orchestrator bridge={host.bridge} store={host.store} view="all" now={() => NOW} />)
    await settle()
    host.asked.length = 0
    /* This session wrote here, so it already knows the module: no introduction. */
    fireEvent.click(within(screen.getByRole('region', { name: 'Questions waiting' })).getByRole('button', { name: 'SQLite' }))
    await settle()
    const sends = host.asked.filter((one) => one.method !== 'messages.mine')
    expect(sends).toEqual([{ method: 'messages.say', params: { to: { session: { module: 'kehikot.claude', session: 'sess-1' } }, body: 'SQLite', replyTo: q.id, thread: 'db' } }])
    expect(host.activity.at(-1)).toEqual([])
    expect(screen.queryByRole('region', { name: 'Questions waiting' })).toBeNull()
  })

  test('the first word to a session that never wrote here is preceded by the introduction, once', async () => {
    const said = message({ from: { module: ID, name: 'Agent Questions', session: null, place: { epic: null, parts: [], kehikko: null }, person: true }, to: { session: { module: 'kehikot.vibe', session: 'v-1' } }, body: 'Are you there?' })
    const host = standIn([said])
    render(<Orchestrator bridge={host.bridge} store={host.store} view="all" now={() => NOW} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /kehikot\.vibe/ }))
    await settle()
    const write = (text: string) => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: text } })
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    }
    host.asked.length = 0
    write('Please rebase')
    await settle()
    write('And run the tests')
    await settle()
    const sends = host.asked.filter((one) => one.method !== 'messages.mine')
    expect(sends.map((one) => one.method)).toEqual(['messages.post', 'messages.say', 'messages.say'])
    expect(sends[0]!.params).toEqual({ to: { session: { module: 'kehikot.vibe', session: 'v-1' } }, once: true, body: INTRO })
    expect(sends[1]!.params).toEqual({ to: { session: { module: 'kehikot.vibe', session: 'v-1' } }, body: 'Please rebase' })
    expect(host.notes).toContainEqual({ sessions: [`kehikot.vibe\u0000v-1`] })
  })

  test('announces itself once at its kehikko when placed', async () => {
    const host = standIn([])
    render(<Orchestrator bridge={host.bridge} store={host.store} view="all" now={() => NOW} />)
    await settle()
    const posts = host.asked.filter((one) => one.method === 'messages.post')
    expect(posts).toEqual([{ method: 'messages.post', params: { to: { place: { kehikko: 'writing' } }, once: true, body: INTRO } }])
    expect(host.notes).toContainEqual({ places: ['writing'] })
  })

  test('a typed message to everyone goes to the project', async () => {
    const host = standIn([])
    render(<Orchestrator bridge={host.bridge} store={host.store} view="all" now={() => NOW} />)
    await settle()
    const to = screen.getByRole('combobox', { name: 'To' }) as HTMLSelectElement
    const everyone = [...to.options].findIndex((one) => one.textContent === 'Every session in the project')
    fireEvent.change(to, { target: { value: String(everyone) } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Lunch break' } })
    host.asked.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await settle()
    expect(host.asked.filter((one) => one.method === 'messages.say')).toEqual([{ method: 'messages.say', params: { to: { project: true }, body: 'Lunch break' } }])
  })

  test('a refusal because the person has not allowed it says where to turn it on', async () => {
    const host = standIn([message({ kind: 'question', choices: ['Yes', 'No'], body: 'Merge?' })])
    host.bridge.request = (async (method: string, params: Record<string, unknown> = {}) => {
      if (method === 'messages.say') return { outcome: 'declined', id: null, why: 'The person has not allowed this module to send messages as them.' }
      if (method === 'messages.mine') return { messages: host.kept.filter((one) => one.id > ((params.since as number) ?? 0)), more: 0 }
      return { outcome: 'sent', id: 999, why: '' }
    }) as Bridge['request']
    render(<Orchestrator bridge={host.bridge} store={host.store} view="all" now={() => NOW} />)
    await settle()
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0]!)
    await settle()
    expect(screen.getByRole('status').textContent).toContain('Settings › Modules › Agent Questions')
  })
})
