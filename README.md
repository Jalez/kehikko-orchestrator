# Orchestrator

Starts Claude Code sessions on the references somebody picked, and shows what
those sessions are saying.

A Kehikko module: its own page, its own doors, its own port (7850). A host may
frame it, and then it knows what is selected and what prompt was aimed at it. It
also works with nothing else running at all — the roster and the transcripts are
read off this machine, not asked for.

```
bun install
bun run register            # writes ~/Library/Application Support/Kehikot/modules/kehikot.orchestrator.json
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
re-read when it grows (the server watches the folder while a page follows it and
tells the page over a held stream; nothing asks on a clock), drawn as turns, tool
calls and results. Not a terminal: see
`transcript.ts` for why there is no pty here.

**Starts a session.** `claude --bg --name=<title> <one prompt>`, in a directory
from an allow-list the process was started with. The prompt is shown, and
editable, before the button does anything. The title is where in kehikko the
session is from: the kehikko, the project, the epic and the parts it is for,
`Main · orch · session-titles · Titles`, shown above the prompt. No reference
numbers, states or authors. It is given once, at the start; a name a person sets
later is theirs and nothing here changes it.

## Under a pick of the epic's parts

A part of an epic lists references, and a session is about the references its
opening names. With nothing picked the roster is as it always was. With parts
picked it is the sessions on a picked part's references; a session that names
none is in no part and is back when nothing is picked. What is in hand stays:
the session whose transcript is open, and the sessions on the references a
person selected. A pick that leaves no session says one sentence where the rows
were, and nothing else on the page is about the pick. The rule is the
protocol's (`useFocus().narrow`); `src/focus.ts` says what a session is tied
to. The server is asked which references each session names (`among`) and is
never told what is picked.

## The three settings

| | |
|---|---|
| `ORCHESTRATOR_DIRS` | Colon-separated absolute paths. The directories this module may list sessions in and start one in. **No default** — unset means nothing can be started. |
| `PORT` | Where to listen. 7850. |
| `KEHIKOT_ORIGINS` | Who may frame this page (space-separated origins; `KEHIKOT_ORIGIN` is read as a fallback). Defaults to every origin a host here serves from, 4170 and 4181 among them. |

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
