const groups = {
  Produce: ['Bananas', 'Gala Apples', 'Hass Avocados', 'Roma Tomatoes', 'Carrots', 'Baby Spinach', 'Strawberries', 'Blueberries', 'Broccoli', 'Yellow Onions', 'Russet Potatoes', 'Cucumbers'],
  Dairy: ['Whole Milk', '2% Milk', 'Greek Yogurt', 'Vanilla Yogurt', 'Salted Butter', 'Cheddar Cheese', 'Mozzarella', 'Cottage Cheese', 'Large Eggs', 'Heavy Cream', 'Sour Cream', 'Oat Milk'],
  Bakery: ['Whole Wheat Bread', 'Sourdough Loaf', 'White Sandwich Bread', 'Butter Croissants', 'Plain Bagels', 'English Muffins', 'Brioche Buns', 'Flour Tortillas', 'Pita Bread', 'Blueberry Muffins', 'Dinner Rolls', 'Baguettes'],
  Frozen: ['Frozen Peas', 'Frozen Corn', 'Frozen Broccoli', 'Frozen Blueberries', 'Mixed Berries', 'Cheese Pizza', 'Pepperoni Pizza', 'Vanilla Ice Cream', 'Chocolate Ice Cream', 'Hash Browns', 'Potato Fries', 'Chicken Nuggets'],
  Pantry: ['Long Grain Rice', 'Jasmine Rice', 'Spaghetti', 'Penne', 'Canned Chickpeas', 'Black Beans', 'Diced Tomatoes', 'Chicken Broth', 'Olive Oil', 'Peanut Butter', 'Rolled Oats', 'All-Purpose Flour'],
  Proteins: ['Chicken Breast', 'Chicken Thighs', 'Ground Turkey', 'Ground Beef', 'Pork Chops', 'Salmon Fillets', 'Shrimp', 'Firm Tofu', 'Smoked Sausage', 'Deli Turkey', 'Deli Ham', 'Tempeh'],
  Beverages: ['Orange Juice', 'Apple Juice', 'Sparkling Water', 'Still Water', 'Cold Brew Coffee', 'Black Tea', 'Green Tea', 'Ginger Ale', 'Cola', 'Lemonade', 'Coconut Water', 'Sports Drink'],
  Snacks: ['Tortilla Chips', 'Potato Chips', 'Pretzels', 'Salted Almonds', 'Cashews', 'Trail Mix', 'Granola Bars', 'Popcorn', 'Rice Cakes', 'Hummus', 'Salsa', 'Dark Chocolate'],
}
export const catalog = Object.entries(groups).flatMap(([category, names], group) =>
  names.map((name, index) => ({ id: `SKU-${101 + group * 12 + index}`, name, category, index: group * 12 + index })),
)
export const departments = Object.keys(groups)
export type Item = typeof catalog[number]

export function sampleHistory(item: Item) {
  return Array.from({ length: 56 }, (_, day) => {
    const base = 9 + (item.index * 7) % 83
    const weekend = day % 7 >= 5 ? 0.34 * base : 0
    const noise = ((day * 59 + item.index * 13) % 19 - 9) * 0.7
    return Math.max(0, Math.round(base + weekend + noise + day * (item.index % 5 - 1) * 0.15))
  })
}

export function parseHistory(text: string) {
  const input = text.trim()
  if (!input) throw new Error('Enter at least 14 daily totals, oldest first.')
  if (input.length > 12000) throw new Error('Paste up to 365 daily totals.')
  const tokens = input.split(/[\s,;]+/)
  if (tokens.some(token => !/^\d{1,7}$/.test(token) || Number(token) > 1000000)) {
    throw new Error('Use whole numbers from 0 to 1,000,000. Separate daily totals with commas, spaces, or new lines.')
  }
  if (tokens.length < 14 || tokens.length > 365) throw new Error('Enter between 14 and 365 daily totals.')
  return tokens.map(Number)
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const models = ['Weekly seasonal', 'Recent average', 'Damped trend'] as const
type Model = typeof models[number]

function predict(history: number[], horizon: number, model: Model) {
  const week = history.slice(-7)
  const recent = mean(week)
  const dailyTrend = (recent - mean(history.slice(-14, -7))) / 7
  return Array.from({ length: horizon }, (_, day) => {
    if (model === 'Weekly seasonal') return week[day % 7]
    if (model === 'Recent average') return recent
    return Math.max(0, recent + dailyTrend * (day + 1) * 0.7)
  })
}

export function planDemand(history: number[], horizon: number, stock: number, pack: number) {
  const origins = Array.from({ length: Math.max(0, history.length - horizon - 13) }, (_, index) => index + 14).slice(-56)
  const eligible = origins.length >= 8
  const split = eligible ? Math.floor(origins.length * 0.65) : 0
  // Keep target periods used for model selection disjoint from the evaluation targets.
  const evaluation = eligible ? origins.slice(split) : []
  const selection = eligible ? origins.slice(0, split).filter(origin => origin + horizon <= evaluation[0]) : []
  const errors = (model: Model, indexes: number[]) => indexes.map(origin =>
    sum(history.slice(origin, origin + horizon)) - sum(predict(history.slice(0, origin), horizon, model)),
  )
  const model = selection.length ? [...models].sort((a, b) =>
    sum(errors(a, selection).map(Math.abs)) - sum(errors(b, selection).map(Math.abs)),
  )[0] : models[0]
  const daily = predict(history, horizon, model)
  const total = sum(daily)
  const residuals = errors(model, evaluation).map(Math.abs).sort((a, b) => a - b)
  const baseline = errors(models[0], evaluation)
  const actual = sum(evaluation.map(origin => sum(history.slice(origin, origin + horizon))))
  const spread = residuals.length >= 8 ? residuals[Math.ceil(residuals.length * 0.9) - 1] : null
  const upper = spread === null ? null : Math.ceil(total + spread)
  const lower = spread === null ? null : Math.max(0, Math.floor(total - spread))
  const target = upper ?? Math.ceil(total)
  return {
    daily, total, lower, upper, model, evaluation: evaluation.length, selection: selection.length,
    wape: actual ? sum(residuals) / actual : null,
    baselineWape: actual ? sum(baseline.map(Math.abs)) / actual : null,
    order: Math.ceil(Math.max(0, target - stock) / pack) * pack,
    target,
  }
}
