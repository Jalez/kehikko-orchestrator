import { held, heldDraft } from 'kehikot-module-protocol/client'

/**
 * What this page holds across a reload of itself, and nothing longer — the protocol's `held`:
 * `sessionStorage`, written as it changes, by the project the host says is open and then by what
 * it was made against. See "Keeping unsaved work across a reload" in the protocol's
 * docs/module-plumbing.md. It is not a prompt store, which this module was told not to be: it
 * lives as long as the tab and nothing here is sent anywhere.
 *
 * The names are the ones this module has always used. What is under them is now a record by
 * target, so a value an older build of this page left in a tab is not one of these and is not
 * read: its fields are strings, and both readers below take only objects.
 */

/** A prompt somebody edited and has not sent. */
export interface Draft {
  /** The composed text the edit started from. A draft is only for the prompt and selection it was written over. */
  base: string
  /** What is in the box. */
  text: string
  /** The directory chosen beside it: a restored prompt aimed at a reset directory would be an agent in the wrong repository. */
  dir: string
}

/** One per project, under `PROMPT`. Emptied, or put back as composed, is not a draft: `heldDraft` says so. */
export const drafts = held<Draft>('kehikot.orchestrator.draft', (stored) => {
  const one = heldDraft(stored)
  const dir = (stored as { dir?: unknown } | null)?.dir
  return one ? { base: one.base, text: one.text, dir: typeof dir === 'string' ? dir : '' } : null
})
export const PROMPT = 'prompt'

/** Which session's transcript is open. The target is the epic it was opened under, so it cannot reopen under another. */
export const opened = held<{ session: string }>('kehikot.orchestrator.open', (stored) => {
  const session = (stored as { session?: unknown } | null)?.session
  return typeof session === 'string' && session ? { session } : null
})
