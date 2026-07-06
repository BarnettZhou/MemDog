# MemDog

内存看门狗。定时巡逻监控进程内存占用，超过阈值时通过系统原生通知告警。

## 安装

```bash
cd /Users/xumacmini/codes/memdog
npm install
npm link        # 可选，安装后可在任意目录执行 memdog
```

安装完成后，使用 `memdog --help` 查看所有命令。

## 快速开始

```bash
# 1. 添加要监控的进程
memdog add WeChat --threshold 256

# 2. 启动后台守护进程
memdog start

# 3. 查看运行状态
memdog status

# 4. 查看日志
memdog log
```

## 命令说明

### 进程管理

```bash
memdog add <process-name> [--cmd <pattern>] [--threshold <mb>]
```

添加一个监听目标。

- `--cmd`：按命令行子串精确匹配。适合 `node`、`Java` 这类多实例进程名，例如 `memdog add node --cmd "server.js"`。
- `--threshold`：该进程的内存阈值（MB），默认使用全局阈值 512，最小 1。

示例：

```bash
memdog add node --cmd "server.js" --threshold 512
memdog add WeChat --threshold 256
memdog add 企业微信 --cmd "com.tencent.WeWorkMac" --threshold 400
```

---

```bash
memdog remove <process-name-or-index>
```

移除监听目标。支持按进程名或索引移除。索引通过 `memdog list` 查看。

示例：

```bash
memdog remove WeChat
memdog remove 1
memdog remove #1
```

> shell 中 `#1` 需要加引号，建议直接用数字 `1`。

---

```bash
memdog list
```

查看当前监听名单及运行状态。每个目标前会显示 `#index`，用于后续按索引操作。

示例输出：

```text
采样间隔: 60 秒，全局内存阈值: 512 MB
监听目标:
  #1 WeChat: 阈值: 256 MB 1 个 PID: 69273
  #2 企业微信(com.tencent.WeWorkMac): 阈值: 400 MB 8 个 PID: 2495, 57806, ...
```

### 阈值与采样间隔

```bash
memdog threshold <mb>
```

设置全局默认内存阈值（MB），对所有未单独设置阈值的进程生效。

示例：

```bash
memdog threshold 512
```

---

```bash
memdog set-threshold <index> <mb>
```

修改指定监听进程的内存阈值。`index` 来自 `memdog list` 的 `#index`，可用 `1` 或 `#1`。

示例：

```bash
memdog set-threshold 1 100
memdog set-threshold #2 400
```

---

```bash
memdog interval <seconds>
```

设置采样间隔（秒），默认 60 秒。

示例：

```bash
memdog interval 30
```

### 守护进程控制

```bash
memdog start       # 后台启动监控
memdog stop        # 停止监控
memdog status      # 查看守护进程是否运行
memdog log [lines] # 查看最近 N 行日志，默认 50 行
```

示例：

```bash
memdog start
memdog status
memdog log 100
memdog stop
```

### 调试

```bash
memdog run
```

前台直接运行，不按守护进程。方便查看实时采样输出和测试通知。

### 通知测试

```bash
memdog notify-test
```

发送一条测试通知，用于确认系统通知权限和图标是否正常。

首次运行时，macOS 会询问是否允许通知，请点击“允许”。

## 配置与日志

配置文件：`~/.memdog/config.json`

示例：

```json
{
  "interval": 60,
  "threshold": 512,
  "targets": [
    { "name": "WeChat", "threshold": 256 },
    { "name": "企业微信", "cmdPattern": "com.tencent.WeWorkMac", "threshold": 400 },
    { "name": "node", "cmdPattern": "server.js" }
  ]
}
```

日志文件：`~/.memdog/log.txt`

## 多实例进程匹配

像 `node`、`java` 这种通用运行时，进程名相同但实际对应不同服务。MemDog 支持通过 `--cmd` 按命令行子串匹配：

```bash
memdog add node --cmd "server.js"
memdog add node --cmd "build.js"
```

如果命令行里有中文路径或应用名被系统编码，可以用稳定标识匹配，比如 macOS bundle ID：

```bash
memdog add 企业微信 --cmd "com.tencent.WeWorkMac"
```

## 通知机制

- **macOS**：通过 `osascript` 调用系统原生通知，支持提示音和自定义图标（需放置 `assets/icon.png`）。
- **Windows / Linux**：使用 `node-notifier` 发送原生通知。

纯 SSH / 服务器环境可能无法弹出通知，失败时会自动降级写入日志。

## 常见问题

**Q：修改配置后需要重启守护进程吗？**

不需要。MemDog 每次采样前都会重新读取配置文件，配置修改自动生效。

**Q：为什么远程控制时看不到弹窗？**

远程会话通常会抑制 macOS 通知弹窗。脚本执行成功后，本机登录用户应能看到弹窗和听到声音。

**Q：如何避免 MemDog 监控到自己？**

MemDog 会自动排除自身 PID，无需额外配置。

## 许可证

MIT
