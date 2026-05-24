const fs = require('fs')
const path = require('path')

const ROOT = path.dirname(__filename)
const api = require('./api_config')

// ---- Transcript helpers (inlined from former lib/transcript.js) ----
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
    let best = null, bestMtime = 0
    for (const d of fs.readdirSync(projectsDir)) {
      const full = path.join(projectsDir, d)
      try {
        if (!fs.statSync(full).isDirectory()) continue
        const jsonlFiles = fs.readdirSync(full).filter(f => f.endsWith('.jsonl'))
        if (!jsonlFiles.length) continue
        const newest = Math.max(...jsonlFiles.map(f => fs.statSync(path.join(full, f)).mtimeMs))
        if (newest > bestMtime) { bestMtime = newest; best = full }
      } catch(e2) {}
    }
    if (best) { _transcriptDir = best; try { fs.writeFileSync(CACHE_FILE, best, 'utf-8') } catch(e2) {} ; return best }
  } catch(e) {}
  const fallback = path.join(HOME, '.claude', 'projects', 'C--Users-----')
  if (fs.existsSync(fallback)) { _transcriptDir = fallback; return fallback }
  return null
}

function getTranscriptDir() {
  if (!_transcriptDir) return discoverTranscriptDir()
  return _transcriptDir
}

function getMemoryDir() {
  const td = getTranscriptDir()
  if (!td) return null
  const memDir = path.join(td, 'memory')
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true })
  return memDir
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

// Content validation: skip system error messages and non-project content
function isValidContent(text, minLen = 20) {
  if (!text || text.length < minLen) return false
  const rejectPatterns = [
    /The user doesn't want to proceed with this tool use/i,
    /The tool use was rejected/i,
    /was NOT written to the file/i,
    /STOP what you are doing/i,
    /wait for the user to tell me how to proceed/i,
    /^\(未检测到\)$/, /^暂无相关记忆$/
  ]
  return !rejectPatterns.some(p => p.test(text))
}

function callAPI(messages) {
  return api.callStrong(messages, 1024)
}

// ---- Read transcript context (no DB needed, runs even if index module fails) ----
function readTranscriptContext() {
  // Race condition guard: SessionEnd is async:true, new session may have newer transcript
  // If the newest file has <20 entries, it's likely a fresh new session — use previous file
  const latestFile = findLatest()
  const prevFile = findPrevious()

  let targetFile = latestFile
  if (latestFile && prevFile) {
    try {
      const latestLines = readTail(latestFile.path, 30)
      const prevLines = readTail(prevFile.path, 30)
      // If latest has very few entries (<20) or is mostly continuation markers, use previous
      const realEntries = latestLines.filter(l => {
        try {
          const e = JSON.parse(l)
          // Skip pure system entries (no message role, no conversational content)
          if (e.isMeta) return false
          if (!e.message || !e.message.role) return false
          const c = e.message?.content || ''
          const t = typeof c === 'string' ? c : (Array.isArray(c) ? c.find(b => b.type === 'text')?.text || '' : '')
          if (!t || t.length < 3) return false
          return !t.includes('This session is being continued') && !t.includes('Primary Request') && !t.includes('parentUuid')
        } catch(e2) { return false }
      }).length
      if (realEntries < 20) {
        targetFile = prevFile
      }
    } catch(e) {}
  }

  if (!targetFile) return { context: '', rawLines: [], transcriptPath: null }

  const rawLines = readTail(targetFile.path, 300)
  let context = rawLines.map(l => {
    try {
      const entry = JSON.parse(l)
      const msg = entry.message || {}
      const role = msg.role || 'unknown'
      let content = ''
      if (typeof msg.content === 'string') content = msg.content
      else if (Array.isArray(msg.content)) {
        const tb = msg.content.find(b => b.type === 'text')
        if (tb) content = tb.text
      }
      if (!content || content.includes('parentUuid') || content.includes('sidechain')) return null
      return `[${role}] ${content.substring(0, 500)}`
    } catch(e) { return null }
  }).filter(Boolean).slice(-100).join('\n')

  // Skip if context is mostly env vars / non-conversational noise
  if (context) {
    const envVarLines = context.split('\n').filter(l => /^\[(user|assistant)\]\s*[A-Z_][A-Z0-9_]+=/.test(l)).length
    const totalLines = context.split('\n').filter(Boolean).length
    if (totalLines > 0 && envVarLines / totalLines > 0.5) {
      context = ''
    }
  }
  return { context, rawLines, transcriptPath: targetFile.path }
}

// ---- Helpers for cleaning up extracted messages ----
function isCommandMsg(text) {
  return text.includes('<command-message') || text.includes('<command-name') || text.includes('<command-args')
    || text.includes('<local-command-caveat>') || text.includes('<local-command-stdout>') || text.includes('<local-command-stderr>')
}

function stripAngleTags(text) {
  if (!text) return text
  let r = text
  let prev
  do { prev = r; r = r.replace(/<[\w-]+>[\s\S]*?<\/[\w-]+>/g, '') } while (r !== prev)
  r = r.replace(/<[\w-]+\/>/g, '').replace(/<\/?[\w-]+>/g, '').trim()
  return r
}

// ---- Extract last user/assistant messages directly from raw transcript ----
function extractLastMessages(rawLines) {
  let lastUserText = '', lastAssistantText = '', firstUserText = ''
  // Scan backwards to find user messages with string content
  for (let i = rawLines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(rawLines[i])
      if (e.isMeta) continue // skip system metadata entries
      const msg = e.message || {}
      const content = msg.content
      if (e.type === 'user' && typeof content === 'string' && content.length > 2) {
        if (isCommandMsg(content)) continue
        const cleaned = stripAngleTags(content).substring(0, 200)
        if (cleaned.length <= 2) continue
        // Skip system-level noise that survived stripAngleTags
        if (/^(Caveat:|Bye!|The messages below)/.test(cleaned)) continue
        if (!lastUserText) lastUserText = cleaned
        firstUserText = cleaned.substring(0, 150) // overwrite = earliest non-command msg
      }
      if (e.type === 'assistant' && !lastAssistantText) {
        let text = ''
        if (typeof content === 'string') text = content
        else if (Array.isArray(content)) {
          const tb = content.find(c => c.type === 'text')
          if (tb) text = tb.text
        }
        if (text && text.length > 5 && !text.includes('parentUuid') && !text.includes('sidechain')) {
          lastAssistantText = stripAngleTags(text).substring(0, 200)
        }
      }
    } catch(e) {}
  }
  return { lastUserText, lastAssistantText, firstUserText }
}

// ---- Write auto-memory from transcript context (no AI needed) ----
function writeAutoMemory(context, rawLines) {
  if (!context || !isValidContent(context, 20)) return false
  try {
    // Primary: extract from raw transcript entries (handles CC's tool_result-heavy format)
    let { lastUserText, lastAssistantText, firstUserText } = extractLastMessages(rawLines || [])

    // Fallback: extract from [role] context lines if raw parsing found nothing
    if (!lastUserText || !lastAssistantText) {
      const lastLines = context.split('\n').filter(Boolean).slice(-15)
      const userLines = lastLines.filter(l => l.startsWith('[user]')).map(l => l.replace(/^\[user\]\s*/, ''))
      const asstLines = lastLines.filter(l => l.startsWith('[assistant]')).map(l => l.replace(/^\[assistant\]\s*/, ''))
      if (!lastUserText) {
        for (let j = userLines.length - 1; j >= 0; j--) {
          const txt = stripAngleTags(userLines[j])
          if (!isCommandMsg(userLines[j]) && txt.length > 2) {
            lastUserText = txt.substring(0, 200); break
          }
        }
      }
      if (!lastAssistantText && asstLines.length > 0) {
        lastAssistantText = stripAngleTags(asstLines[asstLines.length-1]).substring(0, 200)
      }
      if (!firstUserText && userLines.length > 0) {
        for (let j = 0; j < userLines.length; j++) {
          const txt = stripAngleTags(userLines[j])
          if (!isCommandMsg(userLines[j]) && txt.length > 2) {
            firstUserText = txt.substring(0, 150); break
          }
        }
      }
    }

    const body = `上一句: ${lastUserText || '(未检测到)'}
此前: ${firstUserText || lastUserText || '(未检测到)'}
上次: ${lastAssistantText || '(未检测到)'}`
    saveAutoMemory('wiz_last_session', 'Wiz last session summary', 'project', body)
    process.stdout.write(`[wiz] auto-memory wiz_last_session updated\n`)

    // Also update CLAUDE.local.md so it doesn't carry stale conversational data
    try {
      const homeDir = process.env.USERPROFILE || process.env.HOME || ROOT
      const localFile = path.join(homeDir, '.claude', 'CLAUDE.local.md')
      if (fs.existsSync(localFile)) {
        let localContent = fs.readFileSync(localFile, 'utf-8')
        const summaryLine = `上一句: ${(lastUserText || '').substring(0, 100)}`
        if (localContent.includes('## 本次会话最近对话')) {
          localContent = localContent.replace(/## 本次会话最近对话[\s\S]*?(?=\n## |$)/,
            `## 本次会话最近对话\n${summaryLine}`)
        } else {
          localContent += `\n## 本次会话最近对话\n${summaryLine}\n`
        }
        fs.writeFileSync(localFile, localContent, 'utf-8')
      }
    } catch(e) {
      process.stdout.write(`[wiz] CLAUDE.local.md update skipped: ${e.message}\n`)
    }

    return true
  } catch(e) {
    process.stdout.write(`[wiz] auto-memory write failed: ${e.message}\n`)
    return false
  }
}

async function consolidate() {
  // Index module may fail (better-sqlite3 not found) — auto-memory should still work
  let index = null
  let stats = { semanticCount: 0, proceduralCount: 0, skillCount: 0, evoCount: 0, episodeCount: 0 }
  try {
    index = require(path.join(ROOT, 'index'))
    index.init()
    index.ensureMemoryDirs()
    stats = index.getStats()
  } catch(e) {
    process.stdout.write(`[wiz] index module unavailable: ${e.message}\n`)
  }

  const sessionId = `s${Date.now()}_${Math.random().toString(36).substring(2, 6)}`

  // Read transcript (always works, no DB needed)
  const { context, rawLines } = readTranscriptContext()

  // STEP 1: Write auto-memory FIRST — independent of AI, independent of DB
  writeAutoMemory(context, rawLines)

  // STEP 2: Generate episode summary via AI — depends on DB (for stats) + AI API
  if (index && context && isValidContent(context, 50)) {
    try {
      const epPrompt = `Summarize this Claude Code session in 2-3 sentences in Chinese. Focus on: what was accomplished, key decisions made, and what's pending. Be concise.

Session context:
${context.substring(0, 2000)}`

      const epSummary = await callAPI([{ role: 'user', content: epPrompt }])
      if (epSummary) {
        const epData = {
          sessionId,
          summary: epSummary.trim(),
          savedAt: new Date().toISOString(),
          stats: { semantic: stats.semanticCount, procedural: stats.proceduralCount, skills: stats.skillCount }
        }
        const epFile = path.join(ROOT, 'memory', 'episodic', `${sessionId}.json`)
        fs.writeFileSync(epFile, JSON.stringify(epData, null, 2), 'utf-8')
        process.stdout.write(`[wiz] episode saved: ${epSummary.substring(0, 80)}...\n`)

        // Update injection.md directly so next session has fresh context even if inject.js fails
        try {
          const injFile = path.join(ROOT, 'injection.md')
          if (fs.existsSync(injFile)) {
            let injContent = fs.readFileSync(injFile, 'utf-8')
            const epLine = epSummary.trim().substring(0, 300)
            if (injContent.includes('## 上次对话')) {
              injContent = injContent.replace(/## 上次对话[\s\S]*?(?=\n## |\n---|\n> |$)/,
                `## 上次对话\n${epLine}`)
            } else {
              // Insert after 项目上下文 section
              injContent = injContent.replace(/(## 项目上下文\n[^\n]+\n)/,
                `$1\n## 上次对话\n${epLine}\n`)
            }
            fs.writeFileSync(injFile, injContent, 'utf-8')
            process.stdout.write(`[wiz] injection.md updated with episode\n`)
          }
        } catch(e) {
          process.stdout.write(`[wiz] injection.md update skipped: ${e.message}\n`)
        }
      }
    } catch(e) {
      process.stdout.write(`[wiz] episode summary failed: ${e.message}\n`)
    }
  }

  // STEP 2.5: Save raw transcript (全量保存)
  const { transcriptPath } = readTranscriptContext()
  if (index && transcriptPath) {
    try {
      const saved = index.saveRawEpisodic(sessionId, transcriptPath)
      if (saved) {
        process.stdout.write(`[wiz] raw episodic saved for ${sessionId}\n`)
      } else {
        process.stdout.write(`[wiz] raw episodic skipped (too few messages)\n`)
      }
    } catch(e) {
      process.stdout.write(`[wiz] raw episodic save failed: ${e.message}\n`)
    }
  }

  // Extract key facts from session (needs index/DB + AI)
  if (index && context && isValidContent(context, 50)) {
    try {
      const prompt = `Extract 3 key reusable facts from this Claude Code session context. Focus on: technical conclusions, project decisions, lessons learned. Output one per line: key: content

${context.substring(0, 2000)}`

      const result = await callAPI([{ role: 'user', content: prompt }])
      const lines = result.split('\n').filter(l => l.includes(': '))
      let extracted = 0
      for (const line of lines) {
        const m = line.match(/^([\w_]+):\s*(.+)/)
        if (m && isValidContent(m[2].trim(), 10)) {
          index.saveSemantic(m[1], m[2].trim())
          index.logEvolution(sessionId, 'extract', { key: m[1] })
          extracted++
        }
      }
      process.stdout.write(`[wiz] extracted ${extracted} facts from session\n`)
    } catch(e) {
      process.stdout.write(`[wiz] session extraction failed: ${e.message}\n`)
    }
  }

  // All following steps require index (DB) — skip if unavailable
  if (index) {
    // ---- FEEDBACK: Analyze which injected memories were used ----
    try {
      const injContent = fs.readFileSync(path.join(ROOT, 'injection.md'), 'utf-8')
      const injectedKeys = []
      const re = /^-\s+(\w+):/gm
      let m
      while ((m = re.exec(injContent)) !== null) {
        injectedKeys.push(m[1])
      }

      if (injectedKeys.length > 0) {
        const transcriptDir = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'projects', 'D--claude')
        let transcriptText = ''
        try {
          const files = fs.readdirSync(transcriptDir).filter(f => f.endsWith('.jsonl'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(transcriptDir, f)).mtime }))
            .sort((a, b) => b.mtime - a.mtime)
          if (files.length > 0) {
            const raw = fs.readFileSync(path.join(transcriptDir, files[0].name), 'utf-8')
            const lines = raw.split('\n').filter(Boolean)
            transcriptText = lines.slice(-200).map(l => {
              try { return JSON.parse(l).message?.content || '' } catch(e) { return l.substring(0, 200) }
            }).join('\n')
          }
        } catch(e) {}

        const refs = index.detectMemoryReferences(injectedKeys, transcriptText)
        const refKeys = new Set(refs.map(r => r.key))

        for (const key of injectedKeys) {
          if (refKeys.has(key)) {
            index.recordFeedback(key, 'referenced', sessionId, 'found_in_transcript')
            index.recordFeedback(key, 'helped', sessionId, 'session_used_memory')
          }
        }

        if (refs.length > 0) {
          process.stdout.write(`[wiz] feedback: ${refs.length}/${injectedKeys.length} memories referenced, recorded helped\n`)
        }
      }
    } catch(e) {
      process.stdout.write(`[wiz] feedback analysis error: ${e.message}\n`)
    }

    // ---- SKILL FEEDBACK: Detect invocation + completion ----
    try {
      const injContent = fs.readFileSync(path.join(ROOT, 'injection.md'), 'utf-8')
      const injectedSkills = []
      const skillRe = /^### (\S+)/gm
      let sm
      while ((sm = skillRe.exec(injContent)) !== null) {
        injectedSkills.push(sm[1])
      }

      if (injectedSkills.length > 0) {
        const transcriptDir = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'projects', 'D--claude')
        let transcriptText = ''
        try {
          const files = fs.readdirSync(transcriptDir).filter(f => f.endsWith('.jsonl'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(transcriptDir, f)).mtime }))
            .sort((a, b) => b.mtime - a.mtime)
          if (files.length > 0) {
            const raw = fs.readFileSync(path.join(transcriptDir, files[0].name), 'utf-8')
            transcriptText = raw.substring(Math.max(0, raw.length - 8000))
          }
        } catch(e) {}

        const invokedSkills = []
        for (const sn of injectedSkills) {
          const pattern = new RegExp(`Skill\\(\\{[^}]*skill["']?\\s*:\\s*["']${sn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i')
          if (pattern.test(transcriptText)) {
            invokedSkills.push(sn)
            index.recordSkillFeedback(sn, 'invoked', '', sessionId, 0.8)
          }
        }

        const completionSignals = [
          /完成|好了|搞定|done|fixed?|resolved?|success/i,
          /✅|🎉|👍/,
          /it works?|working now|no more error/i
        ]
        const failureSignals = [
          /不行|不对|没用|错误|失败|error|crash|bug/i,
          /重来|换个|再试|doesn't work|still broken/i
        ]
        const hasCompletion = completionSignals.some(p => p.test(transcriptText))
        const hasFailure = failureSignals.some(p => p.test(transcriptText))

        if (hasCompletion && !hasFailure && invokedSkills.length > 0) {
          for (const sn of invokedSkills) {
            index.recordSkillFeedback(sn, 'completed', '', sessionId, 0.9)
          }
          process.stdout.write(`[wiz] skill_fb: ${invokedSkills.length} skills completed\n`)
        } else if (invokedSkills.length > 0) {
          for (const sn of invokedSkills) {
            index.recordSkillFeedback(sn, 'failed', '', sessionId, 0.2)
          }
        }

        for (const sn of injectedSkills) {
          if (!invokedSkills.includes(sn)) {
            index.recordSkillFeedback(sn, 'not_used', '', sessionId, 0.3)
          }
        }

        index.syncSkillPrefsToFile()
      }
    } catch(e) {
      process.stdout.write(`[wiz] skill_fb error: ${e.message}\n`)
    }

    // ---- GRAPH: Ensure graph module is loaded ----
    try {
      const graph = require(path.join(ROOT, 'graph'))
      graph.init()
    } catch(e) {}

    // Compact and log
    const compacted = index.compactMemories()
    index.logEvolution(sessionId, 'session_end', { compacted })

    // Auto-run hermes_fusion every ~5 sessions
    let lastCount = 0
    try { lastCount = parseInt(fs.readFileSync(HERMES_COUNT_FILE, 'utf-8')) } catch(e) {}
    if (stats.semanticCount > lastCount + 50 && stats.semanticCount > lastCount * 1.15) {
      try {
        const { execSync } = require('child_process')
        const pyCmd = 'import daemon,json; print(json.dumps(daemon.hermes_fusion()))'
        const result = execSync(`python -c "${pyCmd}"`, {
          cwd: ROOT, timeout: 90000, encoding: 'utf-8', windowsHide: true
        })
        process.stdout.write(`[wiz] hermes_fusion: ${result.trim()}\n`)
        fs.writeFileSync(HERMES_COUNT_FILE, String(stats.semanticCount))
      } catch(e) {
        process.stdout.write(`[wiz] hermes_fusion failed: ${e.message}\n`)
      }
    }

    // Smart elimination: tier management + raw episodic cleanup
    try {
      const elimination = index.runSmartElimination()
      if (elimination.rawDeleted > 0 || elimination.promoted > 0 || elimination.demoted > 0 || elimination.archived > 0) {
        process.stdout.write(`[wiz] elimination: raw_deleted=${elimination.rawDeleted} compressed=${elimination.rawCompressed} promoted=${elimination.promoted} demoted=${elimination.demoted} archived=${elimination.archived}\n`)
      }
    } catch(e) {
      process.stdout.write(`[wiz] elimination failed: ${e.message}\n`)
    }

    // JS-side pruneIneffective as backup
    const pruned = index.pruneIneffective()
    if (pruned > 0) process.stdout.write(`[wiz] JS prune: removed ${pruned} ineffective memories\n`)

    const afterStats = index.getStats()
    process.stdout.write(`[wiz] session ${sessionId} done | mems: ${stats.semanticCount}→${afterStats.semanticCount} | raw_epi: ${afterStats.rawEpisodicCount} | episode: saved\n`)

    // Storage budget check
    try {
      const budget = index.checkStorageBudget()
      if (budget.budget !== 'ok') {
        process.stdout.write(`[wiz] storage: ${budget.sizeMB.toFixed(1)}MB (${budget.budget}) action=${budget.action}\n`)
      }
    } catch(e) {}
  }

  // Episodic tiered retention (no DB needed)
  cleanEpisodic()
}

// Tiered retention for episodic memories
function cleanEpisodic() {
  const episodicDir = path.join(ROOT, 'memory', 'episodic')
  if (!fs.existsSync(episodicDir)) return
  const now = Date.now()
  const DAY = 86400000
  const criticalKeywords = /决策|架构|根因|方案|决定|修复|原因|design|architecture|root.cause|decision/i

  const files = fs.readdirSync(episodicDir).filter(f => f.endsWith('.json'))
  let deleted = 0, merged = 0
  const weekBuckets = {}

  for (const file of files) {
    const filePath = path.join(episodicDir, file)
    let stat
    try { stat = fs.statSync(filePath) } catch(e) { continue }
    const age = now - stat.mtimeMs

    if (age > 90 * DAY) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        if (criticalKeywords.test(content)) continue
      } catch(e) {}
      fs.unlinkSync(filePath)
      deleted++
    } else if (age > 30 * DAY) {
      // Merge oldest files in same ISO week bucket when 30+ days old
      const d = new Date(stat.mtimeMs)
      // Convert to ISO week number: getWeekOfYear
      const startOfYear = new Date(d.getFullYear(), 0, 1)
      const weekNum = Math.ceil((((d - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7)
      const weekKey = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
      if (!weekBuckets[weekKey]) weekBuckets[weekKey] = []
      weekBuckets[weekKey].push(filePath)
    }
  }

  for (const weekFiles of Object.values(weekBuckets)) {
    if (weekFiles.length <= 1) continue
    weekFiles.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs)
    for (let i = 0; i < weekFiles.length - 1; i++) {
      try { fs.unlinkSync(weekFiles[i]); merged++ } catch(e) {}
    }
  }

  if (deleted > 0 || merged > 0) {
    process.stdout.write(`[wiz] episodic: deleted ${deleted}, merged ${merged}\n`)
  }
}

const HERMES_COUNT_FILE = path.join(ROOT, '.hermes_counter')

async function main() {
  // Debounce guard: prevent multiple SessionEnd invocations from racing
  const CONSOLIDATE_LOCK = path.join(ROOT, '.consolidate.lock')
  let lockFd = null
  try {
    lockFd = fs.openSync(CONSOLIDATE_LOCK, 'wx')
    fs.writeSync(lockFd, String(process.pid))
  } catch(e) {
    if (e.code === 'EEXIST') {
      try {
        const t = fs.statSync(CONSOLIDATE_LOCK).mtimeMs
        if (Date.now() - t < 30000) {
          process.stdout.write(`[wiz] consolidate skipped: lock held by another instance\n`)
          return // another consolidate running within 30s
        }
        fs.unlinkSync(CONSOLIDATE_LOCK)
        lockFd = fs.openSync(CONSOLIDATE_LOCK, 'wx')
        fs.writeSync(lockFd, String(process.pid))
      } catch(e2) { return }
    } else { throw e }
  }
  const releaseLock = () => { try { fs.closeSync(lockFd); fs.unlinkSync(CONSOLIDATE_LOCK) } catch(e) {} }

  const logFile = path.join(ROOT, 'consolidate.log')
  fs.appendFileSync(logFile, `${new Date().toISOString()} SessionEnd START\n`)
  try {
    await consolidate()
    fs.appendFileSync(logFile, `${new Date().toISOString()} SessionEnd DONE\n`)
  } catch(e) {
    fs.appendFileSync(logFile, `${new Date().toISOString()} SessionEnd ERROR: ${e.message}\n`)
    // Fallback: even if consolidate() crashes, write auto-memory from raw transcript
    try {
      // Use prev file to avoid racing with any new session that just started
      const target = findPrevious() || findLatest()
      if (target) {
        const raw = readTail(target.path, 300)
        const lines = raw.map(l => {
          try {
            const e = JSON.parse(l)
            const msg = e.message || {}
            const role = msg.role || 'unknown'
            let c = ''
            if (typeof msg.content === 'string') c = msg.content
            else if (Array.isArray(msg.content)) {
              const tb = msg.content.find(b => b.type === 'text')
              if (tb) c = tb.text
            }
            if (!c || c.includes('parentUuid')) return null
            return `[${role}] ${c.substring(0, 500)}`
          } catch(e3) { return null }
        }).filter(Boolean).slice(-100).join('\n')
        if (lines) {
          // Extract user messages from raw transcript (handles CC's tool_result format)
          let lu = '', la = '', fu = ''
          for (let i = raw.length - 1; i >= 0; i--) {
            try {
              const e = JSON.parse(raw[i])
              const msg = e.message || {}
              const c = msg.content
              if (e.type === 'user' && typeof c === 'string' && c.length > 2) {
                if (isCommandMsg(c)) continue
                const cleaned = stripAngleTags(c).substring(0, 200)
                if (cleaned.length <= 2) continue
                if (!lu) lu = cleaned
                fu = cleaned.substring(0, 150) // overwrite = earliest non-command msg
              }
              if (e.type === 'assistant' && !la) {
                let t = ''
                if (typeof c === 'string') t = c
                else if (Array.isArray(c)) { const tb = c.find(x => x.type === 'text'); if (tb) t = tb.text }
                if (t && t.length > 5 && !t.includes('parentUuid')) la = stripAngleTags(t).substring(0, 200)
              }
            } catch(e4) {}
          }
          const body = `上一句: ${lu || '(fallback)'}\n此前: ${fu || lu || '(fallback)'}\n上次: ${la || '(fallback)'}`
          saveAutoMemory('wiz_last_session', 'Wiz last session summary', 'project', body)
          // Fallback should also update CLAUDE.local.md
          try {
            const homeDir = process.env.USERPROFILE || process.env.HOME || ROOT
            const localFile = path.join(homeDir, '.claude', 'CLAUDE.local.md')
            if (fs.existsSync(localFile)) {
              let localContent = fs.readFileSync(localFile, 'utf-8')
              const summaryLine = `上一句: ${(lu || '').substring(0, 100)}`
              if (localContent.includes('## 本次会话最近对话')) {
                localContent = localContent.replace(/## 本次会话最近对话[\s\S]*?(?=\n## |$)/,
                  `## 本次会话最近对话\n${summaryLine}`)
              } else {
                localContent += `\n## 本次会话最近对话\n${summaryLine}\n`
              }
              fs.writeFileSync(localFile, localContent, 'utf-8')
            }
          } catch(e) {}
          fs.appendFileSync(logFile, `${new Date().toISOString()} auto-memory fallback written\n`)
        }
      }
    } catch(e2) {
      fs.appendFileSync(logFile, `${new Date().toISOString()} auto-memory fallback failed: ${e2.message}\n`)
    }
  } finally {
    releaseLock()
  }
}

main()
