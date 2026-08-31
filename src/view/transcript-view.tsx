import { useEffect, useRef } from 'react'

import type { Event } from '@/api/client.ts'
import { cn } from '@/lib/utils.ts'

/**
 * What a session is doing, as it does it.
 *
 * ## Ordinary DOM, and no xterm
 *
 * The source here is JSONL, not a byte stream from a terminal: it arrives
 * already split into turns, tool calls and results, with roles and timestamps
 * on it. Rendering that through a terminal emulator would mean flattening
 * structure into escape sequences and then asking a program to guess the
 * structure back out. What is drawn instead is the structure — which is
 * selectable, searchable by the browser's own find, wrappable in a 240px container,
 * and readable a week later.
 *
 * The one thing a terminal would give that this does not is the exact glyphs
 * Claude Code paints. That is not what somebody watching from a canvas is here
 * for; they want to know what it is doing.
 *
 * ## Following, and when to stop
 *
 * The view scrolls to the bottom when new events arrive, and stops doing so the
 * moment the reader scrolls up. A follower that yanks the viewport back down
 * while somebody is reading three screens of a tool result is a follower they
 * will stop using. It resumes when they return to the bottom themselves, which
 * is the gesture that means "carry on".
 */

/** The reader is at the bottom if they are within this many pixels of it. */
const AT_BOTTOM_PX = 40

function stamp(at: string): string {
  if (!at) return ''
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function Line({ event, fresh }: { event: Event; fresh: boolean }) {
  const label =
    event.kind === 'said'
      ? event.role === 'you'
        ? 'you'
        : 'agent'
      : event.kind === 'tool'
        ? event.tool || 'tool'
        : `${event.tool || 'tool'} said`

  return (
    <div
      className={cn(
        'min-w-0 border-l-2 py-1 pl-2',
        fresh && 'arrived',
        event.kind === 'said' && event.role === 'you' && 'border-l-primary/50',
        event.kind === 'said' && event.role === 'agent' && 'border-l-border',
        /* Tool traffic is deliberately quieter than prose. It is the bulk of a
           transcript by volume and the smaller part of it by meaning, and a
           view that gave both the same weight would be a wall. */
        event.kind !== 'said' && 'border-l-transparent',
      )}
    >
      <div className="text-muted-foreground flex min-w-0 items-baseline gap-1.5 text-[10px]">
        <span className={cn('shrink-0 font-medium', event.kind === 'said' && 'text-foreground/70')}>{label}</span>
        <span className="shrink-0 tabular-nums opacity-60">{stamp(event.at)}</span>
      </div>
      <div
        className={cn(
          'said mt-0.5 min-w-0 text-[11px] leading-snug',
          event.kind === 'said' ? 'text-foreground' : 'text-muted-foreground',
          /* A tool call is one line however long its argument is: the argument
             is a caption, and a caption that wraps to six lines has stopped
             being one. The result below it is where the detail belongs. */
          event.kind === 'tool' && 'truncate',
          event.kind === 'result' && 'max-h-40 overflow-y-auto',
        )}
      >
        {event.text || <span className="opacity-50">(nothing)</span>}
      </div>
    </div>
  )
}

export function TranscriptView({
  events,
  since,
  why,
}: {
  events: Event[]
  /** How many events at the end are new since the last poll, for the flash. */
  since: number
  /** The server's sentence when there is no transcript, rather than an empty box. */
  why?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const following = useRef(true)

  useEffect(() => {
    const el = box.current
    if (!el || !following.current) return
    el.scrollTop = el.scrollHeight
  }, [events])

  if (!events.length) {
    return (
      <p className="text-muted-foreground p-3 text-xs">
        {why ?? 'Nothing has been written to this session’s transcript yet.'}
      </p>
    )
  }

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        following.current = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX
      }}
      className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-1"
    >
      {events.map((event, i) => (
        <Line
          /* Index, deliberately. These events have no id of their own — a
             transcript row can produce three of them — and the list only ever
             grows at the end, so an index is stable for every element React
             would otherwise be asked to reconcile. */
          key={i}
          event={event}
          fresh={i >= events.length - since && since > 0 && since < events.length}
        />
      ))}
    </div>
  )
}
