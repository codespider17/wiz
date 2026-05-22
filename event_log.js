const Database = require('better-sqlite3')
const fs = require('fs')
const path = require('path')

const ROOT = path.dirname(__filename)
const DB_PATH = path.join(ROOT, 'event.db')
const MAX_EVENTS = 500
const MAX_STACK_DEPTH = 10

let db

function getDb() {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        session TEXT DEFAULT ''
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_stack (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task TEXT NOT NULL,
        pushed_at TEXT NOT NULL,
        session TEXT DEFAULT ''
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_events_ts ON events(id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_task_stack_id ON task_stack(id)`)
  }
  return db
}

function appendEvent(type, content, sessionId = '') {
  try {
    const d = getDb()
    const ts = new Date().toISOString()
    d.prepare('INSERT INTO events (ts, type, content, session) VALUES (?, ?, ?, ?)')
      .run(ts, type, String(content).substring(0, 500), sessionId)
    trimEvents()
  } catch (e) {
    process.stderr.write(`event_log append: ${e.message}\n`)
  }
}

function getRecentEvents(count = 10) {
  try {
    const d = getDb()
    const rows = d.prepare('SELECT ts, type, content, session FROM events ORDER BY id DESC LIMIT ?').all(count)
    return rows.reverse()
  } catch (e) {
    return []
  }
}

function formatTimeline(count = 10) {
  const events = getRecentEvents(count)
  if (events.length === 0) return ''
  const lines = events.map((e, i) => {
    const d = e.ts ? new Date(e.ts) : new Date()
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    const label = e.type === 'user' ? 'user' : e.type === 'assistant' ? 'assistant' : 'system'
    return `${events.length - i}. ${time} — ${label}: ${String(e.content).substring(0, 200)}`
  })
  return `## 事件时间线\n${lines.join('\n')}`
}

function trimEvents() {
  try {
    const d = getDb()
    const count = d.prepare('SELECT COUNT(*) as c FROM events').get().c
    if (count > MAX_EVENTS) {
      const toDelete = count - MAX_EVENTS
      d.prepare('DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id ASC LIMIT ?)').run(toDelete)
    }
  } catch (e) {}
}

function pushTask(task, sessionId = '') {
  try {
    const d = getDb()
    // Dedup: skip if last task is identical
    const last = d.prepare('SELECT task FROM task_stack ORDER BY id DESC LIMIT 1').get()
    const taskStr = String(task).substring(0, 200)
    if (last && last.task === taskStr) return
    const ts = new Date().toISOString()
    d.prepare('INSERT INTO task_stack (task, pushed_at, session) VALUES (?, ?, ?)')
      .run(taskStr, ts, sessionId)
    const count = d.prepare('SELECT COUNT(*) as c FROM task_stack').get().c
    if (count > MAX_STACK_DEPTH) {
      const toDelete = count - MAX_STACK_DEPTH
      d.prepare('DELETE FROM task_stack WHERE id IN (SELECT id FROM task_stack ORDER BY id ASC LIMIT ?)').run(toDelete)
    }
  } catch (e) {}
}

function getTaskStack(depth = 3) {
  try {
    const d = getDb()
    return d.prepare('SELECT task, pushed_at, session FROM task_stack ORDER BY id DESC LIMIT ?').all(depth)
  } catch (e) {
    return []
  }
}

function formatTaskStack(depth = 3) {
  const tasks = getTaskStack(depth)
  if (tasks.length === 0) return ''
  const lines = tasks.map((t, i) => {
    const d = t.pushed_at ? new Date(t.pushed_at) : new Date()
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    return `${i + 1}. [${time}] ${String(t.task).substring(0, 150)}`
  })
  return `## 任务回溯\n${lines.join('\n')}`
}

function clearTaskStack() {
  try {
    const d = getDb()
    d.prepare('DELETE FROM task_stack').run()
  } catch (e) {}
}

function backfillFromSnapshot(episodicDir) {
  try {
    const d = getDb()
    const count = d.prepare('SELECT COUNT(*) as c FROM events').get().c
    if (count > 0) return

    const files = fs.readdirSync(episodicDir)
      .filter(f => f.startsWith('snap_') && f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(episodicDir, f)).mtime }))
      .sort((a, b) => a.mtime - b.mtime)

    const stmt = d.prepare('INSERT OR IGNORE INTO events (ts, type, content, session) VALUES (?, ?, ?, ?)')
    const insertMany = d.transaction((events) => {
      for (const e of events) stmt.run(e.ts, e.type, e.content, e.session)
    })

    const batch = []
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(episodicDir, f.name), 'utf-8'))
        const summary = data.summary || ''
        const taskMatch = summary.match(/任务:\s*([^|]+)/)
        const task = taskMatch ? taskMatch[1].trim() : ''
        if (task) {
          const ts = data.savedAt || new Date(f.mtime).toISOString()
          batch.push({ ts, type: 'user', content: task, session: data.sessionId || f.name })
        }
      } catch (e) {}
    }

    if (batch.length > 0) insertMany(batch)
  } catch (e) {
    process.stderr.write(`event_log backfill: ${e.message}\n`)
  }
}

module.exports = {
  appendEvent, getRecentEvents, formatTimeline,
  pushTask, getTaskStack, formatTaskStack, clearTaskStack,
  backfillFromSnapshot
}
