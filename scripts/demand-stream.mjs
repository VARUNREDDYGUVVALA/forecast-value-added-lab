import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'
import { generateDemand, regimes } from '../src/live-engine.ts'

const { values } = parseArgs({ options: {
  start: { type: 'string', default: '0' },
  count: { type: 'string' },
  regime: { type: 'string', default: 'Normal trade' },
} })

function integer(value, name) {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a nonnegative integer`)
  return BigInt(value)
}

const start = integer(values.start, '--start')
const end = values.count === undefined ? undefined : start + integer(values.count, '--count')
if (!regimes.includes(values.regime)) throw new Error(`Regime must be one of: ${regimes.join(', ')}`)

function* batches() {
  let cursor = start
  while (end === undefined || cursor < end) {
    const lines = []
    for (let i = 0; i < 256 && (end === undefined || cursor < end); i++, cursor++) {
      lines.push(JSON.stringify(generateDemand(cursor, values.regime)))
    }
    yield lines.join('\n') + '\n'
  }
}

try {
  await pipeline(Readable.from(batches(), { objectMode: false }), process.stdout)
} catch (error) {
  if (error.code !== 'EPIPE') throw error
}
