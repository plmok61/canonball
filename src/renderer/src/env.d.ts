/// <reference types="vite/client" />
import type { CanonballApi } from '../../shared/types'

declare global {
  interface Window {
    canonball: CanonballApi
  }
}
