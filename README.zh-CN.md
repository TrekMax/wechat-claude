# wechat-claude

通过 iLink 协议实现的微信-Claude 桥接服务。向你的微信机器人发送消息，即可获得 Claude 的回复。

## 功能特性

- **双模式运行** — API 模式（轻量聊天）或 ACP 模式（完整智能体）
- **文本消息** — 发送文本，接收 Claude 的回复
- **图片识别** — 发送图片，Claude 通过 Vision API 进行分析
- **语音转写** — 语音消息自动转文字后转发给 Claude
- **多用户支持** — 最多 10 个并发用户，各自拥有独立对话
- **对话记忆** — 滑动窗口历史记录（50 轮），发送 `/reset` 可重置
- **ACP 智能体支持** — Claude Code、Copilot、Gemini、Codex 或任何 ACP 兼容的智能体
- **长文本自动分段** — 超长回复自动拆分为多条微信消息

## 前置要求

- **Node.js** >= 18.0.0
- **npm** 或 **pnpm**
- 一个 **微信** 账号（用于扫码登录）
- 根据使用模式准备对应的 **API Key**：
  - API 模式：`ANTHROPIC_API_KEY`
  - ACP 模式 (Claude)：`ANTHROPIC_API_KEY`
  - ACP 模式 (Codex)：`OPENAI_API_KEY`
  - ACP 模式 (Gemini)：`GEMINI_API_KEY`
  - ACP 模式 (Copilot)：GitHub Copilot 订阅

## 安装

### 从 npm 安装（推荐）

```bash
npm install -g wechat-claude
```

### 从源码安装

```bash
git clone https://github.com/TrekMax/wechat-claude.git
cd wechat-claude
npm install
npm run build

# 复制环境变量模板并填入你的密钥
cp .env.example .env
```

## 快速开始

### API 模式（轻量聊天）

直接调用 Claude API，适合简单的文本/图片对话。

```bash
export ANTHROPIC_API_KEY=sk-ant-xxxxx
npm run dev
```

### ACP 模式（完整智能体）

启动智能体子进程，支持代码编辑、文件操作、工具调用等完整能力。

```bash
# Claude Code 智能体
npm run dev -- --agent claude

# OpenAI Codex 智能体
export OPENAI_API_KEY=sk-xxxxx
npm run dev -- --agent codex

# GitHub Copilot 智能体
npm run dev -- --agent copilot

# Gemini CLI 智能体
npm run dev -- --agent gemini

# 自定义智能体命令
npm run dev -- --agent "npx my-custom-agent --acp"
```

### ACP 模式选项

```bash
# 指定智能体工作目录
npm run dev -- --agent claude --cwd ~/projects/myapp

# 设置模型（对 Claude Code 会写入 .claude/settings.json）
npm run dev -- --agent claude --model haiku

# 在聊天中显示智能体思考过程
npm run dev -- --agent claude --show-thoughts

# 组合使用
npm run dev -- --agent codex --cwd ~/projects/myapp --show-thoughts --debug
```

启动后扫描终端中的二维码完成微信登录。登录成功后，向机器人账号发送消息即可开始对话。

### 生产环境

```bash
npm run build
npm start
# 或使用 ACP 模式：
npm start -- --agent claude --cwd ~/projects/myapp
```

## 内置智能体预设

| 预设名 | 智能体 | 包名 | 所需环境变量 |
|--------|--------|------|-------------|
| `claude` | Claude Code | `@zed-industries/claude-code-acp` | `ANTHROPIC_API_KEY` |
| `codex` | OpenAI Codex | `@zed-industries/codex-acp` | `OPENAI_API_KEY` |
| `copilot` | GitHub Copilot | `@github/copilot` | GitHub Copilot 订阅 |
| `gemini` | Gemini CLI | `@google/gemini-cli` | `GEMINI_API_KEY` |

智能体包会在首次运行时通过 `npx` 自动拉取。

## 聊天指令

| 指令 | 说明 |
|------|------|
| `/reset` | 清空对话历史 |
| `/new` | 同 `/reset` |
| `/clear` | 同 `/reset` |
| `/model` | 查看当前模型 |
| `/model <名称>` | 切换模型 |
| `/status` | 查看会话信息 |
| `/debug on\|off` | 开关调试日志 |
| `/help` | 显示可用指令 |

### 多任务并行（ACP 模式）

| 指令 | 说明 |
|------|------|
| `/task new [描述]` | 新建并行任务 |
| `/task list` | 查看所有活跃任务 |
| `/task <id>` | 切换当前任务 |
| `/task end [id]` | 结束任务 |
| `/show-thoughts` | 切换思考过程显示 |

同时运行多个智能体任务，每个任务拥有独立的智能体上下文。

## 环境变量

| 变量 | 是否必需 | 默认值 | 说明 |
|------|----------|--------|------|
| `ANTHROPIC_API_KEY` | API 模式必需 | — | Anthropic API 密钥 |
| `OPENAI_API_KEY` | Codex ACP 必需 | — | OpenAI API 密钥 |
| `CLAUDE_MODEL` | 否 | `claude-sonnet-4-20250514` | Claude 模型（API 模式） |
| `CLAUDE_MAX_TOKENS` | 否 | `4096` | 最大响应 token 数（API 模式） |
| `CLAUDE_SYSTEM_PROMPT` | 否 | 默认提示词 | 系统提示词（API 模式） |
| `WEIXIN_BASE_URL` | 否 | `https://ilinkai.weixin.qq.com` | 微信 iLink API 地址 |
| `MAX_CONCURRENT_USERS` | 否 | `10` | 最大并发用户数 |
| `SESSION_IDLE_TIMEOUT_HOURS` | 否 | `24` | 会话过期时间（小时） |

## 配置说明

完整配置参考请查看 [docs/usage.zh-CN.md](docs/usage.zh-CN.md)。

## 系统架构

系统设计与模块详情请查看 [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md)。

## 开发

```bash
# 运行测试
npm test

# 监听模式运行测试
npm run test:watch

# 测试覆盖率
npm run test:coverage

# 类型检查
npx tsc --noEmit

# 构建
npm run build
```

## 许可证

MIT
