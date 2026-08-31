import { describe, expect, test } from 'bun:test'
import { PROTOCOL, manifestSchema, speaks } from 'roadmap-module-protocol'

import { ID, MANIFEST, VERSION } from '../manifest.ts'

/**
 * The manifest is the only half of this program a host reads before deciding to
 * frame it, so the things a host actually looks at are asserted rather than
 * assumed. These are cheap and they catch the failure that is hardest to see
 * from inside: a module that runs perfectly and is refused at the door.
 */
describe('the manifest', () => {
  test('is what the protocol package will accept', () => {
    expect(() => manifestSchema.parse(MANIFEST)).not.toThrow()
  })

  test('claims a range that includes the protocol it was built against', () => {
    expect(speaks(MANIFEST.declares.protocol, PROTOCOL)).toBe(true)
    /* And excludes the next one. A module that claimed every future protocol
       would be claiming to speak a language nobody has written yet. */
    expect(speaks(MANIFEST.declares.protocol, PROTOCOL + 1)).toBe(false)
  })

  test('declares a prompt, which is what makes this container a target for one', () => {
    expect(MANIFEST.declares.prompt).toBe(true)
  })

  test('declares storage, which is what closes the CORS hole in manifest.ts', () => {
    /* If this ever goes false, `server.cors` has to come back in
       `vite.config.ts` or no script in the page will run — and then the write
       ticket becomes readable from any origin. The two are one decision and
       this is the assertion that says so. */
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('asks for exactly one capability, and it is the one the refs need', () => {
    expect(MANIFEST.declares.uses).toEqual(['live:read'])
  })

  test('names no MCP door', () => {
    /* Deliberate. The one thing this module can do that nothing else can is
       start a process, and an MCP tool for that is an agent spawning agents
       with nobody in the room. */
    expect(MANIFEST.mcp).toBeUndefined()
  })

  test('is entered at /app, on its own origin', () => {
    expect(MANIFEST.entry).toBe('/app')
    expect(MANIFEST.id).toBe(ID)
    expect(MANIFEST.version).toBe(VERSION)
  })
})
