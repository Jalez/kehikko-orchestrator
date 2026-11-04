import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'kehikot-module-protocol'
import pkg from './package.json'

import { SETTINGS } from './settings.ts'

export const ID = 'kehikot.orchestrator'
/** The module's version: package.json's, the one place it is written. A release is tagged with it. */
export const VERSION: string = pkg.version

/**
 * The port this module would rather have. A preference, not a promise: `serves()` moves to the next
 * free port and rewrites the registration when something else holds it.
 */
export const PREFERRED_PORT = 7850

/**
 * What every agent session on a kehikko this module is on is told about it (protocol 2.36.0,
 * `agentSays`), at most 200 characters. It names the exact call: `send_message` with `to: { module }`
 * and the two kinds (protocol 2.50.0). A running session hears it again when it changes
 * (`NotesTold.said`, protocol 2.50.0).
 */
export const AGENT_SAYS =
  'Your person reads and answers you here. Send questions, decisions and progress reports with send_message to {module: "kehikot.orchestrator"}: kind "question" (with choices) or "report".'

/**
 * What the Orchestrator is: the person's one place to talk with the agent sessions in a project.
 *
 * Sessions ask it questions and report what they work on through the host's messages (protocol
 * 2.50.0: `send_message` with `kind` and `choices`, addressed `to: { module: ID }`); the person
 * answers here — a choice pressed or words typed — and their answer goes back as THEIR message, which
 * the host marks as the person's (`messages.say`), typed into the session's terminal.
 *
 * ## What it asks of the host
 *
 * - **`agents:message`**: `messages.mine` (what is addressed to this module, and what was sent through
 *   it) and `messages.post` (its own introduction, `once`).
 * - **`messages:as-person`**: `messages.say`, the person's own message. The host sends one only on the
 *   person's press in this page, and only after the person turned on this module's setting in the
 *   host's own Settings › Modules (`settings.ts`).
 * - **`activity:report`**: an unanswered question is a needs-you item in the Inbox until it is
 *   answered. Reports never ask for attention.
 * - **`state:keep`**: the header's "show" switch, kept by the host per container (`state.set`), so it
 *   is back after the app restarts.
 *
 * ## What it no longer is
 *
 * Before 2.0.0 this module started Claude Code sessions on picked references and showed their
 * transcripts. Starting sessions is the agent modules' (each runs its own), and reading a transcript
 * is the terminal's; both are gone, with the `ORCHESTRATOR_DIRS` scope they needed.
 *
 * `storage: true` because the page writes to its own server (`/api/introduced`) under its ticket, on
 * its real origin.
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  protocol: PROTOCOL,
  id: ID,
  name: 'Orchestrator',
  icon: 'lucide:network',
  version: VERSION,
  tags: ['agents'],
  summary: 'Talk with your agent sessions in one place: answer their questions, message them, see what each is working on.',
  agentSays: AGENT_SAYS,
  entry: '/app',
  modes: [
    { id: 'orchestrator', label: 'Messages', scope: 'project', scopeSays: 'the questions, reports and messages of the agent sessions in this project' },
  ],
  extensions: { emits: [], consumes: [] },
  partless: 'A conversation with an agent session is the session’s, wherever it works, never a part of an epic.',
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['agents:message', 'messages:as-person', 'activity:report', 'state:keep'],
    storage: true,
    prompt: false,
    settings: SETTINGS,
  },
  health: '/healthz',
})
