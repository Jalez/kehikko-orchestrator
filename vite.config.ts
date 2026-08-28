import type { IncomingMessage } from 'node:http'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { WELL_KNOWN } from 'roadmap-module-protocol'
import { defineConfig, type Plugin } from 'vite'

import { MANIFEST, TICKET, answer } from './doors.ts'
import { page } from './page.ts'
import { readScope } from './scope.ts'

/**
 * Every door this module answers on, served by the one process that serves the
 * page.
 *
 * ## Why they cannot be a second server
 *
 * A module is ONE ORIGIN or it is nothing: the protocol refuses a manifest
 * whose `entry` points anywhere but the origin that served the manifest, and it
 * is right to — a program that could name somebody else's page would be a
 * program that could have the host frame somebody else.
 *
 * That argument is usually made about the manifest and the health check. Here
 * it reaches further, because this module serves its own material: the page
 * fetches `/api/sessions` and `/api/transcript` as relative paths, which is how
 * it works with nothing else running at all. A store on a second port would
 * make every one of those fetches cross-origin and would mean this page could
 * not read its own roster inside the frame it was written to live in. So the
 * doors are middleware here, and `doors.ts` holds the deciding without holding
 * a socket.
 */
function doors(): Plugin {
  return {
    name: 'orchestrator-doors',
    configureServer(server) {
      /**
       * Read once, at start, and said out loud in the log.
       *
       * A person who set `ORCHESTRATOR_DIRS` and typoed a path should find out
       * here, in the terminal they typed it in, and not from a button refusing
       * them twenty minutes later. Read once rather than per request because
       * this is what the process was started with, and a variable that changed
       * under a running process would be a scope that widened without anybody
       * restarting anything.
       */
      const scope = readScope()
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

      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const path = url.pathname
        const method = (request.method ?? 'GET').toUpperCase()

        const send = (status: number, body: unknown) => {
          response.statusCode = status
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(body, null, 2))
        }

        /* Spelled by the protocol package so that this module and every host
           cannot disagree about it by a character. */
        if (path === WELL_KNOWN) return send(200, MANIFEST)

        if (path === '/app' || path === '/app/' || path === '/') {
          void server
            .transformIndexHtml(request.url ?? '/app', page(TICKET), request.originalUrl)
            .then((html) => {
              response.statusCode = 200
              response.setHeader('content-type', 'text/html; charset=utf-8')
              /*
               * Framed by a host and by nothing else — and by nothing at all is
               * fine too, which is what opening this page directly is.
               *
               * `frame-ancestors` is the module's own half of the arrangement:
               * a host says which origins IT will frame, and this says who may
               * frame this. It is deliberately not a list of one: whoever is
               * running this decides, through `ROADMAP_ORIGIN`, and the default
               * is the address the host in this workspace actually serves on.
               *
               * It matters more here than in the modules that only read. A page
               * with a start button embedded in a stranger's document is a
               * start button somebody can be tricked into pressing.
               */
              response.setHeader(
                'content-security-policy',
                `frame-ancestors 'self' ${process.env.ROADMAP_ORIGIN ?? 'http://127.0.0.1:4181 http://localhost:4181'}`,
              )
              response.end(html)
            })
            .catch(next)
          return
        }

        const ours = path === '/healthz' || path.startsWith('/api/')
        if (!ours) return next()

        /* Only the paths above read a body, and only those wait for one. Vite's
           own middleware stack has to keep seeing an unconsumed request for
           everything else. */
        void body(request)
          .then((parsed) =>
            answer(method, path, url.searchParams, parsed, readTicket(request.headers['x-orchestrator-ticket']), scope),
          )
          .then((reply) => {
            if (!reply) return next()
            send(reply.status, reply.body)
          })
          .catch(next)
      })
    },
  }
}

/** One header, which node hands over as a string, an array, or nothing. */
function readTicket(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] ?? null
  return null
}

/**
 * The request body, as JSON, or null.
 *
 * Bounded, because the caller is whatever on this machine found the port —
 * loopback is a fence around the machine and not around the programs on it —
 * and a handler that reads until the socket closes is a handler that can be
 * asked to read forever. The largest thing this module accepts is a prompt,
 * which the protocol caps at 8KB; a megabyte is a bound rather than a budget.
 *
 * Unparseable is null rather than a throw, and `doors.ts` says "that was not a
 * request" about it. A malformed body is an ordinary answer to give.
 */
const MAX_BODY_BYTES = 1_000_000

async function body(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  if ((request.method ?? 'GET').toUpperCase() !== 'POST') return null
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const piece = chunk as Buffer
    size += piece.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(piece)
  }
  if (!chunks.length) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
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
 * ## No alias for `roadmap-module-protocol`
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
 */
export default defineConfig({
  base: './',
  plugins: [doors(), react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
})
