import { useEffect, useState } from 'react'
import { Scene } from './scene/Scene'
import { Toolbar } from './ui/Toolbar'
import { LayerPanel } from './ui/LayerPanel'
import { useStore } from './store'
import { loadFiles, loadLast, loadSynth } from './ui/files'
import { Timeline } from './ui/Timeline'
import { Profiled } from './dev/Profiled'
import { ComputePanel } from './ui/ComputePanel'
import { usePalette } from './theme/palette'

export default function App() {
  const error = useStore((s) => s.error)
  const [dropping, setDropping] = useState(false)
  const accent = usePalette().accent

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent)
  }, [accent])

  useEffect(() => {
    const synth = import.meta.env.DEV ? new URLSearchParams(location.search).get('synth') : null
    if (synth) return loadSynth(synth)
    let last: string | null = null
    try {
      last = localStorage.getItem('strata:sample')
    } catch {
      /* first sample */
    }
    loadLast(last)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = useStore.getState()
      s.focus(null)
      s.setLens(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="app"
      onDragOver={(e) => (e.preventDefault(), setDropping(true))}
      onDragLeave={() => setDropping(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setDropping(false)
        await loadFiles(e.dataTransfer.files)
      }}
    >
      <Toolbar />
      <div className="stage">
        <Profiled id="Scene">
          <Scene />
        </Profiled>
        <Profiled id="LayerPanel">
          <LayerPanel />
        </Profiled>
        <div className="dock">
          <Profiled id="ComputePanel">
            <ComputePanel />
          </Profiled>
          <Profiled id="Timeline">
            <Timeline />
          </Profiled>
        </div>
        {error && (
          <div className="error" onClick={() => useStore.setState({ error: null })}>
            {error}
          </div>
        )}
        {dropping && <div className="drop">Drop a .dbml file (and optionally its workflows .yaml / .json)</div>}
      </div>
    </div>
  )
}
