import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * A DOM for every test file, registered once.
 *
 * The rendering tests need one and the pure ones do not care. Two suites with
 * different globals is more to reason about than one preload, and the failure
 * where a component test runs without a document is a stack trace nobody reads
 * as "wrong config".
 */
GlobalRegistrator.register()
