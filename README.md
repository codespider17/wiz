# Wiz V2.0

<p align="center">
  <b>给 Claude Code 的认知引擎</b><br>
  五层记忆 · 知识图谱 · 自动推理 · 主动预警 · 自进化 · 零窗口守护
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue" alt="V2.0">
  <img src="https://img.shields.io/badge/status-stable-green" alt="Stable">
  <img src="https://img.shields.io/badge/license-MIT-purple" alt="MIT">
</p>

---

## 总览

Wiz 给 Claude Code 加装了一层完整的认知系统。它不是插件——它是引擎。

**V2.0 核心亮点：零弹窗架构** — 所有子进程（注入、Worker、会话结束处理）均在完全静默的后台运行，C# 原生 launcher + `windowsHide` 全覆盖，彻底杜绝 cmd 弹窗。

```
V1.x: node inject.js → cmd 窗口一闪而过  ❌
V2.0: launcher.exe inject.js → 零窗口     ✅
```

### 认知能力

- **记忆不灭** — 跨会话持久化，后台 Worker 自动从对话中提炼关键事实
- **知识推理** — 记忆之间自动建立因果图，搜一个带出一串
- **主动预警** — 检测到正在重复之前的失败模式时发出警告
- **技能学习** — 观察你在什么场景用什么技能，按需推荐最相关的 2-3 个
- **自我进化** — 低效记忆自动衰减淘汰，冲突记忆合并，高频模式晋升为可复用流程
- **零窗口守护** — 全部后台进程无窗口运行，C++/C# 级原生隐藏

---

## V2.0 新增特性

### 零窗口启动架构

Wiz V2.0 对进程创建做了全链路改造：

| 改动 | 说明 |
|------|------|
| `launcher.cs` | C# 原生 `ProcessStartInfo` + `CreateNoWindow=true`，彻底消除窗口创建 |
| `windowsHide: true` | 所有 `spawn`/`execSync` 调用全覆盖 |
| `Atomics.wait` 替代 `sleep` | 消除 `execSync('sleep 0.05')` 产生的残余窗口 |
| VBS → launcher.exe | hook 命令从 VBS → C# 编译二进制，根源上不触发 cmd |

### 信号化任务检测

以信号检测替代关键词黑名单，100 倍更精准的任务识别：

| 维度 | V1.x | V2.0 |
|------|------|------|
| 方法 | 人工维护黑名单 | 多信号加权判定 |
| 项目信号 | 无 | 50+ 正则（代码、框架、数据库、CI/CD） |
| 生活信号 | 仅关键词 | AI 级语义识别（问候、日常闲聊） |
| 分析长度 | 3 条 × 300 字符 | 5 条 × 300 字符 |

### 时序感知记忆排名

记忆不是同等重要的——最近用过的更重要：

```
final_score = (confidence + effectiveness_boost) × time_decay
time_decay = max(0.4, 1.0 − days_since_update × 0.02)
```

- 30 天未更新的记忆权重降至 0.4
- 最近使用过的记忆获得天然排名优势
- 新记忆快速上升到顶部，旧记忆不退场但权重降低

### CJK 感知隐私过滤

中文信息密度天然高于英文，V2.0 为中文做了专门适配：

```javascript
// V1.x: content.length < 15 → 过滤     ❌ "用户用 py" 被丢弃
// V2.0: CJK ? 8 : 15 → 保留中文字段    ✅ "用户用 py" 正确保留
```

### 内容验证 & 去重

- **内容验证**: `consolidate.js` 新增 `isValidContent()`，跳过工具拒绝、文件写入失败等系统噪声
- **任务去重**: `event_log.js` 自动跳过连续相同的 task 记录，避免任务栈污染
- **Worker PID 自愈**: `start-worker.js` 先检测已有进程，避免重复启动

### 记忆防污染（v2.0.2）

会话记忆被环境变量命令和 injection.md 覆盖的问题，三个维度根治：

| 防线 | 文件 | 机制 |
|------|------|------|
| 入口过滤 | `inject.js` | 裸 `GH_TOKEN=0` 这类环境变量赋值被 `ENV_VAR_RE` 正则识别，标记为系统消息而非任务上下文 |
| 会话来源 | `consolidate.js` | 从 transcript JSONL 原始转录读取真实对话（而非可能被重写的 injection.md），跳过 >50% 行是环境变量的噪声 |
| 条件重写 | `extract_worker.js` | 仅当提取到新 facts（saved > 0）时才重跑 inject.js，避免无意义覆盖 |

### 运行时数据

| 指标 | 数值 |
|------|------|
| 语义记忆 | 325 条 |
| 技能索引 | 91 个 |
| 反馈事件 | 1150+ 条 |
| 历史会话 | 102 条 |
| 事件日志 | 233+ 条 |
| 进化记录 | 115+ 条 |

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

搜索一条记忆时，图谱自动展开关联：

```
"JWT 签名验证失败"
  → OAuth 绕过方案未解决    (blocked_by)
  → 字节码混淆 235KB       (part_of)
  → mitmproxy 捕获 76 个 token (triggers)
```

### 主动预警

当图谱检测到当前任务命中已知的失败路径时，在注入文档中生成 ⚠️ 危险信号：

- **失败模式** — 曾因同一原因失败 N 次
- **阻塞风险** — 关键节点仍未解决
- **潜在冲突** — 两个方案互斥

### 自进化

- **衰减+晋升+去重** — 30 天未访问自动衰减，高频使用自动晋升
- **时序衰减** — 30 天权重降至 0.4，最近使用优先
- **AI 审查** — 用 pro 模型定期审查高价值记忆，合并/分类/生成工作流
- **技能评分** — `invoke_count + recency → quality_score`，低分技能归档
- **效果淘汰** — 注入多次无效的记忆自动清除

### 优雅降级

每层都有 fallback，实战磨出来的韧性：

- flash AI 超时 → 关键词兜底
- Skill 工具失败 → 自动读文件执行指令
- SessionEnd 钩子不触发 → Worker 15 分钟空闲自动 consolidate
- Worker 崩溃 → 下次用户输入 inject.js 检测心跳并自愈
- PID 文件冲突 → start-worker.js 自动检查存活进程

---

## 架构

```
settings.json Hooks
  ├─ SessionStart      → launcher.exe inject.js --session-start  (零窗口)
  ├─ UserPromptSubmit  → launcher.exe inject.js                   (零窗口)
  └─ SessionEnd        → launcher.exe consolidate.js              (零窗口)

launcher.exe (C#, CreateNoWindow=true)
  ├─ inject.js ──────→ injection.md ──────→ CC 读取执行
  │     ├─ Phase 0: 图谱预警 (本地, 0ms)
  │     ├─ Phase 1: lite 注入 (关键词, 0 API)
  │     ├─ Phase 2: flash AI 三路并行
  │     │     ├─ 技能推荐 (关键词预筛→AI精选)
  │     │     ├─ 记忆精选 (bigram预筛→AI精选)
  │     │     └─ 任务分解 (信号化检测)
  │     └─ Phase 3: full 注入 (图扩展+反馈+技能)
  │
  ├─ start-worker.js ──→ extract_worker.js (后台进程, 30s轮询)
  │     ├─ PID 冲突检测 (避免重复启动)
  │     ├─ 监听对话转录文件
  │     ├─ 调用 flash API 提取事实 → memory.db
  │     ├─ 关系提取 → graph.db
  │     ├─ 技能偏好检测 → skill_prefs
  │     ├─ 条件重写 injection.md（仅当有新 facts 时）
  │     └─ SessionEnd 检测 → consolidate.js
  │
  └─ consolidate.js
        ├─ 从 transcript 读取会话上下文（非可能被污染的 injection.md）
        ├─ 环境变量噪声检测（>50% 行是 env var 则跳过）
        ├─ 内容验证 (isValidContent 过滤系统噪声)
        ├─ 生成情景摘要
        ├─ 事实提取 + 去重
        ├─ 任务去重 (event_log.js)
        └─ 自进化触发 (hermes_fusion)

daemon.py (MCP 服务器, 18 个工具)
  ├─ 记忆操作: search_memory / save_memory / memory_stats
  ├─ 图谱操作: search_graph / expand_keys / create_edge / graph_stats
  ├─ 技能操作: list_skills / create_skill / skill_rankings / skill_prefs
  ├─ 情景操作: search_episodes / save_episodic / search_procedural
  ├─ 推理: hermes_fusion / search_warnings
  ├─ 反馈: record_feedback
  └─ 上下文: current_context
```

### 项目结构

```
wiz/
├─ index.js             记忆数据库管理 (628 行)
├─ inject.js            上下文注入引擎 (795 行, 信号化任务检测)
├─ extract_worker.js    后台提取 Worker (371 行, windowsHide 全覆盖)
├─ consolidate.js       会话结束处理器 (278 行, 内容验证)
├─ start-worker.js      零窗口 Worker 启动器 (36 行, PID 检测)
├─ launcher.cs          C# 零窗口进程启动器 (68 行)
├─ launcher.exe         编译后的零窗口启动器
├─ daemon.py            MCP 服务器 (1077 行, 18 个工具)
├─ daemon.js            MCP 服务器 (遗留, 130 行)
├─ graph.js             知识图谱引擎 (516 行)
├─ event_log.js         事件日志系统 (169 行, 任务去重)
├─ privacy_filter.js    隐私过滤器 (79 行, CJK 感知)
├─ install.js           安装脚本 (81 行)
├─ run_consolidate.vbs  VBS 启动包装 (可选)
├─ run_inject.vbs       VBS 启动包装 (可选)
├─ run_inject_start.vbs VBS 启动包装 (可选)
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

### 2. 编译 launcher.exe（零窗口启动的关键）

```bash
# 需要安装 .NET SDK 或 Mono。在 VS 开发者命令提示符或安装了 .NET SDK 的终端中运行
csc /target:winexe launcher.cs /out:launcher.exe
```

> **`/target:winexe` 是关键**：如果不加此标志，编译产物是控制台应用程序，
> Windows 每次启动时都会短暂分配控制台窗口再隐藏，形成闪一下的弹窗。
> 加上 `/target:winexe` 后，OS 根本不会为它创建控制台窗口。

也可以直接运行项目根目录的 `build_launcher.bat`（无需手动敲命令）。

如果不想编译 C#，可以使用系统自带的 VBS 包装（会有一个 cmd 瞬间闪过）。

### 3. 配置 settings.json

编辑 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "\"C:\\path\\to\\wiz\\launcher.exe\" inject.js --session-start", "async": true }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "\"C:\\path\\to\\wiz\\launcher.exe\" inject.js", "async": true }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "\"C:\\path\\to\\wiz\\launcher.exe\" consolidate.js", "async": true }
        ]
      }
    ]
  },
  "mcpServers": {
    "wiz": {
      "type": "stdio",
      "command": "python",
      "args": ["C:/path/to/wiz/daemon.py"],
      "env": {}
    }
  }
}
```

> **如果不想用 launcher.exe**，可以直接调 `node inject.js`，会有一个 cmd 窗口瞬间闪过后消失，不影响功能。

### 4. 配置 CLAUDE.md

```markdown
所有长期记忆及技能由 Wiz 管理。
当 injection.md 推荐技能时，必须用 Skill 工具调用。
!include C:/path/to/wiz/injection.md
```

### 5. 设置 API Key

需要 DeepSeek 或兼容 API。项目使用两个模型：

| 用途 | 模型 | 端点 |
|------|------|------|
| Worker 提取 + 注入精选 | `deepseek-v4-flash` | `/v1/chat/completions`（OpenAI 兼容） |
| 自进化审查 | `deepseek-v4-pro` | `/anthropic/v1/messages`（Anthropic 兼容） |

```bash
export DEEPSEEK_API_KEY=sk-xxx
```

去 [platform.deepseek.com](https://platform.deepseek.com) 注册即可获取。

### 6. 重启 Claude Code

首次启动后，Worker 自动在后台启动（零窗口）。

---

## 工作原理

### 零窗口启动链路

```
CC Hook 触发 → launcher.exe (C#, CreateNoWindow=true)
  → spawn node 子进程 (windowsHide: true)
  → 所有子子进程 (windowsHide: true, Atomics.wait 替代 sleep)
  → 零弹出窗口
```

### 注入流程

每次用户发送消息，`inject.js` 执行：

1. **Phase 0** — 本地图谱查询，检测已知危险路径（0ms，零 API）
2. **Phase 1** — 关键词检索相关记忆，写入 `injection.md`（轻量，零 API）
3. **Phase 2** — 三路并行调用 flash API：技能推荐 + 记忆精选 + 任务分解（信号化检测）
4. **Phase 3** — 图谱扩展 + 反馈注入 + 技能推荐写入

整个过程非阻塞（`async: true`），CC 不需要等待注入完成即可开始回复。

### Worker 后台提取

`extract_worker.js` 是一个常驻后台进程（由 `start-worker.js` 带 PID 检测启动）：

- 每 30 秒检测对话转录文件的新内容
- 调用 flash API 从对话中提取事实、关系、技能偏好
- 写入 `memory.db`（语义记忆）、`graph.db`（知识图谱）、`skill_prefs`
- 检测会话空闲超过 15 分钟 → 自动触发 `consolidate.js`

### 会话结束处理

`consolidate.js` 通过 SessionEnd 钩子或 Worker 空闲检测触发：

- 内容验证：`isValidContent()` 过滤系统错误/工具拒绝等噪声
- 生成情景摘要（AI）
- 提取关键事实（AI），经 CJK 感知隐私过滤
- 更新记忆库（衰减旧记忆、晋升高频记忆、时序降权）

### MCP 工具

通过 `daemon.py` 提供 18 个 MCP 工具：

| 工具 | 用途 |
|------|------|
| `search_memory` | 全文检索语义记忆 + AI 语义排序 |
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
| `search_episodes` | 搜索会话历史 |
| `save_episodic` | 保存会话记录 |
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
# 启动 Worker（零窗口）
node wiz/start-worker.js

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
自信度 + 时序系统自动维护：30 天未访问的衰减至权重 0.4，注入多次无效的淘汰，低分技能归档。

**支持其他 API 吗？**
支持任何 OpenAI 兼容 API。改 `lib/api.js` 中的端点和模型名即可。

**launcher.exe 弹出窗口？**
确保编译时使用 `CreateNoWindow=true`。如果不想编译，可直接用 `node inject.js`（会有短暂 cmd 闪过）。

**隐私怎么保护？**
三层过滤：HERMES_PROMPT 明确指示不提取 PII，`privacy_filter.js` 用正则拦截 + CJK 长度感知，`consolidate.js` 内容验证过滤系统噪声。

---

## 许可证

MIT — codespider17
