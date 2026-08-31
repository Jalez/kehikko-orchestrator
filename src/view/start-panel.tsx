import { useEffect, useState } from 'react'

import { compose, type Named } from '../../compose.ts'
import { start, type Started } from '@/api/client.ts'
import { Button } from '@/components/ui/button.tsx'

/**
 * The start button, and everything a person should read before pressing it.
 *
 * ## The prompt is shown, and it is editable, and it is not composed here
 *
 * There is no prompt EDITOR in this module — no place to write a prompt from
 * scratch, no store of prompts, no template list. Prompts are the host's job:
 * the dialog belongs to the frame so it is not clipped by the iframe, and so
 * one container can aim a prompt at another. What arrives here is `context.prompt`,
 * one string the host already composed out of every container aiming at this one,
 * each fragment headed `## from <module id>`. This module does not merge
 * fragments because it never sees any.
 *
 * What this box is instead is the LAST LOOK. Somebody about to spawn an agent
 * in a repository they care about should be able to read the exact characters
 * it will be told, and change them, without leaving the container — a session
 * started on a prompt nobody read is the failure this whole panel exists to
 * prevent. So the composed text is put in a textarea, the person may edit it,
 * and what is posted is what is in the box.
 *
 * The edit is deliberately not remembered anywhere. It belongs to this press.
 * A remembered edit would be a second prompt store living in the module that
 * was told not to have one, and it would go stale against the host's the moment
 * anybody changed anything upstairs.
 *
 * ## Why a null prompt is not disabled
 *
 * `context.prompt` is null on any host that offers no prompt for this container, and
 * the protocol says a module declaring `prompt` must work when there is none.
 * So the box fills with `NO_PROMPT_FALLBACK` instead — visibly, in the same
 * place, with a line saying that is what happened. Greying the button out would
 * make an ordinary state look like a broken one.
 */

export function StartPanel({
  refs,
  prompt,
  dirs,
  scoped,
  onStarted,
}: {
  refs: Named[]
  prompt: string | null
  dirs: string[]
  scoped: boolean
  onStarted: () => void
}) {
  const composed = compose(prompt, refs)
  const [text, setText] = useState(composed.text)
  const [dir, setDir] = useState(dirs[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<Started | null>(null)

  /*
   * When the host's prompt or the selection changes, the box goes back to the
   * newly composed text.
   *
   * The alternative — keeping whatever is typed — sounds kinder and is worse:
   * the person changes the selection, the box still describes the old
   * references, and the mismatch is invisible because the box looks like it is
   * showing the current state. Losing an edit is a visible cost; sending an
   * agent at the wrong work is not.
   */
  useEffect(() => {
    setText(composed.text)
    setSaid(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the composed text itself, which is the whole input
  }, [composed.text])

  useEffect(() => {
    if (!dirs.includes(dir)) setDir(dirs[0] ?? '')
  }, [dirs, dir])

  const canStart = Boolean(dir) && text.trim().length > 0 && !busy

  return (
    <section className="min-w-0 border-t p-2">
      <h2 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Start a session</h2>

      {refs.length ? (
        <p className="mt-1 text-[11px]">
          on{' '}
          {refs.map((r, i) => (
            <span key={r.ref}>
              {i ? ', ' : ''}
              <span className="font-medium">{r.ref}</span>
              {r.kind ? <span className="text-muted-foreground"> ({r.kind})</span> : null}
            </span>
          ))}
        </p>
      ) : (
        <p className="text-muted-foreground mt-1 text-[11px]">
          Nothing is selected on the canvas, so this session would be started with no references. Pick some in another
          container and they arrive here.
        </p>
      )}

      {!composed.fromHost ? (
        <p className="text-muted-foreground mt-1 text-[10px]">
          No prompt was written for this container, so the text below is this module’s own default. Edit it, or write one in
          the host — the dialog is the frame’s, not this module’s.
        </p>
      ) : null}

      <label className="mt-1.5 block">
        <span className="sr-only">What this session will be told</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          className="said border-input bg-background focus-visible:ring-ring block w-full min-w-0 resize-y rounded-md border p-1.5 text-[11px] leading-snug focus-visible:ring-2 focus-visible:outline-none"
        />
      </label>

      {/*
        The directory is a choice among the ones this module was given, and never
        a field somebody types into. `scope.ts` has the argument: a page that can
        add a directory to its own allow-list has no allow-list, and the server
        refuses anything not on the list regardless of what this control does.
        This is the readable half of that rule, not the enforcing half.
      */}
      {dirs.length ? (
        <label className="mt-1.5 flex min-w-0 items-center gap-1.5">
          <span className="text-muted-foreground shrink-0 text-[10px]">in</span>
          <select
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            className="border-input bg-background min-w-0 flex-1 truncate rounded-md border px-1.5 py-1 text-[11px]"
          >
            {dirs.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-destructive mt-1.5 text-[11px]">
          No working directory is configured, so nothing can be started. Set <code>ORCHESTRATOR_DIRS</code> to a
          colon-separated list of absolute paths and restart this module. There is deliberately no default: a guessed
          path is an agent editing the wrong repository.
          {scoped ? null : ' The roster above is showing every session on this machine for the same reason.'}
        </p>
      )}

      <Button
        type="button"
        size="sm"
        disabled={!canStart}
        className="mt-1.5 w-full"
        onClick={() => {
          setBusy(true)
          setSaid(null)
          void start({ prompt: text, dir, refs: refs.map((r) => r.ref) })
            .then((result) => {
              setSaid(result as Started)
              if ((result as Started).ok) onStarted()
            })
            .finally(() => setBusy(false))
        }}
      >
        {busy ? 'Starting…' : 'Start'}
      </Button>

      {said ? (
        <div className="mt-1.5 min-w-0 text-[10px]">
          {said.ok ? (
            <>
              <p className="text-foreground">
                Started (pid {said.pid}). It takes a few seconds to appear on the roster — Claude Code writes its
                transcript once the session begins saying things, and that file is what this list is read from.
              </p>
              {/* The exact argv, because nobody should have to read this
                  module's source to find out what a button on a page ran. It is
                  an array and never a shell string; see `start.ts`. */}
              <pre className="said text-muted-foreground mt-1 overflow-x-auto rounded bg-muted p-1">
                {JSON.stringify(said.argv)}
              </pre>
            </>
          ) : (
            <p className="text-destructive">{said.why}</p>
          )}
        </div>
      ) : null}
    </section>
  )
}
