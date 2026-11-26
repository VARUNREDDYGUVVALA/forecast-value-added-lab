import data from './demo.json'

export type Product = typeof data.products[number]
export const stages = ['baseline', 'ml', 'promotion', 'override'] as const
export const stageLabels = ['Seasonal baseline', 'ML forecast', 'Promotion', 'Planner override']

export function quantity(product: Product, stage: typeof stages[number]) {
  return product[stage] ?? product.promotion
}

export function replay(product: Product, proposed: number) {
  const error = Math.abs(proposed - product.actual)
  return { error, fva: Math.abs(product.promotion - product.actual) - error }
}

export function portfolio(products: Product[]) {
  const sales = products.reduce((sum, p) => sum + p.actual, 0)
  return stages.map((stage, index) => {
    const error = products.reduce((sum, p) => sum + Math.abs(quantity(p, stage) - p.actual), 0)
    const previous = products.reduce((sum, p) => sum + Math.abs(quantity(p, stages[Math.max(0, index - 1)]) - p.actual), 0)
    return { name: stageLabels[index], error, fva: previous - error, wape: sales ? error / sales : null,
      floor: index ? Math.min(error, previous) : 0, height: index ? Math.abs(previous - error) : error }
  })
}

export function orderScenario(stock: number, samples: number[], shortageCost: number, surplusCost: number, capacity: number) {
  let best = { order: 0, cost: Infinity, risk: 0, surplus: 0 }
  for (let order = 0; order <= capacity; order += 5) {
    const available = stock + order
    const surplus = samples.reduce((sum, d) => sum + Math.max(0, available - d), 0) / samples.length
    const shortage = samples.reduce((sum, d) => sum + Math.max(0, d - available), 0) / samples.length
    const risk = samples.filter(d => d > available).length / samples.length
    const cost = surplus * surplusCost + shortage * shortageCost
    if (cost < best.cost) best = { order, cost, risk, surplus }
  }
  return best
}
