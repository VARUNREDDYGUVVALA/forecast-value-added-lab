import { describe, expect, it } from 'vitest'
import { catalog, departments, parseHistory, planDemand, sampleHistory } from './planning'

describe('demand planner', () => {
  it('has 96 unique items across eight departments with usable samples', () => {
    expect(catalog).toHaveLength(96)
    expect(new Set(catalog.map(item => item.id)).size).toBe(96)
    expect(departments).toHaveLength(8)
    for (const item of catalog) expect(parseHistory(sampleHistory(item).join(', '))).toHaveLength(56)
  })

  it('parses units and rejects invalid or insufficient input', () => {
    const values = Array.from({ length: 14 }, (_, day) => day)
    expect(parseHistory(values.join(' ;\n'))).toEqual(values)
    expect(() => parseHistory('2, -5, 4')).toThrow(/whole numbers/)
    expect(parseHistory('0 1')).toEqual([0, 1])
    expect(() => parseHistory(' , ; ')).toThrow(/at least one/)
  })

  it('forecasts the lead-time total and rounds a stock gap up to a full pack', () => {
    const plan = planDemand(Array(14).fill(20), 7, 40, 12)
    expect(plan.total).toBe(140)
    expect(plan.order).toBe(108)
    expect(plan.upper).toBeNull()
    expect(planDemand(Array(14).fill(20), 7, 200, 12).order).toBe(0)
  })

  it('uses a provisional average with one day and accepts long histories', () => {
    const plan = planDemand(parseHistory('45'), 7, 20, 7)
    expect(plan.total).toBe(315)
    expect(plan.order).toBe(301)
    expect(plan.wape).toBeNull()
    expect(plan.upper).toBeNull()
    expect(plan.model).toBe('Recent average')
    const history = parseHistory('45 '.repeat(100_000))
    expect(history).toHaveLength(100_000)
    expect(planDemand(history, 7, 20, 7).total).toBe(315)
  })

  it('learns weekly patterns and avoids division by zero on zero demand', () => {
    const history = Array.from({ length: 56 }, (_, day) => day % 7 + 10)
    const plan = planDemand(history, 7, 0, 1)
    expect(plan.daily).toEqual([10, 11, 12, 13, 14, 15, 16])
    expect(plan.wape).toBe(0)
    expect(plan.upper).toBe(91)
    expect(planDemand(Array(56).fill(0), 7, 0, 1).wape).toBeNull()
  })
})
