import { test } from 'node:test'
import assert from 'node:assert/strict'

import { redactSecrets, scanSensitive } from '../lib/redact.js'

test('扫描并替换各类密钥/凭据', () => {
  const sample = [
    'openai: sk-abc1234567890123456789',
    'github: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890123456789',
    'url: https://user:pw@example.com/x',
    '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----',
    'JWT: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'bearer abcdefghijklmnopqrstuvwxyz1234567890',
  ].join('\n')
  const { text, hits } = redactSecrets(sample)
  assert.ok(!/sk-[A-Za-z0-9]{16,}/.test(text))
  assert.ok(!/ghp_[A-Za-z0-9]{20,}/.test(text))
  assert.ok(!/user:pw@/.test(text))
  assert.ok(!/BEGIN RSA PRIVATE KEY/.test(text))
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\./.test(text))
  assert.ok(!/bearer\s+abcdefghijklmnopqrstuvwxyz/.test(text))
  assert.ok(hits['openai-key'] >= 1)
  assert.ok(hits['github-token'] >= 1)
  assert.ok(hits['uri-credentials'] >= 1)
  assert.ok(hits['private-key'] >= 1)
  assert.ok(hits['jwt'] >= 1)
  assert.ok(hits['bearer'] >= 1)
})

test('secret-assignment / env-secret-line：保留 key 名、替换值', () => {
  const { text } = redactSecrets('api_key=abcdefghijklmnopqrstuvwxyz\nexport AUTH_TOKEN=1234567890abcdefghij')
  assert.ok(text.includes('api_key=') && !text.includes('abcdefghijklmnopqrstuvwxyz'))
  assert.ok(text.includes('AUTH_TOKEN=') && !text.includes('1234567890abcdefghij'))
})

test('普通文本 safe，敏感文本 unsafe', () => {
  assert.equal(scanSensitive('修复了 get_user 空指针，加了 pytest 用例').safe, true)
  const bad = scanSensitive('password: hunter2hunter2hunter2')
  assert.equal(bad.safe, false)
  assert.ok(bad.kinds.includes('secret-assignment'))
})