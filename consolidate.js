const fs = require('fs')
const path = require('path')
const https = require('https')

const ROOT = path.dirname(__filename)
const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || 'YOUR_DEEPSEEK_API_KEY'

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
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-v4-pro[1m]',
      max_tokens: 1024,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    })
    const req = https.request({
      hostname: 'api.deepseek.com', path: '/anthropic/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' }
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const body = JSON.parse(data)
          if (body.error) { reject(new Error(body.error.message)); return }
          const textBlock = body.content?.find(c => c.type === 'text')
          resolve(textBlock ? textBlock.text : (body.content?.[0]?.text || ''))
        } catch(e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function consolidate() {
  const index = require(path.join(ROOT, 'index'))
  index.init()
  index.ensureMemoryDirs()

  const sessionId = `s${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
  const stats = index.getStats()

  // Read current session context from transcript — NOT from injection.md (which may be stale/overwritten)
  const transcriptLib = require(path.join(ROOT, 'lib', 'transcript'))
  const latestFile = transcriptLib.findLatest()
  let context = ''
  if (latestFile) {
    const rawLines = transcriptLib.readTail(latestFile.path, 300)
    context = rawLines.map(l => {
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
    // Skip episode generation if context is mostly env vars / non-conversational noise
    if (context) {
      const envVarLines = context.split('\n').filter(l => /^\[(user|assistant)\]\s*[A-Z_][A-Z0-9_]+=/.test(l)).length
      const totalLines = context.split('\n').filter(Boolean).length
      if (totalLines > 0 && envVarLines / totalLines > 0.5) {
        context = '' // mostly env var commands, not real conversation
      }
    }
  }

  // Generate episode summary via AI for session continuity
  if (context && isValidContent(context, 50)) {
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
        process.stdout.write(`[overmind] episode saved: ${epSummary.substring(0, 80)}...\n`)

        // Write last session context to auto-memory for cross-session continuity
        try {
          const lastLines = context.split('\n').filter(Boolean).slice(-10)
          const lastUserMsg = (lastLines.filter(l => l.startsWith('[user]')).pop() || '').replace(/^\[user\]\s*/, '').substring(0, 200)
          const lastAssistantMsg = (lastLines.filter(l => l.startsWith('[assistant]')).pop() || '').replace(/^\[assistant\]\s*/, '').substring(0, 200)
          const firstSentence = epSummary.trim().split(/[。！\n]/)[0]
          const body = `上一句: ${lastUserMsg || firstSentence}
此前: ${firstSentence || epSummary.trim().substring(0, 150)}
上次: ${lastAssistantMsg || context.split('\n').pop()?.substring(0, 200) || ''}`
          transcriptLib.saveAutoMemory('wiz_last_session', 'Wiz last session summary', 'project', body)
          process.stdout.write(`[overmind] auto-memory wiz_last_session updated\n`)
        } catch(amErr) {
          process.stdout.write(`[overmind] auto-memory write failed: ${amErr.message}\n`)
        }
      }
    } catch(e) {
      process.stdout.write(`[overmind] episode summary failed: ${e.message}\n`)
    }
  }

  // Extract key facts from session (always run, not just when <100 mems)
  if (context && isValidContent(context, 50)) {
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
      process.stdout.write(`[overmind] extracted ${extracted} facts from session\n`)
    } catch(e) {
      process.stdout.write(`[overmind] session extraction failed: ${e.message}\n`)
    }
  }

  // ---- FEEDBACK: Analyze which injected memories were used ----
  try {
    // Read injection.md to find injected memory keys
    const injContent = fs.readFileSync(path.join(ROOT, 'injection.md'), 'utf-8')
    const injectedKeys = []
    const re = /^-\s+(\w+):/gm
    let m
    while ((m = re.exec(injContent)) !== null) {
      injectedKeys.push(m[1])
    }

    if (injectedKeys.length > 0) {
      // Read current transcript to detect references
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

      // Detect which injected memories were referenced
      const refs = index.detectMemoryReferences(injectedKeys, transcriptText)
      const refKeys = new Set(refs.map(r => r.key))

      for (const key of injectedKeys) {
        if (refKeys.has(key)) {
          index.recordFeedback(key, 'referenced', sessionId, 'found_in_transcript')
          index.recordFeedback(key, 'helped', sessionId, 'session_used_memory')
        }
      }

      if (refs.length > 0) {
        process.stdout.write(`[overmind] feedback: ${refs.length}/${injectedKeys.length} memories referenced, recorded helped\n`)
      }
    }
  } catch(e) {
    process.stdout.write(`[overmind] feedback analysis error: ${e.message}\n`)
  }

  // ---- SKILL FEEDBACK: Detect invocation + completion ----
  try {
    // Find injected skills from injection.md
    const injContent = fs.readFileSync(path.join(ROOT, 'injection.md'), 'utf-8')
    const injectedSkills = []
    const skillRe = /^### (\S+)/gm
    let sm
    while ((sm = skillRe.exec(injContent)) !== null) {
      injectedSkills.push(sm[1])
    }

    if (injectedSkills.length > 0) {
      // Read transcript for detection
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

      // Signal 1: Detect Skill tool invocation
      const invokedSkills = []
      for (const sn of injectedSkills) {
        // Check if skill name appears near Skill tool call pattern
        const pattern = new RegExp(`Skill\\(\\{[^}]*skill["']?\\s*:\\s*["']${sn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i')
        if (pattern.test(transcriptText)) {
          invokedSkills.push(sn)
          index.recordSkillFeedback(sn, 'invoked', '', sessionId, 0.8)
        }
      }

      // Signal 2: Detect task completion
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

      // Only mark completed if completion signals dominate
      if (hasCompletion && !hasFailure && invokedSkills.length > 0) {
        for (const sn of invokedSkills) {
          index.recordSkillFeedback(sn, 'completed', '', sessionId, 0.9)
        }
        process.stdout.write(`[overmind] skill_fb: ${invokedSkills.length} skills completed\n`)
      } else if (invokedSkills.length > 0) {
        for (const sn of invokedSkills) {
          index.recordSkillFeedback(sn, 'failed', '', sessionId, 0.2)
        }
      }

      // Record not_used for injected skills that weren't invoked
      for (const sn of injectedSkills) {
        if (!invokedSkills.includes(sn)) {
          index.recordSkillFeedback(sn, 'not_used', '', sessionId, 0.3)
        }
      }

      // Sync skill prefs to shared file
      index.syncSkillPrefsToFile()
    }
  } catch(e) {
    process.stdout.write(`[overmind] skill_fb error: ${e.message}\n`)
  }

  // ---- GRAPH: Ensure graph module is loaded ----
  try {
    const graph = require(path.join(ROOT, 'graph'))
    graph.init()
  } catch(e) {}

  // Compact and log
  const compacted = index.compactMemories()
  index.logEvolution(sessionId, 'session_end', { compacted })

  // Auto-run hermes_fusion every ~5 sessions to keep memory healthy
  let lastCount = 0
  try { lastCount = parseInt(fs.readFileSync(HERMES_COUNT_FILE, 'utf-8')) } catch(e) {}
  if (stats.semanticCount > lastCount + 50 && stats.semanticCount > lastCount * 1.15) {
    try {
      const { execSync } = require('child_process')
      const pyCmd = 'import daemon,json; print(json.dumps(daemon.hermes_fusion()))'
      const result = execSync(`python -c "${pyCmd}"`, {
        cwd: ROOT, timeout: 90000, encoding: 'utf-8', windowsHide: true
      })
      process.stdout.write(`[overmind] hermes_fusion: ${result.trim()}\n`)
      fs.writeFileSync(HERMES_COUNT_FILE, String(stats.semanticCount))
    } catch(e) {
      process.stdout.write(`[overmind] hermes_fusion failed: ${e.message}\n`)
    }
  }

  // Episodic tiered retention
  cleanEpisodic()

  // JS-side pruneIneffective as backup (Python hermes_fusion may not run every session)
  const pruned = index.pruneIneffective()
  if (pruned > 0) process.stdout.write(`[overmind] JS prune: removed ${pruned} ineffective memories\n`)

  const afterStats = index.getStats()
  process.stdout.write(`[overmind] session ${sessionId} done | mems: ${stats.semanticCount}→${afterStats.semanticCount} | episode: saved\n`)
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
    process.stdout.write(`[overmind] episodic: deleted ${deleted}, merged ${merged}\n`)
  }
}

const HERMES_COUNT_FILE = path.join(ROOT, '.hermes_counter')

async function main() {
  const logFile = path.join(ROOT, 'consolidate.log')
  fs.appendFileSync(logFile, `${new Date().toISOString()} SessionEnd START\n`)
  try {
    await consolidate()
    fs.appendFileSync(logFile, `${new Date().toISOString()} SessionEnd DONE\n`)
  } catch(e) {
    fs.appendFileSync(logFile, `${new Date().toISOString()} SessionEnd ERROR: ${e.message}\n`)
  }
}

main()
