export type Regime = 'Normal trade' | 'Promotion surge' | 'Demand shift'
export const regimes: Regime[] = ['Normal trade', 'Promotion surge', 'Demand shift']
export const retention = 600
const mask = (1n << 64n) - 1n
const products = ['Greek Yogurt', 'Fresh Apples', 'Whole Wheat Bread', 'Whole Milk', 'Hass Avocado', 'Butter Croissants']

export type DemandEvent = {
  sequence: string
  product: string
  regime: Regime
  actual: number
  baseline: number
  promotion: number
  override: number
  guarded: number
  held: boolean
}

function noise(index: bigint, salt: bigint) {
  let value = (index + salt * 0x9e3779b97f4a7c15n) & mask
  value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & mask
  value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & mask
  return Number((value ^ (value >> 31n)) % 10000n) / 10000
}

export function generateDemand(sequence: bigint, regime: Regime): DemandEvent {
  const sku = Number(sequence % BigInt(products.length))
  const day = sequence / BigInt(products.length)
  const baseline = 120 + sku * 22 + (day % 7n >= 5n ? 24 : 0)
  const promoted = noise(sequence, 1n) < (regime === 'Promotion surge' ? 0.65 : 0.23)
  const promotion = baseline + (promoted ? 48 : 0)
  const planned = noise(sequence, 2n) < 0.5
  const change = planned ? Math.round((noise(sequence, 3n) - 0.28) * 115) : 0
  const override = Math.max(0, promotion + change)
  const held = Math.abs(change) > Math.max(25, promotion * 0.2)
  const guarded = held ? promotion : override
  // Resolve simulated sales after the guard has selected its candidate.
  const shift = regime === 'Demand shift' ? (sku % 2 ? 44 : -36) : 0
  const actual = Math.max(0, Math.round(promotion + shift + (noise(sequence, 4n) - 0.5) * 42))
  return { sequence: sequence.toString(), product: products[sku], regime, actual, baseline, promotion, override, guarded, held }
}

export function summarize(events: DemandEvent[]) {
  let actual = 0
  let plannerError = 0
  let shadowError = 0
  let held = 0
  let helped = 0
  let hurt = 0
  for (const event of events) {
    const planner = Math.abs(event.override - event.actual)
    const shadow = Math.abs(event.guarded - event.actual)
    actual += event.actual
    plannerError += planner
    shadowError += shadow
    held += Number(event.held)
    helped += Number(shadow < planner)
    hurt += Number(shadow > planner)
  }
  return {
    plannerWape: actual ? plannerError / actual : null,
    shadowWape: actual ? shadowError / actual : null,
    shadowFva: plannerError - shadowError,
    held, helped, hurt,
  }
}

export function advance(cursor: bigint, retained: DemandEvent[], count: number, regime: Regime) {
  if (!Number.isSafeInteger(count) || count < 0 || count > retention) throw new RangeError('Invalid batch size')
  const batch = Array.from({ length: count }, (_, i) => generateDemand(cursor + BigInt(i), regime))
  return { cursor: cursor + BigInt(count), events: [...retained, ...batch].slice(-retention) }
}
