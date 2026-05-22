# Wiz

<p align="center">
  <b>给 Claude Code 的认知引擎</b><br>
  五层记忆 · 知识图谱 · 自动推理 · 主动预警 · 自进化
</p>

<p align="center">
  不只是记忆，是推理。
</p>

---

## 这是什么

Wiz 给 Claude Code 加装了一层完整的认知系统。它不是插件——它是引擎。

CC 原生能力：对话关闭，记忆归零。Wiz 改变了这一点：

- **记忆不灭** — 跨会话持久化，后台 Worker 自动从对话中提炼关键事实
- **知识推理** — 记忆之间自动建立因果图，搜一个带出一串
- **主动预警** — 检测到正在重复之前的失败模式时发出警告
- **技能学习** — 观察你在什么场景用什么技能，按需推荐最相关的 2-3 个
- **自我进化** — 低效记忆自动衰减淘汰，冲突记忆合并，高频模式晋升为可复用流程

### 实际运行数据

| 指标 | 数值 |
|------|------|
| 语义记忆 | 124 条 |
| 技能索引 | 91 个 |
| 反馈事件 | 1150 条 |
| 历史会话 | 102 条 |
| 事件日志 | 233 条 |
| 进化记录 | 115 条 |

---

## 核心系统

### 五层记忆

| 层级 | 存储 | 说明 |
|------|------|------|
| 语义记忆 | SQLite + FTS5 | 技术事实、决策、偏好，全文检索+中文分词 |
| 技能索引 | SQLite | 可搜索的 skill 目录，按场景推荐 |
| 情景记忆 | JSON 文件 + history 表 | 每次会话的摘要存档 |
| 知识图谱 | graph.db | 10 种关系类型，子图遍历，因果推理 |
| 反馈闭环 | feedback_events | 记忆注入→引用→效果的追踪，低效自动淘汰 |

### 知识图谱（10 种关系）

```
depends_on · part_of · blocked_by · causes · solves
related_to · extends · conflicts_with · alternative_to · triggers
```

Worker 在后台自动从对话中提取关系建边。注入时，选中的记忆沿图谱自动扩展——你不问它也给。

### 被动推理

这是 Wiz 最独特的隐性能力。搜索一条记忆时，图谱自动展开关联：

```
"JWT 签名验证失败"
  → OAuth 绕过方案未解决    (blocked_by)
  → 字节码混淆 235KB       (part_of)
  → mitmproxy 捕获 76 个 token (triggers)
```

这不是记忆搜索，这是推理。

### 主动预警

当图谱检测到当前任务命中已知的失败路径时，在注入文档中生成 ⚠️ 危险信号：

- **失败模式** — 曾因同一原因失败 N 次
- **阻塞风险** — 关键节点仍未解决
- **潜在冲突** — 两个方案互斥

### 自进化

- **衰减+晋升+去重** — 30 天未访问自动衰减，高频使用自动晋升
- **AI 审查** — 用 pro 模型定期审查高价值记忆，合并/分类/生成工作流
- **技能评分** — `invoke_count + recency → quality_score`，低分技能归档
- **效果淘汰** — 注入多次无效的记忆自动清除

### 优雅降级

每层都有 fallback，实战磨出来的韧性：

- flash AI 超时 → 关键词兜底
- Skill 工具失败 → 自动读文件执行指令
- SessionEnd 钩子不触发 → Worker 15 分钟空闲自动 consolidate
- Worker 崩溃 → 下次用户输入 inject.js 检测心跳并自愈

---

## 架构

```
settings.json Hooks
  ├─ SessionStart      → node inject.js (接受 --session-start 参数用于兼容)
  ├─ UserPromptSubmit  → node inject.js
  └─ SessionEnd        → node consolidate.js

inject.js ──────→ injection.md ──────→ CC 读取执行
    │
    ├─ Phase 0: 图谱预警 (本地, 0ms)
    ├─ Phase 1: lite 注入 (关键词, 0 API)
    ├─ Phase 2: flash AI 三路并行
    │     ├─ 技能推荐 (关键词预筛→AI精选)
    │     ├─ 记忆精选 (bigram预筛→AI精选)
    │     └─ 任务分解
    └─ Phase 3: full 注入 (图扩展+反馈+技能)

extract_worker.js (后台进程, 30s 轮询)
    ├─ 监听对话转录文件
    ├─ 调用 flash API 提取事实 → memory.db
    ├─ 关系提取 → graph.db
    ├─ 技能偏好检测 → skill_prefs
    └─ SessionEnd 检测 → consolidate.js

daemon.py (MCP 服务器)
    ├─ search_memory / save_memory / memory_stats
    ├─ search_graph / expand_keys / create_edge / graph_stats
    ├─ list_skills / create_skill / skill_rankings / skill_prefs
    ├─ search_procedural / search_episodes / save_episodic
    ├─ hermes_fusion (自进化触发器)
    ├─ search_warnings (预警查询)
    ├─ record_feedback (反馈追踪)
    └─ current_context (注入上下文查看)
```

### 项目结构

```
wiz/
├─ index.js             记忆数据库管理 (32 函数, 619 行)
├─ inject.js            上下文注入引擎 (16 函数, 750 行)
├─ extract_worker.js    后台提取 Worker (9 函数, 354 行)
├─ consolidate.js       会话结束处理器 (3 函数, 264 行)
├─ daemon.py            MCP 服务器 (1077 行, 18 个工具)
├─ graph.js             知识图谱引擎 (15 函数, 516 行)
├─ event_log.js         事件日志系统 (10 函数, 165 行)
├─ privacy_filter.js    隐私过滤器
├─ lib/
│  ├─ api.js            API 调用封装
│  ├─ transcript.js     对话转录文件读取
│  └─ feedback.js       反馈追踪
├─ memory.db            语义+技能+进化+反馈数据库
├─ graph.db             知识图谱数据库
├─ event.db             事件日志数据库
├─ memory/              情景记忆文件存储
└─ HERMES_PROMPT.md     Worker 提取提示词
```

---

## 安装

### 1. 克隆 & 依赖

```bash
git clone https://github.com/codespider17/wiz.git
cd wiz
npm install
pip install jieba
```

### 2. 配置 settings.json

编辑 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node \"/path/to/wiz/inject.js\" --session-start", "async": true }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node \"/path/to/wiz/inject.js\"", "async": true }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node \"/path/to/wiz/consolidate.js\"", "async": true }
        ]
      }
    ]
  },
  "mcpServers": {
    "wiz": {
      "type": "stdio",
      "command": "python",
      "args": ["/path/to/wiz/daemon.py"],
      "env": {}
    }
  }
}
```

### 3. 配置 CLAUDE.md

```markdown
所有长期记忆及技能由 Wiz 管理。
当 injection.md 推荐技能时，必须用 Skill 工具调用。
!include /path/to/wiz/injection.md
```

### 4. 设置 API Key

Worker 使用 flash 模型提取记忆，需要 DeepSeek 或兼容 API：

```bash
export DEEPSEEK_API_KEY=sk-xxx
```

也可以在 `lib/api.js` 中修改端点和模型。

### 5. 重启 Claude Code

首次启动后，Worker 自动在后台启动。

---

## 工作原理

### 注入流程

每次用户发送消息，`inject.js` 执行：

1. **Phase 0** — 本地图谱查询，检测已知危险路径（0ms，零 API）
2. **Phase 1** — 关键词检索相关记忆，写入 `injection.md`（轻量，零 API）
3. **Phase 2** — 三路并行调用 flash API：技能推荐 + 记忆精选 + 任务分解
4. **Phase 3** — 图谱扩展 + 反馈注入 + 技能推荐写入

整个过程非阻塞（`async: true`），CC 不需要等待注入完成即可开始回复。

### Worker 后台提取

`extract_worker.js` 是一个常驻后台进程：

- 每 30 秒检测对话转录文件的新内容
- 调用 flash API 从对话中提取事实、关系、技能偏好
- 写入 `memory.db`（语义记忆）、`graph.db`（知识图谱）、`skill_prefs`
- 检测会话空闲超过 15 分钟 → 自动触发 `consolidate.js`

### 会话结束处理

`SessionEnd` 钩子或 Worker 的空闲检测触发 `consolidate.js`：

- 读取当前会话的完整内容
- 调用 AI 生成情景摘要
- 更新记忆库（衰减旧记忆、晋升高频记忆）
- 写入会话历史

### MCP 工具

通过 `daemon.py` 提供 18 个 MCP 工具，可直接在对话中调用：

| 工具 | 用途 |
|------|------|
| `search_memory` | 全文检索语义记忆，可选 AI 语义排序 |
| `save_memory` | 手动保存语义记忆 |
| `list_skills` | 搜索技能库 |
| `create_skill` | 创建新 skill |
| `memory_stats` | 记忆库统计 |
| `current_context` | 查看当前注入上下文 |
| `hermes_fusion` | 触发自进化流程 |
| `search_graph` | 图谱搜索，返回关系子图 |
| `expand_keys` | 记忆 key → 图谱展开关联 |
| `create_edge` | 手动建立关系边 |
| `search_warnings` | 检测当前任务的危险信号 |
| `record_feedback` | 记录记忆使用效果反馈 |
| `skill_rankings` | 技能效果排行榜 |
| `skill_prefs` | 查询技能使用偏好 |
| `search_procedural` | 搜索程序性记忆模板 |
| `search_episodes` | 搜索会话历史（情景记忆） |
| `save_episodic` | 保存一个会话记录 |
| `graph_stats` | 图谱统计信息 |

---

## 维护

### 查看 Worker 状态

```bash
cat wiz/.worker.heartbeat
cat wiz/.worker.pid
tail -f wiz/worker.log
```

### 手动操作

```bash
# 启动 Worker
node wiz/extract_worker.js

# 手动触发会话结束处理
node wiz/consolidate.js

# 查看数据库统计
node -e "const i = require('./index'); i.init(); console.log(i.memoryStats())"
```

### 数据安全

所有数据全量本地存储，不上传云端：
- `memory.db` — 语义记忆 + 技能索引 + 反馈
- `graph.db` — 知识图谱
- `event.db` — 事件日志
- `memory/` — 情景记忆文件

备份只需复制上述文件和目录。

---

## 常见问题

**会影响 CC 启动速度吗？**
不会。注入 Phase 0-1 在本地瞬间完成（零 API 延迟），AI 精选在后台异步运行。

**Worker 崩溃了怎么办？**
自动恢复。下次用户输入时，`inject.js` 检测到心跳过期（>60 秒）会自动重新拉起 Worker。

**记忆太多会撑爆吗？**
自信度系统自动维护：30 天未访问的衰减，注入多次无效的淘汰，低分技能归档。

**支持其他 API 吗？**
支持任何 OpenAI 兼容 API。改 `lib/api.js` 中的端点和模型名即可。

**隐私怎么保护？**
双层过滤：HERMES_PROMPT 明确指示不提取 PII，`privacy_filter.js` 用正则拦截手机号/地址/密钥等模式。

---

## 许可证

MIT — codespider17
