import { useStore } from '../store'

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
                {n.detail.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
    </div>
  )
}
