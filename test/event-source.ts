/**
 * A stand-in for the browser's `EventSource`, registered for every test file by `setup.ts`.
 *
 * It plays this module's server: every stream opens and sends its first piece of news at once (the
 * `initial` the real server sends), and a test sends more with `tell`. Nothing is fetched; what each
 * page opened is in `sources`.
 */
export class FakeEventSource {
  static readonly sources: FakeEventSource[] = []
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  constructor(readonly url: string) {
    FakeEventSource.sources.push(this)
    /* A microtask rather than a timer, so a test counting the page's timers counts none of these. */
    queueMicrotask(() => {
      if (this.readyState === 2) return
      this.readyState = 1
      this.onopen?.(new Event('open'))
      this.send({ changed: true })
    })
  }
  addEventListener(): void {}
  close(): void {
    this.readyState = 2
  }
  send(data: unknown): void {
    if (this.readyState === 1) this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
}

/** The streams still open whose URL starts with `path`. */
export const openOn = (path: string) => FakeEventSource.sources.filter((one) => one.readyState !== 2 && one.url.startsWith(path))

/** Send news to every open stream on `path`, as the server's `publish` does. */
export function tell(path: string, data: unknown = { changed: true }): number {
  const open = openOn(path)
  for (const one of open) one.send(data)
  return open.length
}
