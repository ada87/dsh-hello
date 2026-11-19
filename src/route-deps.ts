import type { Config } from './config.js'
import type { DeviceStore } from './devices.js'
import type { HostContext } from './host.js'
import type { InteractionBroker } from './interactions.js'
import type { PairingManager } from './pairing.js'
import type { PushManager } from './push.js'
import type { SessionFacade } from './sessions.js'
import type { SseHub } from './streams.js'
import type { TerminalManager } from './terminal.js'

/** Everything a route group may read; assembled once in `index.ts`. */
export interface RouteDependencies {
  config: Config
  ctx: HostContext
  devices: DeviceStore
  pairing: PairingManager
  hub: SseHub
  interactions: InteractionBroker
  push: PushManager
  sessions: SessionFacade
  terminals: TerminalManager
  logger: {
    info(message: string): void
    warn(message: string): void
    debug?(message: string): void
  }
  version: { version: string | null; compatible: boolean }
  pluginVersion: string
  /**
   * Authenticated Web UI URL for this process, or `null` when the Host does not
   * expose one. The app opens it to hand a pending interaction to the browser.
   */
  webUrl?: () => string | null
  /** Persist and apply a new approvals/questions policy for this Host. */
  saveInteractionTarget?: (target: Config['interactionTarget']) => Promise<void>
  /** The policy currently in force (stored override or the config default). */
  interactionTarget?: () => Config['interactionTarget']
}
