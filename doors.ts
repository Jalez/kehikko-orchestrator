import { establishBuild, mintTicket, refuseTicket, settingsDoor, type Reply } from 'kehikot-module-protocol/serve'

import { ID, MANIFEST, VERSION } from './manifest.ts'
import { SETTINGS } from './settings.ts'
import { noteIntroduced, readIntroduced, readSettings, storeDir, writeSetting } from './store.ts'

export { MANIFEST }
export type { Reply }

/**
 * This module's own doors. Almost everything the Orchestrator does goes through the HOST — the
 * messages are the host's (protocol 2.50.0: `messages.mine`, `messages.post`, `messages.say`), and the
 * person's mark on a message is the host's to stamp. What is left here is small:
 *
 *  - `/healthz`;
 *  - the settings door (`settingsDoor`): the person's "Send messages to agent sessions as you";
 *  - `/api/introduced`: which agent sessions this module has introduced itself to, and where it last
 *    announced itself, per project — read with GET, added to with POST (the page's ticket).
 */

/** The page's write ticket: printed into the page, new on every start. Not a credential against this machine. */
export const TICKET = mintTicket()

export const BUILD = establishBuild({ version: VERSION, dir: import.meta.dirname })

const NO_TICKET =
  'That request did not carry this module’s write ticket. The ticket is printed into the page this module serves and is new on every start, so a page holding an old one only has to be reloaded.'

const ok = (body: unknown): Reply => ({ status: 200, body })
const refuse = (status: number, why: string): Reply => ({ status, body: { ok: false, error: why } })

const strings = (value: unknown, most: number): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one.length <= 256).slice(0, most) : [])

export async function answer(
  method: string,
  path: string,
  params: URLSearchParams,
  body: Record<string, unknown> | null,
  ticket: string | null,
  dir: string = storeDir(),
): Promise<Reply | null> {
  if (path === '/healthz') return ok({ ok: true, id: ID, version: VERSION })

  const settings = settingsDoor({
    module: ID,
    fields: SETTINGS,
    read: () => ({ values: readSettings(dir) }),
    write: (_project, key, value) => writeSetting(dir, key, value),
    ticket: TICKET,
  })
  const said = await settings(method, path, params, body, ticket)
  if (said) return said

  if (path === '/api/introduced') {
    if (method === 'GET') {
      const project = params.get('project') ?? ''
      return ok({ ok: true, ...readIntroduced(dir, project) })
    }
    if (method !== 'POST') return refuse(405, '/api/introduced takes GET and POST.')
    const refused = refuseTicket(ticket, TICKET, NO_TICKET)
    if (refused) return refused
    const project = typeof body?.project === 'string' ? body.project : ''
    const noted = noteIntroduced(dir, project, { sessions: strings(body?.sessions, 50), places: strings(body?.places, 10) })
    if (!noted) return refuse(400, 'Which project: its id, as the host names it.')
    return ok({ ok: true, ...noted })
  }

  return null
}
