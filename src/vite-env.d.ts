/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Set by the deploy workflow (github.sha) — undefined in local dev.
  readonly VITE_COMMIT_SHA?: string
}
