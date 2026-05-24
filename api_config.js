/**
 * Wiz API Configuration
 *
 * ccswitch 通过设置环境变量来切换模型，wiz 从环境变量读取配置。
 *
 * 环境变量:
 *   WIZ_API_KEY       — API Key (fallback: DEEPSEEK_API_KEY → ANTHROPIC_AUTH_TOKEN)
 *   WIZ_BASE_URL      — API 基础地址 (默认: https://api.deepseek.com)
 *   WIZ_FAST_MODEL    — 快速模型名 (默认: deepseek-v4-flash)
 *   WIZ_STRONG_MODEL  — 强力模型名 (默认: deepseek-v4-pro[1m])
 *   WIZ_API_STYLE     — API 风格: "openai" | "anthropic" (默认: 自动检测)
 *
 * 自动检测规则:
 *   - base_url 包含 deepseek.com → 强力模型用 anthropic 风格，快速模型用 openai 风格
 *   - 其他情况 → 统一用 openai 风格 (兼容 OpenAI / Azure / 本地模型 / 其他)
 */

const https = require('https')
const http = require('http')
const { URL } = require('url')

// ---- 配置读取 ----

const API_KEY = process.env.WIZ_API_KEY
  || process.env.DEEPSEEK_API_KEY
  || process.env.ANTHROPIC_AUTH_TOKEN
  || ''

const BASE_URL = (process.env.WIZ_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')

const FAST_MODEL = process.env.WIZ_FAST_MODEL || 'deepseek-v4-flash'
const STRONG_MODEL = process.env.WIZ_STRONG_MODEL || 'deepseek-v4-pro[1m]'
const API_STYLE = process.env.WIZ_API_STYLE || '' // 'openai' | 'anthropic' | '' (auto)

// ---- 自动检测 API 风格 ----

function detectStyle(isStrong) {
  if (API_STYLE) return API_STYLE
  // DeepSeek: 强力模型走 anthropic 兼容，快速模型走 openai 兼容
  if (BASE_URL.includes('deepseek.com')) {
    return isStrong ? 'anthropic' : 'openai'
  }
  // 其他: 统一 openai 兼容
  return 'openai'
}

// ---- 解析 URL ----

function parseUrl(urlStr) {
  const u = new URL(urlStr)
  return {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port,
    path: u.pathname + u.search,
    isHttps: u.protocol === 'https:'
  }
}

// ---- OpenAI 兼容 API 调用 ----

function callOpenAI(messages, model, maxTokens = 4096, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const url = parseUrl(`${BASE_URL}/v1/chat/completions`)
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    })
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.isHttps ? 443 : 80),
      path: url.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      timeout
    }
    const transport = url.isHttps ? https : http
    const req = transport.request(opts, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) { reject(new Error(json.error.message || JSON.stringify(json.error))); return }
          const content = json.choices?.[0]?.message?.content || ''
          resolve(content)
        } catch(e) { reject(new Error(`API parse error: ${data.substring(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('API timeout')) })
    req.write(body)
    req.end()
  })
}

// ---- Anthropic 兼容 API 调用 ----

function callAnthropic(messages, model, maxTokens = 4096, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const url = parseUrl(`${BASE_URL}/v1/messages`)
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    })
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.isHttps ? 443 : 80),
      path: url.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      timeout
    }
    const transport = url.isHttps ? https : http
    const req = transport.request(opts, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) { reject(new Error(json.error.message || JSON.stringify(json.error))); return }
          const textBlock = json.content?.find(c => c.type === 'text')
          resolve(textBlock ? textBlock.text : (json.content?.[0]?.text || ''))
        } catch(e) { reject(new Error(`API parse error: ${data.substring(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('API timeout')) })
    req.write(body)
    req.end()
  })
}

// ---- 统一调用接口 ----

/**
 * 调用强力模型 (用于自进化审查、复杂推理)
 */
function callStrong(messages, maxTokens = 16384) {
  const style = detectStyle(true)
  const caller = style === 'anthropic' ? callAnthropic : callOpenAI
  return caller(messages, STRONG_MODEL, maxTokens)
}

/**
 * 调用快速模型 (用于记忆提取、技能推荐、任务分解)
 */
function callFast(messages, maxTokens = 4096) {
  const style = detectStyle(false)
  const caller = style === 'anthropic' ? callAnthropic : callOpenAI
  return caller(messages, FAST_MODEL, maxTokens)
}

/**
 * 调用快速模型 (单条 prompt，便捷接口)
 */
function callFastPrompt(prompt, maxTokens = 4096) {
  return callFast([{ role: 'user', content: prompt }], maxTokens)
}

// ---- 配置信息 (调试用) ----

function getConfig() {
  return {
    baseUrl: BASE_URL,
    fastModel: FAST_MODEL,
    strongModel: STRONG_MODEL,
    apiStyle: API_STYLE || 'auto',
    hasKey: !!API_KEY,
    detectedStrongStyle: detectStyle(true),
    detectedFastStyle: detectStyle(false)
  }
}

module.exports = {
  API_KEY, BASE_URL, FAST_MODEL, STRONG_MODEL,
  callStrong, callFast, callFastPrompt,
  callOpenAI, callAnthropic,
  getConfig
}
