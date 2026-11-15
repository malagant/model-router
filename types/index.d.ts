export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable'
export type Mode = 'auto' | 'off' | Tier

export type LastTurn = {
  tier: Tier | null
  reason: string
  model: string
  cost: number
  alt: Record<Tier, number>
}

export type Totals = {
  actual: number
  alt: Record<Tier, number>
  turns: number
  routed: Record<Tier, number>
}

declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      mode: Mode
      last: LastTurn | null
      totals: Shaped<Totals>
      isBandHidden: boolean
    }
  }
}
