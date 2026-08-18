import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'

import { Store, newTaskId } from '../lib/store.js'
import { createInitialTask } from '../lib/engine.js'

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'wf-store-'))
  const store = new Store(dir)
  store.ensure()
  return { store, dir }
}

test('checkpoint 保存→加载→深等（§3.2 可序列化/可恢复/可审计）', () => {
  const { store, dir } = tmpStore()
  try {
    const t = createInitialTask({ goal: 'demo' })
    t.task_id = newTaskId()
    t.phase = 'IMPLEMENT'
    t.touched_files = ['src/a.py', 'tests/test_a.py']
    t.next_action = '写用例'
    store.saveTask(t)
    const back = store.loadTask(t.task_id)
    assert.deepEqual(back, t)
    assert.ok(store.hasTask(t.task_id))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('active 指针 + resume 恢复 phase/next_action/触碰文件', () => {
  const { store, dir } = tmpStore()
  try {
    const t = createInitialTask({ goal: 'demo' })
    t.task_id = newTaskId()
    t.phase = 'REPAIR'
    t.next_action = '核对失败签名再修'
    t.touched_files = ['lib/x.js']
    store.saveTask(t)
    store.setActive(t.task_id)
    const back = store.loadTask(store.getActive())
    assert.equal(back.phase, 'REPAIR')
    assert.equal(back.next_action, '核对失败签名再修')
    assert.deepEqual(back.touched_files, ['lib/x.js'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('dry-run 不落盘（checkpoint/active/lessons/交付）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-dry-'))
  try {
    const store = new Store(dir, { dryRun: true })
    store.ensure()
    const t = createInitialTask({ goal: 'demo' })
    t.task_id = newTaskId()
    store.saveTask(t)
    store.setActive(t.task_id)
    store.addLesson({ text: 'x' })
    store.saveDelivery(t.task_id, 'md')
    assert.equal(existsSync(store.activePath), false)
    assert.equal(existsSync(join(dir, 'lessons.jsonl')), false)
    assert.equal(existsSync(join(dir, 'deliveries', `${t.task_id}.md`)), false)
    assert.equal(existsSync(join(dir, 'tasks', `${t.task_id}.json`)), false)
    // 审计日志 dry-run 也不写
    store.appendActivity({ task: t.task_id, event: 'x' })
    assert.equal(existsSync(store.activityPath), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('教训库：去重 + 去敏 + 拒绝空内容', () => {
  const { store, dir } = tmpStore()
  try {
    store.addLesson({ text: '  FastAPI  用  uv 管锁文件  ' })
    const dup = store.addLesson({ text: 'fastapi 用 uv 管锁文件' })
    assert.equal(dup.dedupe, true)
    assert.equal(store.listLessons().length, 1)
    const sec = store.addLesson({ text: 'token 是 sk-abc1234567890123456789 别提交' })
    assert.equal(sec.added, true)
    assert.ok(!store.listLessons().some((l) => /sk-[A-Za-z0-9]{16,}/.test(l.text)))
    const empty = store.addLesson({ text: '   ' })
    assert.equal(empty.added, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('审计日志带任务过滤与去敏', () => {
  const { store, dir } = tmpStore()
  try {
    const t = createInitialTask({ goal: 'x' })
    t.task_id = newTaskId()
    store.appendActivity({ task: t.task_id, event: 'apply', data: { token: 'sk-abc1234567890123456789', ok: 1 } })
    store.appendActivity({ task: 'other', event: 'apply', data: { ok: 2 } })
    const tail = store.tailActivity(t.task_id, 10)
    assert.equal(tail.length, 1)
    assert.ok(!JSON.stringify(tail).includes('sk-abc1234567890123456789'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})