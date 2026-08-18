import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRetryableFailure, Breaker } from '../lib/resilience.js'

test('TRANSPORT failures are retryable', () => {
  assert.equal(isRetryableFailure({ code: 'TRANSPORT' }), true)
})

test('INVALID_REQUEST failures are not retryable', () => {
  assert.equal(isRetryableFailure({ code: 'INVALID_REQUEST' }), false)
})

test('server errors and rate limits are retryable by status', () => {
  assert.equal(isRetryableFailure({ status: 500 }), true)
  assert.equal(isRetryableFailure({ status: 503 }), true)
  assert.equal(isRetryableFailure({ status: 429 }), true)
  assert.equal(isRetryableFailure({ status: 408 }), true)
  assert.equal(isRetryableFailure({ status: 400 }), false)
})

test('network-ish messages are retryable', () => {
  assert.equal(isRetryableFailure({ message: 'fetch failed: socket hang up' }), true)
  assert.equal(isRetryableFailure({ message: 'request timeout' }), true)
  assert.equal(isRetryableFailure({ message: 'ECONNREFUSED' }), true)
})

test('aborts are never retryable', () => {
  assert.equal(isRetryableFailure({ code: 'ABORTED' }), false)
  assert.equal(isRetryableFailure({ aborted: true }), false)
})

test('breaker opens after threshold failures in window', () => {
  const breaker = new Breaker({ threshold: 2, windowMs: 60000, now: () => 0 })
  breaker.recordFailure(0)
  assert.equal(breaker.shouldOpen(0), false)
  breaker.recordFailure(0)
  assert.equal(breaker.shouldOpen(0), true)
})

test('breaker resets on success', () => {
  const breaker = new Breaker({ threshold: 2, windowMs: 60000, now: () => 0 })
  breaker.recordFailure(0)
  breaker.recordFailure(0)
  breaker.recordSuccess(5)
  assert.equal(breaker.shouldOpen(10), false)
})

test('breaker forgets failures older than the window', () => {
  const breaker = new Breaker({ threshold: 2, windowMs: 60000, now: () => 0 })
  breaker.recordFailure(0)
  breaker.recordFailure(10000)
  assert.equal(breaker.shouldOpen(61001), false)
})
