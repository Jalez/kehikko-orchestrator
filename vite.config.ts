import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { doors, serves } from 'kehikot-module-protocol/serve'
import { defineConfig, type Plugin } from 'vite'

import { BUILD, MANIFEST, TICKET, answer } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'
import { readScope } from './scope.ts'

/**
 * Which directories this process may start a session in: read once, at start.
 *
 * Read once rather than per request because this is what the process was
 * started with, and a variable that changed under a running process would be a
 * scope that widened without anybody restarting anything. The doors below close
 * over it.
 */
const scope = readScope()

/**
 * The scope, said out loud in the log.
 *
 * A person who set `ORCHESTRATOR_DIRS` and typoed a path should find out here,
 * in the terminal they typed it in, and not from a button refusing them twenty
 * minutes later.
 */
function saysScope(): Plugin {
  return {
    name: 'orchestrator-scope',
    apply: 'serve',
    configureServer(server) {
      if (scope.dirs.length) {
        server.config.logger.info(`orchestrator: may start sessions in ${scope.dirs.join(', ')}`)
      } else {
        server.config.logger.warn(
          'orchestrator: ORCHESTRATOR_DIRS is not set, so nothing can be started. The roster will show every ' +
            'session on this machine; the start button will say which variable to set.',
        )
      }
      for (const bad of scope.rejected) {
        server.config.logger.warn(`orchestrator: ignoring ${bad.path} — ${bad.why}`)
      }
    },
  }
}

/**
 * The dev server, and the line in it that is deliberately absent.
 *
 * ## No `server.cors` — this module declares storage instead
 *
 * References and Atlas set `cors: true` and have to. A host frames a module
 * WITHOUT `allow-same-origin` unless its manifest declares storage, which puts
 * the page on an opaque origin — and `<script type="module">` is ALWAYS fetched
 * in CORS mode, so with no permissive header not one script in the page runs.
 * The document loads, `load` fires, the host greets it, and nothing answers.
 * `curl` cannot see it, being unsubject to CORS; only the browser console can.
 * That has cost this codebase days.
 *
 * This module goes the other way, and it is not a close call: it serves its own
 * `/api` and it takes a write that starts a process. A permissive
 * `Access-Control-Allow-Origin` means any page in any tab can read this origin,
 * and therefore read `/app`, and therefore read the write ticket printed into
 * it. Journeys had exactly that hole open earlier today and the measurement is
 * quoted in `manifest.ts`. There it was a journey body; here it would be a
 * coding agent started in somebody's repository.
 *
 * So the manifest declares `storage: true` and this line is gone. With a real
 * origin, this page's scripts and its `/api` calls are ordinary same-origin
 * requests: no CORS is involved at all, nothing is offered to strangers, and
 * the ticket is unreadable from any other origin.
 *
 * ## No alias for `kehikot-module-protocol`
 *
 * There used to be one, in every module here, pointing at the protocol's source
 * in the repository they all used to live in. It is gone and must not come
 * back: the package's `exports` are correct, reaching past them is what made a
 * whole class of bug possible, and a module that resolved its contract
 * differently from the host it talks to is a module testing something nobody
 * ships.
 *
 * ## `base: './'`
 *
 * This page is served at `/app` here and framed by a host at whatever address
 * that host wrote down. Absolute asset paths are correct in the first case and
 * a guess in the second; relative ones are a fact in both, because the browser
 * resolves them against the document it just fetched.
 *
 * ## And no `server.port`, because `serves()` decides it
 *
 * 7850 used to be written on the `bunx vite` line in `run.sh` and again in
 * `register.ts`, and true in neither the moment something else held the port:
 * `--strictPort` meant this module printed `Error: Port 7850 is already in use`
 * and exited 1. Here that is worse than elsewhere — a host that cannot reach
 * this module has no roster, so a session it started stays running with nothing
 * on screen offering to stop it. The number is `PREFERRED_PORT` in `manifest.ts`
 * now, said once beside the id.
 *
 * `serves()` is FIRST in the plugin list because it has to claim a port before
 * anything else in this config asks for one. A free 7850 is taken in silence;
 * this module already answering there ends the start cleanly rather than making
 * a SECOND roster over the same sessions; anything else is a loud move to the
 * next free port with the registration rewritten to the port the server ACTUALLY
 * bound, read off `httpServer.address()` after `listening` rather than off what
 * was asked for.
 *
 * ## `doors()`
 *
 * Every door this module answers on, served by the one process that serves the
 * page — a module is ONE ORIGIN, and the page fetches `api/sessions` and
 * `api/transcript` as relative paths. The protocol's plugin serves the manifest
 * at both well-known paths, `/app` (generated, so the write ticket and the build
 * can be printed into it, `no-store`, and `frame-ancestors` from
 * `frameAncestors()` — which matters more here than in the modules that only
 * read: a page with a start button embedded in a stranger's document is a start
 * button somebody can be tricked into pressing), and `/healthz` and `/api/*`
 * through `answer` in `doors.ts`, which holds the deciding without holding a
 * socket. The body is bounded at the plugin's megabyte; the largest thing this
 * module accepts is a prompt, which the protocol caps at 8KB. See the
 * protocol's docs/module-plumbing.md.
 */
export default defineConfig({
  base: './',
  plugins: [
    serves({ id: ID, prefer: PREFERRED_PORT }),
    saysScope(),
    doors({
      manifest: MANIFEST,
      answer: (method, path, query, body, ticket) => answer(method, path, query, body, ticket, scope),
      build: BUILD,
      page: { title: 'Orchestrator', ticket: TICKET },
    }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
})
