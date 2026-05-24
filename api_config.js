/**
 * Wiz API Configuration
 *
 * 自动跟随 Claude Code 当前使用的模型。ccswitch 切换模型时，wiz 自动跟着切换。
 *
 * 优先级:
 *   1. WIZ_* 环境变量 (完全覆盖，高级用户)
 *   2. ANTHROPIC_* 环境变量 (Claude Code / ccswitch 自动设置)
 *   3. DEEPSEEK_API_KEY (旧版兼容)
 *   4. 硬编码默认值 (DeepSeek)
 *
 * 环境变量:
 *   WIZ_API_KEY       — API Key (覆盖)
 *   WIZ_BASE_URL      — API 基础地址 (覆盖)
 *   WIZ_FAST_MODEL    — 快速模型名 (覆盖)
 *   WIZ_STRONG_MODEL  — 强力模型名 (覆盖)
 *   WIZ_API_STYLE     — API 风格: "openai" | "anthropic" (覆盖，默认自动检测)
 *
 * 自动读取 (Claude Code / ccswitch 设置):
 *   ANTHROPIC_AUTH_TOKEN — API Key
 *   ANTHROPIC_BASE_URL   — API 基础地址
 *   ANTHROPIC_MODEL      — 模型名 (fast 和 strong 共用)
 */

const https = require('https')
const http = require('http')
const { URL } = require('url')

// ---- 配置读取 (优先级: WIZ_* → ANTHROPIC_* → DEEPSEEK_* → 默认值) ----

const API_KEY = process.env.WIZ_API_KEY
  || process.env.ANTHROPIC_AUTH_TOKEN
  || process.env.DEEPSEEK_API_KEY
  || ''

const BASE_URL = (
  process.env.WIZ_BASE_URL
  || process.env.ANTHROPIC_BASE_URL
  || 'https://api.deepseek.com'
).replace(/\/+$/, '')

// 模型名: WIZ_* 优先，否则用 ANTHROPIC_MODEL（Claude Code 当前模型），最后 fallback 到 DeepSeek
const FAST_MODEL = process.env.WIZ_FAST_MODEL
  || process.env.ANTHROPIC_MODEL
  || 'deepseek-v4-flash'

const STRONG_MODEL = process.env.WIZ_STRONG_MODEL
  || process.env.ANTHROPIC_MODEL
  || 'deepseek-v4-pro[1m]'

const API_STYLE = process.env.WIZ_API_STYLE || ''

// ---- 自动检测 API 风格 ----

function detectStyle(isStrong) {
  if (API_STYLE) return API_STYLE
  // DeepSeek: 强力模型走 anthropic 兼容，快速模型走 openai 兼容
  if (BASE_URL.includes('deepseek.com')) {
    return isStrong ? 'anthropic' : 'openai'
  }
  // ANTHROPIC_BASE_URL 路径中包含 anthropic → anthropic 风格
  if (BASE_URL.includes('anthropic')) return 'anthropic'
  // 其他 → openai 兼容 (OpenAI / OpenRouter / 本地模型等)
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

function callStrong(messages, maxTokens = 16384) {
  const style = detectStyle(true)
  const caller = style === 'anthropic' ? callAnthropic : callOpenAI
  return caller(messages, STRONG_MODEL, maxTokens)
}

function callFast(messages, maxTokens = 4096) {
  const style = detectStyle(false)
  const caller = style === 'anthropic' ? callAnthropic : callOpenAI
  return caller(messages, FAST_MODEL, maxTokens)
}

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
    source: process.env.WIZ_API_KEY ? 'WIZ_API_KEY'
      : process.env.ANTHROPIC_AUTH_TOKEN ? 'ANTHROPIC_AUTH_TOKEN (Claude Code)'
      : process.env.DEEPSEEK_API_KEY ? 'DEEPSEEK_API_KEY'
      : 'none',
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
