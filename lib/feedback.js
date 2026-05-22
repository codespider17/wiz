const path = require('path')
const fs = require('fs')

function recordMemInjections(mems, method, sessionId, index) {
  try {
    for (const m of mems) {
      index.recordFeedback(m.key, 'injected', sessionId, `selected_by_${method}`)
    }
    return true
  } catch(e) { return false }
}

function recordSkillInjections(skills, task, sessionId, index) {
  try {
    for (const s of skills) {
      index.recordSkillFeedback(s.name, 'injected', task, sessionId, 0.5)
    }
    index.syncSkillPrefsToFile()
    return true
  } catch(e) { return false }
}

function detectSkillUsage(injectedSkills, transcriptText, index) {
  if (!injectedSkills || injectedSkills.length === 0) return { invoked: [], notUsed: [] }

  const invokedSkills = []
  for (const sn of injectedSkills) {
    const escaped = sn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`Skill\\(\\{[^}]*skill["']?\\s*:\\s*["']${escaped}["']`, 'i')
    if (pattern.test(transcriptText)) {
      invokedSkills.push(sn)
      index.recordSkillFeedback(sn, 'invoked', '', '', 0.8)
    }
  }

  const completionSignals = [/完成|好了|搞定|done|fixed?|resolved?|success/i, /✅|🎉|👍/, /it works?|working now|no more error/i]
  const failureSignals = [/不行|不对|没用|错误|失败|error|crash|bug/i, /重来|换个|再试|doesn't work|still broken/i]
  const hasCompletion = completionSignals.some(p => p.test(transcriptText))
  const hasFailure = failureSignals.some(p => p.test(transcriptText))

  if (hasCompletion && !hasFailure && invokedSkills.length > 0) {
    for (const sn of invokedSkills) {
      index.recordSkillFeedback(sn, 'completed', '', '', 0.9)
    }
  } else if (invokedSkills.length > 0) {
    for (const sn of invokedSkills) {
      index.recordSkillFeedback(sn, 'failed', '', '', 0.2)
    }
  }

  const notUsed = injectedSkills.filter(sn => !invokedSkills.includes(sn))
  for (const sn of notUsed) {
    index.recordSkillFeedback(sn, 'not_used', '', '', 0.3)
  }
  index.syncSkillPrefsToFile()

  return { invoked: invokedSkills, notUsed }
}

function detectMemoryRefs(injectedKeys, transcriptText, index) {
  if (!injectedKeys || injectedKeys.length === 0) return []
  return index.detectMemoryReferences(injectedKeys, transcriptText)
}

function runSessionFeedback(injectedKeys, injectedSkills, transcriptText, index, sessionId) {
  const results = { memRefs: 0, memTotal: injectedKeys.length, skillsInvoked: 0, skillsTotal: injectedSkills.length }

  if (injectedKeys.length > 0) {
    const refs = detectMemoryRefs(injectedKeys, transcriptText, index)
    const refKeys = new Set(refs.map(r => r.key))
    for (const key of injectedKeys) {
      if (refKeys.has(key)) {
        index.recordFeedback(key, 'referenced', sessionId, 'found_in_transcript')
        index.recordFeedback(key, 'helped', sessionId, 'session_used_memory')
      } else {
        index.recordFeedback(key, 'did_not_help', sessionId, 'no_ref_in_transcript')
      }
    }
    results.memRefs = refs.length
  }

  if (injectedSkills.length > 0) {
    const usage = detectSkillUsage(injectedSkills, transcriptText, index)
    results.skillsInvoked = usage.invoked.length
  }

  return results
}

module.exports = {
  recordMemInjections, recordSkillInjections,
  detectSkillUsage, detectMemoryRefs, runSessionFeedback
}
