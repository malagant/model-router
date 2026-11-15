import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { LastTurn, Mode, Tier, Totals } from '../types'

// ---------------------------------------------------------------------------
// Modelle und Preise (USD pro 1 Mio. Tokens, Anthropic-Listenpreise, Stand 2026-11).
// Cache-Write = 1,25 × Input (5-Minuten-Cache). Hier anpassen, falls sich Preise ändern.
// ---------------------------------------------------------------------------
type Price = { input: number; output: number; cacheWrite: number; cacheRead: number }

const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus', 'fable']

const MODEL: Record<Tier, { id: string; label: string; price: Price }> = {
  haiku: { id: 'claude-haiku-5-5', label: 'Haiku 5.5', price: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 } },
  sonnet: { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', price: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 } },
  opus: { id: 'claude-opus-5-5', label: 'Opus 5.5', price: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 } },
  fable: { id: 'claude-fable-5-2', label: 'Fable 5.2', price: { input: 8, output: 40, cacheWrite: 10, cacheRead: 0.2 } },
}

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const costOf = (u: Usage, p: Price): number =>
  (u.input_tokens * p.input +
    u.output_tokens * p.output +
    u.cache_creation_input_tokens * p.cacheWrite +
    u.cache_read_input_tokens * p.cacheRead) /
  1_000_000

const tierOfModel = (model: string): Tier | null =>
  TIERS.find(t => model.toLowerCase().includes(t)) ?? null

// ---------------------------------------------------------------------------
// Routing-Heuristik: kostet selbst nichts, läuft lokal auf dem Prompt-Text.
// ---------------------------------------------------------------------------
const FABLE_WORDS = /\b(fable|maximal|bestes modell|höchste qualität|forschungs|beweis(e|en)?|proof)\b/i
const OPUS_WORDS =
  /\b(architektur|architecture|refactor\w*|migrat\w*|debug\w*|security|sicherheit\w*|analysier\w*|analy[sz]e|plan(e|ung)?|design\w*|implementier\w*|implement|optimier\w*|performance|warum|why|komplex\w*|review|race condition|deadlock|algorithm\w*|mehrere dateien|gesamte?n? (code|projekt|repo))\b/i
const HAIKU_WORDS =
  /^(hi|hallo|hey|danke|thanks|ok|ja|nein|yes|no)\b|\b(übersetz\w*|translate|tippfehler|typo|umbenenn\w*|rename|formatier\w*|format|kurz|short|was ist|what is|wie spät|zähl\w*|liste? auf|list)\b/i

export const classify = (text: string): { tier: Tier; reason: string } => {
  const t = text.trim()
  const len = t.length
  const codeBlocks = (t.match(/```/g) ?? []).length / 2
  const hasTrace = /(Traceback|Exception|Error:|at \S+:\d+|panic:)/.test(t)

  if (FABLE_WORDS.test(t)) return { tier: 'fable', reason: 'Schlüsselwort für Höchstleistung' }
  if (len > 2500 || (OPUS_WORDS.test(t) && (len > 300 || codeBlocks >= 1 || hasTrace)))
    return { tier: 'opus', reason: len > 2500 ? 'sehr lange Anfrage' : 'komplexe Aufgabe' }
  if (hasTrace || codeBlocks >= 1) return { tier: 'sonnet', reason: 'Code / Fehlermeldung' }
  if (OPUS_WORDS.test(t)) return { tier: 'sonnet', reason: 'Fachfrage, kurz' }
  if (len < 160 && (HAIKU_WORDS.test(t) || len < 40)) return { tier: 'haiku', reason: 'kurze, einfache Anfrage' }
  return { tier: 'sonnet', reason: 'Standard' }
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
const zero = (): Record<Tier, number> => ({ haiku: 0, sonnet: 0, opus: 0, fable: 0 })
const emptyTotals = (): Totals => ({ actual: 0, alt: zero(), turns: 0, routed: zero() })

const mode = atom({ plugin: 'model-router', key: 'mode' } as const, 'auto' as Mode)
const last = atom({ plugin: 'model-router', key: 'last' } as const, null as LastTurn | null)
const totals = atom({ plugin: 'model-router', key: 'totals' } as const, emptyTotals(), { shape: 'totals-1' })
const isBandHidden = atom({ plugin: 'model-router', key: 'isBandHidden' } as const, false)

const PANE = 'model-router'
const MODES: readonly Mode[] = ['auto', 'off', ...TIERS]

const usd = (n: number): string => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`)
const pct = (actual: number, ref: number): string =>
  ref <= 0 ? '–' : `${actual <= ref ? '−' : '+'}${Math.abs(Math.round((1 - actual / ref) * 100))}%`

export const register: Register = on => {
  // Pro Turn: gewähltes Modell und aufsummierte Kosten (Modulvariablen, gehen bei Reload verloren – unkritisch).
  const choice = new Map<string, { tier: Tier; reason: string }>()
  const acc = new Map<string, { cost: number; alt: Record<Tier, number>; model: string }>()
  let lastTier: Tier = 'sonnet'

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('mode')
    if (typeof saved === 'string' && (MODES as readonly string[]).includes(saved)) {
      await update($, mode, () => saved as Mode)
    }
    await $.command.register({
      name: 'router',
      description: 'Modell-Router: /router [auto|off|haiku|sonnet|opus|fable|reset] – ohne Argument öffnet den Kostenvergleich',
    })
    return next(e)
  })

  on('command.run', { command: 'router' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'reset') {
      await update($, totals, () => emptyTotals())
      await update($, last, () => null)
      return { text: 'Kostenzähler zurückgesetzt.' }
    }
    if ((MODES as readonly string[]).includes(arg)) {
      await update($, mode, () => arg as Mode)
      await $.store.set('mode', arg)
      await update($, isBandHidden, () => false)
      const what =
        arg === 'auto' ? 'automatische Auswahl' : arg === 'off' ? 'aus (Session-Modell bleibt)' : `fest auf ${MODEL[arg as Tier].label}`
      return { text: `Modell-Router: ${what}.` }
    }
    if (arg !== '') return { text: `Unbekannt: "${arg}". Erlaubt: ${MODES.join(', ')}, reset.` }
    await $.ui.open({ id: PANE, title: 'Modell-Router · Kosten' })
    return { text: 'Kostenvergleich geöffnet.' }
  })

  // Auswahl beim Start eines Haupt-Turns
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const m = await read($, mode)
    if (m === 'off') return next(e)
    let picked: { tier: Tier; reason: string }
    if (m !== 'auto') picked = { tier: m, reason: 'manuell festgelegt' }
    else if (e.text.trim() === '') picked = { tier: lastTier, reason: 'Fortsetzung' }
    else picked = classify(e.text)
    lastTier = picked.tier
    choice.set(e.turnId, picked)
    $.ui.status(`Router → ${MODEL[picked.tier].label} (${picked.reason})`)
    return next(e)
  })

  // Jede Modell-Anfrage: Modell umschreiben (nur Hauptschleife) und Kosten mitschreiben (alle Schleifen)
  on('turn.step', async function* ($, e, next) {
    const picked = e.agentId === undefined ? choice.get(e.turnId) : undefined
    const result = yield* next(picked ? { ...e, model: MODEL[picked.tier].id } : e)
    const u = result.usage
    if (u) {
      const actualTier = tierOfModel(u.model)
      const cost = actualTier ? costOf(u, MODEL[actualTier].price) : 0
      const alt = zero()
      for (const t of TIERS) alt[t] = costOf(u, MODEL[t].price)
      const a = acc.get(e.turnId) ?? { cost: 0, alt: zero(), model: u.model }
      a.cost += cost
      for (const t of TIERS) a.alt[t] += alt[t]
      a.model = u.model
      acc.set(e.turnId, a)
      await update($, totals, s => {
        const n = { ...s, actual: s.actual + cost, alt: { ...s.alt } }
        for (const t of TIERS) n.alt[t] += alt[t]
        return n
      })
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const picked = choice.get(e.turnId)
    const a = acc.get(e.turnId)
    choice.delete(e.turnId)
    acc.delete(e.turnId)
    if (e.agentId === undefined && a) {
      const turn: LastTurn = {
        tier: picked?.tier ?? null,
        reason: picked?.reason ?? 'Router aus',
        model: a.model,
        cost: a.cost,
        alt: a.alt,
      }
      await update($, last, () => turn)
      await update($, totals, s => {
        const routed = { ...s.routed }
        if (picked) routed[picked.tier] += 1
        return { ...s, turns: s.turns + 1, routed }
      })
    }
    return next(e)
  })

  // Zeile über dem Prompt
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const t = await read($, last)
    if (e.props.hasSurvey || t === null || (await read($, isBandHidden))) return next(e)
    const s = await read($, totals)
    const { Box, Button, Text } = $.ui.resolve(e)
    const label = t.tier ? MODEL[t.tier].label : t.model
    return (
      <Box>
        <Text>
          <Text bold>{label}</Text>
          <Text dimColor> ({t.reason}) · Turn {usd(t.cost)} · Session {usd(s.actual)} · Opus wäre {usd(s.alt.opus)} ({pct(s.actual, s.alt.opus)}) </Text>
        </Text>
        <Button key="details" label="Details" onPress={() => void $.ui.open({ id: PANE, title: 'Modell-Router · Kosten' })} />
        <Button key="hide" label="×" plain onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  // Pane mit dem vollen Vergleich
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const m = await read($, mode)
    const s = await read($, totals)
    const t = await read($, last)
    const setMode = (x: Mode) => async () => {
      await update($, mode, () => x)
      await $.store.set('mode', x)
    }
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Modus</Text>
          <Box flexWrap="wrap">
            {MODES.map(x => (
              <Button key={`mode-${x}`} label={x === m ? `● ${x}` : x} variant={x === m ? 'primary' : 'secondary'} onPress={setMode(x)} />
            ))}
          </Box>
        </Box>

        <Box flexDirection="column">
          <Text bold>Diese Session ({s.turns} Anfragen)</Text>
          <Text>
            Tatsächlich bezahlt: <Text bold>{usd(s.actual)}</Text>
          </Text>
          {TIERS.map(x => (
            <Text dimColor={s.alt[x] === 0}>
              {`Immer ${MODEL[x].label}:`.padEnd(20)} {usd(s.alt[x]).padStart(9)}   Ersparnis {pct(s.actual, s.alt[x])}
            </Text>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text bold>Verteilung</Text>
          <Text dimColor>
            {TIERS.map(x => `${MODEL[x].label}: ${s.routed[x]}`).join(' · ')}
          </Text>
        </Box>

        {t && (
          <Box flexDirection="column">
            <Text bold>Letzte Anfrage</Text>
            <Text>
              {t.tier ? MODEL[t.tier].label : t.model} – {t.reason} – {usd(t.cost)}
            </Text>
            <Text dimColor>{TIERS.map(x => `${MODEL[x].label} ${usd(t.alt[x])}`).join(' · ')}</Text>
          </Box>
        )}

        <Text dimColor>
          Vergleich = gleiche Token-Zahlen zu den Preisen des jeweiligen Modells (Listenpreis USD). Andere Modelle
          hätten anders lange geantwortet, und ein Modellwechsel verliert den Prompt-Cache – die Werte sind eine Schätzung.
        </Text>
        <Button key="reset" label="Zähler zurücksetzen" onPress={() => update($, totals, () => emptyTotals())} />
      </Box>
    )
  })
}
