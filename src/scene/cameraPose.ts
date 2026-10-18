import type { CameraPose } from '../model/types'

/**
 * Reads the live camera from outside the canvas (a story scene captures it). The camera rig fills
 * `read` in while it's mounted; without it there's no pose.
 */
export const cameraPose: { read: () => CameraPose | null } = { read: () => null }
