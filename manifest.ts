import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'roadmap-module-protocol'

export const ID = 'roadmap.orchestrator'
export const VERSION = '1.0.0'

/**
 * What this module says about itself when a host asks.
 *
 * The manifest is the smallest half of this program and the only half a host
 * ever reads before deciding whether to frame it. Read it as a description of
 * the ENRICHMENT rather than of the app: the page lists the Claude Code
 * sessions on this machine and reads their transcripts with nothing else
 * running at all. What a host adds is a selection to filter by, a prompt to
 * start with, and one answer about what those references ARE.
 *
 * ## Two capabilities, and the ones deliberately absent
 *
 * - **`live:read` — declared, and it is the only read.** `context.selection`
 *   carries refs and nothing else: `gh#105` on the wire is a string, and
 *   whether it is an issue or a pull request is not in it. The protocol is
 *   explicit about why — a host can vouch that these are the refs somebody
 *   picked and cannot vouch for what they are, because it was told and never
 *   checked. So when this page wants to write "pull request gh#105" into the
 *   opening prompt of a session it is about to start, it asks `live.get` and
 *   reads the kind out of the bag the refresh filed it in, which is where
 *   References reads it too. Without the answer the prompt says `gh#105` and no
 *   more, which is honest and slightly less useful.
 * - **`selection:set` — not declared.** This module is a consumer of the
 *   canvas's selection, not an author of it. A start button that also moved
 *   everybody else's selection would be a container reaching sideways.
 * - **`epics:read` — not declared.** There is nothing on this page that is per
 *   epic except the selection, and the selection arrives without being asked
 *   for. A picker over epics would be a control for a state this module does
 *   not have.
 * - **`stage:report` — not declared, and this is the one worth arguing.** The
 *   sessions this module starts DO report stages; they do it themselves,
 *   through whatever MCP door they are connected to, because a stage is an
 *   assertion about work and the thing doing the work is the only honest
 *   author of one. A launcher that reported on behalf of what it launched would
 *   be writing "working" about a process it cannot see the inside of.
 * - **`state:keep` — not declared.** There is nothing here worth remembering
 *   between loads: which session you had open is a fact about the last minute,
 *   and restoring it would put a stale transcript on screen before the roster
 *   had been read.
 *
 * And per the protocol's own README: a declaration is not a request and is not
 * answered. The host refuses whatever it likes at every call whatever is
 * written here, so the page is built to be refused — a refused `live.get` means
 * the references in the prompt lose their kind, and nothing else.
 *
 * ## `prompt: true`, and what it is not
 *
 * This is the "a prompt would be used here" signal, and it is a declaration
 * rather than a demand. It is how a host knows to list this container among the
 * places a prompt can be aimed, and how it knows to show that one is expected.
 *
 * There is deliberately no prompt editor in this module. The modal belongs to
 * the frame: framed, an editor here would be clipped by the iframe, and a
 * person aiming a prompt at this container from another one could not reach it at
 * all. What arrives is `context.prompt`, one string composed by the host, and
 * this module does not merge fragments because it never sees any. Null is an
 * ordinary state and the page says, in words, what it will use instead.
 *
 * ## No `mcp`, and that is a decision rather than an omission
 *
 * A module may name its own MCP door and most of the modules beside this one
 * do, because they hold something an agent would want to write. This one holds
 * nothing durable. The roster is `claude agents --json --all` read fresh, the
 * transcripts are Claude Code's own files, and an agent that wanted either can
 * read both directly with less ceremony than a second door over the same bytes.
 *
 * There is a sharper reason too. The one thing this module can do that nothing
 * else here can is START A PROCESS. Putting that behind an MCP tool would mean
 * an agent could spawn agents on a loop with nobody in the room, and the whole
 * shape of `start.ts` is that a person pressed something. So the door stays
 * shut.
 *
 * ## Storage, and why THIS module asks for it
 *
 * `storage: true` makes the host frame this page with `allow-same-origin`, so
 * it keeps its real origin instead of running opaque. References and Atlas
 * declare `false` and are right to: they hold nothing, they ask the host for
 * everything, and an origin would be a thing they had no use for.
 *
 * This module is the other kind. It serves its own `/api` — the roster, the
 * transcripts — and it takes one write, which is the most consequential write
 * in this workspace: `POST /api/start` spawns a Claude Code session. Opaque,
 * that combination has a hole in it that Journeys had open earlier today:
 *
 *   - An opaque page's fetches to its own `/api` are CROSS-origin, because its
 *     origin is `null` and matches nothing. So the server would have to answer
 *     with permissive CORS or the page could not read its own roster.
 *   - Permissive CORS means any page in any tab can read this origin.
 *     Including `/app`. Including the write ticket printed into it. Measured on
 *     Journeys before this was fixed there:
 *
 *         $ curl -H 'Origin: https://evil.example' http://127.0.0.1:7840/app
 *         Access-Control-Allow-Origin: *
 *         ...ticket" type="application/json">"e75d4d01-…
 *
 *     A page somebody happened to visit could take that ticket off loopback and
 *     use it. Here that is not a stale journey body — it is a coding agent
 *     started in somebody's repository.
 *
 * That is not a weakness in the ticket; the ticket was never an authorization
 * check. It is what happens when a program that takes writes is given no origin
 * to take them under. Declaring storage closes it at the root: with a real
 * origin this page's scripts and its `/api` calls are ordinary same-origin
 * requests, no CORS header is sent at all, and a stranger's page reading `/app`
 * gets nothing back.
 *
 * The sandbox is weakened by exactly what that costs, which is little. The
 * origin this page regains is `127.0.0.1:7850`; the host is on
 * `127.0.0.1:4181`. Different ports are different origins, so the page still
 * cannot reach into the host — it can only reach itself, which is all it asked
 * for.
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  /**
   * Parsed rather than shipped as a bare object.
   *
   * The protocol package is explicit that its schemas are a convenience and
   * never the host's check — the host runs its own copy over what arrives on
   * the wire. That cuts both ways: running it HERE is the cheapest way for this
   * module to learn it has written a manifest no host will accept, and to learn
   * it when this file is imported rather than from a host's refusal in somebody
   * else's log.
   */
  protocol: PROTOCOL,
  id: ID,
  name: 'Orchestrator',
  version: VERSION,
  summary: 'Start a session on what you picked, and watch what it says.',
  /**
   * What an agent should do about this module, given that it is here.
   *
   * Not the summary: that says what this IS, for a person deciding whether to
   * place it. This says what its PRESENCE OBLIGES, and a host composes it into
   * the prompt every agent on the canvas is handed — attributed to this module,
   * because it is this module's claim rather than the host's.
   *
   * This one is addressed partly to sessions started BY this module, which is
   * unusual and worth noting: the agent reading it may be the thing this module
   * spawned.
   */
  guidance:
    'Sessions are started here on the references picked out on this kehikko. If you are one of ' +
    'those sessions, the references you were started on are the scope of your work — do not widen ' +
    'it because something nearby looked wrong; write down what you noticed instead. Your ' +
    'transcript is being read live by the person who started you, so say what you are doing as ' +
    'you do it rather than only at the end.',
  entry: '/app',
  modes: [{ id: 'orchestrator', label: 'Sessions', scope: 'epic' }],
  extensions: { emits: [], consumes: [] },
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['live:read'],
    storage: true,
    prompt: true,
  },
  health: '/healthz',
})
