import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DIRS_VAR, allowed, readScope } from '../scope.ts'

/**
 * The allow-list is the fence around the only dangerous thing this module does.
 * Every one of these is a way somebody could otherwise get a session started
 * somewhere nobody named.
 */
describe('the directories this module may start a session in', () => {
  const real = mkdtempSync(join(tmpdir(), 'orchestrator-scope-'))
  const file = join(real, 'a-file')
  writeFileSync(file, 'not a directory\n')

  test('unset means the list is empty, not that everything is allowed', () => {
    const scope = readScope({})
    expect(scope.dirs).toEqual([])
    expect(allowed(real, scope)).toBe(false)
  })

  test('reads a colon-separated list, keeping the order', () => {
    const scope = readScope({ [DIRS_VAR]: `${real}:${tmpdir()}` })
    expect(scope.dirs[0]).toBe(real)
    expect(scope.dirs).toContain(real)
  })

  test('refuses a relative path rather than resolving it against a cwd nobody can see', () => {
    const scope = readScope({ [DIRS_VAR]: 'projects/thing' })
    expect(scope.dirs).toEqual([])
    expect(scope.rejected[0]?.path).toBe('projects/thing')
  })

  test('refuses a path that is not there, and says so', () => {
    const scope = readScope({ [DIRS_VAR]: '/no/such/place/at/all' })
    expect(scope.dirs).toEqual([])
    expect(scope.rejected[0]?.why).toContain('nothing at that path')
  })

  test('refuses a file', () => {
    const scope = readScope({ [DIRS_VAR]: file })
    expect(scope.dirs).toEqual([])
    expect(scope.rejected[0]?.why).toContain('not a directory')
  })

  /**
   * The one that matters most. `allowed` is equality against a resolved path
   * and NOT containment: accepting anything under an allowed root would let a
   * request name a subdirectory nobody wrote down. A start directory is a
   * directory somebody wrote, not one they wrote a prefix of.
   */
  test('does not accept a subdirectory of an allowed directory', () => {
    const scope = readScope({ [DIRS_VAR]: real })
    expect(allowed(real, scope)).toBe(true)
    expect(allowed(join(real, 'node_modules'), scope)).toBe(false)
  })

  test('does not accept a traversal that resolves outside', () => {
    const scope = readScope({ [DIRS_VAR]: real })
    expect(allowed(`${real}/../..`, scope)).toBe(false)
    expect(allowed('', scope)).toBe(false)
    expect(allowed('relative', scope)).toBe(false)
  })
})
