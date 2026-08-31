import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Named } from '../compose.ts'
import { failed, roster, thread, type Event, type Roster, type Row } from '@/api/client.ts'
import { StartPanel } from '@/view/start-panel.tsx'
import { TranscriptView } from '@/view/transcript-view.tsx'
import { SessionRow } from '@/view/session-row.tsx'
import { useRoadmap } from '@/wire/use-roadmap.ts'
import { ID } from '../manifest.ts'

/**
 * The page.
 *
 * ## What is drawn when framed, and what is not
 *
 * Not the module's name, and not its summary. The host shows the manifest's
 * `summary` as a tooltip on the container header, and a page that printed its own
 * title inside the frame would be saying the same sentence twice in a column
 * 240px wide. Unframed — opened in a tab, which is a real way to run this — the
 * heading is drawn, because then nothing else is saying what this is.
 *
 * ## The two panels, and why they stack rather than sit side by side
 *
 * A `@container` query, not a viewport one. The viewport is the host's window,
 * which is large; the frame is a column beside three others, and a `md:` prefix
 * would lay out for a screen nobody is looking at. Below the threshold the
 * roster is a list with the open session's transcript under it; above it, they
 * are two columns. Neither arrangement scrolls the page sideways — every long
 * string is inside something with `min-w-0` on it.
 */

/** How often the roster is re-read. `sessions.ts` caches for 3s, so this is the real rate. */
const ROSTER_MS = 4000
/**
 * How often the open transcript is re-read.
 *
 * Faster than the roster, because this is the thing somebody is watching. It
 * costs one `stat` when nothing has moved — the poll sends the modification
 * time it last saw and the server answers `unchanged` without reading the file.
 */
const THREAD_MS = 1500

export function App() {
  const wire = useRoadmap(ID)
  const [list, setList] = useState<Roster | null>(null)
  const [listWhy, setListWhy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [threadWhy, setThreadWhy] = useState<string | undefined>(undefined)
  const [fresh, setFresh] = useState(0)
  const stamp = useRef(0)

  const refsKey = wire.selection.join(',')

  /**
   * Read the roster.
   *
   * Keyed on the selection rather than on a tick, so that changing what is
   * selected re-asks immediately instead of at the next poll — a filter that
   * takes four seconds to apply reads as a filter that did not work.
   */
  const readRoster = useCallback(() => {
    const refs = refsKey ? refsKey.split(',') : []
    void roster(refs).then((answer) => {
      if (failed(answer)) {
        setListWhy(answer.why)
        return
      }
      setListWhy(null)
      setList(answer)
    })
  }, [refsKey])

  useEffect(() => {
    readRoster()
    const timer = setInterval(readRoster, ROSTER_MS)
    return () => clearInterval(timer)
  }, [readRoster])

  /*
   * The open session's transcript, followed.
   *
   * `stamp` is a ref rather than state on purpose: it is the poll's own
   * bookkeeping, it changes on every tick, and putting it in state would
   * re-run this effect — tearing down and rebuilding the interval — once a
   * second forever.
   */
  useEffect(() => {
    if (!open) {
      setEvents([])
      setThreadWhy(undefined)
      return
    }
    stamp.current = 0
    setEvents([])
    let alive = true
    const tick = () => {
      void thread(open, stamp.current).then((answer) => {
        if (!alive) return
        if (failed(answer)) {
          setThreadWhy(answer.why)
          return
        }
        setThreadWhy(answer.why)
        if (answer.unchanged) return
        stamp.current = answer.touchedAt
        setEvents((was) => {
          /* How many of the new list the reader has not seen, for the flash in
             the view. Computed here rather than there because the view is given
             a list and has no memory of the previous one. */
          setFresh(Math.max(0, answer.events.length - was.length))
          return answer.events
        })
      })
    }
    tick()
    const timer = setInterval(tick, THREAD_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [open])

  /**
   * The selection, with what `live.get` said each reference is.
   *
   * A ref with no entry keeps an empty kind rather than being dropped. The
   * selection is the person's, and a reference this module could not identify
   * is still a reference they picked — leaving it out of the prompt because a
   * host did not answer would be this module quietly editing what somebody
   * asked for.
   */
  const named: Named[] = useMemo(
    () =>
      wire.selection.map((ref) => ({
        ref,
        kind: wire.kinds[ref]?.kind ?? '',
        title: wire.kinds[ref]?.title ?? '',
      })),
    [wire.selection, wire.kinds],
  )

  const rows: Row[] = list?.sessions ?? []
  const openRow = rows.find((r) => r.sessionId === open) ?? null

  return (
    <div className="container flex h-full min-w-0 flex-col text-sm">
      {/* Unframed only. See the note at the top of this file. */}
      {wire.at === 'unhosted' ? (
        <header className="min-w-0 border-b px-2 py-1.5">
          <h1 className="text-xs font-medium">Orchestrator</h1>
          <p className="text-muted-foreground text-[10px]">
            Nothing is framing this page, so no selection and no prompt can reach it. The roster below is every session
            this module can see; a session can still be started, with this module’s own default prompt.
          </p>
        </header>
      ) : null}

      {wire.at === 'listening' ? (
        <p className="text-muted-foreground p-2 text-[11px]">Waiting to see whether a host greets this page…</p>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col @[34rem]:flex-row">
        <div className="flex min-h-0 min-w-0 flex-col @[34rem]:w-1/2 @[34rem]:border-r">
          <Legend list={list} why={listWhy} pinned={wire.pinned} epic={wire.epic} />
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {rows.map((row) => (
              <SessionRow
                key={row.sessionId}
                row={row}
                open={row.sessionId === open}
                onOpen={() => setOpen(row.sessionId === open ? null : row.sessionId)}
              />
            ))}
          </div>
          <StartPanel
            refs={named}
            prompt={wire.prompt}
            dirs={list?.dirs ?? []}
            scoped={list?.scoped ?? false}
            onStarted={readRoster}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t @[34rem]:border-t-0">
          {openRow ? (
            <>
              <header className="min-w-0 border-b px-2 py-1.5">
                <p className="truncate text-xs font-medium">{openRow.name || openRow.id}</p>
                <p className="text-muted-foreground truncate text-[10px]" title={openRow.cwd}>
                  {openRow.state} · {openRow.cwd}
                </p>
              </header>
              <TranscriptView events={events} since={fresh} why={threadWhy} />
            </>
          ) : (
            <p className="text-muted-foreground p-3 text-[11px]">
              Pick a session to follow what it is doing. What is shown is Claude Code’s own transcript, read from disk
              as it is written — so a session that never announced itself to anything is still readable here.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The line above the roster, which has to tell four situations apart.
 *
 * This is the part that is easy to get wrong by saying nothing. "No sessions"
 * is four different facts — there are none on the machine, none in the
 * directories this module was given, none matching what is selected, or the
 * match ran out of window — and a person seeing an empty list needs to know
 * which. The one that most needs saying is the third, because the fix is
 * "change the selection" and nothing else on screen suggests the selection is
 * involved.
 */
function Legend({
  list,
  why,
  pinned,
  epic,
}: {
  list: Roster | null
  why: string | null
  pinned: boolean
  epic: string | null
}) {
  if (why) return <p className="text-destructive border-b p-2 text-[11px]">{why}</p>
  if (!list) return <p className="text-muted-foreground border-b p-2 text-[11px]">Reading the roster…</p>

  const parts: string[] = []
  parts.push(`${list.sessions.length} of ${list.total}`)
  if (list.refs.length) parts.push(`matching ${list.refs.join(', ')}`)
  parts.push(list.scoped ? `in ${list.dirs.length} director${list.dirs.length === 1 ? 'y' : 'ies'}` : 'on this machine')

  return (
    <div className="text-muted-foreground min-w-0 border-b px-2 py-1 text-[10px]">
      <p className="truncate">{parts.join(' · ')}</p>
      {!list.scoped ? (
        <p className="truncate">
          ORCHESTRATOR_DIRS is unset, so nothing is filtered by directory and nothing can be started.
        </p>
      ) : null}
      {list.cut ? (
        <p className="truncate">
          Only the {list.considered} most recent sessions were compared against the selection; older ones are not shown.
        </p>
      ) : null}
      {/* Pinning is said out loud because the protocol's whole argument for the
          field is that a module pinned silently cannot tell a person's pin from
          a canvas that has not moved. */}
      {pinned ? <p className="truncate">Held: this container keeps {epic ?? 'what it was last told'} until unpinned.</p> : null}
    </div>
  )
}
