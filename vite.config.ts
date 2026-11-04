import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { doors, serves } from 'kehikot-module-protocol/serve'
import { defineConfig } from 'vite'

import { BUILD, MANIFEST, TICKET, answer } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'

/** The page and its doors on one origin, in development: the same `answer` the built server serves (`serve.ts`). */
export default defineConfig({
  base: './',
  plugins: [
    serves({ id: ID, prefer: PREFERRED_PORT }),
    doors({
      manifest: MANIFEST,
      answer: (method, path, query, body, ticket) => answer(method, path, query, body, ticket),
      build: BUILD,
      page: { title: 'Orchestrator', ticket: TICKET },
    }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
})
