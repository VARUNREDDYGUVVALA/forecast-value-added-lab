import { useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Boxes, ChartNoAxesCombined, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Database, Filter, GitBranch, LayoutDashboard, Menu, PackageSearch, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell, LabelList } from 'recharts'
import data from './demo.json'
import { orderScenario, portfolio, quantity, replay, stageLabels, stages, type Product } from './analytics'
import { LiveLab } from './live-lab'
import './style.css'

const nav = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'FVA scorecard', icon: BarChart3 },
  { label: 'Forecast explorer', icon: ChartNoAxesCombined }, { label: 'Planner overrides', icon: SlidersHorizontal },
  { label: 'Live demand lab', icon: Activity }, { label: 'Inventory risk', icon: Boxes }, { label: 'Forecast copilot', icon: Sparkles },
  { label: 'Model analytics', icon: Activity }, { label: 'Agent monitor', icon: GitBranch },
  { label: 'Audit history', icon: ClipboardList },
]
const categories = ['All categories', ...new Set(data.products.map(p => p.category))]
const format = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 })
const signed = (value: number) => value ? (value > 0 ? '+' : '−') + format(Math.abs(value)) : '0'
const pct = (value: number | null) => value === null ? '—' : (value * 100).toFixed(1) + '%'
const tone = (value: number) => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
const overrideFva = (p: Product) => replay(p, p.override ?? p.promotion).fva
type Decision = { id: string; sku: string; name: string; units: number; fva: number; at: string; status: 'Proposed' | 'Approved locally' }
type Investigation = { sku: string; stage: string; before: number; after: number; at: string;
  trace: string[]; policy?: { id: string; revision: number; text: string } }
const useApi = import.meta.env.VITE_USE_API === 'true'
const auditKey = 'fva-lab:decisions:v1'

function loadDecisions(): Decision[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(auditKey) ?? '[]')
    return Array.isArray(saved) ? saved : []
  } catch { return [] }
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="panel"><header className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>{children}</section>
}

function Waterfall({ products }: { products: Product[] }) {
  const rows = portfolio(products)
  const first = rows[0].error
  const final = rows[3].error
  const chart = [...rows.map((row, index) => ({
    ...row, name: ['Baseline', 'ML forecast', 'Promotion', 'Override'][index],
    label: index ? signed(row.fva) : format(row.error),
    color: index === 0 ? '#8a9b92' : row.fva < 0 ? '#d98466' : '#63a889',
  })), { name: 'Final error', error: final, floor: 0, height: final, fva: 0, label: format(final), color: '#245c4b', wape: rows[3].wape }]
  return <Panel title="Forecast error waterfall" subtitle="Change in absolute error at each planning stage" action={<span className="chart-unit">Units</span>}>
    <div className="chart" role="img" aria-label={chart.map(row => row.name + ' ' + row.label).join(', ')}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chart} margin={{ top: 24, right: 12, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e8ece6" strokeDasharray="3 4" />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tickMargin={11} tick={{ fontSize: 11, fill: '#586762' }} />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#687671' }} allowDecimals={false} />
          <Tooltip cursor={{ fill: '#e8f2eb55' }} content={({ active, payload }) => active && payload?.length ? <div className="chart-tip"><strong>{payload[0].payload.name}</strong><br />{format(payload[0].payload.error)} units absolute error</div> : null} />
          <Bar dataKey="floor" stackId="error" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="height" stackId="error" maxBarSize={52} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {chart.map(row => <Cell key={row.name} fill={row.color} />)}
            <LabelList dataKey="label" position="top" fill="#263a32" fontSize={12} fontWeight={700} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <footer className="chart-foot"><span><i className="dot green" /> Error reduced</span><span><i className="dot orange" /> Error added</span><strong>{first ? pct((first - final) / first) + ' below baseline' : 'Baseline error is zero'}</strong></footer>
  </Panel>
}

function ProductTable({ products, open }: { products: Product[]; open: (p: Product) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Actual sales</th><th>Override FVA</th><th><span className="sr-only">Open</span></th></tr></thead>
    <tbody>{products.map(p => <tr key={p.sku}><td><button className="product-button" onClick={() => open(p)}><span className={'product-icon ' + p.category.toLowerCase()}><PackageSearch size={17} /></span><span><strong>{p.name}</strong><small>{p.sku}</small></span></button></td><td>{p.category}</td><td>{format(p.actual)} units</td><td>{p.override === null ? <span className="muted">Carried forward</span> : <span className={'metric ' + tone(overrideFva(p))}>{signed(overrideFva(p))} units</span>}</td><td><button className="icon-button" aria-label={'Open ' + p.name} onClick={() => open(p)}><ChevronRight size={17} /></button></td></tr>)}</tbody></table></div>
}

function App() {
  const [page, setPage] = useState('Overview')
  const [category, setCategory] = useState(categories[0])
  const [selected, setSelected] = useState(data.products[0])
  const [units, setUnits] = useState(1300)
  const [stock, setStock] = useState(65)
  const [capacity, setCapacity] = useState(60)
  const [shortageCost, setShortageCost] = useState(5)
  const [overrideOnly, setOverrideOnly] = useState(false)
  const [decisionList, setDecisions] = useState(loadDecisions)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [question, setQuestion] = useState(3)
  const [investigation, setInvestigation] = useState<Investigation | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [help, setHelp] = useState(false)
  const selectedProducts = data.products.filter(p => category === categories[0] || p.category === category)
  const overrides = selectedProducts.filter(p => p.override !== null)
  const rows = portfolio(selectedProducts)
  const sample = replay(selected, units)

  function go(next: string) {
    setPage(next)
    setNotice('')
    setMobileNav(false)
    window.scrollTo(0, 0)
  }

  function selectProduct(p: Product) {
    setSelected(p)
    setUnits(p.override ?? p.promotion)
  }

  function open(p: Product) {
    selectProduct(p)
    go('Forecast explorer')
  }

  function persist(next: Decision[], success: string) {
    try {
      localStorage.setItem(auditKey, JSON.stringify(next))
      setDecisions(next)
      setNotice(success)
    } catch {
      setNotice('Browser storage is unavailable. The decision was not saved.')
    }
  }

  async function saveProposal() {
    setSaving(true)
    setNotice('')
    try {
      let value = sample.fva
      if (useApi) {
        const response = await fetch('/api/replay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku: selected.sku, units }),
        })
        if (!response.ok) throw new Error('Replay failed')
        const result: { fva: number } = await response.json()
        value = result.fva
      }
      persist([{ id: crypto.randomUUID(), sku: selected.sku, name: selected.name, units, fva: value,
        at: new Date().toISOString(), status: 'Proposed' }, ...loadDecisions()], 'Proposal saved in this browser.')
    } catch {
      setNotice('The forecast replay could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function investigate() {
    const stage = stageLabels[question]
    const before = Math.abs(quantity(selected, stages[question - 1]) - selected.actual)
    const after = Math.abs(quantity(selected, stages[question]) - selected.actual)
    const at = new Date().toISOString()
    setNotice('')
    if (!useApi) {
      setInvestigation({ sku: selected.sku, stage, before, after, at, trace: [
        'Loaded forecast versions from the exported demonstration data.',
        `Compared absolute errors of ${before} and ${after} units.`,
      ] })
      return
    }
    setRunning(true)
    try {
      const response = await fetch('/api/investigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: selected.sku, stage: stages[question] }),
      })
      if (!response.ok) throw new Error('Investigation failed')
      const result: Investigation = await response.json()
      setInvestigation({ ...result, stage, at })
    } catch {
      setNotice('The investigation could not load verified evidence.')
    } finally {
      setRunning(false)
    }
  }

  const picker = <label className="select-control"><PackageSearch size={16} /><select aria-label="Product" value={selected.sku} onChange={e => {
    const p = data.products.find(item => item.sku === e.target.value)
    if (p) selectProduct(p)
  }}>{data.products.map(p => <option key={p.sku} value={p.sku}>{p.name}</option>)}</select><ChevronDown size={14} /></label>

  const filteredView = ['Overview', 'FVA scorecard', 'Planner overrides'].includes(page)
  return <div className="app">
    <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
      <button className="brand" onClick={() => go('Overview')}><span className="brand-mark"><ChartNoAxesCombined size={24} strokeWidth={2.4} /></span><span><b>Forecast Lab</b><small>Retail intelligence</small></span></button>
      <nav aria-label="Main navigation">
        <div className="nav-label">WORKSPACE</div>
        {nav.map(({ label, icon: Icon }) => <div key={label}>{label === 'Model analytics' && <div className="nav-label secondary">OPERATIONS</div>}<button className={page === label ? 'nav-item active' : 'nav-item'} aria-current={page === label ? 'page' : undefined} onClick={() => go(label)}><Icon size={18} /><span>{label}</span>{page === label && <span className="active-dot" />}</button></div>)}
      </nav>
      <div className="sidebar-bottom"><span className="demo-mark"><Database size={16} /></span><span><b>Demo workspace</b><small>Synthetic retail data</small></span></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="crumb"><button className="icon-button mobile-menu" aria-label="Toggle navigation" onClick={() => setMobileNav(!mobileNav)}><Menu size={22} /></button><span>Workspace</span><ChevronRight size={14} /><strong>{page}</strong></div><div className="top-actions"><span className="demo-badge"><i className="dot green" /> Demo mode</span><button className="icon-button" aria-label="About this workspace" onClick={() => setHelp(true)}><CircleHelp size={20} /></button></div></header>
      <main>
        <div className="page-header"><div><h1>{page === 'Overview' ? 'Forecast overview' : page}</h1><p>{({
          Overview: 'Track how each planning decision changes forecast accuracy.',
          'FVA scorecard': 'Compare forecast stages on the same eligible records.',
          'Forecast explorer': 'Inspect forecast versions and replay a historical decision.',
          'Planner overrides': 'Find which overrides improved or worsened accuracy.',
          'Live demand lab': 'Stress-test a planner override guardrail against a continuous synthetic demand stream.',
          'Inventory risk': 'Compare synthetic replenishment outcomes under variable demand.',
          'Forecast copilot': 'Investigate a planning decision using matched forecast evidence.',
          'Model analytics': 'Compare measured accuracy on generated daily sales.',
          'Agent monitor': 'Inspect the evidence checks from the latest investigation.',
          'Audit history': 'Review planning proposals saved in this browser.',
        })[page]}</p></div>
        {filteredView && <label className="select-control"><Filter size={15} /><select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(x => <option key={x}>{x}</option>)}</select><ChevronDown size={14} /></label>}
        {['Forecast explorer', 'Forecast copilot'].includes(page) && picker}</div>

        {page === 'Overview' && <>
          <section className="hero"><div className="hero-content"><div className="hero-label"><Sparkles size={15} /> FEATURED INVESTIGATION</div><h2>When more forecast<br />means more error.</h2><p>Follow a Greek yogurt promotion through four forecast stages to see where accuracy improved and where it slipped.</p><button className="hero-button" onClick={() => open(data.products[0])}>Explore the yogurt case <ArrowRight size={17} /></button><button className="hero-button hero-link" onClick={() => go('Live demand lab')}>Open live lab <Activity size={16} /></button></div></section>
          <div className="stat-grid">
            {[
              { title: 'Matched forecasts', value: String(selectedProducts.length), sub: 'Eligible product records', icon: ClipboardList, color: '' },
              { title: 'Baseline WAPE', value: pct(rows[0].wape), sub: format(rows[0].error) + ' units absolute error', icon: Activity, color: '' },
              { title: 'ML value added', value: signed(rows[1].fva), sub: 'Units of error removed', icon: ArrowUpRight, color: tone(rows[1].fva) },
              { title: 'Override value added', value: signed(rows[3].fva), sub: 'Units of error change', icon: ArrowDownRight, color: tone(rows[3].fva) },
            ].map(({ title, value, sub, icon: Icon, color }) => <section className="stat" key={title}><div className="stat-top"><span>{title}</span><span className="stat-icon"><Icon size={17} /></span></div><strong className={color}>{value}</strong><small>{sub}</small></section>)}
          </div>
          <div className="overview-grid"><Waterfall products={selectedProducts} /><Panel title="Planning attention" subtitle="Largest error increases" action={<span className="attention-icon"><Activity size={17} /></span>}>
            <div className="attention-list">{[...overrides].filter(p => overrideFva(p) < 0).sort((a, b) => overrideFva(a) - overrideFva(b)).slice(0, 3).map(p => <button key={p.sku} onClick={() => open(p)}><span><strong>{p.name}</strong><small>{p.category} · {p.sku}</small></span><span className="metric negative">{signed(overrideFva(p))}</span></button>)}{!overrides.some(p => overrideFva(p) < 0) && <p>No harmful overrides in this category.</p>}</div>
            <button className="text-button attention-link" onClick={() => go('Planner overrides')}>View planner overrides <ArrowRight size={15} /></button>
          </Panel></div>
          <Panel title="Forecast review queue" subtitle="Historical planning cases" action={<button className="text-button" onClick={() => go('FVA scorecard')}>View scorecard <ArrowRight size={15} /></button>}><ProductTable products={selectedProducts} open={open} /></Panel>
        </>}

        {page === 'FVA scorecard' && <>
          <div className="toolbar"><label><input type="checkbox" checked={overrideOnly} onChange={e => setOverrideOnly(e.target.checked)} /> Override records only</label><span>Decision cutoff {data.cutoff.slice(0, 10)} UTC</span></div>
          <Waterfall products={overrideOnly ? overrides : selectedProducts} />
          <Panel title="Stage performance" subtitle={`${overrideOnly ? overrides.length : selectedProducts.length} matched · ${overrideOnly ? selectedProducts.length - overrides.length : 0} excluded · ${pct(overrides.length / selectedProducts.length)} override coverage in category`}>
            <div className="table-wrap"><table><thead><tr><th>Forecast stage</th><th>Absolute error</th><th>WAPE</th><th>FVA</th></tr></thead><tbody>{portfolio(overrideOnly ? overrides : selectedProducts).map((r, i) => <tr key={r.name}><td>{r.name}</td><td>{format(r.error)} units</td><td>{pct(r.wape)}</td><td className={tone(r.fva)}>{i ? signed(r.fva) : '—'}</td></tr>)}</tbody></table></div>
          </Panel>
        </>}

        {page === 'Planner overrides' && <Panel title="Override performance" subtitle={`${overrides.length} adjusted · ${overrides.filter(p => overrideFva(p) > 0).length} improved · ${overrides.filter(p => overrideFva(p) === 0).length} tied`}><ProductTable products={selectedProducts} open={open} /></Panel>}

        {page === 'Forecast explorer' && <>
          <div className="overview-grid"><Waterfall products={[selected]} /><Panel title="Historical replay" subtitle={`Observed sales · ${format(selected.actual)} units`}>
            <div className="form-content"><label htmlFor="proposal">Proposed forecast (units)</label><input id="proposal" type="number" min={0} max={100000} value={units} onChange={e => setUnits(Math.max(0, Math.min(100000, Math.trunc(Number(e.target.value)))))} />
              <div className="result"><span>Absolute error <b>{format(sample.error)}</b></span><span>Override FVA <b className={tone(sample.fva)}>{signed(sample.fva)}</b></span></div>
              <button className="primary" disabled={saving} onClick={saveProposal}>{saving ? "Saving…" : "Save proposal"}</button>
              <p role="status">{notice}</p>
            </div></Panel></div>
          <Panel title="Forecast version lineage" subtitle={`${selected.sku} · ${selected.reason} · Cutoff ${data.cutoff}`}><div className="table-wrap"><table><thead><tr><th>Stage</th><th>Forecast units</th><th>Issued at (UTC)</th><th>Target date</th></tr></thead><tbody>{selected.versions.map(v => <tr key={v.stage}><td>{stageLabels[stages.findIndex(s => s === v.stage)]}</td><td>{format(v.units)}</td><td>{v.issued.replace('T', ' ').replace('Z', '')}</td><td>{v.target}</td></tr>)}</tbody></table></div></Panel>
        </>}

        {page === 'Live demand lab' && <LiveLab />}

        {page === 'Inventory risk' && (() => {
          const scenario = orderScenario(stock, data.benchmark.demand_samples, shortageCost, 1, capacity)
          return <Panel title="Replenishment simulation" subtitle="Empirical demand scenarios pooled across six synthetic SKUs. Surplus cost is $1 per unit."><div className="form-content scenario">
            <label>Available inventory<input type="number" min={0} max={10000} value={stock} onChange={e => setStock(Math.max(0, Math.min(10000, Math.trunc(Number(e.target.value)))))} /></label>
            <label>Maximum order<input type="number" min={0} max={1000} value={capacity} onChange={e => setCapacity(Math.max(0, Math.min(1000, Math.trunc(Number(e.target.value)))))} /></label>
            <label>Shortage cost per unit ($)<input type="number" min={0} max={1000} value={shortageCost} onChange={e => setShortageCost(Math.max(0, Math.min(1000, Number(e.target.value))))} /></label>
            <div className="result"><span>Proposed order <b>{scenario.order} units</b></span><span>Shortage probability <b>{pct(scenario.risk)}</b></span><span>Expected surplus <b>{format(scenario.surplus)} units</b></span><span>Expected cost <b>${format(scenario.cost)}</b></span></div>
            <p className="muted">Historical illustration. Orders are evaluated in multiples of five with immediate delivery.</p>
          </div></Panel>
        })()}

        {page === 'Forecast copilot' && <Panel title="Investigate forecast accuracy" subtitle="Deterministic analytics with source-linked evidence"><div className="form-content">
          <label htmlFor="question">Compare a stage with its predecessor</label><select id="question" value={question} onChange={e => setQuestion(Number(e.target.value))}>{stageLabels.slice(1).map((stage, i) => <option key={stage} value={i + 1}>{stage}</option>)}</select>
          <button className="primary" disabled={running} onClick={investigate}><Sparkles size={16} /> {running ? "Investigating…" : "Run investigation"}</button>{notice && <p role="status">{notice}</p>}
          {investigation?.sku === selected.sku && <div className="result answer"><strong>{investigation.stage}</strong><p>Absolute error moved from {investigation.before} to {investigation.after} units. That is {signed(investigation.before - investigation.after)} units of FVA. This comparison measures forecast error and cannot establish causation.</p>{investigation.policy && <p><b>{investigation.policy.id} · v{investigation.policy.revision}</b> {investigation.policy.text}</p>}<button className="text-button" onClick={() => open(selected)}>Evidence · {selected.sku} forecast versions <ArrowRight size={15} /></button></div>}
        </div></Panel>}

        {page === 'Model analytics' && <Panel title="Chronological model benchmark" subtitle={`${data.benchmark.samples} observations across ${data.benchmark.windows} windows · Synthetic daily sales`}><div className="table-wrap"><table><thead><tr><th>Model</th><th>WAPE</th><th>MAE</th><th>RMSE</th><th>MASE</th><th>Mean bias</th></tr></thead><tbody>{data.benchmark.models.map(m => <tr key={m.name}><td>{m.name}</td><td>{pct(m.wape)}</td><td>{format(m.mae)}</td><td>{format(m.rmse)}</td><td>{m.mase.toFixed(2)}</td><td>{signed(m.bias)}</td></tr>)}</tbody></table></div><div className="form-content"><div>P10–P90 empirical interval coverage <strong>{pct(data.benchmark.coverage)}</strong></div><div>Gradient Boosting final holdout WAPE <strong>{pct(data.benchmark.final_holdout_wape)}</strong></div></div></Panel>}

        {page === 'Agent monitor' && <Panel title="Investigation trace" subtitle="Deterministic workflow"><div className="form-content">
          {investigation ? <ol className="trace"><li>Selected {investigation.sku} for {investigation.stage.toLowerCase()} review.</li>{investigation.trace.map(step => <li key={step}>{step}</li>)}<li>Recorded at {new Date(investigation.at).toLocaleString()}.</li></ol> : <p>Run an investigation to populate the trace.</p>}
          <button className="text-button" onClick={() => go('Forecast copilot')}>Open forecast copilot <ArrowRight size={15} /></button>
        </div></Panel>}

        {page === 'Audit history' && <Panel title="Local decisions" subtitle="Approvals are recorded locally for this demonstration."><div className="table-wrap">{decisionList.length ? <table><thead><tr><th>Product</th><th>Proposed units</th><th>FVA</th><th>Recorded</th><th>Status</th></tr></thead><tbody>{decisionList.map(d => <tr key={d.id}><td>{d.name}</td><td>{format(d.units)}</td><td className={tone(d.fva)}>{signed(d.fva)}</td><td>{new Date(d.at).toLocaleString()}</td><td>{d.status === 'Proposed' ? <button className="text-button" onClick={() => persist(decisionList.map(x => x.id === d.id ? { ...x, status: 'Approved locally' } : x), 'Approval saved in this browser.')}>Approve locally</button> : d.status}</td></tr>)}</tbody></table> : <p className="form-content">No proposals yet. Save a proposal in Forecast explorer to start an audit trail.</p>}</div>{notice && <p className="form-content" role="status">{notice}</p>}</Panel>}

        <footer className="page-footer"><span>Forecast Lab · Synthetic retail workspace</span><span>Forecast Value Added Scorecard</span></footer>
      </main>
    </div>
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="modal" role="dialog" aria-modal="true" aria-label="About Forecast Lab" onClick={e => e.stopPropagation()}><button className="icon-button close" aria-label="Close" onClick={() => setHelp(false)}><X size={20} /></button><h2>About Forecast Lab</h2><p>Forecast Value Added is the reduction in absolute error between consecutive forecast stages. Positive values indicate improved accuracy.</p><p>The planning cases are fictional. Model metrics come from chronological evaluation on generated sales. Proposals stay in your browser.</p></section></div>}
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
