import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store'
import { timeClock } from '../scene/timeClock'
import { captureScene, sameScene } from '../view/story'
import { Menu } from './Menu'

/**
 * The story along the bottom of the canvas: scenes in order as numbered chips with ‹ › to step
 * (← / → too), + Scene to save what's on screen, and Present to hide the side panels. The scene
 * shown gets a caption with its title and note, which say what to look at.
 */
export function StoryStrip() {
  const open = useStore((s) => s.storyOpen)
  const story = useStore((s) => s.layout.story) ?? []
  const at = useStore((s) => s.storyAt)
  const presenting = useStore((s) => s.presenting)
  const { openStory, addScene, showScene, moveScene, recaptureScene, deleteScene, present } = useStore(
    useShallow((s) => ({
      openStory: s.openStory,
      addScene: s.addScene,
      showScene: s.showScene,
      moveScene: s.moveScene,
      recaptureScene: s.recaptureScene,
      deleteScene: s.deleteScene,
      present: s.present,
    })),
  )
  if (!open) return null
  const step = (d: -1 | 1) => showScene(at === null ? (d > 0 ? 0 : story.length - 1) : Math.max(0, Math.min(story.length - 1, at + d)))

  return (
    <div className="story">
      {at !== null && story[at] && <Caption i={at} />}
      <div className="story-strip" role="toolbar" aria-label="Story">
        <span className="story-label">Story</span>
        <button title="Previous scene (←)" disabled={!story.length || at === 0} onClick={() => step(-1)}>‹</button>
        <ol className="story-scenes">
          {story.length === 0 && <li className="story-empty">Set up a view, then save it as a scene.</li>}
          {story.map((sc, i) => (
            <li key={sc.id} className={`story-chip${i === at ? ' on' : ''}`}>
              <button className="story-go" title={sc.note || sc.title} onClick={() => showScene(i)}>
                <span className="n">{i + 1}</span>
                <span className="t">{sc.title}</span>
              </button>
              {!presenting && (
                <Menu label="⋯" title="Scene options" className="row-menu">
                  {(close) => (
                    <>
                      <button role="menuitem" className="menu-item" onClick={() => (close(), recaptureScene(i))}>Update to what's on screen</button>
                      <button role="menuitem" className="menu-item" disabled={i === 0} onClick={() => (close(), moveScene(i, -1))}>Move earlier</button>
                      <button role="menuitem" className="menu-item" disabled={i === story.length - 1} onClick={() => (close(), moveScene(i, 1))}>Move later</button>
                      <button role="menuitem" className="menu-item" onClick={() => (close(), deleteScene(i))}>Delete</button>
                    </>
                  )}
                </Menu>
              )}
            </li>
          ))}
        </ol>
        <button title="Next scene (→)" disabled={!story.length || at === story.length - 1} onClick={() => step(1)}>›</button>
        {!presenting && (
          <button title="Save what's on screen (view, selection, Day timeline, camera) as a scene after this one" onClick={addScene}>
            + Scene
          </button>
        )}
        <button
          className={presenting ? 'on' : ''}
          disabled={!story.length && !presenting}
          title={presenting ? 'Stop presenting (Esc)' : 'Hide the side panels and step through the scenes'}
          onClick={() => {
            present(!presenting)
            if (!presenting && at === null) showScene(0)
          }}
        >
          {presenting ? 'Stop' : 'Present'}
        </button>
        {!presenting && (
          <button className="story-close" title="Close the story (S)" onClick={() => openStory(false)}>✕</button>
        )}
      </div>
    </div>
  )
}

/** The shown scene's title and note; editable unless presenting, with Update / Revert once the view moves away from it. */
function Caption({ i }: { i: number }) {
  const scene = useStore((s) => s.layout.story![i])
  const presenting = useStore((s) => s.presenting)
  const editScene = useStore((s) => s.editScene)
  const recaptureScene = useStore((s) => s.recaptureScene)
  const showScene = useStore((s) => s.showScene)
  // Whether the view still shows the scene (camera and playhead aside).
  const changed = useStore(
    (s) => !sameScene(scene.state, captureScene(s, timeClock.t, null)),
  )
  const [editing, setEditing] = useState(false)

  if (editing && !presenting)
    return (
      <div className="story-caption editing">
        <input aria-label="Scene title" value={scene.title} onChange={(e) => editScene(i, { title: e.target.value })} autoFocus />
        <textarea
          aria-label="Scene note"
          placeholder="What to look at in this scene…"
          rows={4}
          value={scene.note}
          onChange={(e) => editScene(i, { note: e.target.value })}
        />
        <div className="story-caption-actions">
          <button onClick={() => setEditing(false)}>Done</button>
        </div>
      </div>
    )
  return (
    <div className="story-caption">
      <div className="story-caption-head">
        <span className="n">{i + 1}</span>
        <h3>{scene.title}</h3>
        {!presenting && (
          <button className="link" title="Edit the title and note" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      {scene.note && <p>{scene.note}</p>}
      {changed && !presenting && (
        <div className="story-changed">
          <span>The view has changed since this scene.</span>
          <button className="link" onClick={() => recaptureScene(i)}>Update scene</button>
          <button className="link" onClick={() => showScene(i)}>Revert</button>
        </div>
      )}
    </div>
  )
}
