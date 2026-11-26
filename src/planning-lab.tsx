import { useState } from 'react'
import { ArrowRight, Calculator, PackageCheck } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { catalogEvidence, compareCatalog } from './catalog-forecast'
import { catalog, departments, parseHistory, planDemand, sampleHistory, type Item } from './planning'

const number = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })
const percent = (n: number | null) => n === null ? 'Unavailable' : (n * 100).toFixed(1) + '%'
type Draft = { text: string; sample: boolean }
type Result = { pooled: ReturnType<typeof compareCatalog>;  item: Item; history: number[]; horizon: number; stock: number; pack: number; sample: boolean; plan: ReturnType<typeof planDemand> }

export function PlanningLab() {
  const [department, setDepartment] = useState(departments[0])
  const [item, setItem] = useState(catalog[0])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [horizon, setHorizon] = useState(7)
  const [stock, setStock] = useState('40')
  const [pack, setPack] = useState('1')
  const [lastWeekday, setLastWeekday] = useState('')
  const [recentPromotion, setRecentPromotion] = useState(false)
  const [targetPromotion, setTargetPromotion] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const draft = drafts[item.id] ?? { text: '', sample: false }

  function updateDraft(next: Draft) {
    setResult(null)
    setError('')
    setDrafts(old => ({ ...old, [item.id]: next }))
  }

  function select(next: Item) {
    setItem(next)
    setError('')
    setResult(null)
  }

  function calculate() {
    setError('')
    try {
      const history = parseHistory(draft.text)
      const available = Number(stock)
      const packSize = Number(pack)
      if (!stock || !Number.isSafeInteger(available) || available < 0 || available > 1000000 ||
          !Number.isSafeInteger(packSize) || packSize < 1 || packSize > 1000000) {
        throw new Error('Use whole units for stock and a pack size of at least one.')
      }
      setResult({ item, history, horizon, stock: available, pack: packSize, sample: draft.sample,
        plan: planDemand(history, horizon, available, packSize),
        pooled: lastWeekday === '' ? null : compareCatalog(history, item.category, horizon, Number(lastWeekday),
          recentPromotion, targetPromotion) })
    } catch (issue) {
      setResult(null)
      setError(issue instanceof Error ? issue.message : 'Unable to analyze the input.')
    }
  }

  const activePooled = result?.pooled?.report.usePooled ? result.pooled : null
  const proposedOrder = result && activePooled
    ? Math.ceil(Math.max(0, Math.ceil(activePooled.total) - result.stock) / result.pack) * result.pack
    : result?.plan.order ?? 0
  const chart = result ? [
    ...result.history.slice(-28).map((value, index, values) => ({
      label: index === values.length - 1 ? 'Latest' : String(index - values.length + 1), observed: value,
      predicted: index === values.length - 1 ? value : null,
    })),
    ...(activePooled?.daily ?? result.plan.daily).map((value, index) => ({ label: '+' + (index + 1), observed: null, predicted: value })),
  ] : []

  return <>
    <div className="overview-grid planning-grid">
      <section className="panel">
        <header className="panel-head"><div><h2>Item and demand history</h2><p>{catalog.length} grocery items across {departments.length} departments</p></div><span className="stat-icon"><Calculator size={17}/></span></header>
        <form className="form-content" onSubmit={event => { event.preventDefault(); calculate() }}>
          <div className="planning-fields">
            <label>Department<select value={department} onChange={e => {
              setDepartment(e.target.value)
              select(catalog.find(candidate => candidate.category === e.target.value)!)
            }}>{departments.map(group => <option key={group}>{group}</option>)}</select></label>
            <label>Item<select aria-label="Item" value={item.id} onChange={e => select(catalog.find(candidate => candidate.id === e.target.value)!)}>
              {catalog.filter(candidate => candidate.category === department).map(candidate =>
                <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.id}</option>)}
            </select></label>
          </div>
          <label>Daily demand totals<textarea value={draft.text} onChange={e => updateDraft({ text: e.target.value, sample: false })}
            rows={5} placeholder="Example: 18, 21, 16, 24, 19, 35, 32…" aria-describedby="planning-format" /></label>
          <p id="planning-format" className="muted">Enter one or more consecutive daily totals, oldest first. Include zero-sales days and use demand estimates if stockouts hid sales. Your values stay in this browser tab.</p>
          <button className="text-button" type="button" onClick={() => {
            updateDraft({ text: sampleHistory(item).join(', '), sample: true })
          }}>Load sample history <ArrowRight size={14}/></button>
          {draft.sample && <p className="muted">Synthetic sample loaded for {item.name}.</p>}
          <div className="planning-fields plan-inputs">
            <label>Stock on hand<input type="number" min={0} max={1000000} required value={stock} onChange={e => { setStock(e.target.value); setResult(null) }} /></label>
            <label>Supplier lead time<select value={horizon} onChange={e => { setHorizon(Number(e.target.value)); setResult(null) }}>
              {[1, 2, 3, 4, 5, 6, 7, 10, 14].map(days => <option key={days} value={days}>{days} {days === 1 ? 'day' : 'days'}</option>)}
            </select></label>
            <label>Units per pack<input type="number" min={1} max={1000000} required value={pack} onChange={e => { setPack(e.target.value); setResult(null) }} /></label>
          </div>
          <details className="catalog-settings">
            <summary>Compare a model trained across 96 items</summary>
            <label>Weekday of latest observation<select value={lastWeekday} onChange={e => { setLastWeekday(e.target.value); setResult(null) }}>
              <option value="">Unknown</option>
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, index) =>
                <option key={day} value={index}>{day}</option>)}
            </select></label>
            <label><input type="checkbox" checked={recentPromotion} onChange={e => { setRecentPromotion(e.target.checked); setResult(null) }} /> Latest observation was on promotion</label>
            <label><input type="checkbox" checked={targetPromotion} onChange={e => { setTargetPromotion(e.target.checked); setResult(null) }} /> Promotion planned for the entire lead time</label>
            <p className="muted">Uses synthetic training data. Choose the latest weekday to compare forecasts for up to 14 submitted days.</p>
          </details>
          <button className="primary">Calculate plan <ArrowRight size={16} /></button>
          {error && <p className="negative" role="alert">{error}</p>}
        </form>
      </section>
      <section className="panel">
        <header className="panel-head"><div><h2>Replenishment plan</h2><p>{result ? result.item.name + ' · ' + (result.sample ? 'Synthetic sample' : 'Your demand history') : 'Enter your daily sales or load a sample to get started.'}</p></div><span className="stat-icon"><PackageCheck size={17}/></span></header>
        {result && <div className="form-content" aria-live="polite">
          <section className="planning-order"><span>Suggested order</span><strong>{number(proposedOrder)} units</strong><p>{proposedOrder ? `${number(proposedOrder / result.pack)} packs of ${number(result.pack)}` : 'Current stock meets the planning target.'}</p></section>
          <div className="result">
            <span>{result.horizon}-day demand forecast <b>{number(activePooled?.total ?? result.plan.total)} units</b></span>
            <span>Historical-error range <b>{activePooled || result.plan.lower === null || result.plan.upper === null ? 'More history needed' : `${number(result.plan.lower)}–${number(result.plan.upper)} units`}</b></span>
            <span>Stock on hand <b>{number(result.stock)} units</b></span>
            <span>Planning target <b>{number(activePooled ? Math.ceil(activePooled.total) : result.plan.target)} units</b></span>
            <span>Forecast model <b>{activePooled ? 'Shared catalog model' : result.plan.model}</b></span>
            <span>Holdout WAPE <b>{percent(activePooled ? null : result.plan.wape)}</b></span>
            {!activePooled && result.plan.selection > 0 && <span>Weekly seasonal benchmark <b>{percent(result.plan.baselineWape)}</b></span>}
          </div>
          <p>{activePooled ? 'The shared model uses your recent demand and patterns from synthetic catalog data. This order uses its point forecast. There is no measured safety buffer for your item.'
            : result.plan.upper === null
            ? result.history.length < 7
              ? 'Provisional plan. The forecast repeats your average daily demand, and there is too little history to estimate a safety buffer.'
              : 'The order uses the rounded point forecast. Add more daily history to estimate a safety buffer.'
            : 'The target uses the top of the historical-error range, then subtracts on-hand stock. The order is rounded up to a full pack.'}</p>
          {result.pooled && <div className="result">
            <strong>Shared model comparison · synthetic holdout</strong>
            <span>Shared forecast <b>{number(result.pooled.total)} units</b></span>
            <span>Per-item forecast <b>{number(result.plan.total)} units</b></span>
            <span>Shared model WAPE <b>{percent(result.pooled.report.test.pooled)}</b></span>
            <span>Per-item baseline WAPE <b>{percent(result.pooled.report.test.baseline)}</b></span>
            <p>{catalogEvidence.items} items · {result.pooled.context}-day history cohort · {number(result.pooled.report.test.windows)} matched lead-time windows. The model choice used a separate validation period.</p>
          </div>}
          <p className="muted">This estimates demand during lead time. Check incoming orders, shelf life, and supplier minimums before ordering.</p>
        </div>}
      </section>
    </div>
    {result && <section className="panel">
      <header className="panel-head"><div><h2>Demand history and forecast</h2><p>{number(result.history.length)} submitted {result.history.length === 1 ? 'day' : 'days'} · {result.plan.evaluation} chronological holdout windows</p></div></header>
      <div className="chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 10, right: 18, left: -10, bottom: 2 }}>
        <CartesianGrid vertical={false} stroke="#e8ece6" strokeDasharray="3 4" />
        <XAxis dataKey="label" minTickGap={18} tick={{ fontSize: 11, fill: '#586762' }} />
        <YAxis tick={{ fontSize: 11, fill: '#586762' }} />
        <Tooltip formatter={value => typeof value === 'number' ? number(value) + ' units' : ''} />
        <Line name="Observed" dataKey="observed" stroke="#315e50" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line name="Forecast" dataKey="predicted" stroke="#b96647" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
      </LineChart></ResponsiveContainer></div>
      <footer className="chart-foot"><span><i className="dot green" /> Observed</span><span><i className="dot orange" /> Forecast</span><span>Day 0 is the latest observation.</span></footer>
    </section>}
  </>
}
