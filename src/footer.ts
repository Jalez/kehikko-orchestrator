import { LIMITS, footerItemsSchema, type FooterItem } from 'kehikot-module-protocol'

import type { Roster, Row } from '@/api/client.ts'

/**
 * The Orchestrator's footer, in a host that draws one (`kehikot.footer`, protocol 2.38.0): what
 * the sessions are doing now, so a container folded to its header and footer still says it. The
 * header keeps Start a session (it starts something); the legend the page drew above the roster
 * (how many of how many, matching what, in which directories, older ones left out, held) is here
 * instead. Nothing here is pressable.
 *
 * - how many sessions are shown of how many, and which references they match;
 * - how many are working and how many are free;
 * - the session open beside the roster, and what it says it is doing;
 * - not scoped (nothing can be started), and held, when they are true;
 * - what went wrong reading the roster.
 *
 * Pure: the page declares it only when the greeting said the host draws it.
 */
export interface FooterState {
  list: Roster | null
  /** Rows drawn after the pick narrowed them. */
  rows: readonly Row[]
  open: Row | null
  why: string | null
  pinned: boolean
  epic: string | null
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)

export function footerItems({ list, rows, open, why, pinned, epic }: FooterState): FooterItem[] {
  if (why) return footerItemsSchema.parse([{ kind: 'text', id: 'trouble', text: cut(why, LIMITS.FOOTER_TEXT), level: 'critical', tooltip: cut(why, LIMITS.FOOTER_TOOLTIP) }])
  if (!list) return footerItemsSchema.parse([])
  const items: unknown[] = []
  const where = list.scoped ? `in ${list.dirs.length} director${list.dirs.length === 1 ? 'y' : 'ies'}` : 'on this machine'
  const tip = [
    `${rows.length} of ${list.total} sessions${list.refs.length ? `, matching ${list.refs.join(', ')}` : ''}, ${where}.`,
    ...(list.cut ? [`Only the ${list.considered} most recent sessions were compared; older ones are not shown.`] : []),
  ].join(' ')
  items.push({
    kind: 'text',
    id: 'sessions',
    text: cut(`${rows.length} of ${list.total}${list.refs.length ? ` · ${list.refs.join(', ')}` : ''}`, LIMITS.FOOTER_TEXT),
    tooltip: cut(tip, LIMITS.FOOTER_TOOLTIP),
  })
  const working = rows.filter((row) => !row.free && !row.over).length
  const free = rows.filter((row) => row.free).length
  items.push({ kind: 'text', id: 'working', text: `${working} working · ${free} free`, align: 'center', optional: true })
  if (!list.scoped) {
    items.push({ kind: 'text', id: 'unscoped', text: 'Not scoped', level: 'warn', tooltip: 'ORCHESTRATOR_DIRS is unset, so nothing is filtered by directory and nothing can be started.' })
  }
  if (pinned) items.push({ kind: 'text', id: 'held', text: 'Held', optional: true, tooltip: cut(`This container keeps ${epic ?? 'what it was last told'} until unpinned.`, LIMITS.FOOTER_TOOLTIP) })
  if (open) {
    items.push({
      kind: 'text',
      id: 'open',
      text: cut(`${open.name || open.id} · ${open.state}`, LIMITS.FOOTER_TEXT),
      align: 'end',
      tooltip: cut(open.cwd, LIMITS.FOOTER_TOOLTIP),
    })
  }
  return footerItemsSchema.parse(items)
}
