import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { answer } from '../doors.ts'
import { rank, type Session } from '../sessions.ts'
import { readScope, withProject } from '../scope.ts'

/** The scope follows the project the page names and the host confirms, across a rename. */

const ID = '44444444-4444-4444-8444-444444444444'
const made: string[] = []
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true })
})

function root(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orchestrator-project-')))
  made.push(dir)
  return dir
}
function project(at: string, id: string | null = ID): string {
  mkdirSync(join(at, '.kehikot'), { recursive: true })
  if (id) writeFileSync(join(at, '.kehikot', 'project.json'), JSON.stringify({ id, createdAt: null }))
  return at
}
const yes = async () => true
const no = async () => false
const none = readScope({})

const session = (cwd: string): Session => ({ id: 'a', sessionId: 's', name: 'n', cwd, kind: 'bg', startedAt: 1, state: 'idle' })

describe('the project is the scope', () => {
  test('without ORCHESTRATOR_DIRS the host-confirmed project path is the working directory', async () => {
    const p = project(join(root(), 'thesis'))
    const scope = await withProject(none, p, yes)
    expect(scope.dirs).toEqual([p])
    expect(scope.project).toBe(p)
  })

  test('a path the host does not hold as a project is not taken', async () => {
    const p = project(join(root(), 'thesis'))
    expect((await withProject(none, p, no)).dirs).toEqual([])
    expect((await withProject(none, 'relative/path', yes)).dirs).toEqual([])
    expect((await withProject(none, '/no/such/place', yes)).dirs).toEqual([])
    expect((await withProject(none, null, yes)).dirs).toEqual([])
  })

  test('ORCHESTRATOR_DIRS stays as an extra allow-list beside the project', async () => {
    const base = root()
    const p = project(join(base, 'thesis'))
    const extra = join(base, 'extra')
    mkdirSync(extra)
    const scope = await withProject(readScope({ ORCHESTRATOR_DIRS: extra }), p, yes)
    expect(scope.dirs).toEqual([p, extra])
  })

  test('after a rename Start works in the new path with no environment at all', async () => {
    const base = root()
    const old = project(join(base, 'old'))
    await withProject(none, old, yes)
    const next = join(base, 'new')
    renameSync(old, next)

    const said = await answer('GET', '/api/scope', new URLSearchParams({ project: next }), null, null, none, yes)
    expect((said?.body as { dirs: string[] }).dirs).toEqual([next])

    /* The write ticket is still checked first: a bad one is refused, and nothing is spawned. */
    const refused = await answer('POST', '/api/start', new URLSearchParams(), { prompt: 'x', dir: next, project: next }, 'bad', none, yes)
    expect((refused?.body as { ok: boolean }).ok).toBe(false)
  })
})

describe('sessions under a former path of the same project', () => {
  test('the old path, recorded inside the project, is carried by the rename', async () => {
    const base = root()
    const old = project(join(base, 'old'))
    const first = await withProject(none, old, yes)
    expect(first.former).toEqual([])

    const next = join(base, 'new')
    renameSync(old, next)
    const scope = await withProject(none, next, yes)
    expect(scope.former).toEqual([old])

    const rows = rank([session(`${old}/src`), session(`${next}/src`), session(`${old}-notes`)], [...scope.dirs, ...scope.former!])
    expect(rows.map((r) => r.cwd).sort()).toEqual([`${next}/src`, `${old}/src`].sort())
  })

  test('a path that still exists is another folder, not a former one', async () => {
    const base = root()
    const a = project(join(base, 'a'))
    await withProject(none, a, yes)
    /* A copy carries the record and the id; the original is still there. */
    const b = join(base, 'b')
    mkdirSync(join(b, '.kehikot', 'kehikot-orchestrator'), { recursive: true })
    writeFileSync(join(b, '.kehikot', 'project.json'), JSON.stringify({ id: ID, createdAt: null }))
    writeFileSync(join(b, '.kehikot', 'kehikot-orchestrator', 'paths.json'), JSON.stringify({ id: ID, paths: [a] }))
    expect((await withProject(none, b, yes)).former).toEqual([])
  })

  test('a record from a project with another id is not trusted', async () => {
    const base = root()
    const a = join(base, 'a')
    project(a, ID)
    const b = project(join(base, 'b'), '55555555-5555-4555-8555-555555555555')
    mkdirSync(join(b, '.kehikot', 'kehikot-orchestrator'), { recursive: true })
    writeFileSync(join(b, '.kehikot', 'kehikot-orchestrator', 'paths.json'), JSON.stringify({ id: ID, paths: [join(base, 'gone')] }))
    expect((await withProject(none, b, yes)).former).toEqual([])
  })
})
