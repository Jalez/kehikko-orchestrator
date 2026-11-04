# Orchestrator

The person's one place to talk with their agent sessions: answer their questions, message them, and
see what each is working on.

A Kehikot module: its own page and doors, on its own port (7850). Everything it shows and sends goes
through the host's messages (protocol 2.50.0), which the host keeps on this machine.

```
bun install
bun run register            # writes ~/Library/Application Support/Kehikot/modules/kehikot.orchestrator.json
./run.sh
```

## What it does

**Tells the sessions.** Every agent session on a kehikko the Orchestrator is on is told, in its notes,
to send its questions, decisions and progress reports here: `send_message` to
`{module: "kehikot.orchestrator"}`, with `kind: "question"` (and up to six short `choices`) or
`kind: "report"`. Sessions that were already running hear it too: the notes repeat a module's changed
words, and the Orchestrator introduces itself once to each session at its kehikko (`messages.post` with
`once`; the host hands each session at most one introduction, ever, and also reaches sessions that come
to the kehikko later). The first time the person writes to a session that never wrote here, that
introduction goes first.

**Shows the conversations.** One thread per agent session (who, where, whether it waits for you, works
or is quiet), questions waiting first, a question's choices as buttons. A board of what each session
last reported working on.

**Sends as the person.** A choice pressed, or words typed to one session, a place (this kehikko, this
epic) or every session, go as the person's own message (`messages.say`): the host marks it as theirs
and the receiving agent module types it into the session framed "[Message from your person via
Orchestrator]". The host sends one only on a press in this page, and only once the person has turned
on **Send messages to agent sessions as you** in Kehikot's Settings › Modules › Orchestrator — off by
default. No agent can send as the person.

**Asks for attention only for questions.** Each unanswered question is a needs-you item in Kehikot's
Inbox, withdrawn when it is answered. Reports never ask for attention.

**Rows.** The header picks what is shown (all sessions, questions, or what they work on). The footer
says how many questions wait and how many agents work, so a container folded to two rows still says it.
The page fits its container: one question with its choices when it is small, one column when narrow, the
threads beside the open conversation and the board when there is room.

## What it keeps

`~/Library/Application Support/Kehikot/orchestrator/` (`KEHIKOT_ORCHESTRATOR_DIR` elsewhere): the
setting, and which sessions it has introduced itself to per project. Nothing in a project: sessions are
this computer's.

## Tests

```
bun run typecheck
bun test
```
