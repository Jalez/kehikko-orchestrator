# Orchestrator

Starts Claude Code sessions on the references somebody picked, and shows what
those sessions are saying.

A Kehikko module: its own page, its own doors, its own port (7850). A host may
frame it, and then it knows what is selected and what prompt was aimed at it. It
also works with nothing else running at all — the roster and the transcripts are
read off this machine, not asked for.

```
bun install
bun run register            # writes ~/.roadmap/modules/roadmap.orchestrator.json
ORCHESTRATOR_DIRS=/path/to/a/working/copy ./run.sh
```

## What it does

**Lists sessions.** From `claude agents --json --all`, read rather than
declared: a session that never announced itself to anything is still on the
list, and one that died drops off. Filtered to `ORCHESTRATOR_DIRS` when that is
set, and unfiltered when it is not — the page says which.

**Filters by the selection.** `context.selection` arrives from the host as refs
and nothing else. A session is "on" a reference if the reference is named in the
words it was started with, which is read from its transcript's opening prompt
and never edited afterwards.

**Follows a transcript.** Claude Code's own JSONL under `~/.claude/projects`,
polled, drawn as turns, tool calls and results. Not a terminal: see
`transcript.ts` for why there is no pty here.

**Starts a session.** `claude --bg <one prompt>`, in a directory from an
allow-list the process was started with. The prompt is shown, and editable,
before the button does anything.

## The three settings

| | |
|---|---|
| `ORCHESTRATOR_DIRS` | Colon-separated absolute paths. The directories this module may list sessions in and start one in. **No default** — unset means nothing can be started. |
| `PORT` | Where to listen. 7850. |
| `ROADMAP_ORIGIN` | Who may frame this page. Defaults to the host on 4181. |

## Where the arguments are

Nothing here is obvious, and the reasoning is in the code rather than in this
file. The four worth reading before changing anything:

- `manifest.ts` — why this module declares `storage` when References does not,
  and what a permissive `Access-Control-Allow-Origin` would cost a module that
  takes a write like this one's.
- `start.ts` — the rules around turning an HTTP request into a process. Read the
  opening twice.
- `scope.ts` — why the allow-list is one list for two jobs, and why it can only
  come from the environment.
- `src/wire/mailbox.ts` — the greeting race, which has cost this codebase days.

## Tests

```
bun run typecheck
bun test
```

`test/runtime.test.ts` is the odd one: it greps the server files for `Bun.*`
APIs. The dev server is a **node** process (`bunx vite` execs the `vite` bin,
whose shebang is node) while the tests run under bun, so a `Bun.spawn` here
passes every test and returns nothing at runtime. It did.
