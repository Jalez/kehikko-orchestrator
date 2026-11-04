import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PERSON_MESSAGES_SETTING, SETTINGS_PATH } from 'kehikot-module-protocol'

import { TICKET, answer } from '../doors.ts'
import { ID, MANIFEST } from '../manifest.ts'
import { INTRODUCED_MOST, noteIntroduced, readIntroduced, readSettings, storeDir } from '../store.ts'

/**
 * This module's own doors: health, the person's setting, and the record of whom it introduced
 * itself to — kept in its machine folder, written only with the page's ticket.
 */

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orchestrator-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const call = (method: string, path: string, query: Record<string, string> = {}, body: Record<string, unknown> | null = null, ticket: string | null = null) =>
  answer(method, path, new URLSearchParams(query), body, ticket, dir)

describe('the manifest', () => {
  test('asks for the messages, the person’s messages and the Inbox, and nothing it no longer does', () => {
    expect(MANIFEST.id).toBe(ID)
    expect(MANIFEST.declares.uses).toEqual(['agents:message', 'messages:as-person', 'activity:report'])
    expect(MANIFEST.declares.prompt).toBe(false)
    expect(MANIFEST.declares.settings?.map((one) => one.key)).toEqual([PERSON_MESSAGES_SETTING.key])
    expect(MANIFEST.declares.settings?.[0]).toMatchObject({ personOnly: true, default: false, scope: 'machine' })
    expect(MANIFEST.mcp).toBeUndefined()
  })
})

describe('the doors', () => {
  test('health', async () => {
    expect((await call('GET', '/healthz'))?.body).toMatchObject({ ok: true, id: ID })
  })
  test('the setting: off until the person turns it on', async () => {
    expect((await call('GET', SETTINGS_PATH))?.body).toMatchObject({ ok: true, values: { sendAsPerson: false } })
    const refused = await call('POST', SETTINGS_PATH, {}, { key: 'sendAsPerson', value: true, by: 'agent' })
    expect(refused?.body).toMatchObject({ outcome: 'refused' })
    expect(readSettings(dir).sendAsPerson).toBe(false)
    const saved = await call('POST', SETTINGS_PATH, {}, { key: 'sendAsPerson', value: true }, TICKET)
    expect(saved?.body).toMatchObject({ outcome: 'saved' })
    expect(readSettings(dir).sendAsPerson).toBe(true)
  })
  test('/api/introduced: read freely, written only with the ticket', async () => {
    expect((await call('GET', '/api/introduced', { project: 'p1' }))?.body).toEqual({ ok: true, sessions: {}, places: {} })
    const refused = await call('POST', '/api/introduced', {}, { project: 'p1', sessions: ['kehikot.claude\u0000s1'] })
    expect(refused?.status).toBe(403)
    const written = await call('POST', '/api/introduced', {}, { project: 'p1', sessions: ['kehikot.claude\u0000s1', 'bad key'], places: ['writing', 'Not A Key'] }, TICKET)
    expect(written?.status).toBe(200)
    const read = (await call('GET', '/api/introduced', { project: 'p1' }))?.body as { sessions: Record<string, number>; places: Record<string, number> }
    expect(Object.keys(read.sessions)).toEqual(['kehikot.claude\u0000s1'])
    expect(Object.keys(read.places)).toEqual(['writing'])
    expect((await call('POST', '/api/introduced', {}, { project: '../etc' }, TICKET))?.status).toBe(400)
  })
})

describe('the store', () => {
  test('in the machine folder, never a project', () => {
    expect(storeDir({}, 'darwin')).toContain(join('Library', 'Application Support', 'Kehikot', 'orchestrator'))
    expect(storeDir({ KEHIKOT_ORCHESTRATOR_DIR: '/tmp/x' }, 'darwin')).toBe('/tmp/x')
  })
  test('a session is remembered once, with the first time; projects are kept apart; capped', () => {
    noteIntroduced(dir, 'p1', { sessions: ['kehikot.claude\u0000s1'] }, 1)
    noteIntroduced(dir, 'p1', { sessions: ['kehikot.claude\u0000s1'] }, 2)
    expect(readIntroduced(dir, 'p1').sessions['kehikot.claude\u0000s1']).toBe(1)
    expect(readIntroduced(dir, 'p2').sessions).toEqual({})
    const many = Array.from({ length: INTRODUCED_MOST + 5 }, (_, i) => `kehikot.claude\u0000s-${i}`)
    for (let i = 0; i < many.length; i += 50) noteIntroduced(dir, 'p1', { sessions: many.slice(i, i + 50) }, 10 + i)
    expect(Object.keys(readIntroduced(dir, 'p1').sessions).length).toBe(INTRODUCED_MOST)
    expect(JSON.parse(readFileSync(join(dir, 'introduced.json'), 'utf8'))).toHaveProperty('p1')
  })
})
