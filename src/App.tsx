import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Scene } from './scene/Scene'
import { Toolbar } from './ui/Toolbar'
import { LayerPanel } from './ui/LayerPanel'
import { useGlobalKeys } from './ui/keys'
import { boot, openFiles } from './ui/files'
import { Timeline } from './ui/Timeline'
import { Profiled } from './dev/Profiled'
import { ComputePanel } from './ui/ComputePanel'
import { Notices } from './ui/Notices'
import { usePalette } from './theme/palette'

const carriesFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')

export default function App() {
  const [dropping, setDropping] = useState(false)
  // dragenter / dragleave fire for every child crossed; count them so the overlay doesn't flicker.
  const depth = useRef(0)
  const accent = usePalette().accent

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent)
  }, [accent])

  useEffect(() => {
    void boot()
  }, [])

  useGlobalKeys()

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        if (!carriesFiles(e)) return
        depth.current++
        setDropping(true)
      }}
      onDragOver={(e) => carriesFiles(e) && e.preventDefault()}
      onDragLeave={(e) => {
        if (carriesFiles(e) && --depth.current <= 0) setDropping(false)
      }}
      onDrop={async (e) => {
        e.preventDefault()
        depth.current = 0
        setDropping(false)
        await openFiles(e.dataTransfer.files)
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
        <Notices />
        {dropping && (
          <div className="drop">Drop a workspace snapshot, a .dbml schema (with its workflows .yaml / .json), or a layout file</div>
        )}
      </div>
    </div>
  )
}
