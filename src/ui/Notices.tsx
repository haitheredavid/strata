import { useStore } from '../store'
import type { WarningItem } from '../data/warnings'
import { jobNodeId } from '../view/deriveView'
import { goTo, selectPipeline } from './select'

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
            <details open>
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

/** A warning item; one that names a task selects it, one that names a pipeline selects the pipeline. */
function Item({ item }: { item: WarningItem }) {
  const link = item.link
  if (!link) return <>{item.text}</>
  const go = () => (link.kind === 'pipeline' ? selectPipeline(link.id) : goTo(jobNodeId(link.id)))
  return (
    <button className="link" title={link.kind === 'pipeline' ? 'Select this pipeline' : 'Select this task'} onClick={go}>
      {item.text}
    </button>
  )
}
