import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PERSON_MESSAGES_SETTING, settingsValues } from 'kehikot-module-protocol'

import { SETTINGS } from './settings.ts'

/**
 * What this module keeps: two small files in its machine folder, never in a project.
 *
 *   ~/Library/Application Support/Kehikot/orchestrator/     (macOS; $XDG_DATA_HOME/kehikot/orchestrator elsewhere)
 *     settings.json     the person's setting: send messages to agent sessions as them
 *     introduced.json   which agent sessions this module has introduced itself to, and where it
 *                       last announced itself, per project id
 *
 * Why the machine and not `<project>/.kehikot/orchestrator/`: everything here is about THIS
 * computer. An agent session (its id, its terminal) means nothing on a teammate's machine, and the
 * host keeps the messages themselves in its own machine database for the same reason. A project
 * file would travel with the repository to nobody. `KEHIKOT_ORCHESTRATOR_DIR` puts it elsewhere (the
 * tests).
 */
export function storeDir(env: Record<string, string | undefined> = process.env, platform: string = process.platform): string {
  if (env.KEHIKOT_ORCHESTRATOR_DIR) return env.KEHIKOT_ORCHESTRATOR_DIR
  const home = homedir() // kehikot-storage: allow the module's machine folder: agent sessions are this computer's, not a project's
  return platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Kehikot', 'orchestrator') : join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'kehikot', 'orchestrator')
}

function readJson(file: string): Record<string, unknown> {
  try {
    const read = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return typeof read === 'object' && read !== null && !Array.isArray(read) ? (read as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Written whole, through a temporary file, so a reader never sees half of one. */
function writeJson(dir: string, name: string, value: unknown): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, name)
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, file)
}

/* ---- the setting ---- */

export function readSettings(dir: string = storeDir()): Record<string, unknown> {
  return settingsValues(SETTINGS, readJson(join(dir, 'settings.json')))
}

/** One change, already held to the field by the settings door. Null: written. */
export function writeSetting(dir: string, key: string, value: unknown): string | null {
  if (key !== PERSON_MESSAGES_SETTING.key) return `There is no setting called ${key.slice(0, 64)} here.`
  writeJson(dir, 'settings.json', { ...readJson(join(dir, 'settings.json')), [key]: value === true })
  return null
}

/* ---- introductions ---- */

/** How many sessions one project remembers; the oldest go first. */
export const INTRODUCED_MOST = 2000
/** How many places one project remembers having announced itself at. */
export const ANNOUNCED_MOST = 200

export interface Introduced {
  /** `module\u0000session` → when this module introduced itself to that session (ms). */
  sessions: Record<string, number>
  /** A kehikko's key → when this module last announced itself there (ms). */
  places: Record<string, number>
}

const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/

function projectOf(all: Record<string, unknown>, project: string): Introduced {
  const one = all[project] as Partial<Introduced> | undefined
  const numbers = (value: unknown): Record<string, number> =>
    typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
      : {}
  return { sessions: numbers(one?.sessions), places: numbers(one?.places) }
}

const newest = (record: Record<string, number>, most: number): Record<string, number> =>
  Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1]).slice(0, most))

export function readIntroduced(dir: string, project: string): Introduced {
  if (!PROJECT_ID.test(project)) return { sessions: {}, places: {} }
  return projectOf(readJson(join(dir, 'introduced.json')), project)
}

/** Remember sessions introduced and places announced at, in one project. Merged, never forgotten but by the caps. */
export function noteIntroduced(dir: string, project: string, add: { sessions?: string[]; places?: string[] }, now: number = Date.now()): Introduced | null {
  if (!PROJECT_ID.test(project)) return null
  const all = readJson(join(dir, 'introduced.json'))
  const was = projectOf(all, project)
  const key = /^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]\u0000[^\u0000]{1,128}$/
  const place = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/
  const sessions = { ...was.sessions }
  for (const one of add.sessions ?? []) if (key.test(one) && sessions[one] === undefined) sessions[one] = now
  const places = { ...was.places }
  for (const one of add.places ?? []) if (place.test(one)) places[one] = now
  const next: Introduced = { sessions: newest(sessions, INTRODUCED_MOST), places: newest(places, ANNOUNCED_MOST) }
  writeJson(dir, 'introduced.json', { ...all, [project]: next })
  return next
}
