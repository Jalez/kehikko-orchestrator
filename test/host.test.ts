import { describe, expect, mock, test } from 'bun:test'
import { MESSAGE, PROTOCOL } from 'roadmap-module-protocol'

import { connect } from '../src/wire/host.ts'
import type { MessageSource } from '../src/wire/mailbox.ts'

/**
 * The wire, without a browser.
 *
 * `connect` takes its source as an argument precisely so this file can exist:
 * every decision it makes — who to answer, what to ignore, what to do with a
 * `goto` nobody handled — is testable against a fake window, and none of it
 * needs a frame or a host.
 */

function fake() {
  const listeners = new Set<(ev: MessageEvent) => void>()
  const sent: unknown[] = []
  const host = { postMessage: (m: unknown) => sent.push(m) } as unknown as Window
  const source: MessageSource = {
    addEventListener: (_t, fn) => listeners.add(fn),
    removeEventListener: (_t, fn) => listeners.delete(fn),
    parent: null,
  }
  const deliver = (data: unknown, from: Window | null = host, origin = 'http://127.0.0.1:4181') => {
    for (const fn of listeners) fn({ data, source: from, origin } as unknown as MessageEvent)
  }
  const hello = (context: Record<string, unknown> = {}) =>
    deliver({
      type: MESSAGE.HELLO,
      protocol: PROTOCOL,
      session: 's1',
      state: null,
      context: { epic: 'e', project: null, theme: 'dark', selection: [], pinned: false, prompt: null, ...context },
    })
  return { source, host, sent, deliver, hello }
}

describe('being greeted', () => {
  test('answers with roadmap.ready, naming itself', () => {
    const w = fake()
    connect('roadmap.orchestrator', {}, w.source)
    w.hello()
    expect(w.sent[0]).toMatchObject({ type: MESSAGE.READY, id: 'roadmap.orchestrator', protocol: PROTOCOL })
  })

  test('hands the context on, including the fields that were added last', () => {
    const w = fake()
    const onHello = mock(() => {})
    connect('m', { onHello }, w.source)
    w.hello({ selection: ['gh#131'], prompt: 'review it', pinned: true })
    /* The listing in `onMessage` has to be complete, and completeness is not
       obvious to look at: a field left out does not fail, it quietly becomes
       the page's idea that the host said nothing about it. */
    expect(onHello).toHaveBeenCalledWith(
      expect.objectContaining({ selection: ['gh#131'], prompt: 'review it', pinned: true }),
      null,
    )
  })

  test('a re-greeting is normal, not an error', () => {
    const w = fake()
    connect('m', {}, w.source)
    w.hello()
    w.hello()
    expect(w.sent.filter((m) => (m as { type: string }).type === MESSAGE.READY)).toHaveLength(2)
  })
})

describe('a context after the greeting', () => {
  test('carries selection, prompt and pinned through', () => {
    const w = fake()
    const onContext = mock(() => {})
    connect('m', { onContext }, w.source)
    w.hello()
    w.deliver({
      type: MESSAGE.CONTEXT,
      /* A context message carries the protocol number too. Left out, this
         parses as nothing and the page silently never hears it — which is the
         failure `hostMessageSchema` is here to make loud on the receiving side
         and quiet on this one. */
      protocol: PROTOCOL,
      epic: 'e2',
      project: null,
      theme: 'light',
      selection: ['!12', 'gh#9'],
      pinned: false,
      prompt: '## from roadmap.references\nlook',
    })
    expect(onContext).toHaveBeenCalledWith({
      epic: 'e2',
      project: null,
      theme: 'light',
      selection: ['!12', 'gh#9'],
      pinned: false,
      prompt: '## from roadmap.references\nlook',
    })
  })

  /**
   * The check that matters most in THIS module. What travels on this wire ends
   * up in the opening words of a process; a second sender able to inject a
   * context would be somebody else choosing what an agent is told.
   */
  test('is ignored when it did not come from the window that greeted us', () => {
    const w = fake()
    const onContext = mock(() => {})
    connect('m', { onContext }, w.source)
    w.hello()
    const stranger = { postMessage: () => {} } as unknown as Window
    w.deliver(
      { type: MESSAGE.CONTEXT, protocol: PROTOCOL, epic: 'x', project: null, theme: 'dark', selection: ['gh#666'], pinned: false, prompt: 'do harm' },
      stranger,
    )
    expect(onContext).not.toHaveBeenCalled()
  })

  test('anything that is not a wire message is ignored', () => {
    const w = fake()
    const onContext = mock(() => {})
    connect('m', { onContext }, w.source)
    w.hello()
    /* Vite's own hot-reload socket posts at this window, and it is not
       hypothetical: this page is served by Vite. */
    w.deliver({ type: 'vite:beforeUpdate', updates: [] })
    w.deliver('a string')
    expect(onContext).not.toHaveBeenCalled()
  })
})

describe('asking a question', () => {
  test('is refused rather than hanging when nothing has greeted us', async () => {
    const w = fake()
    const host = connect('m', {}, w.source)
    await expect(host.request('live.get', {})).rejects.toThrow('nobody to ask')
  })

  test('matches an answer to the question by correlation id', async () => {
    const w = fake()
    const host = connect('m', {}, w.source)
    w.hello()
    const asked = host.request('live.get', { epic: 'e' })
    const sent = w.sent.find((m) => (m as { type: string }).type === MESSAGE.REQUEST) as { id: string }
    w.deliver({ type: MESSAGE.RESPONSE, id: sent.id, ok: true, data: { issues: {} } })
    await expect(asked).resolves.toEqual({ issues: {} })
  })

  test('a refusal arrives as HostRefused with the host’s own words', async () => {
    const w = fake()
    const host = connect('m', {}, w.source)
    w.hello()
    const asked = host.request('live.get', {})
    const sent = w.sent.find((m) => (m as { type: string }).type === MESSAGE.REQUEST) as { id: string }
    w.deliver({ type: MESSAGE.RESPONSE, id: sent.id, ok: false, reason: 'unknown-method', error: 'never heard of it' })
    await expect(asked).rejects.toThrow('never heard of it')
  })

  test('stopping refuses everything still waiting rather than leaving it hanging', async () => {
    const w = fake()
    const host = connect('m', {}, w.source)
    w.hello()
    const asked = host.request('live.get', {})
    host.stop()
    await expect(asked).rejects.toThrow('stopped listening')
  })
})

describe('a goto', () => {
  /**
   * This module lists sessions and not references, so there is nothing to walk
   * to — but the answer is not optional. The host waits 1200ms and then treats
   * silence as "not found", which is right behaviour and a worse experience
   * than being told.
   */
  test('is always answered, even though this module has nothing to walk to', () => {
    const w = fake()
    connect('m', {}, w.source)
    w.hello()
    w.deliver({ type: MESSAGE.GOTO, id: 'g1', ref: 'gh#131' })
    const went = w.sent.find((m) => (m as { type: string }).type === MESSAGE.WENT)
    expect(went).toMatchObject({ id: 'g1', found: false })
  })

  test('is answered once even if the handler throws', () => {
    const w = fake()
    connect('m', { onGoto: () => { throw new Error('boom') } }, w.source)
    w.hello()
    w.deliver({ type: MESSAGE.GOTO, id: 'g2', ref: 'gh#1' })
    expect(w.sent.filter((m) => (m as { type: string }).type === MESSAGE.WENT)).toHaveLength(1)
  })
})
