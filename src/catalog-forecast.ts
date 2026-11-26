import trained from './catalog-model.json'

type Context = keyof typeof trained.evaluation
type Horizon = keyof typeof trained.evaluation[Context]
export const catalogEvidence = trained

export function predictCatalog(history: number[], department: string, lastWeekday: number, recentPromotion: boolean, targetPromotion: boolean, lead: number) {
  const recent = history.slice(-7)
  const scale = Math.max(1, recent.reduce((sum, units) => sum + units, 0) / recent.length)
  const tail = recent.slice(-3)
  const weekday = (lastWeekday + lead) % 7
  const features = [
    history.length / 14, lead / 14, recent[recent.length - 1] / scale,
    tail.reduce((sum, units) => sum + units, 0) / (tail.length * scale), Math.log(scale) / 14,
    Number(recentPromotion), Number(targetPromotion),
    ...trained.departments.map(value => Number(value === department)),
    ...Array.from({ length: 7 }, (_, day) => Number(weekday === day)),
    ...Array.from({ length: 7 }, (_, day) => Number(lastWeekday === day)),
  ]
  return Math.max(0, scale * features.reduce((value, feature, index) =>
    value + feature * trained.coefficients[index], trained.intercept))
}

export function compareCatalog(history: number[], department: string, horizon: number, lastWeekday: number,
  recentPromotion: boolean, targetPromotion: boolean) {
  if (!history.length || history.length > 14 || history.every(units => units === 0)) return null
  const context: Context = history.length === 14 ? '14' : history.length >= 7 ? '7' : history.length >= 3 ? '3' : '1'
  const report = trained.evaluation[context][String(horizon) as Horizon]
  if (!report) return null
  const recent = history.slice(-Number(context))
  const daily = Array.from({ length: horizon }, (_, day) =>
    predictCatalog(recent, department, lastWeekday, recentPromotion, targetPromotion, day + 1))
  return { daily, total: daily.reduce((sum, value) => sum + value, 0), report, context }
}
