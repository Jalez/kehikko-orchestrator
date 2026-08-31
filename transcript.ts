import { open, readdir, stat } from 'node:fs/promises'

/**
 * ## `node:fs`, and not `Bun.file`
 *
 * The salvaged original sliced its reads out of a `Bun.file` handle, because
 * the roadmap it came from is a Bun server. This module is not: `run.sh` ends in
 * `bunx vite`, `bunx` execs the `vite` bin, and that bin's shebang is
 * `#!/usr/bin/env node`. The dev server is a NODE process, `Bun` is not
 * defined in it, and every read in this file would have thrown at runtime while
 * passing every test — because the tests run under bun.
 *
 * `sessions.ts` has the long version of this note. The rule it leaves: nothing
 * in the server half of this module may use a `Bun.*` API.
 */

/**
 * What a session actually said, read from Claude Code's own transcript.
 *
 * Salvaged from `roadmap/src/transcript.ts`, and the reason it exists there is
 * the reason it exists here, so it is repeated rather than referenced:
 *
 *   The roadmap only hears from a session that calls its MCP tools, so picking
 *   a session out of the list used to show an empty thread — the session was
 *   real and working, it just had not talked to the roadmap. The transcript on
 *   disk is the conversation itself, so it is read directly rather than waited
 *   for.
 *
 * That argument is what makes this module's "watch it live" honest. Nothing
 * here asks the session for anything, nothing is attached to it, and a session
 * started from somebody's own terminal an hour ago reads exactly as well as one
 * this page spawned a second ago. A registry of sessions that announced
 * themselves would show neither.
 *
 * ## Why this and not a terminal
 *
 * The obvious build for "see it live" is a pty: node-pty on the server, xterm
 * in the page, a websocket carrying keystrokes. It was not built, and the
 * reason is not taste. A websocket that carries keystrokes into a shell is a
 * shell on this machine reachable by anything that can reach this port — and
 * loopback is a fence around the machine, not around the programs on it. This
 * module already does the most dangerous thing in the workspace by spawning one
 * fixed command in one allow-listed directory; it is not also going to offer an
 * interactive process to whatever finds 7850.
 *
 * A transcript follower gives up exactly one thing: you cannot type at the
 * session. Everything a running session is DOING — its turns, the tools it
 * calls, what those tools answered — is in the JSONL as it happens, because
 * Claude Code writes it there for its own resume to read. What it costs is
 * latency, bounded by the poll interval, and the loss of the raw terminal
 * rendering, which is a thing to be grateful for rather than to mourn: this is
 * structured data, and drawing it as DOM means it can be searched, wrapped in a
 * 240px container, and read a week later.
 *
 * ## What was extended, and why
 *
 * The original skipped tool calls entirely — `if (row.type !== 'user' && ...)`
 * and then only `type === 'text'` blocks — because it was building a chat
 * thread for a person catching up on a conversation. This module is watching
 * work happen, and a session that spends four minutes reading files shows as
 * nothing at all under that filter: the page looks frozen while the agent is
 * at its busiest, which is the exact failure the follower exists to avoid. So
 * `tool_use` and `tool_result` blocks become events of their own kind, and the
 * view decides how loud to draw them.
 */

/** One thing that happened in a conversation, in the order it happened. */
export interface Event {
  /** Who produced it. A tool result is filed under `you` because that is where the JSONL puts it. */
  role: 'you' | 'agent'
  /**
   * `said` is prose. `tool` is the agent asking for something, and `text` is a
   * one-line rendering of the arguments. `result` is what came back.
   *
   * Three kinds rather than a boolean, because the view draws all three
   * differently and a page that could only tell prose from not-prose would put
   * a file's entire contents in the same typeface as a sentence.
   */
  kind: 'said' | 'tool' | 'result'
  /** The tool's name, on `tool` and `result` events, and '' otherwise. */
  tool: string
  text: string
  at: string
}

/** Read at call time, not at import, so a test can point it at a fixture first. */
function root(): string {
  return process.env.CLAUDE_PROJECTS_DIR ?? `${process.env.HOME ?? ''}/.claude/projects`
}

/** Test seam: read transcripts from somewhere else, and forget what was cached. */
export function useProjectsDir(path: string): void {
  process.env.CLAUDE_PROJECTS_DIR = path
  cache = null
}

/** A long session is mostly tool traffic; the tail holds the readable part. */
const TAIL_BYTES = 4 * 1024 * 1024
/** Enough tail to hold the last thing said, without reading whole histories. */
const PEEK_BYTES = 96 * 1024
/** Enough head to hold the opening prompt, whatever preamble is written above it. */
const HEAD_BYTES = 256 * 1024

/** sessionId -> where its transcript is and when it last grew. */
export interface Entry {
  path: string
  touchedAt: number
}

let cache: { at: number; map: Map<string, Entry> } | null = null
/** Long enough that a burst of requests costs one scan, short enough to feel live. */
const INDEX_MS = 4000

/**
 * Every transcript on this machine, by session id. Built in one pass: looking
 * each session up on its own meant a directory scan per session, and there are
 * hundreds of them.
 *
 * A session id is a uuid, so the project folder it sits under does not have to
 * be worked out from the working directory — which is just as well, because
 * Claude Code's folder naming is its own business and not a contract.
 */
export async function index(): Promise<Map<string, Entry>> {
  const now = Date.now()
  if (cache && now - cache.at < INDEX_MS) return cache.map
  const map = new Map<string, Entry>()
  let dirs: string[] = []
  try {
    dirs = await readdir(root())
  } catch {
    cache = { at: now, map }
    return map
  }
  await Promise.all(
    dirs.map(async (d) => {
      let names: string[] = []
      try {
        names = await readdir(`${root()}/${d}`)
      } catch {
        return
      }
      await Promise.all(
        names
          .filter((n) => n.endsWith('.jsonl'))
          .map(async (n) => {
            const path = `${root()}/${d}/${n}`
            try {
              const s = await stat(path)
              map.set(n.slice(0, -6), { path, touchedAt: s.mtimeMs })
            } catch {
              /* it went away between listing and reading */
            }
          }),
      )
    }),
  )
  cache = { at: now, map }
  return map
}

async function fileFor(sessionId: string): Promise<string | null> {
  return (await index()).get(sessionId)?.path ?? null
}

/**
 * Read part of a file, without reading the rest of it.
 *
 * The whole reason the tails and heads in this file are bounded: a session that
 * has run for six hours has a transcript in the tens of megabytes, and the page
 * polls it every second and a half. Reading it whole to show the last forty
 * lines would be the most expensive thing this module does, by a wide margin,
 * and it would get more expensive the longer somebody watched.
 *
 * Decoded as UTF-8 over a byte range, which means a slice can begin and end
 * mid-character as well as mid-line. Both callers already discard the partial
 * line at the cut, which takes care of the partial character with it.
 */
async function slice(path: string, from: number, length: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, from)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** How big it is, or 0 if it went away between the index and the read. */
async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/**
 * Prose out of a content block list.
 *
 * `String(v)` is deliberately not used anywhere in here: it turns `null` into
 * the word "null" on screen, which is a lie about what an agent said.
 */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type?: string; text?: string } => typeof b === 'object' && b !== null)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b.text as string).trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * How long any single event's text may be before it is cut.
 *
 * A `Read` of a thousand-line file arrives here whole. Rendering it whole in a
 * 300px container is a scrollbar with a conversation somewhere inside it, and
 * shipping it over the wire on every poll is a megabyte a second for something
 * nobody is reading. Cut with the cut SAID, so a reader knows there was more
 * rather than believing the tool returned forty lines.
 */
const EVENT_CHARS = 2000

function clip(text: string): string {
  return text.length <= EVENT_CHARS ? text : `${text.slice(0, EVENT_CHARS)}\n… (${text.length - EVENT_CHARS} more characters, not shown)`
}

/**
 * One line describing a tool call.
 *
 * The arguments are somebody else's JSON and can be enormous — a whole file
 * body on a `Write`. What a person watching wants is which tool and against
 * what, so the few keys that are nearly always the "what" are preferred and
 * anything else is the compact JSON, cut. Guessing at a shape is fine here in a
 * way it would not be in the roster: this is a caption, and a wrong caption on
 * a line that also names the tool is a small cost.
 */
function callLine(input: unknown): string {
  if (typeof input === 'string') return clip(input)
  if (typeof input !== 'object' || input === null) return ''
  const o = input as Record<string, unknown>
  for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt', 'description']) {
    const v = o[key]
    if (typeof v === 'string' && v.trim()) return clip(v.trim())
  }
  try {
    return clip(JSON.stringify(o))
  } catch {
    return ''
  }
}

/** What a tool answered, whatever shape Claude Code recorded it in. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const out: string[] = []
  for (const b of content) {
    if (typeof b === 'string') out.push(b.trim())
    else if (typeof b === 'object' && b !== null) {
      const block = b as { type?: string; text?: string }
      if (block.type === 'text' && typeof block.text === 'string') out.push(block.text.trim())
      /* An image result has no text at all, and saying so beats a blank line
         that reads as a tool that returned nothing. */
      else if (block.type === 'image') out.push('(an image)')
    }
  }
  return out.filter(Boolean).join('\n')
}

interface Row {
  type?: string
  isMeta?: boolean
  isSidechain?: boolean
  timestamp?: string
  message?: { content?: unknown }
  toolUseResult?: unknown
}

/** Every event one JSONL row produced, in order. Usually one; a turn with two tool calls is three. */
function eventsOf(row: Row, names: Map<string, string>): Event[] {
  if (row.type !== 'user' && row.type !== 'assistant') return []
  if (row.isMeta || row.isSidechain) return []
  const role: Event['role'] = row.type === 'user' ? 'you' : 'agent'
  const at = typeof row.timestamp === 'string' ? row.timestamp : ''
  const out: Event[] = []

  const said = textOf(row.message?.content)
  if (said) out.push({ role, kind: 'said', tool: '', text: clip(said), at })

  const content = row.message?.content
  if (Array.isArray(content)) {
    for (const raw of content) {
      if (typeof raw !== 'object' || raw === null) continue
      const b = raw as { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown }
      if (b.type === 'tool_use') {
        const tool = typeof b.name === 'string' ? b.name : 'a tool'
        /*
         * Remembered so the RESULT, which carries only an id, can be labelled
         * with the tool that produced it. Rows are walked newest-first, so the
         * call is seen AFTER its result and the name is filled in on a second
         * pass — see `walk`.
         *
         * The key is `id` and not `tool_use_id`, and getting that wrong is
         * silent: the two blocks are the two ends of one correlation and only
         * the receiving end is called `tool_use_id`. The first version of this
         * file read `tool_use_id` on both, matched nothing ever, and drew every
         * tool result under the label "tool said" — which looks like a design
         * choice rather than a bug, and shipped in a fixture that encoded the
         * same mistake. It was caught by reading a real transcript, which is
         * the only thing that could have caught it.
         */
        if (typeof b.id === 'string') names.set(b.id, tool)
        out.push({ role: 'agent', kind: 'tool', tool, text: callLine(b.input), at })
      } else if (b.type === 'tool_result') {
        const id = typeof b.tool_use_id === 'string' ? b.tool_use_id : ''
        if (id) names.set(id, names.get(id) ?? '')
        out.push({
          role: 'you',
          kind: 'result',
          /* Filled in by `walk` once the matching call has been read. */
          tool: id,
          text: clip(resultText(b.content ?? row.toolUseResult)),
          at,
        })
      }
    }
  }
  return out
}

/**
 * Read the tail of a transcript and turn it into events, oldest first.
 *
 * Backwards, and stopping at `limit`, because the interesting end of a
 * conversation is the recent one and a session that has run for six hours has a
 * transcript nobody wants read in full to show the last thing that happened.
 */
async function walk(path: string, limit: number, tail: number): Promise<Event[]> {
  const size = await sizeOf(path)
  const raw = size > tail ? await slice(path, size - tail, tail) : await slice(path, 0, size)
  const lines = raw.split('\n')
  // A sliced read starts mid-line, so the first one is not parseable JSON.
  if (size > tail) lines.shift()

  const names = new Map<string, string>()
  const out: Event[] = []
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const line = lines[i]?.trim()
    if (!line || line[0] !== '{') continue
    let row: Row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    /* Reversed within the row, because the row's own blocks are in forward
       order and the outer loop is running backwards. */
    for (const ev of eventsOf(row, names).reverse()) out.push(ev)
  }
  out.reverse()
  /* Second pass: a `result` was filed under its tool_use_id, and by now the
     call that produced it has been read (it is EARLIER in the file, so LATER in
     this backwards walk). A result whose call fell outside the tail keeps no
     name rather than being given a wrong one. */
  for (const ev of out) {
    if (ev.kind === 'result') ev.tool = names.get(ev.tool) ?? ''
  }
  return out
}

/** The last `limit` things that happened, oldest first. */
export async function transcript(sessionId: string, limit = 80): Promise<Event[]> {
  const path = await fileFor(sessionId)
  return path ? walk(path, limit, TAIL_BYTES) : []
}

/**
 * One line for the roster: the last thing this session SAID, and when.
 *
 * Prose only, and that is the difference from `transcript`. This runs for every
 * session on the list rather than for the one being read, and "Bash: ls" as a
 * roster caption tells a person nothing about what the session is for.
 */
export async function lastSaid(sessionId: string): Promise<Event | null> {
  const path = await fileFor(sessionId)
  if (!path) return null
  const got = await walk(path, 40, PEEK_BYTES)
  for (let i = got.length - 1; i >= 0; i--) {
    const ev = got[i]
    if (ev && ev.kind === 'said') return ev
  }
  return null
}

/**
 * When one session's transcript last grew, read straight from disk.
 *
 * The index behind `index()` is cached, which is right for listing hundreds of
 * sessions and wrong for watching the one on screen: a reply should show up as
 * it is written, not a cache lifetime later. This is the number the page sends
 * back as `since`, so a poll over an unchanged file costs one `stat` and
 * answers 304-shaped rather than re-reading four megabytes.
 */
export async function stampFor(sessionId: string): Promise<number> {
  const path = (await index()).get(sessionId)?.path
  if (!path) return 0
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return 0
  }
}

/**
 * How a session began, for telling one session from another.
 *
 * Salvaged whole, with its reasoning, because this module depends on it for the
 * same thing the roadmap did:
 *
 *   The opening prompt is the only thing about a background session that never
 *   moves: the pid belongs to a launcher that exits, the name is derived and
 *   then rewritten by the labelling cron, and the id is not known until after
 *   the session exists. So the roadmap writes a token into the prompt it
 *   dispatches and looks for it here.
 *
 * `''` means "nothing was read" — the transcript is missing, unreadable, or has
 * not been written yet — and callers MUST treat that as *not known*, never as
 * *not ours*. Deciding a session is a stranger because a file was slow to
 * appear is how a running agent gets declared dead. It is why the filter in
 * `doors.ts` keeps a session whose opening it could not read rather than hiding
 * it.
 */
export async function opening(sessionId: string): Promise<string> {
  const path = await fileFor(sessionId)
  if (!path) return ''
  try {
    const size = await sizeOf(path)
    const raw = await slice(path, 0, Math.min(size, HEAD_BYTES))
    const out: string[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed[0] !== '{') continue
      let row: { type?: string; isSidechain?: boolean; message?: { content?: unknown } }
      try {
        row = JSON.parse(trimmed)
      } catch {
        // A sliced read ends mid-line, and the head is full of meta rows that
        // are not turns. Neither is a reason to give up on the rest.
        continue
      }
      if (row.type !== 'user' || row.isSidechain) continue
      const text = textOf(row.message?.content)
      if (text) out.push(text)
    }
    return out.join('\n')
  } catch {
    return ''
  }
}
