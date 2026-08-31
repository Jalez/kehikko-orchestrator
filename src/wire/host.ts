import {
  LIMITS,
  MESSAGE,
  PROTOCOL,
  clampHeight,
  hostMessageSchema,
  looksLikeWireMessage,
  type Goto,
  type ModuleContext,
  type ResponseFailureReason,
} from 'roadmap-module-protocol'

import { mailbox, type MessageSource } from './mailbox.ts'

/**
 * The bridge, and nothing about sessions.
 *
 * One conversation with one window, in the shape the protocol package defines.
 * It knows how to be greeted, how to ask a question and match the answer to it,
 * how to answer a `goto`, and how to say how tall it would like to be. It knows
 * nothing about Claude Code, and the code that knows about Claude Code knows
 * nothing about `postMessage`.
 *
 * Adapted from `kehikko-references/src/wire/host.ts` and `kehikko-journeys`.
 *
 * ## Binding to the window, not to the origin
 *
 * This page declares storage, so a host frames it WITH `allow-same-origin` and
 * it keeps a real origin of its own. The obvious conclusion to draw from that —
 * that origins are now usable as identity here — is wrong.
 *
 * An origin says which SERVER a document came from, and any number of documents
 * can come from one server: a second frame of this same module, a tab somebody
 * opened at this address, a page that navigated itself here. None of those is
 * the host and every one of them would pass an origin check. The origin was
 * regained so that this page's own `/api` calls stop being cross-origin (see
 * `manifest.ts`), which is a fact about fetching and says nothing about who is
 * on the other end of the frame.
 *
 * What IS an identity is the window handle. The greeting arrives from exactly
 * one `MessageEvent.source`, and nothing in this page or any other page can
 * forge that handle — so the rule is the one the protocol's own note states:
 * bind to the window that greeted us, and after the greeting ignore anything
 * that did not come from it.
 *
 * That rule is load-bearing here in a way it is not in a module that only
 * reads. What arrives on this wire is a SELECTION and a PROMPT, and this module
 * turns both into the opening words of a process. A second sender answering our
 * correlation ids, or slipping in a context, would be somebody else choosing
 * what an agent is told. The window check is what stops that, and it is why
 * there is no code path in this file that acts on a message from an unbound
 * source.
 *
 * We reply with `targetOrigin: '*'` where `ev.origin` is not usable, and that
 * is not laziness. There is nothing secret in anything this page SENDS — a
 * `roadmap.ready` and the occasional `live.get` — and a targeted origin would
 * have to be a guess: the host's origin comes from `ev.origin`, which is
 * `"null"` exactly when the host itself is sandboxed. A guess that fails
 * silently drops every message. Where `ev.origin` is a real origin we use it,
 * because then it is a fact rather than a guess.
 *
 * ## Parse what the host sends, too
 *
 * A framed page receives every message posted at its window: the host's, a dev
 * server's hot-reload socket, an extension's. `looksLikeWireMessage` is the
 * cheap filter and `hostMessageSchema` is the real one. A module that trusted
 * `data.type` alone would be one that Vite's own socket can put into an
 * unexplained state on a Tuesday — and this page is served by Vite, so that
 * socket is not hypothetical.
 */

/**
 * Why a question came back without an answer.
 *
 * The protocol's three, plus one of our own. `silent` is the timeout, and it is
 * a separate word rather than folded into `failed` because the two send a
 * person to different places: `failed` is the host telling us it went wrong,
 * and `silent` is the host not being there — which, from inside a frame, is
 * indistinguishable from a host that is still starting up.
 */
export type Refusal = { reason: ResponseFailureReason | 'silent'; error: string }

export class HostRefused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.error)
    this.name = 'HostRefused'
  }
}

/**
 * How long to wait for one answer.
 *
 * A number rather than forever, because forever is a page that shows "asking…"
 * until somebody reloads it, which is a spinner making a claim that an answer
 * is coming. Twelve seconds is long enough for a host reading a file off a cold
 * disk and short enough that nobody sits through it twice.
 */
const ANSWER_WITHIN_MS = 12_000

export interface HostEvents {
  /** The greeting arrived, carrying the context and whatever the host kept for us. */
  onHello?: (context: ModuleContext, state: string | null) => void
  /** The reader switched epics, changed the selection, wrote a prompt, or pinned this container. */
  onContext?: (context: ModuleContext) => void
  /**
   * "Go to this reference." The answer is not optional and not deferrable: the
   * host is waiting on it, and the protocol is explicit that a module which
   * never answers must not be able to hang a reference. So `answer` is handed
   * in rather than returned, and `connect` guarantees it is called.
   */
  onGoto?: (goto: Goto, answer: (found: boolean, why?: string) => void) => void
}

export interface Host {
  /** Ask one question. Rejects with `HostRefused` — never with a bare string. */
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  /** Say how tall we would like to be. Fire and forget, by design. */
  resize: (height: number) => void
  /** Whether anything has greeted us yet. */
  greeted: () => boolean
  /** Stop listening. Every question still waiting is refused rather than left hanging. */
  stop: () => void
}

/**
 * Start listening, and hand back the four things the page needs.
 *
 * Nothing is sent from here until a greeting arrives, and nothing needs to be:
 * the host greets on every frame load, and a module that announced itself first
 * would be shouting at a window that may not be a host at all.
 *
 * The default source is the `mailbox` rather than `window`, so that a greeting
 * which arrived before this was called is replayed rather than lost. The source
 * stays injectable, because everything this function decides is tested without
 * a browser and that has to keep being true.
 */
export function connect(id: string, events: HostEvents = {}, source: MessageSource = mailbox): Host {
  let host: Window | null = null
  let origin = '*'
  let live = true

  /** Correlation id -> the promise waiting on it. A `Map`, per the protocol's note on lookups. */
  const waiting = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: HostRefused) => void; timer: ReturnType<typeof setTimeout> }
  >()

  let counter = 0
  const nextId = () => `${Date.now().toString(36)}-${(counter += 1).toString(36)}`

  const send = (message: unknown) => {
    if (!host) return
    host.postMessage(message, origin)
  }

  const settle = (correlation: string, outcome: { ok: true; data: unknown } | { ok: false; refusal: Refusal }) => {
    const pending = waiting.get(correlation)
    if (!pending) return
    waiting.delete(correlation)
    clearTimeout(pending.timer)
    if (outcome.ok) pending.resolve(outcome.data)
    else pending.reject(new HostRefused(outcome.refusal))
  }

  const onMessage = (ev: MessageEvent) => {
    if (!live) return
    if (!looksLikeWireMessage(ev.data)) return
    const parsed = hostMessageSchema.safeParse(ev.data)
    if (!parsed.success) return
    const message = parsed.data

    if (message.type === MESSAGE.HELLO) {
      /* Re-greeting is normal rather than an error: the host greets on every
         frame load, and a frame that reloaded itself has forgotten everything.
         So the newest greeting wins, and the window it came from becomes the
         one we answer. */
      host = (ev.source as Window | null) ?? source.parent ?? null
      origin = ev.origin && ev.origin !== 'null' ? ev.origin : '*'
      send({ type: MESSAGE.READY, id, protocol: message.protocol ?? PROTOCOL })
      events.onHello?.(message.context, message.state ?? null)
      return
    }

    /* Everything after the greeting has to come from the window that gave it.
       See the essay at the top: the origin cannot do this job and this can, and
       what travels on this wire ends up in an agent's opening prompt. */
    if (ev.source !== host) return

    if (message.type === MESSAGE.CONTEXT) {
      /* Rebuilt field by field rather than handed on whole, because a context
         message is flat on the wire — `epic` sits beside `type` — while what
         the page wants is the same `ModuleContext` object the greeting carries.
         The listing has to be complete, and completeness here is not obvious to
         look at: a field left out does not fail, it quietly becomes the page's
         idea that the host said nothing about it. That is exactly what happened
         to `selection` in another module, which arrived on the wire and was
         dropped one line before anybody could act on it. `prompt` and `pinned`
         are the two newest and are listed for the same reason — a prompt
         somebody wrote and this page silently discarded would be the same bug
         wearing a different coat. */
      events.onContext?.({
        epic: message.epic,
        project: message.project,
        theme: message.theme,
        selection: message.selection,
        pinned: message.pinned,
        prompt: message.prompt,
      })
      return
    }

    if (message.type === MESSAGE.RESPONSE) {
      if (message.ok) settle(message.id, { ok: true, data: message.data })
      else settle(message.id, { ok: false, refusal: { reason: message.reason, error: message.error } })
      return
    }

    if (message.type === MESSAGE.GOTO) {
      /* Answered exactly once, whatever the listener does — including nothing,
         including throwing. The host is waiting on this and will time out into
         "not found"; a module that leaves it to the timeout has turned a
         hundred milliseconds into a reader watching a container do nothing. */
      let answered = false
      const answer = (found: boolean, why = '') => {
        if (answered) return
        answered = true
        clearTimeout(backstop)
        send({ type: MESSAGE.WENT, id: message.id, found, why: why.slice(0, LIMITS.REASON) })
      }
      /*
       * The backstop, and why 900ms.
       *
       * The protocol is explicit that a module must answer when it KNOWS, not
       * when it is asked. It also cannot be generous: the host gives a walk
       * 1200ms and then treats silence as "not found", falling back to an
       * ordinary link — right behaviour, worse experience than being told so.
       * 900ms leaves this page room for a loopback fetch of its own roster,
       * which takes single milliseconds, while still beating the host's clock
       * with a sentence a person can read.
       */
      const backstop = setTimeout(
        () => answer(false, 'This module did not manage to say where that reference is.'),
        900,
      )
      try {
        if (events.onGoto) events.onGoto(message, answer)
        else answer(false, 'This module is not showing anything that can be walked to.')
      } catch {
        answer(false, 'This module failed while looking for that reference.')
      }
      return
    }
  }

  source.addEventListener('message', onMessage)

  return {
    request(method, params = {}) {
      if (!host) {
        return Promise.reject(
          new HostRefused({ reason: 'silent', error: 'Nothing has greeted this page, so there is nobody to ask.' }),
        )
      }
      const correlation = nextId()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          settle(correlation, {
            ok: false,
            refusal: {
              reason: 'silent',
              error: `The host was asked ${method} and had not answered ${Math.round(ANSWER_WITHIN_MS / 1000)} seconds later.`,
            },
          })
        }, ANSWER_WITHIN_MS)
        waiting.set(correlation, { resolve, reject, timer })
        send({ type: MESSAGE.REQUEST, id: correlation, method, params })
      })
    },

    resize(height) {
      /* Clamped on our own side with the host's own arithmetic, so that what we
         ask for is what we will get. The host runs its own copy over the raw
         number regardless — this is prediction, not enforcement. */
      send({ type: MESSAGE.RESIZE, height: clampHeight(height) })
    },

    greeted: () => host !== null,

    stop() {
      live = false
      source.removeEventListener('message', onMessage)
      for (const correlation of [...waiting.keys()]) {
        settle(correlation, { ok: false, refusal: { reason: 'silent', error: 'This page stopped listening.' } })
      }
    },
  }
}
