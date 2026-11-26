import { expect, it } from 'vitest'
import { catalogEvidence, compareCatalog, predictCatalog } from './catalog-forecast'

it('matches the training runtime for a promoted forecast', () => {
  expect(predictCatalog([24, 30, 38], 'Produce', 3, false, true, 3)).toBeCloseTo(catalogEvidence.check, 5)
})

it('reports chronological holdout evidence with the corresponding lead time and short-history cohort', () => {
  const comparison = compareCatalog([45], 'Dairy', 7, 5, false, false)
  expect(comparison?.daily).toHaveLength(7)
  expect(comparison?.report).toEqual(catalogEvidence.evaluation['1']['7'])
  expect(comparison?.report.test.pooled).toBeLessThan(comparison!.report.test.baseline)
  expect(compareCatalog(Array(15).fill(45), 'Dairy', 7, 5, false, false)).toBeNull()
  expect(compareCatalog([0], 'Dairy', 7, 5, false, false)).toBeNull()
})
