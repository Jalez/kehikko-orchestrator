import type { Anchor, EpicPart } from 'kehikot-module-protocol'

/**
 * The roster, narrowed to the parts of the epic a person picked out.
 *
 * ## One rule, and it is not this file's
 *
 * A part of an epic lists references, and a session is about the references
 * its opening names: the server reads that (`matching` in `doors.ts`) and
 * every row says which it names. So a row's anchors are those references, and
 * the protocol's `useFocus(context).narrow` decides what is drawn.
 *
 *  - **Nothing picked is the roster as it was.**
 *  - **A session that names a reference** is in front when a picked part lists
 *    that reference.
 *  - **A session that names none** is in no part and is not drawn under a
 *    pick. It is not answered `{ whole: true }`: a session about nothing in
 *    particular is not thereby about the whole epic.
 *  - **What is in hand is kept** (`inHand`): the session whose transcript is
 *    open, and the sessions on the references a person selected.
 *  - **One sentence, and only in a roster the pick left empty**: the
 *    protocol's `No session is in the picked part.`
 *
 * ## What this does not touch
 *
 * The server is never told what is picked — it is asked which references each
 * session names, of all the epic's parts — and the MCP door lists every
 * session whatever is picked.
 */

/** What one row is called in the protocol's sentence for an empty view. */
export const NOUN = 'session'

/** As much of a row as an anchor and `inHand` read. */
export interface Tied {
  sessionId: string
  /** The references this session names, of the ones the server was asked to compare it with. */
  refs?: readonly string[] | null
}

/** What ties one session to a part: THE anchor function of this module. Every reference it names. */
export const anchorOf = (row: Tied): Anchor[] => (row.refs ?? []).map((ref) => ({ ref }))

/** Every reference the epic's parts list, picked or not, once each: what the server is asked to compare the sessions with. */
export function refsHeld(parts: readonly EpicPart[]): string[] {
  const out: string[] = []
  for (const part of parts) for (const ref of part.refs) if (!out.includes(ref)) out.push(ref)
  return out
}

/** Whether a session is in a person's hands: its transcript is open, or it is on a reference they selected. */
export function inHand(row: Tied, open: string | null, selection: readonly string[]): boolean {
  return row.sessionId === open || (row.refs ?? []).some((ref) => selection.includes(ref))
}

/** Whether a roster was read for these references: the same ones, in any order. */
export function readFor(among: readonly string[] | null | undefined, wanted: readonly string[]): boolean {
  const had = among ?? []
  return wanted.every((ref) => had.includes(ref))
}
