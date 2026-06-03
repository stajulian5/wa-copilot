import { EventEmitter } from 'events'

// Shared event bus: Express OAuth callback → Electron main → renderer
export const googleAuthEvents = new EventEmitter()
