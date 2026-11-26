import { expect, it } from 'vitest'
import { advance, generateDemand, retention, summarize } from './live-engine'

it('resumes deterministically beyond JavaScript safe integer range', () => {
  const start = 9007199254740999n
  const full = advance(start, [], 8, 'Demand shift')
  const first = advance(start, [], 3, 'Demand shift')
  expect(advance(first.cursor, first.events, 5, 'Demand shift')).toEqual(full)
  expect(full.events[7].sequence).toBe('9007199254741006')
})

it('retains only the rolling window and preserves the active regime on each event', () => {
  const first = advance(0n, [], retention, 'Normal trade')
  const next = advance(first.cursor, first.events, 10, 'Promotion surge')
  expect(next.cursor).toBe(610n)
  expect(next.events).toHaveLength(retention)
  expect(next.events[0].sequence).toBe('10')
  expect(next.events.at(-1)?.regime).toBe('Promotion surge')
})

it('measures improvement and harm from withholding overrides on the same events', () => {
  const fixture = generateDemand(0n, 'Normal trade')
  const report = summarize([
    { ...fixture, actual: 100, override: 140, guarded: 100, held: true },
    { ...fixture, actual: 100, override: 100, guarded: 130, held: true },
  ])
  expect(report).toEqual({ plannerWape: 0.2, shadowWape: 0.15, shadowFva: 10, held: 2, helped: 1, hurt: 1 })
  expect(summarize([]).plannerWape).toBeNull()
})
