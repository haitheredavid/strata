import type { Cluster, ClusterKind } from '../model/workflow'
import type { StageOp } from '../sim/spark'

export const CLUSTER_COLOR: Record<ClusterKind, string> = { job: '#60a5fa', all_purpose: '#a78bfa', serverless: '#2dd4bf' }
export const OP_COLOR: Record<StageOp, string> = {
  scan: '#60a5fa', exchange: '#f59e0b', join: '#a78bfa', aggregate: '#c084fc', write: '#34d399', optimize: '#94a3b8',
}
export const KIND_LABEL: Record<ClusterKind, string> = { job: 'JOB CLUSTER', all_purpose: 'ALL-PURPOSE', serverless: 'SERVERLESS' }

/** `i3.xlarge ×2–8`, or serverless. */
export const clusterSpec = (c: Cluster) =>
  c.kind === 'serverless'
    ? 'serverless · autoscaled'
    : `${c.nodeType} ×${c.workers.min}${c.workers.max > c.workers.min ? `–${c.workers.max}` : ''}`
