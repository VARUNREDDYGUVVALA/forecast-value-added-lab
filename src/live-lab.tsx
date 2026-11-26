import { useEffect, useState } from 'react'
import { Activity, Pause, Play, RotateCcw, ShieldCheck } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { advance, regimes, retention, streamItemCount, summarize, type Regime } from './live-engine'

const percent = (v: number | null) => v === null ? '—' : (100 * v).toFixed(1) + '%'
const batchSizes = [1, 10, 100]

export function LiveLab() {
  const [regime, setRegime] = useState<Regime>('Normal trade')
  const [speed, setSpeed] = useState(10)
  const [running, setRunning] = useState(true)
  const [stream, setStream] = useState(() => advance(0n, [], streamItemCount, 'Normal trade'))
  const [view, setView] = useState('item')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setStream(old => advance(old.cursor, old.events, speed, regime)), 1000)
    return () => window.clearInterval(timer)
  }, [regime, running, speed])

  const latestByItem = new Map(stream.events.map(event => [event.sku, event]))
  const rows = view === 'item'
    ? [...latestByItem.values()].sort((left, right) => left.sku.localeCompare(right.sku))
    : stream.events.slice(-24).reverse()
  const filter = query.trim().toLowerCase()
  const visible = rows.filter(event => [event.sku, event.product, event.department].some(value => value.toLowerCase().includes(filter)))
  const result = summarize(stream.events)
  const cohorts = regimes.map(name => {
    const events = stream.events.filter(event => event.regime === name)
    return { name, count: events.length, ...summarize(events) }
  }).filter(cohort => cohort.count > 0)
  const trends = Array.from({ length: Math.ceil(stream.events.length / 20) }, (_, index) => {
    const chunk = stream.events.slice(index * 20, index * 20 + 20)
    const summary = summarize(chunk)
    return { sequence: chunk.at(-1)?.sequence, planner: (summary.plannerWape ?? 0) * 100, shadow: (summary.shadowWape ?? 0) * 100 }
  })

  return <>
    <section className="panel stream-controls">
      <div className="stream-state"><Activity size={18} /><strong>{running ? 'Stream running' : 'Stream paused'}</strong><span>{streamItemCount} synthetic items</span></div>
      <label>Demand regime <select value={regime} onChange={e => setRegime(e.target.value as Regime)}>
        {regimes.map(item => <option key={item}>{item}</option>)}
      </select></label>
      <label>Events per second <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
        {batchSizes.map(item => <option key={item}>{item}</option>)}
      </select></label>
      <button className="primary" onClick={() => setRunning(!running)}>{running ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Resume</>}</button>
      <button className="icon-button" aria-label="Reset stream" onClick={() => setStream(advance(0n, [], 0, regime))}><RotateCcw size={18}/></button>
    </section>
    <div className="stat-grid">
      {[
        ['Events generated', stream.cursor.toLocaleString(), `${stream.events.length} of ${retention} retained`],
        ['Original planner WAPE', percent(result.plannerWape), 'Rolling matched window'],
        ['Guardrail WAPE', percent(result.shadowWape), `${result.held} overrides held for review`],
        ['Guardrail FVA', (result.shadowFva > 0 ? '+' : '') + result.shadowFva.toLocaleString(), `${result.helped} improved · ${result.hurt} worsened`],
      ].map(([label, value, detail]) => <section className="stat" key={label}><div className="stat-top">{label}</div><strong>{value}</strong><small>{detail}</small></section>)}
    </div>
    <div className="overview-grid">
      <section className="panel"><header className="panel-head"><div><h2>Accuracy under changing demand</h2><p>WAPE per batch of 20 observed events</p></div></header>
        <div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trends} margin={{ top: 12, right: 15, left: -12, bottom: 3 }}>
          <CartesianGrid vertical={false} stroke="#e8ece6" strokeDasharray="3 4" />
          <XAxis dataKey="sequence" minTickGap={28} tick={{ fontSize: 11, fill: '#586762' }} />
          <YAxis tickFormatter={v => v + '%'} tick={{ fontSize: 11, fill: '#586762' }} />
          <Tooltip formatter={value => typeof value === 'number' ? value.toFixed(1) + '%' : ''} />
          <Area dataKey="planner" name="Original planner" stroke="#bd684f" fill="#f6dfd4" isAnimationActive={false} />
          <Area dataKey="shadow" name="Guardrail" stroke="#38765f" fill="#cbe6d6" isAnimationActive={false} />
        </AreaChart></ResponsiveContainer></div>
        <footer className="chart-foot"><span><i className="dot orange" /> Original planner</span><span><i className="dot green" /> Guardrail</span></footer>
      </section>
      <section className="panel"><header className="panel-head"><div><h2>Override guardrail</h2><p>Shadow evaluation</p></div><span className="stat-icon"><ShieldCheck size={18} /></span></header><div className="form-content">
        <p>Flag changes larger than 20% of the promotion forecast or 25 units, whichever is greater. The shadow forecast carries the promotion version forward when a change is flagged.</p>
        <p>Both strategies are scored after simulated sales arrive. Positive FVA means the guardrail removed absolute error. It can also hold helpful overrides during demand shifts.</p>
      </div></section>
    </div>
    <section className="panel"><header className="panel-head"><div><h2>Guardrail performance by regime</h2><p>Matched comparisons within the retained window</p></div></header><div className="table-wrap"><table>
      <thead><tr><th>Regime</th><th>Matched</th><th>Held</th><th>Improved</th><th>Worsened</th><th>FVA (units)</th></tr></thead>
      <tbody>{cohorts.map(row => <tr key={row.name}><td>{row.name}</td><td>{row.count}</td><td>{row.held}</td><td>{row.helped}</td><td>{row.hurt}</td><td>{row.shadowFva > 0 ? '+' : ''}{row.shadowFva.toLocaleString()}</td></tr>)}</tbody>
    </table></div></section>
    <section className="panel">
      <header className="panel-head"><div><h2>Latest observed events</h2><p>{visible.length} of {rows.length} rows · {latestByItem.size} of {streamItemCount} items represented</p></div></header>
      <div className="live-table-tools">
        <label>Search items <input type="search" value={query} placeholder="Item, department, or SKU" onChange={e => setQuery(e.target.value)} /></label>
        <label>Event view <select value={view} onChange={e => setView(e.target.value)}><option value="item">Latest per item</option><option value="recent">24 newest events</option></select></label>
      </div>
      <div className="table-wrap live-table" tabIndex={0} role="region" aria-label="Live demand events">
        <table>
          <thead><tr><th>Event</th><th>Product</th><th>Department</th><th>Regime</th><th>Planner</th><th>Guardrail</th><th>Actual</th><th>Decision</th></tr></thead>
          <tbody>{visible.map(e => <tr key={e.sequence}><td>{e.sequence}</td><td>{e.product} <small className="muted">{e.sku}</small></td><td>{e.department}</td><td>{e.regime}</td><td>{e.override}</td><td>{e.guarded}</td><td>{e.actual}</td><td><span className={'metric ' + (e.held ? 'negative' : 'neutral')}>{e.held ? 'Held for review' : 'Carried through'}</span></td></tr>)}</tbody>
        </table>
      </div>
      {!visible.length && <p className="form-content muted">{rows.length ? 'No items match your search.' : 'Waiting for new events.'}</p>}
    </section>
  </>
}
