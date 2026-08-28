/**
 * What each reference in an epic IS, read out of one `live.get`.
 *
 * ## Why this module has to ask at all
 *
 * `context.selection` carries refs and nothing else. The protocol says why in
 * as many words: a host can vouch that these are the refs somebody picked and
 * cannot vouch for what they ARE, because it was told and never checked.
 * References knows — it read `gh#131` out of the `ghIssues` bag and `gh#105`
 * out of `ghPrs`, and which bag a thing was in is the only thing that says what
 * it is — and it deliberately does not pass that on.
 *
 * So this module reads it where References reads it: from `live.get`, the same
 * source, filed by the same refresh. That is the whole of the arrangement the
 * protocol's essay describes, and it is the reason `live:read` is the one
 * capability declared.
 *
 * ## What it is for, and how little rides on it
 *
 * One line in an opening prompt. `- gh#105 (pull request)` rather than
 * `- gh#105`. An agent given the second still finds the right thing; it just
 * spends a tool call finding out what kind of thing it is. So a refused or
 * unanswered `live.get` costs a word, and everything on this page still works —
 * which is what the protocol means by a module being built to be refused.
 *
 * ## The bags, and the spellings
 *
 * Lifted from `kehikko-references/src/live/collect.ts`. GitLab's two bags are
 * keyed by the bare number and GitHub's two by the ref as written, which is how
 * the host files them; the spellings are rebuilt here to match how people say
 * them out loud, and to match how the canvas spells a selection — because the
 * whole point of this file is looking a selected ref up.
 *
 * The asymmetry is not ours and is not tidied. Tidying it would mean this
 * module and the host disagree about what a key is, which is the one way this
 * lookup can fail silently rather than loudly.
 *
 * `Object.entries` rather than `bag[ref]`: this enumerates rather than looking
 * up by a string that came off the wire, so a bag containing a key called
 * `constructor` is a row about `constructor` and not something inherited from a
 * prototype. The code looks like the hazardous shape and is not.
 */

const BAGS = [
  { bag: 'issues', kind: 'issue', spell: (k: string) => `#${k}` },
  { bag: 'mrs', kind: 'merge request', spell: (k: string) => `!${k}` },
  { bag: 'ghIssues', kind: 'issue', spell: (k: string) => k },
  { bag: 'ghPrs', kind: 'pull request', spell: (k: string) => k },
] as const

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface Known {
  kind: string
  title: string
}

/**
 * ref -> what it is and what it is called, for every reference in one reading.
 *
 * A plain object rather than a `Map` only because it crosses into React state
 * and is compared there; nothing looks anything up in it by a key that came
 * from outside this file and the reading it was built from.
 */
export function kindsOf(live: unknown): Record<string, Known> {
  const out: Record<string, Known> = {}
  if (!isObject(live)) return out
  for (const shape of BAGS) {
    const bag = live[shape.bag]
    if (!isObject(bag)) continue
    for (const [key, raw] of Object.entries(bag)) {
      const title = isObject(raw) && typeof raw.title === 'string' ? raw.title : ''
      out[shape.spell(key)] = { kind: shape.kind, title }
    }
  }
  return out
}
