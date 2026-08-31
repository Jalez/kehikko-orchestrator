#!/usr/bin/env bun
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { originFor, registerAt } from 'roadmap-module-protocol/serve'

import { ID, PREFERRED_PORT } from './manifest.ts'

/**
 * Tell a host on this machine where this module answers.
 *
 *   bun run register            # or: PORT=7851 bun run register
 *
 * A separate program from `run.sh` on purpose. Registration writes into
 * somebody's home directory and says "frame this", which is a decision a person
 * makes once; a start script that did it quietly would be making that decision
 * on their behalf every time they pressed start. That argument is sharper for
 * this module than for the others, because what gets framed here has a button
 * that starts processes.
 *
 * ## The plugin writes this file too, and it does not weaken that
 *
 * `serves()` in `vite.config.ts` rewrites this registration every time the
 * server starts, which reads like exactly what the paragraph above forbids. It
 * is not, and the difference is worth being exact about — especially here, where
 * being framed is consequential.
 *
 * ADOPTION is the decision a person makes once, and this program is it. Running
 * this is how a module nobody had put on their canvas gets onto it, buttons and
 * all; deleting the file is how it comes off again. Nothing the plugin does can
 * put this module on a canvas it was not already invited to.
 *
 * The ADDRESS is not a decision anybody made. Nobody chose 7850 — they chose to
 * be framed, and 7850 is a fact about where this process happened to bind, one
 * that changes between one start and the next when something else has the port.
 * A registration still naming the old number is one the host sweeps to find
 * nothing, and here that is a roster nobody can see: sessions this module
 * started go on running with no page attached to them and no Stop to press.
 * Rewriting the address keeps the decision the person made TRUE. It does not
 * make one.
 *
 * ## `dir` as well as `url`, which this program used not to write
 *
 * The url is where to talk to this module; the directory is where to START it,
 * and it is a DIRECTORY rather than a command line for the reason `run.sh`
 * gives. With only the url, a host can frame a running module and can do nothing
 * at all about a stopped one.
 *
 * It comes from this file's own location rather than from `process.cwd()`, so
 * `bun run register` works from anywhere and records where the program actually
 * is instead of where somebody happened to be standing. That is the one thing
 * the package cannot work out for itself, which is why it is still spelled here.
 *
 * ## Where a host looks is no longer copied into this file
 *
 * The registry directory, the rule that the FILENAME carries the id — a host
 * sweeps the directory and reads the id off the name, so
 * `roadmap.orchestrator.json` is what makes this `roadmap.orchestrator` — and
 * the shape of the document are all in `roadmap-module-protocol/serve` now. This
 * file used to say the path itself, with a note explaining that the copy was
 * deliberate so the directory could stand alone; fourteen deliberate copies of
 * one path are fourteen chances to disagree by a character, and writing to the
 * wrong directory is the worst failure a module can have, because the host finds
 * nothing and finds it silently.
 *
 * `registerAt` MERGES rather than overwrites, so a field somebody set beside the
 * url by hand survives a rewrite that had nothing to do with it.
 */
const port = Number(process.env.PORT ?? PREFERRED_PORT)
const written = registerAt({
  id: ID,
  origin: originFor(port),
  dir: dirname(fileURLToPath(import.meta.url)),
})

console.log(`registered: ${written.file} -> ${written.url} (${written.dir})`)
if (written.was) console.log(`  (was ${written.was.url} in ${written.was.dir})`)
console.log('Start the module with ./run.sh, then reload the host; it sweeps the directory on every read.')
console.log(`If ${port} is taken, ./run.sh moves to the next free port and rewrites this file to match.`)
