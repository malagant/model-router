import { expect, test } from 'claude-code/testing'

const usage = (model: string) => ({
  model,
  input_tokens: 1000,
  output_tokens: 1000,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
})

async function run($: any, on: any, text: string, turnId: string): Promise<string> {
  let sent = ''
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_: unknown, e: { turnId: string; index: number; model: string }) {
    sent = e.model
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: usage(e.model) }
  })
  on('turn.complete', () => ({ text: 'ok' }))
  await $.turn.start({ text, turnId })
  const s = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of s) { /* drain */ }
  await s.result
  await $.turn.complete({ turnId, reason: 'answer', isAborted: false, text: 'ok', usage: usage(sent) })
  return sent
}

test('kurze Frage geht an Haiku', async ($, on) => {
  expect(await run($, on, 'Was ist ein Monad?', 't1')).toBe('claude-haiku-5-5')
})

test('komplexe Aufgabe geht an Opus', async ($, on) => {
  const text = 'Bitte refactor die Architektur unseres Projekts: ' + 'Details. '.repeat(40)
  expect(await run($, on, text, 't2')).toBe('claude-opus-5-5')
})

test('Code mit Fehlermeldung geht an Sonnet', async ($, on) => {
  expect(await run($, on, 'Fix das:\n```\nNoMethodError: undefined method foo\n```', 't3')).toBe('claude-sonnet-5-5')
})
