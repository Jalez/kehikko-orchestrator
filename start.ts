import { spawn, type ChildProcess } from 'node:child_process'

import { runToken } from './compose.ts'
import { allowed, DIRS_VAR, type Scope } from './scope.ts'

/**
 * Starting a Claude Code session.
 *
 * ## Read this before changing anything in this file
 *
 * This is the most dangerous thing in this workspace. Every other module here
 * reads something and draws it; this one turns an HTTP request into a process
 * with a person's credentials, in a directory holding their work, with an
 * agent's permission to edit it. The rules below are lifted from
 * `roadmap/src/launch.ts`, whose opening paragraph is the one to keep in mind:
 *
 *   A registration names the directory, and one script inside it. Not a
 *   command line. A string handed to a shell would make a registration file a
 *   place to write shell, which is a much larger thing to have on a machine
 *   than a script sitting in a directory somebody can read.
 *
 * The shape of that rule survives here even though the thing being started is
 * different. What is fixed and what is variable:
 *
 *  - **The program is fixed.** `claude`, always, written in this file. Nothing
 *    that arrives over the wire chooses a program, and there is no field in the
 *    request that could.
 *  - **The arguments are fixed except one.** `--bg` and then exactly one
 *    string, the prompt. No flags come from the request. A request that could
 *    add a flag could add `--dangerously-skip-permissions`, and then this
 *    module would be a way to run anything.
 *  - **argv, never a shell.** `spawn(cmd, args)` with no `shell: true` and no
 *    interpolation into a string anywhere on the path. The prompt is a single
 *    argv element, so a prompt containing `; rm -rf ~` is a prompt containing
 *    those characters and not a second command. This is the one line that makes
 *    the prompt safe to be arbitrary text, and it is why the prompt does not
 *    need — and does not get — a sanitiser, which would only ever be a filter
 *    somebody eventually finds a way around.
 *  - **The directory is allow-listed, by equality.** See `scope.ts`. It comes
 *    from the environment of whoever started this process; the request may only
 *    NAME one of the directories already on the list, and naming anything else
 *    is refused with the list in the refusal.
 *  - **Nothing starts on its own.** There is no autostart, no retry, no queue
 *    that drains. This is called from a press, and the page shows the exact
 *    prompt that will be sent before the press.
 *  - **Started is not running.** `spawn` does not throw on a missing binary or
 *    a bad cwd — it hands back a child and fires `error` on a later tick — so a
 *    start that reported success on the return of spawn would be reporting that
 *    nothing had gone wrong YET. What is reported is what the kernel said.
 *
 * ## What is NOT claimed
 *
 * The write ticket in `doors.ts` gates this endpoint and is not an
 * authorization check. It stops a page in another tab, which cannot read this
 * origin, from reaching this endpoint. It stops nothing that can run a program
 * on this machine as this user — such a program can read `/app` with `curl` and
 * take the ticket, and could equally well have run `claude` itself without
 * involving this module at all. Loopback is a fence around the machine and not
 * around the programs on it. What this file is protecting against is a browser
 * tab and a mistake, not a local adversary, and pretending otherwise would put
 * the next reader off looking for the real fence.
 */

/** The one program this module will ever start. */
const PROGRAM = 'claude'

export interface Started {
  ok: boolean
  /** Present when a process was created, whether or not it went on to do anything. */
  pid?: number
  /** The exact argv, for the page to print. Never a shell string, because there is never one. */
  argv?: string[]
  dir?: string
  /** The token to look for in `opening()` when finding this session again. */
  token?: string
  why?: string
}

/**
 * Start it, and say what the kernel said.
 *
 * `detached` with its own process group, `stdio: 'ignore'`, `unref` — the
 * session outlives this module, which is the point: closing the container must not
 * kill somebody's agent mid-edit. The consequence is that this module cannot
 * stop what it started, and it does not offer to. `claude` has its own way to
 * end a session and a button here that killed a process group would be this
 * page reaching into a window it never opened.
 *
 * The `'error'` listener is not optional politeness: an unhandled `'error'` on
 * a ChildProcess is thrown, and thrown out of a callback it would take the dev
 * server with it.
 */
export async function start(
  opts: { prompt: string; dir: string; refs: string[] },
  scope: Scope,
): Promise<Started> {
  if (!scope.dirs.length) {
    return {
      ok: false,
      why:
        `No working directory is configured, so there is nowhere to start a session. Set ${DIRS_VAR} to a ` +
        'colon-separated list of absolute paths and restart this module. There is deliberately no default: a ' +
        'guessed path is an agent editing the wrong repository.',
    }
  }
  if (!allowed(opts.dir, scope)) {
    return {
      ok: false,
      why:
        `${opts.dir || '(nothing)'} is not one of the directories this module was given. It may start a session ` +
        `in ${scope.dirs.join(', ')} and nowhere else; ${DIRS_VAR} is where that list comes from.`,
    }
  }
  const text = opts.prompt.trim()
  if (!text) return { ok: false, why: 'A session needs something to be told. Nothing was composed to send it.' }

  /* Fixed program, fixed flags, one variable argv element. See the essay above:
     this line is the whole of what may vary, and it varies as data rather than
     as syntax because it is an array element and never a string handed to a
     shell. */
  const argv = [PROGRAM, '--bg', text]

  let child: ChildProcess
  try {
    child = spawn(PROGRAM, ['--bg', text], { cwd: opts.dir, detached: true, stdio: 'ignore' })
  } catch (e) {
    return { ok: false, why: `${PROGRAM} could not be started: ${e instanceof Error ? e.message : String(e)}` }
  }

  const settled = await new Promise<string | null>((done) => {
    child.once('spawn', () => done(null))
    child.once('error', (e: Error) => done(`${PROGRAM} could not be started in ${opts.dir}: ${e.message}`))
  })
  child.unref()
  if (settled) return { ok: false, why: settled }

  return { ok: true, pid: child.pid, argv, dir: opts.dir, token: runToken(opts.refs) }
}
