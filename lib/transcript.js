const path = require('path')
const fs = require('fs')

const ROOT = path.dirname(path.dirname(__filename))
const HOME = process.env.HOME || process.env.USERPROFILE
const CACHE_FILE = path.join(ROOT, '.transcript_dir_cache')

let _transcriptDir = null

function discoverTranscriptDir() {
  if (_transcriptDir && fs.existsSync(_transcriptDir)) return _transcriptDir

  try {
    const cached = fs.readFileSync(CACHE_FILE, 'utf-8').trim()
    if (cached && fs.existsSync(cached)) {
      const hasJsonl = fs.readdirSync(cached).some(f => f.endsWith('.jsonl'))
      if (hasJsonl) { _transcriptDir = cached; return cached }
    }
  } catch(e) {}

  const projectsDir = path.join(HOME, '.claude', 'projects')
  try {
    if (!fs.existsSync(projectsDir)) return null
    const dirs = fs.readdirSync(projectsDir)
      .map(d => path.join(projectsDir, d))
      .filter(d => { try { return fs.statSync(d).isDirectory() } catch(e) { return false } })

    let best = null, bestMtime = 0
    for (const d of dirs) {
      try {
        const jsonlFiles = fs.readdirSync(d).filter(f => f.endsWith('.jsonl'))
        if (jsonlFiles.length === 0) continue
        const newest = Math.max(...jsonlFiles.map(f => {
          try { return fs.statSync(path.join(d, f)).mtimeMs } catch(e) { return 0 }
        }))
        if (newest > bestMtime) { bestMtime = newest; best = d }
      } catch(e) {}
    }

    if (best) {
      _transcriptDir = best
      try { fs.writeFileSync(CACHE_FILE, best, 'utf-8') } catch(e) {}
      return best
    }
  } catch(e) {}

  const fallback = path.join(HOME, '.claude', 'projects', 'C--Users-----')
  if (fs.existsSync(fallback)) {
    _transcriptDir = fallback
    try { fs.writeFileSync(CACHE_FILE, fallback, 'utf-8') } catch(e) {}
    return fallback
  }
  return null
}

function getTranscriptDir() {
  if (!_transcriptDir) return discoverTranscriptDir()
  return _transcriptDir
}

function findLatest() {
  try {
    const dir = getTranscriptDir()
    if (!dir) return null
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtime, path: path.join(dir, f) }))
      .sort((a, b) => b.mtime - a.mtime)
    return files[0] || null
  } catch(e) { return null }
}

function findPrevious() {
  try {
    const dir = getTranscriptDir()
    if (!dir) return null
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtime, path: path.join(dir, f) }))
      .sort((a, b) => b.mtime - a.mtime)
    return files.length >= 2 ? files[1] : null
  } catch(e) { return null }
}

function readTail(filePath, N) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    return lines.slice(-N)
  } catch(e) { return [] }
}

function readNewLines(filePath, lastPos) {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size <= lastPos) return { lines: [], newPos: lastPos }
    const fd = fs.openSync(filePath, 'r')
    fs.readSync(fd, Buffer.alloc(0), 0, 0, lastPos)
    const buf = Buffer.alloc(stat.size - lastPos)
    fs.readSync(fd, buf, 0, buf.length, lastPos)
    fs.closeSync(fd)
    const text = buf.toString('utf-8')
    const lines = text.split('\n').filter(Boolean)
    return { lines, newPos: stat.size }
  } catch(e) { return { lines: [], newPos: lastPos } }
}

function getUserMessages(lines, limit) {
  const userMsgs = []
  const systemPatterns = [
    'This session is being continued',
    'Primary Request and Intent:',
    'Request interrupted by user for tool use',
    'parentUuid',
    'sidechain'
  ]
  for (let i = lines.length - 1; i >= 0 && userMsgs.length < limit; i--) {
    try {
      const entry = JSON.parse(lines[i])
      if (entry.type !== 'user') continue
      const msg = entry.message
      if (!msg) continue
      let text = null
      if (typeof msg === 'string') text = msg
      else if (typeof msg.content === 'string') text = msg.content
      else if (Array.isArray(msg.content)) {
        const tb = msg.content.find(b => b.type === 'text')
        if (tb) text = tb.text
        if (!text) {
          const tr = msg.content.find(b => b.type === 'tool_result')
          if (tr) {
            const raw = typeof tr.content === 'string' ? tr.content : ''
            text = stripSystemTags(raw)
          }
        }
      }
      if (!text) continue
      if (systemPatterns.some(p => text.includes(p))) continue
      if (/^Continue from where you left off/.test(text)) continue
      const cleaned = stripSystemTags(text)
      if (cleaned && cleaned.length > 1) userMsgs.push(cleaned.substring(0, 300))
    } catch(e) {}
  }
  return userMsgs
}

function compressForExtraction(lines, maxChars) {
  const msgs = []
  for (let i = 0; i < lines.length && msgs.length < 100; i++) {
    try {
      const obj = JSON.parse(lines[i])
      const msg = obj.message || {}
      const role = msg.role || 'unknown'
      let content = msg.content || ''
      if (typeof content !== 'string') content = JSON.stringify(content)
      if (content) msgs.push(`[${role}] ${content.substring(0, 800)}`)
    } catch(e) {}
  }
  const text = msgs.join('\n')
  if (text.length <= maxChars) return text
  return text.substring(0, maxChars)
}

function getRecentContext(N = 50) {
  try {
    const latest = findLatest()
    if (!latest) return ''
    const raw = fs.readFileSync(latest.path, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const recent = []
    for (let i = Math.max(0, lines.length - N); i < lines.length; i++) {
      try {
        const e = JSON.parse(lines[i])
        const msg = e.message
        if (!msg || !msg.role) continue
        let txt = ''
        if (typeof msg.content === 'string') txt = msg.content
        else if (Array.isArray(msg.content)) {
          const tb = msg.content.find(b => b.type === 'text')
          if (tb) txt = tb.text
        }
        if (txt && txt.length > 5 && !txt.includes('parentUuid') && !txt.includes('sidechain')) {
          recent.push(`[${msg.role}] ${stripSystemTags(txt).substring(0, 120)}`)
        }
      } catch(e) {}
    }
    return recent.slice(-6).join('\n')
  } catch(e) { return '' }
}

function projectContext() {
  let ctx = [`工作目录: ${process.cwd()}`]
  try {
    const files = fs.readdirSync(process.cwd()).filter(f => !f.startsWith('.')).slice(0, 15)
    ctx.push(`文件: ${files.join(', ')}`)
  } catch(e) {}
  return ctx.join('\n')
}

function getMemoryDir() {
  const td = getTranscriptDir()
  if (!td) return null
  const memDir = path.join(td, 'memory')
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true })
  return memDir
}

function saveAutoMemory(name, description, type, body) {
  try {
    const memDir = getMemoryDir()
    if (!memDir) return false
    const fileName = `${name}.md`
    const filePath = path.join(memDir, fileName)

    const frontmatter = `---
name: ${name}
description: "${(description || '').replace(/"/g, '\\"')}"
metadata:
  type: ${type || 'project'}
---
${body}`
    fs.writeFileSync(filePath, frontmatter, 'utf-8')

    const indexFile = path.join(memDir, 'MEMORY.md')
    let index = ''
    try { index = fs.readFileSync(indexFile, 'utf-8') } catch(e) {}
    const entryLine = `- [${description || name}](${fileName}) — ${body.substring(0, 80).replace(/\n/g, ' ')}`
    if (index.includes(fileName)) {
      const lines = index.split('\n')
      const updated = lines.map(l => l.includes(fileName) ? entryLine : l).join('\n')
      fs.writeFileSync(indexFile, updated, 'utf-8')
    } else {
      fs.writeFileSync(indexFile, index.trimEnd() + '\n' + entryLine + '\n', 'utf-8')
    }
    return true
  } catch(e) { return false }
}

function stripSystemTags(text) {
  if (!text) return text
  let result = text
  let prev
  do {
    prev = result
    result = result.replace(/<[\w-]+>[\s\S]*<\/[\w-]+>/g, '')
  } while (result !== prev)
  result = result.replace(/<[\w-]+\/>/g, '')
  result = result.replace(/<\/?[\w-]+>/g, '')
  result = result.replace(/\[Request interrupted by user for tool use\][\s\S]*?(?=\n|$)/g, '').trim()
  return result
}

module.exports = {
  getTranscriptDir, getMemoryDir, findLatest, findPrevious, readTail, readNewLines,
  getUserMessages, compressForExtraction, getRecentContext, projectContext, saveAutoMemory,
  stripSystemTags
}
