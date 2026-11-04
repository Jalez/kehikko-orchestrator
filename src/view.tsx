import { useState, type KeyboardEvent } from 'react'
import type { AgentMessage } from 'kehikot-module-protocol'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ID } from '../manifest.ts'
import {
  STATE_WORDS,
  ago,
  keyOf,
  openQuestion,
  placeWords,
  shortId,
  targetWords,
  type Target,
  type Thread,
} from './model.ts'

/**
 * What the page draws, given everything already decided (`model.ts`). Every state is said in words
 * as well as by colour; every control is a real button or field with a name.
 */

/** Answer a question: one of its choices, pressed. */
export type Choose = (question: AgentMessage, thread: Thread, choice: string) => void

export function StateBadge({ thread }: { thread: Thread }) {
  const variant = thread.state === 'asks' ? 'default' : thread.state === 'working' ? 'secondary' : 'outline'
  return (
    <Badge variant={variant} data-state={thread.state}>
      {STATE_WORDS[thread.state]}
    </Badge>
  )
}

/** A question's choices, as buttons; nothing for one already answered. */
export function Choices({ question, thread, choose, busy }: { question: AgentMessage; thread: Thread; choose: Choose; busy: boolean }) {
  if (!question.choices.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={`Answers to ${thread.name}’s question`}>
      {question.choices.map((choice) => (
        <Button key={choice} size="xs" variant="outline" disabled={busy} onClick={() => choose(question, thread, choice)} data-choice={choice}>
          {choice}
        </Button>
      ))}
    </div>
  )
}

/** The oldest waiting question, with its choices: what a container folded small shows. */
export function QuestionCard({ thread, question, choose, busy, now, onOpen }: { thread: Thread; question: AgentMessage; choose: Choose; busy: boolean; now: number; onOpen?: () => void }) {
  return (
    <article className="border-border bg-card rounded-md border p-2 text-sm" data-question={question.id} aria-label={`Question from ${thread.name}`}>
      <header className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
        <span className="text-foreground truncate font-medium">{thread.name}</span>
        <span className="truncate">{shortId(thread.ref?.session ?? '')}</span>
        <span className="ml-auto shrink-0">{ago(Date.parse(question.at), now)}</span>
      </header>
      <p className="mt-1 break-words whitespace-pre-wrap">{question.body}</p>
      <Choices question={question} thread={thread} choose={choose} busy={busy} />
      {onOpen ? (
        <Button size="xs" variant="link" className="mt-1 h-auto px-0" onClick={onOpen}>
          Answer in words
        </Button>
      ) : null}
    </article>
  )
}

export function ThreadList({ threads, open, onOpen, now }: { threads: Thread[]; open: string | null; onOpen: (key: string) => void; now: number }) {
  if (!threads.length) {
    return <p className="text-muted-foreground p-3 text-sm">No agent session has written here yet. Sessions on this kehikko are told to send their questions and reports here.</p>
  }
  return (
    <ul className="divide-border divide-y" aria-label="Agent sessions">
      {threads.map((thread) => {
        const last = thread.messages.at(-1)
        return (
          <li key={thread.key}>
            <button
              type="button"
              onClick={() => onOpen(thread.key)}
              aria-current={open === thread.key ? 'true' : undefined}
              className={cn('hover:bg-accent focus-visible:ring-ring/50 flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left outline-none focus-visible:ring-[3px]', open === thread.key && 'bg-accent')}
              data-thread={thread.key}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-medium">{thread.name}</span>
                {thread.ref ? <span className="text-muted-foreground truncate text-xs">{shortId(thread.ref.session)}</span> : null}
                <span className="ml-auto shrink-0">
                  <StateBadge thread={thread} />
                </span>
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {thread.ref ? placeWords(thread.place) : 'Messages to a place or everyone'}
                {last ? ` · ${ago(Date.parse(last.at), now)}` : ''}
              </span>
              {thread.report ? <span className="truncate text-xs">Working on: {thread.report.body}</span> : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function kindWords(message: AgentMessage): string | null {
  if (message.kind === 'question') return 'Question'
  if (message.kind === 'report') return 'Report'
  return null
}

export function ThreadView({ thread, choose, busy, now }: { thread: Thread; choose: Choose; busy: boolean; now: number }) {
  const answered = new Map(thread.questions.map((one) => [one.message.id, one.answer]))
  return (
    <section aria-label={`Conversation with ${thread.name}`} className="flex min-w-0 flex-col gap-2 p-3">
      <header className="flex min-w-0 flex-wrap items-center gap-1.5">
        <h2 className="truncate text-sm font-semibold">{thread.name}</h2>
        {thread.ref ? <span className="text-muted-foreground text-xs">session {shortId(thread.ref.session)}</span> : null}
        {thread.ref ? <span className="text-muted-foreground text-xs">· {placeWords(thread.place)}</span> : null}
        <span className="ml-auto">
          <StateBadge thread={thread} />
        </span>
      </header>
      <ol className="flex flex-col gap-2" aria-label="Messages">
        {thread.messages.map((message) => {
          const mine = message.from.module === ID
          const answer = answered.get(message.id)
          return (
            <li key={message.id} className={cn('flex min-w-0 flex-col', mine ? 'items-end' : 'items-start')} data-message={message.id}>
              <div className={cn('max-w-[90%] rounded-md px-2.5 py-1.5 text-sm', mine ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                <div className={cn('flex gap-1.5 text-[11px]', mine ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                  <span>{mine ? (message.from.person ? 'You' : 'Orchestrator') : thread.name}</span>
                  {kindWords(message) ? <span>· {kindWords(message)}</span> : null}
                  {message.replyTo !== null ? <span>· answering #{message.replyTo}</span> : null}
                  <span>· {ago(Date.parse(message.at), now)}</span>
                </div>
                <p className="break-words whitespace-pre-wrap">{message.body}</p>
                {message.kind === 'question' && !mine ? (
                  answer ? (
                    <p className="text-muted-foreground mt-1 text-xs">Answered: {answer.body}</p>
                  ) : (
                    <Choices question={message} thread={thread} choose={choose} busy={busy} />
                  )
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function Board({ threads, now }: { threads: Thread[]; now: number }) {
  const reporting = threads.filter((one) => one.report)
  return (
    <section aria-label="Working on" className="p-3">
      <h2 className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">Working on</h2>
      {reporting.length ? (
        <ul className="flex flex-col gap-1.5">
          {reporting.map((thread) => (
            <li key={thread.key} className="flex min-w-0 flex-col text-sm" data-board={thread.key}>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium">{thread.name}</span>
                <span className="text-muted-foreground truncate text-xs">{placeWords(thread.place)}</span>
                <span className="ml-auto shrink-0">
                  <StateBadge thread={thread} />
                </span>
              </span>
              <span className="break-words">{thread.report!.body}</span>
              <span className="text-muted-foreground text-xs">{ago(Date.parse(thread.report!.at), now)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No session has reported what it is working on yet.</p>
      )}
    </section>
  )
}

export interface ComposerProps {
  targets: Target[]
  target: number
  onTarget: (index: number) => void
  threads: Thread[]
  /** The question typed words would answer, in the open thread. */
  answering: AgentMessage | null
  busy: boolean
  send: (body: string) => void
  said: string | null
}

export function Composer({ targets, target, onTarget, threads, answering, busy, send, said }: ComposerProps) {
  const [text, setText] = useState('')
  const go = () => {
    const body = text.trim()
    if (!body || busy) return
    send(body)
    setText('')
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      go()
    }
  }
  return (
    <form
      className="border-border flex flex-col gap-1.5 border-t p-2"
      aria-label="Write to agent sessions"
      onSubmit={(event) => {
        event.preventDefault()
        go()
      }}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <label htmlFor="orchestrator-to" className="text-muted-foreground shrink-0">
          To
        </label>
        <select
          id="orchestrator-to"
          className="border-input bg-background focus-visible:ring-ring/50 h-7 min-w-0 flex-1 rounded-md border px-1.5 text-xs outline-none focus-visible:ring-[3px]"
          value={target}
          onChange={(event) => onTarget(Number(event.target.value))}
        >
          {targets.map((one, index) => (
            <option key={index} value={index}>
              {targetWords(one, threads)}
            </option>
          ))}
        </select>
      </div>
      {answering ? <p className="text-muted-foreground text-xs">Answers: {answering.body.length > 80 ? `${answering.body.slice(0, 79)}…` : answering.body}</p> : null}
      <div className="flex items-end gap-1.5">
        <textarea
          aria-label="Message"
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKey}
          maxLength={2000}
          placeholder="Write to the session — Enter sends, Shift+Enter is a new line"
          className="border-input bg-background focus-visible:ring-ring/50 min-h-9 min-w-0 flex-1 resize-y rounded-md border px-2 py-1.5 text-sm outline-none focus-visible:ring-[3px]"
        />
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          Send
        </Button>
      </div>
      {said ? (
        <p className="text-xs" role="status">
          {said}
        </p>
      ) : null}
    </form>
  )
}

export { keyOf, openQuestion }
