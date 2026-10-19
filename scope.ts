import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import { moduleFile, readProjectFile } from 'kehikot-module-protocol'
import { hostHasProject } from 'kehikot-module-protocol/serve'

import { ID } from './manifest.ts'

/**
 * Which working copies this module is allowed to look at, and to start a
 * session in.
 *
 * ## One list, two jobs, and why they are the same list
 *
 * It reads the roster and it spawns processes, and the temptation is two
 * settings: a wide one for looking and a narrow one for starting. That is worse
 * than it sounds. Two lists means a person configures one, sees the page work,
 * and discovers the other exists only when a button refuses — and the refusal
 * is about a variable they have never heard of. One list, and the sentence is
 * "these are the directories this module is about". If it is safe to start a
 * session there it is safe to read the sessions there, and if it is not safe to
 * start one there it should not be on the list at all.
 *
 * ## No default, ever
 *
 * The host's old `src/dispatch.ts` had a default working directory once — a path that
 * did not exist on the machine — so its button spawned nothing, said it had
 * started something, and locked itself out for ten minutes. The version that
 * replaced it states the rule this file keeps:
 *
 *   There is no default: a guessed path is an agent editing the wrong
 *   repository.
 *
 * So an unset variable means the START list is empty, and the page says which
 * variable to set in the words a person can act on. It does NOT mean the page
 * is useless: an empty list reads as UNSCOPED for the roster, which shows every
 * session on the machine. Those two behaviours look inconsistent written down
 * and are right: showing more sessions than you meant is a busy list, and
 * starting an agent somewhere you did not mean is a bad afternoon.
 *
 * ## Why an environment variable and not a settings file the page can write
 *
 * Because a page that can add a directory to its own allow-list has no
 * allow-list. Whoever starts this process chooses what it may touch, in the
 * same act as choosing to start it, and nothing this program receives over HTTP
 * can widen that. It is the same shape as a registration naming a directory and
 * one script inside it rather than a command line.
 */
export const DIRS_VAR = 'ORCHESTRATOR_DIRS'

export interface Scope {
  /** Absolute, existing directories, in the order they were written. */
  dirs: string[]
  /** What was named and is not a directory on this machine, so the page can say so. */
  rejected: { path: string; why: string }[]
  /** The open project's directory, when the host vouched for it (`withProject`). Absent for the plain env list. */
  project?: string | null
  /**
   * Directories this same project used to live at: gone from disk, recorded under the project's
   * own `.kehikot`, and so carried by a rename. A session whose cwd is under one is this project's.
   * Never a place to START anything; only the roster reads them.
   */
  former?: string[]
}

/**
 * Read the list.
 *
 * Colon-separated, like a PATH, because that is the punctuation a person
 * already knows means "a list of directories" and because a comma is a
 * character that appears in directory names on somebody's machine somewhere.
 *
 * Every entry is resolved to an absolute path and checked to exist. A relative
 * entry is refused rather than resolved against this process's cwd: the cwd of
 * a program started by a host is not a thing the person who wrote the variable
 * can see, so resolving against it would silently mean a different directory
 * depending on how the module was launched.
 */
export function readScope(env: Record<string, string | undefined> = process.env): Scope {
  const raw = (env[DIRS_VAR] ?? '').trim()
  const dirs: string[] = []
  const rejected: Scope['rejected'] = []
  for (const piece of raw.split(':')) {
    const path = piece.trim()
    if (!path) continue
    if (!isAbsolute(path)) {
      rejected.push({ path, why: `${DIRS_VAR} takes absolute paths; this one is relative to nothing a person can see` })
      continue
    }
    const full = resolve(path)
    if (!existsSync(full)) {
      rejected.push({ path: full, why: 'there is nothing at that path on this machine' })
      continue
    }
    if (!statSync(full).isDirectory()) {
      rejected.push({ path: full, why: 'that is a file, not a directory' })
      continue
    }
    if (!dirs.includes(full)) dirs.push(full)
  }
  return { dirs, rejected }
}

/**
 * Is this exactly one of the directories on the list?
 *
 * An equality test against a resolved path, and deliberately not `under()` from
 * `sessions.ts`. The roster asks "is this session inside a directory I care
 * about", which is a question about containment; starting asks "may I run
 * something HERE", and accepting anything under an allowed root would let a
 * request name `…/allowed/node_modules/something` and be obeyed. A start
 * directory is a directory somebody wrote down, not a directory somebody wrote
 * a prefix of.
 */
export function allowed(dir: string, scope: Scope): boolean {
  if (!dir) return false
  if (!isAbsolute(dir)) return false
  return scope.dirs.includes(resolve(dir))
}

/** The id in `<dir>/.kehikot/project.json`, or null. */
export function projectIdAt(dir: string): string | null {
  try {
    const read = readProjectFile(JSON.parse(readFileSync(resolve(dir, '.kehikot', 'project.json'), 'utf8')))
    return read ? read.id : null
  } catch {
    return null
  }
}

/** How many past paths a project remembers. A project is not renamed a hundred times. */
const PATHS_KEPT = 20

/**
 * The paths this project has been seen at, kept in `<project>/.kehikot/<module>/paths.json`, so the
 * list moves with the folder when it is renamed or moved. Returns the ones that are gone from disk.
 */
function formerPaths(project: string, id: string | null): string[] {
  const file = moduleFile(project, ID, 'paths')
  if (!file) return []
  let seen: string[] = []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { id?: unknown; paths?: unknown }
    const same = id === null || typeof parsed.id !== 'string' || parsed.id === id
    if (same && Array.isArray(parsed.paths)) seen = parsed.paths.filter((p): p is string => typeof p === 'string' && isAbsolute(p))
  } catch {
    /* Nothing recorded yet, or not readable: this is the first path. */
  }
  const former = seen.filter((p) => p !== project && !existsSync(p))
  if (!seen.includes(project)) {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `${JSON.stringify({ id, paths: [...seen, project].slice(-PATHS_KEPT) }, null, 2)}\n`)
    } catch {
      /* Read-only project: the old paths just cannot be remembered. */
    }
  }
  return former
}

/**
 * The scope for one request: the project the page says is open, when the HOST says it is one, and
 * `extra` (the `ORCHESTRATOR_DIRS` list) beside it as an optional further allow-list.
 *
 * The page sends `context.projectPath` and the host's `/host/is-project` decides whether it is a
 * project (`hostHasProject`) — a request cannot name an arbitrary directory and have a session
 * started there. A rename gives the page a new path and the same `project.json` id; sessions that
 * were started under the old path stay this project's (`former`).
 */
export async function withProject(
  extra: Scope,
  given: unknown,
  check: (folder: string) => Promise<boolean> = hostHasProject,
): Promise<Scope> {
  if (typeof given !== 'string' || !given.trim() || !isAbsolute(given.trim())) return extra
  let project: string
  try {
    project = realpathSync(given.trim())
    if (!statSync(project).isDirectory()) return extra
  } catch {
    return extra
  }
  if (!(await check(project))) return extra
  const former = formerPaths(project, projectIdAt(project))
  return { dirs: [project, ...extra.dirs.filter((d) => d !== project)], rejected: extra.rejected, project, former }
}
