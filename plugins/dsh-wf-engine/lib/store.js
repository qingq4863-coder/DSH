/**
 * dsh-wf-engine 持久化层（§3.2 Checkpoint / §3.3 记忆分级 / §8 审计）。
 * 存储布局（默认 DSH_HOME/wf，可用 env DSH_WF_ROOT 或工具参数覆盖 root）：
 *   tasks/<task_id>.json   任务 checkpoint（原子写：tmp + rename）
 *   active.json            当前任务指针
 *   activity.jsonl         审计日志（追加，写入前经 redactSecrets）
 *   lessons.jsonl          项目/全局教训（去重 + 去敏）
 *   deliveries/<id>.md     交付摘要
 *   evals/<ts>.json        eval 报告
 * dryRun=true 时所有写方法返回 false 且不触碰文件系统。
 */

import {
  appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { redactSecrets } from './redact.js'

export function defaultRoot() {
  return process.env.DSH_WF_ROOT || join(process.env.DSH_HOME || join(process.env.HOME || process.env.USERPROFILE || '.', '.dsh'), 'wf')
}

export function newTaskId() {
  return `task-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export class Store {
  constructor(root, { dryRun = false } = {}) {
    this.root = root
    this.dryRun = dryRun
    this.tasksDir = join(root, 'tasks')
    this.deliveriesDir = join(root, 'deliveries')
    this.evalsDir = join(root, 'evals')
    this.activePath = join(root, 'active.json')
    this.activeSessionsDir = join(root, 'active-sessions')
    this.activityPath = join(root, 'activity.jsonl')
    this.lessonsPath = join(root, 'lessons.jsonl')
  }

  ensure() {
    for (const dir of [this.tasksDir, this.deliveriesDir, this.evalsDir, this.activeSessionsDir]) {
      mkdirSync(dir, { recursive: true })
    }
  }

  _writeFile(path, text) {
    if (this.dryRun) return false
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path) // 原子替换：进程中断不会留下半截 checkpoint
    return true
  }

  hasTask(id) {
    return existsSync(join(this.tasksDir, `${id}.json`))
  }

  saveTask(task) {
    this._writeFile(join(this.tasksDir, `${task.task_id}.json`), `${JSON.stringify(task, null, 2)}\n`)
  }

  loadTask(id) {
    const path = join(this.tasksDir, `${id}.json`)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new Error(`checkpoint ${id} 损坏: ${error.message}`)
    }
  }

  listTasks() {
    if (!existsSync(this.tasksDir)) return []
    return readdirSync(this.tasksDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .map((id) => this.loadTask(id))
      .sort((a, b) => String(b?.updated_at ?? '').localeCompare(String(a?.updated_at ?? '')))
  }

  activePathFor(sessionId = 'global') {
    if (!sessionId || sessionId === 'global') return this.activePath
    const key = createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 24)
    return join(this.activeSessionsDir, `${key}.json`)
  }

  getActive(sessionId = 'global') {
    const path = this.activePathFor(sessionId)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf8')).task_id ?? null
    } catch {
      return null
    }
  }

  setActive(taskId, sessionId = 'global') {
    this._writeFile(this.activePathFor(sessionId), `${JSON.stringify({ task_id: taskId, session_id: sessionId, ts: new Date().toISOString() })}\n`)
  }

  /** 审计日志：全部去敏后落盘；dryRun 不写。返回行对象。 */
  appendActivity({ task, event, data }) {
    const line = { ts: new Date().toISOString(), task: task ?? null, event, data: data ?? {} }
    if (this.dryRun) return line
    const { text } = redactSecrets(JSON.stringify(line))
    try {
      mkdirSync(dirname(this.activityPath), { recursive: true })
      appendFileSync(this.activityPath, `${text}\n`, 'utf8')
    } catch { /* 观测尽力而为 */ }
    return line
  }

  tailActivity(taskId, limit = 20) {
    if (!existsSync(this.activityPath)) return []
    const lines = readFileSync(this.activityPath, 'utf8').split('\n').filter(Boolean)
    const picked = taskId ? lines.filter((l) => l.includes(`"task":"${taskId}"`)) : lines
    return picked.slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return { raw: l } } })
  }

  /** 教训库：去重（规范化哈希）+ 去敏。返回 { added, dedupe, lesson }。 */
  addLesson(lesson) {
    const { text } = redactSecrets(String(lesson.text ?? ''))
    const entry = { text, category: lesson.category ?? 'general', project: lesson.project ?? '', ts: new Date().toISOString() }
    const key = text.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!key) return { added: false, dedupe: true, lesson: null, reason: 'empty' }
    const existing = this.listLessons()
    const seen = existing.some((l) => l.text.trim().toLowerCase().replace(/\s+/g, ' ') === key)
    if (seen) return { added: false, dedupe: true, lesson: entry }
    if (this.dryRun) return { added: false, dedupe: false, lesson: entry, reason: 'dry-run' }
    mkdirSync(dirname(this.lessonsPath), { recursive: true })
    appendFileSync(this.lessonsPath, `${JSON.stringify(entry)}\n`, 'utf8')
    return { added: true, dedupe: false, lesson: entry }
  }

  listLessons() {
    if (!existsSync(this.lessonsPath)) return []
    return readFileSync(this.lessonsPath, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  }

  saveDelivery(taskId, markdown) {
    this._writeFile(join(this.deliveriesDir, `${taskId}.md`), markdown)
  }

  saveEvalReport(report) {
    const path = join(this.evalsDir, `${Date.now()}.json`)
    this._writeFile(path, `${JSON.stringify(report, null, 2)}\n`)
    return path
  }
}