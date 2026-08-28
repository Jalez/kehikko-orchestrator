import type { Row } from '@/api/client.ts'
import { cn } from '@/lib/utils.ts'

/**
 * One session on the roster.
 *
 * ## The three words, and why they are words
 *
 * `claude agents --json` answers with its own vocabulary — working, blocked,
 * idle, done, failed — and this row shows that word rather than translating it.
 * A translation is a second vocabulary a person has to learn, and the moment
 * Claude Code adds a sixth state the translation shows the wrong one of five.
 * What the row DOES add is the grouping `sessions.ts` computes: running,
 * available, or over. Three groups over an open-ended set of words is a
 * classification that survives a word it has never seen — an unknown state is
 * "available", which is honest, because the two things that are not available
 * are the two this module can name.
 *
 * ## Why a directory is shown, tail-first
 *
 * The roster is unscoped by default (see `scope.ts`), so the list will contain
 * sessions from every checkout on the machine, and "which repository is this
 * one in" is then the first question. The path is elided from the FRONT, which
 * is the opposite of what a browser does to a URL and the right way round here:
 * `/Users/somebody/Projects/` is the same on every row and the last two
 * segments are the whole of the answer.
 */

const AGO: [number, string][] = [
  [86_400_000, 'd'],
  [3_600_000, 'h'],
  [60_000, 'm'],
]

/**
 * How long ago, in one or two characters.
 *
 * Space is the reason. A 240px pane cannot spare "about three hours ago" beside
 * a name, and a person scanning a roster wants the ordering rather than the
 * duration. Under a minute is "now" rather than "0m", because a session that
 * started four seconds ago being labelled zero of anything reads as broken.
 */
export function ago(at: number, now = Date.now()): string {
  if (!at) return ''
  const ms = Math.max(0, now - at)
  for (const [size, unit] of AGO) {
    if (ms >= size) return `${Math.floor(ms / size)}${unit}`
  }
  return 'now'
}

/** The last two path segments, which is where the identity of a checkout lives. */
export function shortDir(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  if (parts.length <= 2) return cwd
  return `…/${parts.slice(-2).join('/')}`
}

export function SessionRow({
  row,
  open,
  onOpen,
}: {
  row: Row
  open: boolean
  onOpen: () => void
}) {
  const tone = row.over ? 'text-muted-foreground' : row.free ? 'text-foreground' : 'text-foreground'
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={open ? 'true' : undefined}
      className={cn(
        'w-full min-w-0 border-b px-2 py-1.5 text-left transition-colors',
        'hover:bg-accent focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        open && 'bg-accent',
      )}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        {/* A dot rather than a word, because the word is on the right and this
            is the thing the eye lands on first when scanning a column. */}
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            row.over ? 'bg-muted-foreground/40' : row.free ? 'bg-muted-foreground' : 'bg-primary',
          )}
        />
        <span className={cn('min-w-0 flex-1 truncate text-xs font-medium', tone)}>{row.name || row.id}</span>
        <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">{ago(row.startedAt)}</span>
      </div>
      <div className="text-muted-foreground mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[10px]">
        <span className="shrink-0">{row.state || 'unknown'}</span>
        <span className="min-w-0 flex-1 truncate" title={row.cwd}>
          {shortDir(row.cwd)}
        </span>
      </div>
      {/*
        The last thing it said, one line, and only when there is one.
        `lastSaid` deliberately skips tool traffic for this caption: "Bash: ls"
        tells a person nothing about what a session is for, and a roster of forty
        of those is a roster with no information in it.
      */}
      {row.said?.text ? (
        <div className="text-muted-foreground/80 mt-0.5 truncate text-[10px] italic">{row.said.text}</div>
      ) : null}
    </button>
  )
}
