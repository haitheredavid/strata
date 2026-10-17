import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Scene } from './scene/Scene'
import { Toolbar } from './ui/Toolbar'
import { Navigator } from './ui/Navigator'
import { Inspector } from './ui/Inspector'
import { CameraCorner, LitByTrail } from './ui/CanvasOverlay'
import { useGlobalKeys } from './ui/keys'
import { boot, openFiles } from './ui/files'
import { DayDock } from './ui/Timeline'
import { Profiled } from './dev/Profiled'
import { Notices } from './ui/Notices'
import { usePalette } from './theme/palette'

const carriesFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')

/**
 * The shell: toolbar over three columns (Navigator · canvas · Inspector), with the Day dock under the
 * Navigator and canvas. Nothing floats over the canvas but the Lit-by trail, notices and camera presets.
 */
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
      <div className="main">
        <Profiled id="Navigator">
          <Navigator />
        </Profiled>
        <div className="canvas">
          <Profiled id="Scene">
            <Scene />
          </Profiled>
          <LitByTrail />
          <Notices />
          <CameraCorner />
        </div>
        <Profiled id="Timeline">
          <DayDock />
        </Profiled>
        <Profiled id="Inspector">
          <Inspector />
        </Profiled>
      </div>
      {dropping && <div className="drop">Drop a workspace snapshot, a .dbml schema (with its workflows .yaml / .json), or a layout file</div>}
    </div>
  )
}
