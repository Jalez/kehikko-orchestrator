/*
 * The client first, and the import order is the whole point.
 *
 * Importing it installs the one `message` listener this page has, and it has to
 * be installed before the frame's `load` event, because that is when the host
 * greets. React's effects run strictly after `load`, so a listener installed in
 * a component is a listener that missed the greeting. See the essay in the
 * client's `mailbox.ts`.
 *
 * It stays in the ENTRY rather than moving beside `connect`, because a module
 * scope that only a lazily-loaded chunk imports is a module scope that has not
 * run yet — the same bug wearing a bundler's clothes. The package's
 * `sideEffects` field names the client files for the same reason.
 *
 * It is listed above the React imports deliberately, and a formatter that sorts
 * imports must not be allowed to move it below something with a side effect of
 * its own.
 */
import 'roadmap-module-protocol/client'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app.tsx'
import './index.css'

/**
 * Mount, and nothing else.
 *
 * `h-full` on the document, the body and the root: this page is a frame's whole
 * contents as often as it is a tab's, and a body sized to its content inside a
 * frame leaves the transcript with no height to scroll within — so it grows
 * instead, and the host's own canvas ends up scrolling a transcript that was
 * supposed to scroll itself.
 */
document.documentElement.classList.add('h-full')
document.body.classList.add('h-full')

const root = document.getElementById('root')
if (!root) throw new Error('the page has no #root to mount into')
root.classList.add('h-full')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
