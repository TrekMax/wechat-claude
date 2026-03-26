# 使用指南

## 前置条件

- **Node.js** >= 18.0.0
- **Anthropic API 密钥** — 在 [console.anthropic.com](https://console.anthropic.com) 获取
- **微信 iLink Bot 账号** — 需要有微信 iLink Bot API 的访问权限

## 安装

```bash
git clone <repo-url>
cd wechat-claude
npm install
```

## 配置

### 环境变量

在项目根目录创建 `.env` 文件（参考 `.env.example`）：

```bash
# 必填
ANTHROPIC_API_KEY=sk-ant-xxxxx

# 可选
CLAUDE_MODEL=claude-sonnet-4-20250514     # 使用的 Claude 模型
CLAUDE_MAX_TOKENS=4096                     # 最大响应 Token 数
CLAUDE_SYSTEM_PROMPT="You are helpful."    # 系统提示词
CLAUDE_TEMPERATURE=0.7                     # 温度参数（0.0-1.0）
WEIXIN_BASE_URL=https://ilinkai.weixin.qq.com  # iLink API 地址
MAX_CONCURRENT_USERS=10                    # 最大并发用户数
SESSION_IDLE_TIMEOUT_HOURS=24              # 会话空闲超时（小时）
```

### CLI 选项

```bash
wechat-claude [选项]

选项：
  --agent <名称|命令>   启用 ACP 模式，指定智能体预设或自定义命令
  --cwd <路径>          ACP 智能体工作目录（默认：当前目录）
  --show-thoughts       在聊天中显示智能体思考过程（ACP 模式）
  --login               强制重新登录（显示二维码）
  --model <model>       覆盖 Claude 模型（API 模式）
  --system-prompt <p>   覆盖系统提示词（API 模式）
  --max-tokens <n>      覆盖最大响应 Token 数（API 模式）
  -h, --help            显示帮助信息
```

CLI 选项的优先级高于环境变量。

## 运行模式

### API 模式（默认）

直接调用 Claude API，支持文本和图片对话。需要 `ANTHROPIC_API_KEY`。

```bash
export ANTHROPIC_API_KEY=sk-ant-xxxxx
npm run dev
```

### ACP 模式

启动完整的智能体子进程（如 Claude Code），可以读写文件、执行命令、使用工具。通过 `--agent` 参数激活。

```bash
# 使用内置预设
npm run dev -- --agent claude

# 指定项目目录
npm run dev -- --agent claude --cwd ~/projects/myapp

# 显示智能体思考过程
npm run dev -- --agent claude --show-thoughts

# 自定义智能体命令
npm run dev -- --agent "npx my-custom-agent --acp"
```

内置智能体预设：

| 预设名 | 智能体 | 命令 |
|--------|--------|------|
| `claude` | Claude Code | `npx @anthropic-ai/claude-code --acp` |
| `copilot` | GitHub Copilot | `npx @github/copilot --acp --yolo` |
| `gemini` | Gemini CLI | `npx @google/gemini-cli --experimental-acp` |

## 运行

### 首次运行

```bash
npm run dev                    # API 模式
npm run dev -- --agent claude  # ACP 模式
```

终端会显示一个二维码，使用微信扫码登录。认证 Token 会保存到 `~/.wechat-claude/token.json`，后续运行自动复用。

### 后续运行

```bash
npm run dev
```

自动使用已保存的 Token。如果 Token 已过期，会自动显示新的二维码。

### 强制重新登录

```bash
npm run dev -- --login
```

### 生产环境构建

```bash
npm run build
npm start
```

## 聊天功能

桥接服务运行后，向你的微信机器人账号发送消息即可：

### 文本消息

发送任意文本消息，Claude 会使用与你相同的语言回复。

### 图片消息

发送图片，Claude 会通过 Vision 功能分析图片内容。你也可以在发送图片时附带文字说明，对图片提出具体问题。

### 语音消息

如果微信提供了语音转写文本，会将转写内容作为文字转发给 Claude。否则，Claude 会收到"收到语音消息但无转写"的提示。

### 聊天指令

| 指令 | 效果 |
|------|------|
| `/reset` | 清空对话历史，重新开始 |
| `/new` | 同 `/reset` |
| `/clear` | 同 `/reset` |

### 多任务并行（ACP 模式）

在 ACP 模式下，你可以同时运行多个智能体任务。每个任务拥有独立的智能体子进程和 Claude 上下文，互不阻塞。

| 指令 | 效果 |
|------|------|
| `/task new [描述]` | 新建并行任务并切换到该任务 |
| `/task list` | 列出所有活跃任务及状态 |
| `/task <id>` | 切换到指定任务（后续消息发送到该任务） |
| `/task end [id]` | 结束任务（不指定 id 则结束当前任务） |
| `/task` | 查看当前任务信息 |

**使用示例：**

```
你: /task new 设计一个 API              → 创建任务 #1，启动智能体
你: （任务 #1 处理中...）
你: /task new 修复登录 bug              → 创建任务 #2，启动另一个智能体并行处理
你: /task list                          → 查看所有任务及其状态
你: /task 1                             → 切回任务 #1
你: 进展如何？                           → 发送到任务 #1
你: /task 2                             → 切换到任务 #2
你: 加上错误处理                         → 发送到任务 #2
```

当有多个任务运行时，回复会带有 `[Task #N]` 前缀，方便区分来源。

不使用 `/task` 命令时，系统行为与之前完全一致 — 自动创建一个默认任务。

### 对话历史

- 每个用户拥有独立的 Claude 对话
- 跨消息保持上下文记忆（Claude 记住之前的对话）
- 滑动窗口保留最近 50 轮（25 组问答）
- 窗口满时自动移除最早的消息
- 历史记录仅存于内存 — 重启服务会清空所有对话

## 模型选择

支持任意 Claude 模型，示例：

```bash
# 快速、高性价比
npm run dev -- --model claude-haiku-4-5-20251001

# 均衡（默认）
npm run dev -- --model claude-sonnet-4-20250514

# 最强能力
npm run dev -- --model claude-opus-4-20250514
```

## 自定义系统提示词

定制 Claude 的行为：

```bash
npm run dev -- --system-prompt "你是一个中英翻译助手。将中文输入翻译为英文，将英文输入翻译为中文。"
```

或通过环境变量设置：

```bash
export CLAUDE_SYSTEM_PROMPT="你是一个编程助手，回复时总是附带代码示例。"
npm run dev
```

## 故障排查

### 二维码显示异常

如果终端无法正确渲染二维码，登录链接会以文本形式打印。复制链接在浏览器中打开即可获得可扫描的二维码。

### Token 过期

使用 `--login` 强制重新扫码登录：

```bash
npm run dev -- --login
```

或删除 Token 文件：

```bash
rm ~/.wechat-claude/token.json
npm run dev
```

### API 频率限制

如果 Claude API 返回频率限制错误，桥接服务会将错误消息转发给微信用户。稍等片刻后重试即可。

### 长回复被截断

微信单条消息限制 4000 字符。桥接服务会自动将长回复拆分为多条消息发送。如果回复仍然过长，可以减小 `CLAUDE_MAX_TOKENS`：

```bash
export CLAUDE_MAX_TOKENS=2048
```

## 编程式调用

桥接服务也可以作为库使用：

```typescript
import { WeChatClaudeBridge, loadConfig } from "wechat-claude";

const config = loadConfig({
  claude: { model: "claude-sonnet-4-20250514" },
});

const bridge = new WeChatClaudeBridge(config, "your-wechat-token");
await bridge.start();

// 优雅关闭
process.on("SIGINT", () => bridge.destroy());
```

## 文件位置

| 路径 | 用途 |
|------|------|
| `~/.wechat-claude/` | 默认存储目录 |
| `~/.wechat-claude/token.json` | 保存的微信认证 Token |
| `.env` | 本地环境配置 |
