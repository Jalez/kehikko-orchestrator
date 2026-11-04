import { useLayoutEffect, useState, type RefObject } from 'react'

import type { Box } from './model.ts'

/**
 * The size of the page's own box as the person resizes its container on the canvas — the frame,
 * not the window. Null until measured, and where there is nothing to measure with.
 */
export function useBox(element: RefObject<HTMLElement | null>): Box | null {
  const [box, setBox] = useState<Box | null>(null)
  useLayoutEffect(() => {
    const at = element.current
    if (!at || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect || (rect.width === 0 && rect.height === 0)) return
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) }
      setBox((was) => (was && was.width === next.width && was.height === next.height ? was : next))
    })
    watch.observe(at)
    return () => watch.disconnect()
  })
  return box
}
