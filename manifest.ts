import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'kehikot-module-protocol'
import pkg from './package.json'

import { SETTINGS } from './settings.ts'
/* This module's introduction (protocol 2.57.0): slides the host shows in its introduction dialog. Also
   read as a file from the repository, so a person can watch it before the module runs or is installed. */
import intro from './intro.json'

/** "How to use" (protocol 2.52.0). Each string one line of plain text. */
export const HELP = {
  summary: 'Talk with your agent sessions in one place: answer their questions, write to them, and see what each is working on.',
  sections: [
    {
      title: 'What it shows',
      points: [
        'One thread per agent session in the project: who it is, where it works, and whether it waits for you, works or is quiet. Questions waiting come first.',
        'A question’s choices as buttons, and what each session last reported working on.',
        'The header’s Show switch picks All sessions, Questions, or Working on. The footer says how many questions wait and how many agents work.',
        'The page fits its container: one question with its choices when small, the threads beside the open conversation when there is room.',
      ],
    },
    {
      title: 'How to use it',
      points: [
        'Answer a question by pressing one of its choices, or by typing your own answer.',
        'Pick a session to read its conversation and write to it, or write to every session on a kehikko, in an epic, or everyone.',
        'Turn on Send messages to agent sessions as you in Kehikot’s Settings › Modules › Orchestrator before writing: it is off by default.',
        'Each unanswered question is also in Kehikot’s Inbox, and leaves it once answered. Reports never ask for your attention.',
      ],
    },
    {
      title: 'What agents can do',
      points: [
        'Every session on a kehikko with the Orchestrator is told to send its questions, decisions and progress here with send_message, as a question with up to six choices or as a report.',
        'What you send arrives in the session’s terminal as your own message. No agent can send as you.',
      ],
    },
    {
      title: 'Rules',
      points: [
        'A message is sent only when you press or type here, and only after you turned the setting on yourself.',
        'Sessions belong to this computer, so nothing is kept in the project.',
      ],
    },
  ],
}

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
  /* "How to use" (protocol 2.52.0), and the introduction (protocol 2.57.0). */
  help: HELP,
  intro,
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
