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
 * Salvaged, with its reasoning, from `roadmap/src/dispatch.ts`:
 *
 *   A pid is not it: `claude --bg` hands off to a daemon and the process we
 *   spawned is gone within the second, taking the number with it. Nor is the
 *   session's name, which Claude Code derives from the prompt and the labelling
 *   cron rewrites every half hour. The opening prompt, though, is written into
 *   the transcript once and never edited again — so a token put IN that prompt
 *   is a key that outlives everything else about the session.
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
 * `context.prompt` is null on any host that offers no prompt for this pane, and
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
 * fragments. Several panes may each aim something at this one; the host has
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
 * is the selection, which is the other half of what this pane was given, and a
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
