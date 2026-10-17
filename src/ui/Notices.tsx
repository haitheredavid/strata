import { useStore } from '../store'
import type { WarningItem } from '../data/warnings'
import { jobNodeId } from '../view/deriveView'

/** Load errors, storage trouble and dataset warnings, plus what the app is busy with. */
export function Notices() {
  const notices = useStore((s) => s.notices)
  const status = useStore((s) => s.status)
  const dismiss = useStore((s) => s.dismiss)
  if (!notices.length && !status) return null
  return (
    <div className="notices" role="status">
      {status && <div className="notice busy">{status}</div>}
      {notices.map((n) => (
        <div key={n.id} className={`notice ${n.level}`}>
          <div className="notice-head">
            <span>{n.text}</span>
            <button className="dismiss" title="Dismiss" onClick={() => dismiss(n.id)}>
              ✕
            </button>
          </div>
          {n.detail && (
            <details open={n.open}>
              <summary>Details</summary>
              <ul>
                {n.detail.map((g, i) => (
                  <li key={i}>
                    {g.items.length ? (
                      <details>
                        <summary>{g.text}</summary>
                        <ul className="items">
                          {g.items.map((item, j) => (
                            <li key={j}>
                              <Item item={item} />
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      g.text
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
    </div>
  )
}

/** A warning item; one that names a task focuses it, one that names a pipeline lights it up. */
function Item({ item }: { item: WarningItem }) {
  const link = item.link
  if (!link) return <>{item.text}</>
  const go = () => {
    const s = useStore.getState()
    if (link.kind === 'pipeline') return s.setLens(link.id)
    const id = jobNodeId(link.id)
    s.focus(id)
    s.camera({ kind: 'fly', id })
  }
  return (
    <button className="link" title={link.kind === 'pipeline' ? 'Light up this pipeline' : 'Focus this task'} onClick={go}>
      {item.text}
    </button>
  )
}
