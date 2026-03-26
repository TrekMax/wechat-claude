# 系统架构

## 概述

wechat-claude 是一个双模式桥接服务，通过 iLink 协议将微信消息连接到 Claude。支持两种运行模式：

### API 模式 — 直接调用 Claude API
```
+------------------+       +------------------+       +------------------+
|                  |       |                  |       |                  |
|    微信客户端     | <---> |  wechat-claude   | <---> |   Claude API     |
|  （用户手机）     |       |    （桥接服务）    |       |  （Anthropic）    |
|                  |       |                  |       |                  |
+------------------+       +------------------+       +------------------+
        ^                         |
        |                         v
   iLink 协议               @anthropic-ai/sdk
  （长轮询方式）              （HTTPS REST）
```

### ACP 模式 — 完整智能体子进程
```
+------------------+       +------------------+       +------------------+
|                  |       |                  |       |                  |
|    微信客户端     | <---> |  wechat-claude   | <---> |   智能体进程      |
|  （用户手机）     |       |    （桥接服务）    |       | （Claude Code、   |
|                  |       |                  |       |  Copilot 等）     |
+------------------+       +------------------+       +------------------+
        ^                         |
        |                         v
   iLink 协议                ACP 协议
  （长轮询方式）           （ndjson over stdio）
```

## 模块结构

```
wechat-claude/
├── bin/
│   └── wechat-claude.ts        # CLI 入口
├── src/
│   ├── index.ts                # 公共 API 导出
│   ├── config.ts               # 配置加载（双模式支持）
│   ├── bridge.ts               # 核心编排器（双模式路由）
│   ├── adapter/
│   │   ├── inbound.ts          # 微信 → Claude/ACP 内容转换
│   │   └── outbound.ts         # Claude/ACP → 微信文本格式化
│   ├── claude/                 # API 模式模块
│   │   ├── client.ts           # Anthropic SDK 封装
│   │   ├── conversation.ts     # 单用户对话历史管理
│   │   └── types.ts            # Claude 相关类型定义
│   ├── acp/                    # ACP 模式模块
│   │   ├── client.ts           # ACP 客户端（消息块累积、权限自动审批）
│   │   ├── agent-manager.ts    # 智能体子进程启动与销毁
│   │   ├── session-manager.ts  # 单用户智能体进程生命周期管理
│   │   └── types.ts            # 智能体预设与解析
│   └── session/
│       ├── manager.ts          # 多用户会话管理（API 模式）
│       └── types.ts            # 会话类型定义
└── tests/                      # 与 src/ 结构对应的测试文件
```

## 核心组件

### Bridge 编排器（`bridge.ts`）

中央编排器，持有所有子组件并协调消息流转：

1. 通过 SDK 回调接收微信消息
2. 检查是否为重置指令
3. 将消息转换为 Claude 内容块（入站适配器）
4. 获取或创建用户会话
5. 将消息追加到对话历史
6. 携带完整历史调用 Claude API
7. 格式化响应内容（出站适配器）
8. 通过微信 SDK 发送回复

```
WeixinSDK.onMessage()
    │
    ▼
┌─────────────────────┐
│   检查重置指令       │──是──► 重置会话，发送确认消息
└─────────┬───────────┘
          │ 否
          ▼
┌─────────────────────┐
│   入站适配器         │  将微信消息转换为 Claude 内容块
│ （文本/图片/语音）    │  图片：下载 → 解密 → base64 编码
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│   会话管理器         │  获取或创建该用户的会话
│   + 对话历史         │  将用户消息追加到历史记录
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│   Claude 客户端      │  将完整对话发送到 Anthropic API
│ （@anthropic-ai/sdk）│  接收响应
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│   出站适配器         │  去除 Markdown 格式，拆分长文本
└─────────┬───────────┘
          ▼
    WeixinSDK.sendText()
```

### 入站适配器（`adapter/inbound.ts`）

将微信 `WeixinMessage`（包含 `item_list: MessageItem[]`）转换为 Claude API 内容块：

| 微信消息类型 | Claude 内容块 |
|-------------|--------------|
| TEXT 文本（1） | `{ type: "text", text: "..." }` |
| IMAGE 图片（2） | `{ type: "image", source: { type: "base64", ... } }` |
| VOICE 语音（3） | `{ type: "text", text: "[语音转写]: ..." }` |
| FILE 文件（4） | `{ type: "text", text: "[收到文件: 文件名]" }` |
| VIDEO 视频（5） | `{ type: "text", text: "[收到视频]" }` |

图片处理流程：
1. `MediaDownloader` 从微信 CDN 下载加密图片
2. AES-128-ECB 解密（由 SDK 处理）
3. 读取文件到 Buffer
4. 编码为 base64
5. 封装为 Claude `ImageBlockParam`，附带正确的 `media_type`

### 出站适配器（`adapter/outbound.ts`）

两个纯函数：

- **`formatForWeChat(text)`** — 去除 Markdown 格式（加粗、斜体、代码块、标题、链接），因为微信不渲染 Markdown
- **`splitText(text, maxLength)`** — 按 4000 字符（微信限制）拆分文本，优先在换行符处断开

### Claude 客户端（`claude/client.ts`）

`@anthropic-ai/sdk` 的轻量封装：

- 接受 `ConversationTurn[]`（角色 + 内容块）
- 映射为 Anthropic `MessageParam[]`，确保类型正确
- 返回 `ClaudeResponse`，包含文本内容、Token 用量和停止原因
- 支持 `temperature` 参数覆盖

### 对话管理（`claude/conversation.ts`）

管理单用户的对话历史：

- 存储 `ConversationTurn[]`（用户/助手交替对话）
- 滑动窗口：超过 `maxTurns` 时，按**对话对**删除最早的记录以保持上下文连贯
- `reset()` 清空所有历史

### 会话管理器（`session/manager.ts`）

管理多个并发用户的会话：

- `Map<userId, UserSession>` 存储对话和元数据
- **LRU 淘汰**：达到容量上限时，淘汰最久未活跃的用户
- **空闲清理**：定时器周期性清理超过 `idleTimeoutMs` 未活跃的会话
- **重置检测**：将用户文本与可配置的关键词列表匹配

## 依赖项

| 包名 | 用途 | 模式 |
|------|------|------|
| `@xmccln/wechat-ilink-sdk` | 微信 iLink 协议（认证、消息收发、媒体加解密） | 通用 |
| `@anthropic-ai/sdk` | Claude API 客户端 | API |
| `@agentclientprotocol/sdk` | ACP 协议，用于智能体子进程通信 | ACP |
| `qrcode-terminal` | 终端二维码渲染（用于扫码登录） | 通用 |

## 安全设计

- **API 密钥**：仅从 `ANTHROPIC_API_KEY` 环境变量加载，绝不存入配置文件
- **Token 存储**：微信认证 Token 保存在 `~/.wechat-claude/token.json`
- **媒体加密**：图片下载使用 AES-128-ECB 解密（由 SDK 处理），临时文件使用后即删除
- **代码无敏感信息**：`.env` 文件已加入 `.gitignore`

## 数据流

```
                     ┌──────────────────┐
                     │   微信服务器      │
                     │ ilinkai.weixin.  │
                     │    qq.com        │
                     └────────┬─────────┘
                              │
                    长轮询（35 秒超时）
                    POST /ilink/bot/getupdates
                              │
                              ▼
                     ┌──────────────────┐
                     │   WeixinSDK      │
                     │  （iLink SDK）    │
                     └────────┬─────────┘
                              │
                         onMessage()
                              │
                              ▼
                     ┌──────────────────┐
                     │     Bridge       │
                     │    （桥接器）     │
                     └───┬──────────┬───┘
                         │          │
              ┌──────────▼──┐  ┌────▼──────────┐
              │  会话管理器   │  │ Claude 客户端  │
              │  (Session)  │  │  (Anthropic)  │
              └─────────────┘  └───────────────┘
```

未使用流式传输 — Claude API 调用为非流式，因为微信 iLink 只支持发送完整消息（状态 = `FINISH`）。
