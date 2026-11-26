import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import artifact from './online-demo.json'

type Report = {
  series: string
  observations: number
  scored: number
  forecast: { period: number; units: number; baseline: number; low: number | null; high: number | null; promotion: boolean }
  latest: { period: number; actual: number; predicted: number; anomaly: boolean; promotion_changed: boolean } | null
  model_wape: number | null
  baseline_wape: number | null
  fva: number | null
  anomalies: number
  interval_coverage: number | null
  model: string
  stock: number
  planning_gap: number | null
}
type Connection = { key: string; series: string; stock: number }
const useApi = import.meta.env.VITE_USE_API === 'true'
const format = (n: number | null) => n === null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 1 })
const wape = (n: number | null) => n === null ? '—' : (n * 100).toFixed(1) + '%'

async function subscribe(connection: Connection, signal: AbortSignal, update: (report: Report) => void) {
  const response = await fetch('/api/online/watch/' + encodeURIComponent(connection.series) + '?stock=' + connection.stock, {
    signal, headers: { Authorization: 'Bearer ' + connection.key },
  })
  if (!response.ok || !response.body) {
    throw new Error(response.status === 404 ? 'No observations have arrived for this series.' : `Connection failed (HTTP ${response.status}).`)
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += value
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const data = buffer.slice(0, boundary).split('\n').find(line => line.startsWith('data: '))
        if (data) update(JSON.parse(data.slice(6)) as Report)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function OnlineLab() {
  const [key, setKey] = useState('')
  const [series, setSeries] = useState('DEMO:SKU-1')
  const [stock, setStock] = useState(110)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [status, setStatus] = useState('')
  const [receivedLive, setReceivedLive] = useState(false)
  const [report, setReport] = useState<Report>(artifact.forecast)
  useEffect(() => {
    if (connection === null) return
    const controller = new AbortController()
    subscribe(connection, controller.signal, latest => {
      setReport(latest)
      setReceivedLive(true)
      setStatus('Receiving live forecasts')
    }).then(() => { if (!controller.signal.aborted) setStatus('Stream ended. Reconnect to resume.') }).catch(error => {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'Stream unavailable')
    })
    return () => controller.abort()
  }, [connection])

  const forecast = report.forecast
  return <>
    <section className="panel">
      <header className="panel-head"><div><h2>Online demand model</h2><p>{report.series} · {report.model} · {receivedLive ? 'Feed output' : 'Synthetic replay'}</p></div><span className="stat-icon"><Activity size={18} /></span></header>
      <div className="form-content">
        {useApi ? <form className="stream-controls online-form" onSubmit={event => {
          event.preventDefault()
          setStatus('Connecting…')
          setConnection({ key, series, stock })
        }}>
          <label>Series ID<input required value={series} onChange={e => setSeries(e.target.value)} maxLength={80} /></label>
          <label>Stream token<input required type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" /></label>
          <label>Available stock<input required type="number" min={0} max={1000000} value={stock} onChange={e => setStock(Number(e.target.value))} /></label>
          <button className="primary">Connect</button>
          {connection && <button className="text-button" type="button" onClick={() => {
            setConnection(null)
            setKey('')
            setStatus('Disconnected')
          }}>Disconnect</button>}
        </form> : <p>Recorded output from a seeded synthetic stream. Connect an authorized sales feed in the Docker deployment to receive live updates.</p>}
        {status && <p role="status">{status}</p>}
        <p>{report.observations.toLocaleString()} observations · {report.scored.toLocaleString()} scored after warm-up · {report.anomalies.toLocaleString()} outside the available forecast bands</p>
      </div>
    </section>
    <div className="stat-grid online-stats">
      {[
        ['Next demand', format(forecast.units) + ' units', `Period ${forecast.period} · ${forecast.promotion ? 'Promotion planned' : 'Regular trade'}`],
        ['Prediction band', forecast.low === null ? 'Calibrating' : `${format(forecast.low)}–${format(forecast.high)}`, `Nominal 90% · observed coverage ${wape(report.interval_coverage)}`],
        ['Model WAPE', wape(report.model_wape), `Seasonal baseline ${wape(report.baseline_wape)}`],
        ['Stock gap', format(report.planning_gap), `Units to upper band · ${format(report.stock)} on hand`],
      ].map(([label, value, detail]) => <section className="stat" key={label}><div className="stat-top">{label}</div><strong>{value}</strong><small>{detail}</small></section>)}
    </div>
    <section className="panel"><header className="panel-head"><div><h2>Latest observed outcome</h2><p>Forecast issued before the observation arrived</p></div></header><div className="form-content">
      {report.latest ? <div className="result">
        <span>Observed demand <b>{format(report.latest.actual)} units</b></span>
        <span>Previously published forecast <b>{format(report.latest.predicted)} units</b></span>
        <span>Forecast-band signal <b>{report.latest.anomaly ? 'Outside band · investigate' : 'No breach recorded'}</b></span>
        <span>Promotion assumption <b>{report.latest.promotion_changed ? 'Changed after forecast' : 'Consistent with forecast'}</b></span>
        <span>Cumulative FVA against baseline <b>{format(report.fva)} units</b></span>
      </div> : <p>Waiting for forecasts to mature after warm-up.</p>}
      <p className="muted">The stock gap is a planning signal. Forecast bands and coverage can change as demand shifts.</p>
    </div></section>
  </>
}
