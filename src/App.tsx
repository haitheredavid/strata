import { useEffect, useState } from 'react'
import { Scene } from './scene/Scene'
import { Toolbar } from './ui/Toolbar'
import { LayerPanel } from './ui/LayerPanel'
import { useStore } from './store'
import { loadFiles, loadSample } from './ui/files'
import { Timeline } from './ui/Timeline'
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
    let last: string | null = null
    try {
      last = localStorage.getItem('strata:sample')
    } catch {
      /* first sample */
    }
    loadSample(last ?? 'commerce')
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
        <Scene />
        <LayerPanel />
        <div className="dock">
          <ComputePanel />
          <Timeline />
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
