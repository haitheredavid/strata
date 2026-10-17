/** True for failures worth retrying: rate limits, server errors, timeouts, dropped connections. */
export function isTransient(message: string): boolean {
  return /\b(429|50[0-4])\b|Too Many Requests|TEMPORARILY_UNAVAILABLE|RESOURCE_EXHAUSTED|REQUEST_LIMIT_EXCEEDED|Service Unavailable|Bad Gateway|Gateway Timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(
    message,
  )
}

/** Wait before retry `attempt` (1-based): 2 s, 4 s, 8 s… capped at 60 s, with up to 25 % jitter. */
export const backoffMs = (attempt: number, random = Math.random) => Math.min(60_000, 1000 * 2 ** attempt) * (1 + random() * 0.25)

export interface RetryOptions {
  attempts: number
  sleep?: (ms: number) => Promise<void>
  onRetry?: (error: Error, attempt: number, waitMs: number) => void
}

/** Runs `fn`, retrying transient failures with backoff; anything else, or the last failure, is thrown. */
export async function withRetry<T>(fn: () => Promise<T>, { attempts, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onRetry }: RetryOptions): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))
      if (attempt >= attempts || !isTransient(error.message)) throw error
      const wait = backoffMs(attempt)
      onRetry?.(error, attempt, wait)
      await sleep(wait)
    }
  }
}
