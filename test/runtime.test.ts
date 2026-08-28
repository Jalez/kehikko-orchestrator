import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The server half of this module runs under NODE, and the tests run under bun.
 *
 * ## Why a grep is the right test here
 *
 * `run.sh` ends in `bunx vite`. `bunx` execs the `vite` bin, whose shebang is
 * `#!/usr/bin/env node`, so the dev server — and therefore every middleware,
 * every roster read, every transcript read — is a node process with no `Bun`
 * global in it.
 *
 * Everything else about this repository is bun: `bun install`, `bun test`, `bun
 * run typecheck`. So a `Bun.spawn` or a `Bun.file` in the server half type-
 * checks, passes every test, and throws at runtime — where it is caught by a
 * `try` that exists for a legitimate reason and turned into an empty answer.
 * That is exactly what happened: `sessions.ts` used `Bun.spawn`, the page said
 * "0 of 0 sessions on this machine", and `claude agents --json --all` in a
 * terminal listed a hundred and eighteen. Nothing failed. Nothing logged.
 *
 * A behavioural test cannot catch this, because the behavioural tests run in
 * the runtime where the API exists. Reading the source for the API is the only
 * check that runs under bun and asserts something about node, so that is what
 * this is. It is crude on purpose: crude and correct beats subtle and absent.
 */
const SERVER_FILES = ['sessions.ts', 'transcript.ts', 'start.ts', 'scope.ts', 'doors.ts', 'page.ts', 'vite.config.ts']

describe('the server half', () => {
  for (const name of SERVER_FILES) {
    test(`${name} uses no Bun-only API`, () => {
      const source = readFileSync(join(import.meta.dirname, '..', name), 'utf8')
      /* Deliberately matches inside comments too. The comments here talk ABOUT
         `Bun.spawn` at length, so this looks for the call shape rather than the
         word — a mention in prose is `\`Bun.spawn\`` in backticks, and a use is
         followed by an open parenthesis. */
      const uses = source.match(/\bBun\.[A-Za-z]+\s*\(/g)
      expect(uses).toBeNull()
    })
  }
})
