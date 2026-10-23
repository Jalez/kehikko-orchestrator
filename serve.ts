#!/usr/bin/env bun
import { run } from 'kehikot-module-protocol/run'

import { BUILD, MANIFEST, TICKET, answer } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'
import { readScope, scopeLines } from './scope.ts'

/**
 * This module over its BUILT page (`bun run build`), on the same doors and the
 * same port. `run.sh` starts this when `dist/` carries a stamp of the commit
 * checked out, and Vite otherwise.
 *
 * Nothing this module says is decided here: the doors are `answer` in
 * `doors.ts`, mounted by the protocol's `run` exactly as `doors()` mounts them
 * on Vite, with the scope read from the environment once at start. A build that
 * is not this checkout's is never served: `run` answers the page with a 503
 * saying which commit each is, and the command to run.
 */
const scope = readScope()
for (const [level, line] of scopeLines(scope)) (level === 'warn' ? console.warn : console.log)(line)

await run({
  id: ID,
  prefer: PREFERRED_PORT,
  dir: import.meta.dirname,
  manifest: MANIFEST,
  answer: (method, path, query, body, ticket) => answer(method, path, query, body, ticket, scope),
  build: BUILD,
  ticket: TICKET,
})
