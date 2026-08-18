/**
 * dsh-wf-engine 去敏模块（§1.2 / §8）：
 * - 日志、教训、审计写入前必经 redactSecrets()。
 * - scanSensitive() 用于写入前拦截判断（safe=false 时工具应提示而非保存）。
 * 零依赖纯函数。
 */

const PATTERNS = [
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'openai-key', re: /\bsk-[A-Za-z0-9]{16,}/g },
  { kind: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: 'bearer', re: /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}/gi },
  { kind: 'secret-assignment', re: /((?:api[_-]?key|token|secret|password|passwd|client[_-]?secret)\s*[:=]\s*)(['"]?)([^\s'",;]+)\2/gi },
  { kind: 'env-secret-line', re: /^(\s*(?:export\s+)?(?:[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET)|(?:TOKEN|API_KEY|SECRET_KEY|PASSWORD|AUTH_TOKEN))\s*=).*/gim },
  { kind: 'uri-credentials', re: /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, placeholder: (m) => `${m[1]}[REDACTED]@` },
]

const REDACTED = '[REDACTED]'

/**
 * 返回 { text, hits: {kind: count} }。
 * 逐模式扫描并替换；同一位置命中多种模式时按数组顺序优先（先替换者先赢）。
 */
export function redactSecrets(input) {
  let out = String(input ?? '')
  const hits = {}
  for (const { kind, re, placeholder } of PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(out)) !== null) {
      hits[kind] = (hits[kind] ?? 0) + 1
      const start = m.index
      const end = start + m[0].length
      const replacement = placeholder ? placeholder(m) : REDACTED
      // 保留 key 名（secret-assignment / env-secret-line 的组 1），值整体替换。
      const prefix = (m[1] ?? '').length > 0 ? m[1] : ''
      const keepStart = start + prefix.length
      out = out.slice(0, start) + prefix + replacement + out.slice(end)
      re.lastIndex = keepStart + replacement.length
    }
  }
  return { text: out, hits }
}

/** 只判断是否含敏感信息（不替换）。 */
export function scanSensitive(input) {
  const { hits } = redactSecrets(input)
  const kinds = Object.keys(hits)
  return { safe: kinds.length === 0, kinds, hits }
}
