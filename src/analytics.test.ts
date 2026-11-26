import { describe, expect, it } from 'vitest'
import { orderScenario, portfolio, replay } from './analytics'
import data from './demo.json'

describe('historical scoring', () => {
  it('reconciles the browser with the Python artifact', () => {
    expect(portfolio(data.products).map(r => r.error)).toEqual(data.portfolio.stages.map(r => r.error))
  })

  it('replays each yogurt transition', () => {
    expect(portfolio([data.products[0]]).map(r => r.fva)).toEqual([0, 150, 80, -180])
    expect(replay(data.products[0], 1100)).toEqual({ error: 0, fva: 20 })
  })

  it('returns null WAPE for an empty selection', () => {
    expect(portfolio([]).every(stage => stage.wape === null)).toBe(true)
  })
})

it('chooses the lowest-cost feasible order', () => {
  expect(orderScenario(10, [15, 20], 5, 1, 10)).toEqual({ order: 10, cost: 2.5, risk: 0, surplus: 2.5 })
})
