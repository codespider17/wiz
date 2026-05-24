# Wiz V3.0

<p align="center">
  <b>给 Claude Code 的认知引擎</b><br>
  全量记忆 · 智能淘汰 · 跨会话连续 · 知识图谱 · 自动推理 · 主动预警 · 自进化 · 零窗口守护
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-3.0-blue" alt="V3.0">
  <img src="https://img.shields.io/badge/status-stable-green" alt="Stable">
  <img src="https://img.shields.io/badge/license-MIT-purple" alt="MIT">
</p>

---

## 快速开始（5 分钟）

```bash
# 1. 克隆项目
git clone https://github.com/codespider17/wiz.git
cd wiz

# 2. 安装依赖
npm install
pip install jieba

# 3. 编译零窗口启动器（可选，不编译也能用）
build_launcher.bat

# 4. 复制启动文件到公共目录
copy launcher.exe C:\Users\Public\
copy run_*.vbs C:\Users\Public\

# 5. 设置 API Key
setx DEEPSEEK_API_KEY sk-xxx

# 6. 配置 Claude Code（编辑 ~/.claude/settings.json，添加 hooks）
# 7. 配置 CLAUDE.md（添加 @../wiz/injection.md）
# 8. 重启 Claude Code
```

详细步骤见下方安装章节。

---

## 总览

Wiz 给 Claude Code 加装了一层完整的认知系统。它不是插件——它是引擎。

**V3 核心突破：全量保存 + 智能淘汰** — 记住所有对话，不重要的随时间自动淘汰。跨会话记忆连续性彻底修复。

```
V1.x: 关键词匹配，单会话                   基础
V2.x: 五层记忆 + 知识图谱 + 零窗口           进阶
V3.0: 全量保存 + 智能淘汰 + 跨会话连续        完全体
```

### 认知能力

- **全量记忆** — 每次对话完整保存到 raw_episodic 表，零遗漏
- **智能淘汰** — 四级分层（hot/warm/cold/frozen），自动晋升/降级/淘汰
- **跨会话连续** — 实时读取 transcript，跳过元问题，准确回忆上一个真正话题
- **知识推理** — 记忆之间自动建立因果图，搜一个带出一串
- **主动预警** — 检测到正在重复之前的失败模式时发出警告
- **技能学习** — 观察你在什么场景用什么技能，按需推荐最相关的 2-3 个
- **自我进化** — 低效记忆自动衰减淘汰，冲突记忆合并，高频模式晋升为可复用流程
- **零窗口守护** — 全部后台进程无窗口运行，C++/C# 级原生隐藏
- **存储管理** — 软上限 50MB 温和清理，硬上限 100MB 紧急清理 + VACUUM

---

## V3 新增特性

### 全量保存机制

每次会话结束，完整对话记录保存到 `raw_episodic` 表：

| 组件 | 说明 |
|------|------|
| `raw_episodic` 表 | 存储完整对话 JSON，含消息数、用户/助手摘要、关键词、重要性评分 |
| `saveRawEpisodic()` | 解析 transcript JSONL，提取关键词，计算重要性 |
| `extractTopicKeywords()` | 本地提取技术关键词 + CJK 二元组，零 API 调用 |
| `calcImportance()` | 基于技术内容密度、对话深度、问题-解决模式、决策信号、闲聊惩罚计算重要性 |

重要性评分公式：

```
score = 0.3 (基线)
      + 0.2 (技术内容命中)
      + 0.1 (对话 >20 条)
      + 0.1 (对话 >50 条)
      + 0.15 (问题-解决模式 ≥3 次)
      + 0.1 (决策信号)
      - 0.2 (闲聊 >50%)
```

### 智能淘汰机制

四级分层，自动管理记忆生命周期：

| Tier | 行为 | 衰减速率 | 晋升条件 | 降级条件 |
|------|------|----------|----------|----------|
| `hot` | 永不主动淘汰 | 无 | — | 30天未更新 + 低访问 |
| `warm` | 2%/天衰减 | 0.98/天 | 高访问 + 高有效性 | 60天未更新 |
| `cold` | 5%/天衰减 | 0.95/天 | 被访问过 | 30天+低重要性→删除 |
| `frozen` | 手动锁定 | 无 | 用户手动 | 永不淘汰 |

淘汰规则：

```
Raw Episodic:
  7天后 → 压缩（保留 user/assistant 消息，截断内容）
  30天 + importance < 0.4 → 删除
  90天 + importance < 0.7 → 删除

Semantic:
  hot → warm: 30天未更新 + access_count < 2
  warm → cold: 60天未更新
  cold → 归档: confidence < 0.15 + 30天未更新
```

### 跨会话记忆连续（V3 核心修复）

V2 的跨会话记忆存在三个 bug，V3 全部修复：

| Bug | 根因 | 修复 |
|-----|------|------|
| 新会话返回旧摘要 | `loadPreviousEpisode()` 优先级高于 `getLatestUserMessage()` | 改为 `getLatestUserMessage()` 优先，fallback 到 `loadPreviousEpisode()` |
| 跨会话读错文件 | 只读最新 1 个 transcript，新会话有自己的文件 | 读取最近 10 个 transcript 文件，逐文件扫描 |
| 元问题当话题返回 | "我们上一句聊的什么？" 被当成最后话题 | 正则过滤元问题，继续向前扫描找真正话题 |

`getLatestUserMessage()` 工作流程：

```
1. 读取 transcript 目录，按 mtime 排序
2. 逐文件向后扫描（最多 10 个）
3. 每个文件内反向扫描，跳过：
   - 系统消息（parentUuid, sidechain, session continuation）
   - 命令消息（<command-message>）
   - 过长消息（>500 字符，可能复制粘贴）
   - 元问题（"上一句聊的什么""聊的什么""说了什么"等）
4. 返回第一个非元问题的用户消息
5. 实时更新 wiz_last_session.md
```

### 分层检索

三级检索，从精确到模糊：

```
Level 1: Semantic (FTS5 全文检索)
  ↓ 不够
Level 2: Episodic (关键词匹配会话摘要)
  ↓ 不够
Level 3: Raw Episodic (topic_keywords 匹配原始对话)
```

### Tier 权重加成

`selectMemoriesAI()` 中加入 tier 权重：

```javascript
const tierBoost = (m.tier === 'hot') ? 0.3 : (m.tier === 'frozen') ? 0.4 : 0
```

hot 记忆天然排名靠前，frozen 记忆（手动锁定）最高优先。

### 存储空间管理

| 阈值 | 行为 |
|------|------|
| < 50MB | 正常运行 |
| 50-100MB | 温和清理：压缩 14 天前未压缩记录 |
| > 100MB | 紧急清理：删除低重要性 raw_episodic + VACUUM |

---

## 运行时数据

| 指标 | V2.1 | V3.0 |
|------|------|------|
| 语义记忆 | 277+ | 360+ |
| 技能索引 | 91 | 91 |
| Raw Episodic | 无 | 全量保存 |
| 分层系统 | 无 | hot/warm/cold/frozen |
| 跨会话连续 | 有 bug | 完全修复 |

---

## 核心系统

### 六层记忆

| 层级 | 存储 | 说明 |
|------|------|------|
| 语义记忆 | SQLite + FTS5 | 技术事实、决策、偏好，全文检索+中文分词，tier 分层 |
| 技能索引 | SQLite | 可搜索的 skill 目录，按场景推荐 |
| 情景记忆 | JSON 文件 + history 表 | 每次会话的摘要存档 |
| Raw Episodic | SQLite (raw_episodic) | 完整对话记录，关键词索引，重要性评分 |
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

- **衰减+晋升+去重** — tier 自动管理，高频使用自动晋升 hot，低频降级 cold
- **时序衰减** — warm 2%/天，cold 5%/天
- **AI 审查** — 用 pro 模型定期审查高价值记忆，合并/分类/生成工作流
- **技能评分** — `invoke_count + recency → quality_score`，低分技能归档
- **效果淘汰** — 注入多次无效的记忆自动清除
- **Raw 压缩** — 7 天后压缩旧对话，保留关键信息

### 优雅降级

每层都有 fallback，实战磨出来的韧性：

- flash AI 超时 → 关键词兜底
- Skill 工具失败 → 自动读文件执行指令
- SessionEnd 钩子不触发 → Worker 15 分钟空闲自动 consolidate
- Worker 崩溃 → 下次用户输入 inject.js 检测心跳并自愈
- PID 文件冲突 → start-worker.js 自动检查存活进程
- getLatestUserMessage 失败 → fallback 到 loadPreviousEpisode

---

## 架构

```
settings.json Hooks（wscript.exe 静默启动，绕过 cmd.exe 中介层）
  ├─ SessionStart      → wscript.exe C:/Users/Public/run_inject_start.vbs
  ├─ UserPromptSubmit  → wscript.exe C:/Users/Public/run_inject.vbs
  └─ SessionEnd        → wscript.exe C:/Users/Public/run_consolidate.vbs

run_*.vbs (ws.Run SW_HIDE, 零窗口)
  └─ launcher.exe (C#, CreateNoWindow=true)
  ├─ inject.js ──────→ injection.md ──────→ CC 读取执行
  │     ├─ Phase 0: 图谱预警 (本地, 0ms)
  │     ├─ Phase 1: lite 注入 (关键词, 0 API)
  │     ├─ Phase 2: flash AI 三路并行
  │     │     ├─ 技能推荐 (关键词预筛→AI精选)
  │     │     ├─ 记忆精选 (bigram预筛→AI精选, tier 权重加成)
  │     │     └─ 任务分解 (信号化检测)
  │     ├─ Phase 3: full 注入 (图扩展+反馈+技能)
  │     └─ getLatestUserMessage (实时跨会话记忆)
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
        ├─ 全量保存 (saveRawEpisodic → raw_episodic 表)
        ├─ 生成情景摘要
        ├─ 事实提取 + 去重
        ├─ 任务去重 (event_log.js)
        ├─ 智能淘汰 (runSmartElimination: tier 晋降级 + raw 压缩/删除)
        ├─ 存储空间检查 (checkStorageBudget)
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
├─ index.js             记忆数据库管理 (970+ 行, 全量保存+智能淘汰+分层检索)
├─ inject.js            上下文注入引擎 (810+ 行, 跨会话连续+tier权重)
├─ extract_worker.js    后台提取 Worker (374 行, windowsHide 全覆盖)
├─ consolidate.js       会话结束处理器 (640+ 行, 全量保存+智能淘汰+存储管理)
├─ start-worker.js      零窗口 Worker 启动器 (36 行, PID 检测)
├─ launcher.cs          C# 零窗口进程启动器源码（原始版）
├─ hook.cs              C# 参数化零窗口启动器（hooks 直调版）
├─ launcher.exe         编译后的 GUI 零窗口启动器
├─ wiz-launcher.exe     hook.cs 编译的带参数启动器
├─ daemon.py            MCP 服务器 (1077 行, 18 个工具)
├─ daemon.js            MCP 服务器 (遗留, 130 行)
├─ graph.js             知识图谱引擎 (516 行)
├─ event_log.js         事件日志系统 (169 行, 任务去重)
├─ privacy_filter.js    隐私过滤器 (79 行, CJK 感知)
├─ install.js           安装脚本 (81 行)
├─ run_consolidate.vbs  VBS 零窗口启动包装（主入口）
├─ run_inject.vbs       VBS 零窗口启动包装（主入口）
├─ run_inject_start.vbs VBS 零窗口启动包装（主入口）
├─ memory.db            语义+技能+进化+反馈+raw_episodic 数据库
├─ graph.db             知识图谱数据库
├─ event.db             事件日志数据库
├─ memory/              情景记忆文件存储
│  └─ archive/          被归档的语义记忆
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

> **Windows 用户注意**：`better-sqlite3` 需要 C++ 编译工具。如果 `npm install` 报错，先安装：
> ```bash
> npm install -g windows-build-tools
> ```
> 或者安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（勾选"使用 C++ 的桌面开发"）。

### 2. 编译 launcher.exe（零窗口启动的关键）

```bash
# 需要安装 .NET SDK 或 Mono。在 VS 开发者命令提示符或安装了 .NET SDK 的终端中运行
csc /target:winexe launcher.cs /out:launcher.exe
```

> **`/target:winexe` 是关键**：如果不加此标志，编译产物是控制台应用程序，
> Windows 每次启动时都会短暂分配控制台窗口再隐藏，形成闪一下的弹窗。
> 加上 `/target:winexe` 后，OS 根本不会为它创建控制台窗口。

也可以直接运行项目根目录的 `build_launcher.bat`（无需手动敲命令）。

> **编译后需要额外一步：** 将 `launcher.exe`、`run_inject.vbs`、`run_inject_start.vbs`、`run_consolidate.vbs` 复制到 `C:\Users\Public\` 目录（无中文路径，避免编码问题）。

### 3. 配置 settings.json

编辑 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "wscript.exe //Nologo C:/Users/Public/run_inject_start.vbs", "async": true }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "wscript.exe //Nologo C:/Users/Public/run_inject.vbs", "async": true }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "wscript.exe //Nologo C:/Users/Public/run_consolidate.vbs", "async": true }
        ]
      }
    ]
  }
}
```

> **路径规范**：使用正斜杠（`C:/Users/Public/`）而非反斜杠，避免 CC 内部反斜杠转义导致路径损坏。
> **MCP 服务器**配置见下方第 6 步。

### 4. 配置 CLAUDE.md

在你的用户目录下创建或编辑 `~/.claude/CLAUDE.md`（全局生效），或在项目根目录创建 `.claude/CLAUDE.md`（仅该项目）：

```markdown
所有长期记忆及技能由 Wiz 管理。
当 injection.md 推荐技能时，必须用 Skill 工具调用。
@../wiz/injection.md
```

> **注意**：使用 `@path` 语法（不是 `!include`）。路径是相对于 CLAUDE.md 文件位置的相对路径。
> 如果 wiz 在 `C:\Users\你的用户名\wiz`，CLAUDE.md 在 `C:\Users\你的用户名\.claude\CLAUDE.md`，则路径为 `@../wiz/injection.md`。

### 5. 设置 API Key

Wiz 支持任何 OpenAI / Anthropic 兼容 API。默认配置为 DeepSeek。

**环境变量**：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `WIZ_API_KEY` | API Key（优先级最高） | — |
| `WIZ_BASE_URL` | API 基础地址 | `https://api.deepseek.com` |
| `WIZ_FAST_MODEL` | 快速模型（记忆提取、技能推荐） | `deepseek-v4-flash` |
| `WIZ_STRONG_MODEL` | 强力模型（自进化审查、复杂推理） | `deepseek-v4-pro[1m]` |
| `WIZ_API_STYLE` | API 风格：`openai` / `anthropic`（空=自动检测） | 自动 |

> 兼容旧变量名：`DEEPSEEK_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN` 仍可用作 fallback。

**Windows（推荐）**：

```cmd
:: DeepSeek（默认）
setx WIZ_API_KEY sk-xxx

:: 或切换到其他 OpenAI 兼容 API（如 OpenRouter、本地模型等）
setx WIZ_API_KEY your-key
setx WIZ_BASE_URL https://openrouter.ai/api
setx WIZ_FAST_MODEL openai/gpt-4o-mini
setx WIZ_STRONG_MODEL openai/gpt-4o
```

**Linux / macOS**：

```bash
# DeepSeek（默认）
echo 'export WIZ_API_KEY=sk-xxx' >> ~/.bashrc
source ~/.bashrc
```

**常用 API 配置示例**：

```bash
# DeepSeek（默认，无需额外配置）
setx WIZ_API_KEY sk-xxx

# OpenAI
setx WIZ_API_KEY sk-xxx
setx WIZ_BASE_URL https://api.openai.com
setx WIZ_FAST_MODEL gpt-4o-mini
setx WIZ_STRONG_MODEL gpt-4o

# OpenRouter（聚合多模型）
setx WIZ_API_KEY sk-or-xxx
setx WIZ_BASE_URL https://openrouter.ai/api
setx WIZ_FAST_MODEL openai/gpt-4o-mini
setx WIZ_STRONG_MODEL anthropic/claude-sonnet-4-20250514

# 本地模型（Ollama / LM Studio）
setx WIZ_API_KEY ollama
setx WIZ_BASE_URL http://localhost:11434
setx WIZ_FAST_MODEL qwen2.5:7b
setx WIZ_STRONG_MODEL qwen2.5:32b
```

> **验证**：新开终端，运行 `node -e "console.log(require('./api_config').getConfig())"` 查看当前配置。

### 6. 配置 MCP 服务器（可选）

如果需要使用 MCP 工具（记忆搜索、图谱操作等），在 `settings.json` 的 `mcpServers` 中添加：

```json
{
  "mcpServers": {
    "wiz": {
      "type": "stdio",
      "command": "python",
      "args": ["C:/Users/你的用户名/wiz/daemon.py"],
      "env": {}
    }
  }
}
```

> 将 `C:/Users/你的用户名/wiz/daemon.py` 替换为你的实际路径。

### 7. 重启 Claude Code

关闭所有 Claude Code 窗口，重新打开。

### 8. 验证安装

在 wiz 项目目录下执行以下检查：

```bash
# 1. 检查 injection.md 是否生成（SessionStart hook 触发后产生）
ls -la injection.md

# 2. 检查 Worker 心跳（应在 60 秒内更新）
cat .worker.heartbeat

# 3. 检查数据库是否初始化
node -e "const i = require('./index'); i.init(); console.log(i.getStats())"

# 4. 检查 API Key 是否生效
node -e "console.log(process.env.DEEPSEEK_API_KEY ? 'API Key OK' : 'API Key NOT SET')"
```

如果第 4 步显示 `API Key NOT SET`，回到第 5 步检查环境变量设置。

---

## 工作原理

### 零窗口启动链路

```
CC Hook 触发 → wscript.exe (GUI应用，无控制台)
  → ws.Run(path, 0=SW_HIDE, True=wait)
    → launcher.exe (winexe, CreateNoWindow=true)
      → node script.js (windowsHide: true)
        → 所有子子进程 (windowsHide: true, Atomics.wait 替代 sleep)
  → 零弹出窗口
```

### 注入流程

每次用户发送消息，`inject.js` 执行：

1. **Phase 0** — 本地图谱查询，检测已知危险路径（0ms，零 API）
2. **Phase 1** — 关键词检索相关记忆，写入 `injection.md`（轻量，零 API）
3. **Phase 2** — 三路并行调用 flash API：技能推荐 + 记忆精选 + 任务分解（信号化检测）
4. **Phase 3** — 图谱扩展 + 反馈注入 + 技能推荐写入
5. **getLatestUserMessage** — 实时读取 transcript，提取上一个会话的真正话题

整个过程非阻塞（`async: true`），CC 不需要等待注入完成即可开始回复。

### Worker 后台提取

`extract_worker.js` 是一个常驻后台进程（由 `start-worker.js` 带 PID 检测启动）：

- 每 30 秒检测对话转录文件的新内容
- 调用 flash API 从对话中提取事实、关系、技能偏好
- 写入 `memory.db`（语义记忆）、`graph.db`（知识图谱）、`skill_prefs`
- 检测会话空闲超过 15 分钟 → 自动触发 `consolidate.js`

### 会话结束处理

`consolidate.js` 通过 SessionEnd 钩子或 Worker 空闲检测触发：

1. 读取 transcript 上下文
2. **全量保存**：`saveRawEpisodic()` → raw_episodic 表
3. 内容验证 + 情景摘要 + 事实提取
4. **智能淘汰**：`runSmartElimination()` → tier 晋降级 + raw 压缩/删除
5. **存储检查**：`checkStorageBudget()` → 自动清理

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
# 在 wiz 项目目录下执行
cat .worker.heartbeat
cat .worker.pid
tail -f worker.log
```

### 手动操作

以下命令均在 wiz 项目目录下执行：

```bash
# 启动 Worker（零窗口）
node start-worker.js

# 手动触发会话结束处理
node consolidate.js

# 查看数据库统计（含 tier 分布 + raw_episodic 数量）
node -e "const i = require('./index'); i.init(); console.log(i.getStats())"

# 手动触发智能淘汰
node -e "const i = require('./index'); i.init(); console.log(i.runSmartElimination())"

# 检查存储空间
node -e "const i = require('./index'); i.init(); console.log(i.checkStorageBudget())"

# 分层检索测试
node -e "const i = require('./index'); i.init(); console.log(i.searchTiered('关键词'))"
```

### 数据安全

所有数据全量本地存储，不上传云端：

- `memory.db` — 语义记忆 + 技能索引 + 反馈 + raw_episodic
- `graph.db` — 知识图谱
- `event.db` — 事件日志
- `memory/` — 情景记忆文件
- `memory/archive/` — 被归档的语义记忆

备份只需复制上述文件和目录。

---

## 常见问题

**npm install 报错 / node-gyp 失败？**
`better-sqlite3` 需要 C++ 编译工具。安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（勾选"使用 C++ 的桌面开发"），然后重新 `npm install`。

**API Key 不生效？**
- 确认用 `setx`（不是 `set`）设置了永久环境变量
- `setx` 设置后需要**重新打开终端**才生效
- 运行 `node -e "console.log(process.env.DEEPSEEK_API_KEY)"` 验证

**injection.md 没有生成？**
- 检查 `settings.json` 的 hooks 配置是否正确
- 确认 `wscript.exe` 路径存在（`C:/Users/Public/run_inject_start.vbs`）
- 手动运行 `node inject.js` 测试

**会影响 CC 启动速度吗？**
不会。注入 Phase 0-1 在本地瞬间完成（零 API 延迟），AI 精选在后台异步运行。

**Worker 崩溃了怎么办？**
自动恢复。下次用户输入时，`inject.js` 检测到心跳过期（>60 秒）会自动重新拉起 Worker。

**记忆太多会撑爆吗？**
V3 的智能淘汰 + 存储管理双重保障：tier 自动降级淘汰 + 50MB/100MB 存储阈值自动清理。

**支持其他 API 吗？**
支持。设置 `WIZ_BASE_URL`、`WIZ_FAST_MODEL`、`WIZ_STRONG_MODEL` 环境变量即可，无需改代码。详见"设置 API Key"章节。

**launcher.exe 弹出窗口？**
确保编译时使用 `/target:winexe`（不是 `/target:exe`）。如果不想编译，可直接用 `node inject.js`（会有短暂 cmd 闪过）。

**隐私怎么保护？**
三层过滤：HERMES_PROMPT 明确指示不提取 PII，`privacy_filter.js` 用正则拦截 + CJK 长度感知，`consolidate.js` 内容验证过滤系统噪声。

**跨会话记忆不连续？**
V3 已彻底修复。`getLatestUserMessage()` 实时读取 transcript，跳过元问题，准确返回上一个真正话题。如果仍然有问题，检查 transcript 目录是否有文件。

---

## 更新日志

### V3.0 (2026-05-24)

**核心突破：全量保存 + 智能淘汰 + 跨会话连续**

| 改动 | 文件 | 说明 |
|------|------|------|
| raw_episodic 表 | `index.js` | 全量保存完整对话记录，含关键词索引和重要性评分 |
| saveRawEpisodic() | `index.js` | 解析 transcript，提取关键词，计算重要性（零 API） |
| runSmartElimination() | `index.js` | 四级分层淘汰：hot/warm/cold/frozen，自动晋降级 |
| searchTiered() | `index.js` | 三级检索：semantic FTS5 → episodic → raw_episodic |
| checkStorageBudget() | `index.js` | 存储空间管理：50MB 软限 + 100MB 硬限 |
| archiveSemantic() | `index.js` | 低信心记忆归档到 memory/archive/ |
| getLatestUserMessage() | `inject.js` | 实时跨会话记忆，元问题过滤，逐文件扫描 |
| tier 权重加成 | `inject.js` | selectMemoriesAI 中 hot +0.3, frozen +0.4 |
| 全量保存集成 | `consolidate.js` | SessionEnd 时调用 saveRawEpisodic() |
| 智能淘汰集成 | `consolidate.js` | SessionEnd 时调用 runSmartElimination() |
| 存储检查集成 | `consolidate.js` | SessionEnd 时调用 checkStorageBudget() |

### V2.1.1 (2026-05-23)

跨会话记忆污染修复 + 竞态守卫 + 最后对话持久化。

### V2.1 (2026-05-22)

零窗口启动架构完全体 + 信号化任务检测 + 时序感知记忆排名。

### V2.0 (2026-05-20)

五层记忆 + 知识图谱 + 被动推理 + 主动预警 + 自进化。

### V1.x (2026-05-19)

基础记忆系统 + 技能索引。

---

## 许可证

MIT — codespider17
