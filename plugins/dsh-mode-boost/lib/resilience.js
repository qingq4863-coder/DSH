/**
 * mode-boost resilience: retry/fallback decision helpers (zero dependencies).
 *
 * The plugin wraps llm/stream so a retryable provider failure can retry once
 * and then fall back to another configured provider (circuit-breaker guarded).
 * These pure helpers are unit-tested; the wiring lives in index.js.
 */

/** Failure codes the wrapper is willing to retry or fall back on. */
const RETRYABLE_CODES = new Set([
  'TRANSPORT',
  'TIMEOUT',
  'QUOTA_EXCEEDED',
  'INVALID_CREDENTIAL',
  'RATE_LIMIT',
])

/** Whether a normalized adapter failure is worth a retry/fallback attempt. */
export function isRetryableFailure(failure = {}) {
  if (!failure || failure.aborted === true || failure.code === 'ABORTED') return false
  if (typeof failure.code === 'string' && RETRYABLE_CODES.has(failure.code)) return true
  const status = Number(failure.status ?? failure.statusCode ?? 0)
  if (status >= 500 || status === 408 || status === 429) return true
  const text = String(failure.message ?? '')
  return /fetch failed|network|timeout|econn|socket hang up|rate limit|quota/i.test(text)
}

/** Sliding-window failure breaker for one provider route. */
export class Breaker {
  constructor({ threshold = 2, windowMs = 300000, now = Date.now } = {}) {
    this.threshold = threshold
    this.windowMs = windowMs
    this.now = now
    this.failures = []
  }

  recordFailure(now = this.now()) {
    this.failures.push(now)
    this.prune(now)
  }

  recordSuccess(now = this.now()) {
    this.failures = []
  }

  shouldOpen(now = this.now()) {
    this.prune(now)
    return this.failures.length >= this.threshold
  }

  prune(now) {
    this.failures = this.failures.filter((t) => now - t <= this.windowMs)
  }
}
