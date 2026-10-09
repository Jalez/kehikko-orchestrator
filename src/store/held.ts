/**
 * What this page holds across a reload of itself, and nothing longer.
 *
 * ## Why there is any of this
 *
 * A page that is older than its server reloads itself (see the protocol's
 * `reloadWhenStale`), Vite's own client reloads it when the dev server comes
 * back, and a person presses reload. None of those can be caught — there is no
 * "before reload" hook, and a hook would not cover the other two anyway — so
 * what must survive is written AS IT CHANGES, synchronously, and a reload finds
 * it already there.
 *
 * ## Why `sessionStorage`
 *
 * It lives exactly as long as the tab: a reload of this frame or of the whole
 * host keeps it, closing the tab ends it. That is the right life for "what I
 * was in the middle of", and the wrong one for a prompt store — which this
 * module was told not to be, and still is not. Nothing here is sent anywhere.
 *
 * It needs a real origin, which this page has because the manifest declares
 * `storage: true`. On an opaque origin every access throws; each one is caught
 * and the page behaves as it did before this file existed.
 *
 * ## The scope
 *
 * Keyed by the project the host says is open ('' when it says none, or when
 * nothing is framing the page), because that is what a host changes under a
 * page without reloading it. Each entry also carries what it was made against —
 * a draft the composed text it edited, an open session the epic — and is only
 * given back when that still holds.
 */
const PREFIX = 'kehikot.orchestrator'

type Kind = 'draft' | 'open'

const key = (kind: Kind, project: string | null) => `${PREFIX}.${kind}:${project ?? ''}`

function read(kind: Kind, project: string | null): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem(key(kind, project))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function write(kind: Kind, project: string | null, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key(kind, project))
    else sessionStorage.setItem(key(kind, project), JSON.stringify(value))
  } catch {
    /* No storage here. The choice holds until the next reload, as it always did. */
  }
}

/** A prompt somebody edited and has not sent. */
export interface Draft {
  /** The composed text the edit started from. A draft is only for the prompt and selection it was written over. */
  base: string
  /** What is in the box. */
  text: string
  /** The directory chosen beside it: a restored prompt aimed at a reset directory would be an agent in the wrong repository. */
  dir: string
}

export function readDraft(project: string | null): Draft | null {
  const held = read('draft', project)
  if (!held || typeof held.base !== 'string' || typeof held.text !== 'string') return null
  return { base: held.base, text: held.text, dir: typeof held.dir === 'string' ? held.dir : '' }
}

/** `null` forgets it: the prompt was sent, emptied, put back as composed, or replaced from the host. */
export function keepDraft(project: string | null, draft: Draft | null): void {
  write('draft', project, draft)
}

/** Which session's transcript is open, and the epic it was opened under. */
export interface Open {
  epic: string | null
  session: string
}

export function readOpen(project: string | null): Open | null {
  const held = read('open', project)
  if (!held || typeof held.session !== 'string' || !held.session) return null
  return { epic: typeof held.epic === 'string' ? held.epic : null, session: held.session }
}

export function keepOpen(project: string | null, open: Open | null): void {
  write('open', project, open)
}
