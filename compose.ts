/**
 * The opening prompt, composed once, in a file both halves import.
 *
 * ## Why this is not in `start.ts`
 *
 * Because the page has to show exactly what will be sent, and the only way for
 * that to be true rather than nearly true is for the page and the server to run
 * the SAME function. `start.ts` imports `node:child_process` and cannot be
 * pulled into a browser bundle; a second copy of this arithmetic in the page
 * would drift, and the drift would be invisible — a person would read one thing
 * on screen and an agent would be told another, with nothing on either side
 * saying so.
 *
 * So: no imports at all in this file, and nothing in it that needs any.
 */

/**
 * The durable name for a session this module started.
 *
 * Salvaged, with its reasoning, from the host's old `src/dispatch.ts`:
 *
 *   A pid is not it: `claude --bg` hands off to a daemon and the process we
 *   spawned is gone within the second, taking the number with it. The opening
 *   prompt, though, is written into the transcript once and never edited
 *   again — so a token put IN that prompt is a key that outlives everything
 *   else about the session.
 *
 * Nor is the session's name, though this module now gives it one (`title`
 * below): a name is the person's to change, with `/rename` or in the job list,
 * and a key a person can edit away is not a key.
 *
 * `transcript.opening()` is how it is read back, and the roster's filter is the
 * thing that reads it. It goes in on a line of its own rather than buried in
 * the prose, so a person reading the transcript can see what it is and guess
 * why it is there.
 */
export function runToken(refs: readonly string[]): string {
  return `kehikko-run:${refs.length ? refs.join(',') : 'nothing-selected'}`
}

/**
 * What a session started with no prompt is told.
 *
 * `context.prompt` is null on any host that offers no prompt for this container, and
 * the protocol says so plainly: a module declaring `prompt` must work when
 * there is none, because on such a host there always will be none. So this is
 * an ordinary state rather than an error, and the page prints this text in the
 * same box a real prompt would appear in — somebody about to spawn an agent can
 * read exactly what it will be told either way, and edit it before pressing.
 *
 * It is deliberately thin. Inventing instructions on somebody's behalf is how a
 * launcher acquires opinions about work it knows nothing about; what this says
 * is the one thing this module actually knows, which is which references were
 * picked.
 */
export const NO_PROMPT_FALLBACK =
  'No instructions were written for this session. Read the references below, work out what they ask for, and say what you find before changing anything.'

/** A reference, as far as this module can describe one. `kind` is '' when `live.get` did not say. */
export interface Named {
  ref: string
  kind: string
  title: string
}

export interface Composed {
  /** Exactly the string that will become one argv element. */
  text: string
  /** Whether the person's own words are in it, or the fallback above. */
  fromHost: boolean
}

/**
 * The person's prompt, the references it was aimed at, and the run token.
 *
 * ## This is not fragment merging
 *
 * The protocol is explicit that a module receives ONE string and does not merge
 * fragments. Several containers may each aim something at this one; the host has
 * already composed them, each fragment headed `## from <module id>`, and what
 * arrives is the result. Deciding how fragments combine is a policy question
 * about somebody's own canvas that three modules would answer three ways, and
 * none of that happens here.
 *
 * What happens here is a different thing and the distinction is worth keeping.
 * The person's text is placed verbatim, untouched, first — including its
 * headings, which are theirs and not this module's to reformat. Below it this
 * module adds the one fact it holds that the host's composer did not: which
 * references this session is for, spelled as the canvas spells them, with their
 * kind where `live.get` supplied one. That is not another author's fragment. It
 * is the selection, which is the other half of what this container was given, and a
 * session started without it would be told to do something to nothing in
 * particular.
 *
 * And the result is what the page shows, in an editable box, before the button
 * is pressed. That is the check that makes the distinction safe: whatever this
 * function decides, a person reads it first and can change it.
 */
export function compose(prompt: string | null, refs: readonly Named[]): Composed {
  const fromHost = typeof prompt === 'string' && prompt.trim().length > 0
  const head = fromHost ? (prompt as string).trim() : NO_PROMPT_FALLBACK
  const lines = [head, '']
  if (refs.length) {
    lines.push('## References this session is for')
    for (const r of refs) {
      const what = [r.kind, r.title].filter(Boolean).join(' — ')
      lines.push(what ? `- ${r.ref}: ${what}` : `- ${r.ref}`)
    }
  } else {
    lines.push('No references were selected for this session.')
  }
  lines.push('', runToken(refs.map((r) => r.ref)))
  return { text: lines.join('\n'), fromHost }
}

/**
 * Where in kehikko a session is started from: what the host's context says about it.
 *
 * `kehikko` is the canvas's name, `project` the project's name (never its path), `epic` the epic's
 * slug, and `parts` the headings of the parts of the epic the session is for. Each is what a person
 * reads on screen, and each may be missing: a host with no canvases, an epic with no parts.
 */
export interface Place {
  kehikko: string | null
  project: string | null
  epic: string | null
  parts: string[]
}

/** As much of the host's context as `placeOf` reads, spelled so that this file needs no import. */
export interface PlaceContext {
  kehikko?: { name: string } | null
  project?: string | null
  epic?: string | null
  parts?: readonly { heading: string; refs: readonly string[]; picked: boolean }[]
}

/**
 * Where a session started now would be from.
 *
 * The parts are the ones a person picked out; with none picked, the ones that list one of the
 * references this session is for, which is what "References this session is for" in the prompt
 * names. With neither, the session is for the epic as a whole and no part is named.
 */
export function placeOf(context: PlaceContext | null | undefined, refs: readonly string[]): Place {
  const parts = context?.parts ?? []
  const picked = parts.filter((part) => part.picked)
  const named = picked.length ? picked : parts.filter((part) => part.refs.some((ref) => refs.includes(ref)))
  return {
    kehikko: context?.kehikko?.name ?? null,
    project: context?.project ?? null,
    epic: context?.epic ?? null,
    parts: named.map((part) => part.heading),
  }
}

/** How long one piece of a title, and the whole of it, may be. A title is read in a list, not a page. */
const PIECE = 60
const TITLE = 160

/** One line of plain text: no control characters, no runs of space, and cut where it is too long. */
function line(text: unknown, most: number): string {
  if (typeof text !== 'string') return ''
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > most ? `${flat.slice(0, most - 1).trimEnd()}…` : flat
}

/**
 * The name a session is started with: the kehikko, the project, the epic and the parts it is for,
 * in that order, each that is known, ` · ` between them — `Main · kehikko · session-titles · Titles`.
 *
 * ## What is not in it
 *
 * No reference, so no MR, PR or issue number; no state; no author. The references are in the
 * prompt, the state is the colour Claude Code's own list gives a session, and a title that repeated
 * either would go stale while the session ran. Nothing that is not a place in kehikko.
 *
 * ## Given once
 *
 * It is the name a session STARTS with (`claude --bg --name=…`, see `start.ts`), and nothing in this
 * module sets a session's name afterwards. A name a person gives it by hand is theirs, and stays.
 *
 * Null when nothing is known — no host, or one that says nothing — and the session is started with
 * no name, so Claude Code names it from its prompt as it always did. The page shows this before the
 * press, and the server makes it again from the same place: the same function, so what a person
 * reads is what the session is called.
 */
export function title(place: Partial<Place> | null | undefined): string | null {
  if (!place) return null
  const parts = Array.isArray(place.parts) ? place.parts.map((part) => line(part, PIECE)).filter(Boolean) : []
  const pieces = [line(place.kehikko, PIECE), line(place.project, PIECE), line(place.epic, PIECE), line(parts.join(', '), PIECE)]
  const text = line(pieces.filter(Boolean).join(' · '), TITLE)
  return text || null
}
