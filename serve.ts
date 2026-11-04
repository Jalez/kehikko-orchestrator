#!/usr/bin/env bun
import { run } from 'kehikot-module-protocol/run'

import { BUILD, MANIFEST, TICKET, answer } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'

/* The built page and the doors, on one port: what `run.sh` starts when `dist/` is this checkout's. */
await run({
  id: ID,
  prefer: PREFERRED_PORT,
  dir: import.meta.dirname,
  manifest: MANIFEST,
  answer: (method, path, query, body, ticket) => answer(method, path, query, body, ticket),
  build: BUILD,
  ticket: TICKET,
})
