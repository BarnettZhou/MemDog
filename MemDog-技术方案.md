# MemDog 技术方案文档

> **MemDog** = Memory + Watchdog，内存看门狗。定时巡逻监控进程内存，超阈值即吠（通知告警）。

---

## 1. 项目概述

| 项目 | 说明 |
|------|------|
| 名称 | MemDog |
| CLI 命令 | `memdog` |
| 用途 | 监控指定进程列表的内存占用，超阈值时通过系统原生通知告警 |
| 采样间隔 | 可配置（30秒 / 1分钟 / 2分钟，默认 60秒） |
| 内存阈值 | 可配置（默认 512 MB） |
| 运行模式 | 前台调试 / 后台守护进程 |

---

## 2. 核心疑问解答

### 2.1 通知能否在后台正常发送？

**可以。** 使用 `node-notifier` 调用操作系统原生通知接口，不依赖终端存活：

| 平台 | 通知机制 | 后台支持 |
|------|----------|----------|
| **macOS** | Notification Center（osascript / 原生绑定） | ✅ 完全支持 |
| **Windows** | Toast Notification（PowerShell / SnoreToast） | ✅ 完全支持 |
| **Linux** | `notify-send`（D-Bus） | ✅ 桌面环境支持；纯服务器降级为日志 |

首次运行时系统会询问是否允许通知，点击允许即可。通知由操作系统渲染，与终端是否打开无关。

### 2.2 后台运行方案

采用**内置 Daemon 自管理**，零外部依赖：

- `memdog start`：以 `detached` 模式启动子进程，将 PID 写入 `~/.memdog/daemon.pid`
- `memdog stop`：读取 PID 文件，发送 `SIGTERM` 信号
- `memdog status`：检查 PID 文件及进程是否存在
- 日志持久化到 `~/.memdog/log.txt`

备选：使用 `pm2` / `forever`，但增加用户环境负担，不如内置方案干净自包含。

### 2.3 为什么 Node 会产生多个进程，而微信不会？

**Node 是通用运行时（Runtime）**，你电脑上可能同时运行：
- 前端 dev server：`npm run dev` → `node`
- 后端服务：`node server.js` → `node`
- 构建脚本：`node build.js` → `node`
- 你的 MemDog 本身：也是 `node`

这些进程名都叫 `node`，但彼此毫无关系。一个 Node 程序还可能用 `cluster` 模块开出多个 worker 进程。

**微信是完整应用（Application）**，实现了单例模式（Singleton），启动时检查是否已有实例，有则唤起已有窗口，不会重复创建进程。

**对 MemDog 的影响**：
- 监控 `node` 时**必须排除自身 PID**，否则 MemDog 会监控自己
- 建议支持**按启动命令/路径精确匹配**（如 `node ./server.js`），而非仅按进程名
- 对多实例进程，可选择**分别展示**每个 PID 的内存，或**聚合展示**总内存

---

## 3. 技术栈选型

| 模块 | 依赖 | 说明 |
|------|------|------|
| CLI 框架 | `commander` | 成熟、文档好、支持子命令与选项 |
| 进程信息 | `pidusage` | 跨平台获取 PID 的内存、CPU 占用 |
| 进程查找 | `ps-list` | 将进程名映射到 PID，支持多实例 |
| 系统通知 | `node-notifier` | 跨平台原生通知，支持 macOS/Windows/Linux |
| 配置存储 | 原生 `fs` | JSON 文件存于 `~/.memdog/config.json` |
| 路径处理 | 原生 `path` + `os` | 处理跨平台 home 目录与路径拼接 |

---

## 4. CLI 命令设计

```bash
# 进程名单管理
memdog add <process-name> [--cmd <cmd-pattern>]    # 添加监听进程
                                                   # 如: memdog add node --cmd "server.js"
memdog remove <process-name>                       # 从监听列表移除
memdog list                                        # 查看当前监听名单及运行状态

# 参数配置
memdog interval <seconds>                          # 采样间隔（如 30, 60, 120），默认 60
memdog threshold <mb>                              # 内存阈值（MB），默认 512

# 守护进程控制
memdog start                                       # 后台启动监控
memdog stop                                        # 停止监控
memdog status                                      # 查看守护进程是否运行
memdog log [lines]                                 # 查看最近 N 行日志（默认 50）

# 调试
memdog run                                         # 前台直接运行（不调守护进程，方便调试）
```

---

## 5. 关键实现细节

### 5.1 进程名 → PID 映射（核心难点）

使用 `ps-list` 获取系统进程快照，按规则过滤匹配项。

**匹配策略（优先级从高到低）：**

1. **精确命令匹配**（推荐）：如果用户指定了 `--cmd`，匹配进程的完整命令行（如 `node ./server.js`）
2. **进程名匹配**：按 `name` 字段匹配（如 `node`、`WeChat`、`WeCom`）
3. **排除自身 PID**：启动时记录 `process.pid`，采样时永远跳过

**多实例处理：**

```javascript
// 伪代码
async function findTargets(config) {
  const allProcs = await psList();
  const results = [];

  for (const target of config.targets) {
    const matched = allProcs.filter(p => {
      if (p.pid === ownPid) return false; // 排除自己
      if (target.cmdPattern) {
        return p.cmd && p.cmd.includes(target.cmdPattern);
      }
      return p.name === target.name || p.name === target.name.toLowerCase();
    });

    results.push({
      name: target.name,
      pids: matched.map(p => p.pid),
      cmdPattern: target.cmdPattern
    });
  }

  return results;
}
```

**展示策略：**
- 单实例进程（如微信）：直接展示该 PID 内存
- 多实例进程（如 Node）：分别展示每个 PID 内存，同时提供**聚合总内存**
- 未运行进程：标记为 "未运行"，不报警，记录日志

### 5.2 采样与报警逻辑（daemon.js 核心）

```javascript
// 伪代码
const alarmCooldown = new Map(); // 进程名 -> 上次报警时间

setInterval(async () => {
  const targets = await findTargets(config);

  for (const target of targets) {
    if (target.pids.length === 0) {
      log(`${target.name} 当前未运行`);
      continue;
    }

    let totalMemory = 0;
    const details = [];

    for (const pid of target.pids) {
      try {
        const stats = await pidusage(pid);
        const memoryMB = stats.memory / 1024 / 1024;
        totalMemory += memoryMB;
        details.push({ pid, memoryMB });
      } catch (e) {
        log(`PID ${pid} 采样失败: ${e.message}`);
      }
    }

    // 判断逻辑：分别判断每个 PID 是否超阈值，同时判断总内存是否超阈值
    const overThreshold = details.some(d => d.memoryMB > config.threshold) 
                       || totalMemory > config.threshold;

    if (overThreshold) {
      const now = Date.now();
      const lastAlarm = alarmCooldown.get(target.name) || 0;

      // 冷却期：同一进程 5 分钟内只报警一次
      if (now - lastAlarm > 5 * 60 * 1000) {
        const message = target.pids.length === 1
          ? `${target.name} (PID: ${target.pids[0]}) 内存 ${totalMemory.toFixed(1)} MB，超过阈值 ${config.threshold} MB`
          : `${target.name} (${target.pids.length} 个进程) 总内存 ${totalMemory.toFixed(1)} MB，超过阈值 ${config.threshold} MB`;

        notify({
          title: 'MemDog 内存告警',
          message: message
        });

        alarmCooldown.set(target.name, now);
        log(`ALARM: ${message}`);
      }
    }
  }
}, config.interval * 1000);
```

### 5.3 守护进程启动与停止

**start 命令：**

```javascript
const { spawn } = require('child_process');
const path = require('path');

function startDaemon() {
  // 检查是否已运行
  if (isDaemonRunning()) {
    console.log('MemDog 守护进程已在运行');
    return;
  }

  const daemonPath = path.join(__dirname, '../lib/daemon.js');
  const logPath = path.join(CONFIG_DIR, 'log.txt');

  // 以追加模式打开日志文件
  const out = fs.openSync(logPath, 'a');
  const err = fs.openSync(logPath, 'a');

  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: ['ignore', out, err] // stdin忽略，stdout/stderr写入日志
  });

  child.unref();
  fs.writeFileSync(PID_FILE, child.pid.toString());
  console.log(`MemDog 守护进程已启动 (PID: ${child.pid})`);
}
```

**stop 命令：**

```javascript
function stopDaemon() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('MemDog 守护进程未运行');
    return;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`MemDog 守护进程已停止 (PID: ${pid})`);
  } catch (e) {
    if (e.code === 'ESRCH') {
      console.log('进程已不存在，清理 PID 文件');
    } else {
      console.error('停止失败:', e.message);
    }
  } finally {
    fs.unlinkSync(PID_FILE);
  }
}
```

**status 命令：**

```javascript
function daemonStatus() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('MemDog 守护进程: 未运行');
    return false;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
  try {
    process.kill(pid, 0); // 信号 0 用于检测进程是否存在
    console.log(`MemDog 守护进程: 运行中 (PID: ${pid})`);
    return true;
  } catch (e) {
    console.log('MemDog 守护进程: 未运行 (PID 文件残留)');
    fs.unlinkSync(PID_FILE);
    return false;
  }
}
```

### 5.4 通知系统封装

```javascript
const notifier = require('node-notifier');
const path = require('path');

function notify({ title, message }) {
  notifier.notify({
    title: title || 'MemDog',
    message: message,
    icon: path.join(__dirname, '../assets/icon.png'), // 可选：自定义图标
    sound: true, // 播放提示音
    timeout: 10 // 通知停留 10 秒
  }, (err, response) => {
    if (err) {
      // 降级：写入日志
      log(`[通知发送失败] ${title}: ${message}`);
    }
  });
}
```

**无 GUI 环境降级：**
- `node-notifier` 在纯 SSH/服务器环境会失败
- 捕获错误后降级为仅写入日志文件
- 用户可通过 `memdog log` 查看告警记录

### 5.5 配置结构

**文件位置**: `~/.memdog/config.json`

```json
{
  "interval": 60,
  "threshold": 512,
  "targets": [
    { "name": "node", "cmdPattern": "server.js" },
    { "name": "WeChat" },
    { "name": "WeCom" },
    { "name": "docker" }
  ]
}
```

**字段说明：**
- `interval`: 采样间隔（秒）
- `threshold`: 内存阈值（MB）
- `targets`: 监控目标列表
  - `name`: 进程名（必填）
  - `cmdPattern`: 命令行匹配模式（可选，用于精确匹配多实例进程）

### 5.6 日志格式

**文件位置**: `~/.memdog/log.txt`

```
[2026-07-06 14:32:01] MemDog 守护进程启动 (PID: 12345)
[2026-07-06 14:32:01] 当前监控目标: node(server.js), WeChat, WeCom, docker
[2026-07-06 14:33:01] node (PID: 67890) 内存: 245.3 MB / 阈值: 512 MB
[2026-07-06 14:34:01] node (PID: 67890) 内存: 267.1 MB / 阈值: 512 MB
[2026-07-06 14:35:01] ALARM: node (PID: 67890) 内存 523.8 MB，超过阈值 512 MB
[2026-07-06 14:35:01] 通知已发送
[2026-07-06 14:36:01] node (PID: 67890) 内存: 498.2 MB / 阈值: 512 MB (冷却中，未报警)
[2026-07-06 14:40:01] ALARM: node (PID: 67890) 内存 567.3 MB，超过阈值 512 MB
[2026-07-06 15:00:00] MemDog 守护进程停止
```

---

## 6. 跨平台兼容性

| 平台 | 通知支持 | 后台进程 | 注意事项 |
|------|----------|----------|----------|
| **macOS** | ✅ Notification Center | ✅ detached | 首次需在系统偏好设置 → 通知 → 允许 Node 发送通知 |
| **Windows** | ✅ Toast | ✅ detached | 可能短暂弹出 PowerShell 窗口，可用 `windows-hide` 优化 |
| **Linux** | ✅ notify-send | ✅ detached | 需桌面环境 + D-Bus；纯服务器环境降级为日志 |

---

## 7. 推荐项目结构

```
memdog/
├── bin/
│   └── memdog.js              # CLI 入口，commander 路由
├── lib/
│   ├── daemon.js              # 守护进程主循环（采样 + 报警）
│   ├── monitor.js             # 进程查找、内存采样、阈值判断
│   ├── config.js              # 配置读写（~/.memdog/config.json）
│   ├── notify.js              # 通知封装（含无 GUI 降级）
│   └── logger.js              # 日志工具（带时间戳、级别）
├── assets/
│   └── icon.png               # 通知图标（可选）
├── package.json
└── README.md
```

---

## 8. package.json

```json
{
  "name": "memdog",
  "version": "1.0.0",
  "description": "A lightweight CLI tool to monitor process memory usage and alert via system notifications",
  "main": "bin/memdog.js",
  "bin": {
    "memdog": "./bin/memdog.js"
  },
  "scripts": {
    "test": "echo "Error: no test specified" && exit 1"
  },
  "keywords": ["memory", "monitor", "process", "watchdog", "cli"],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "commander": "^11.1.0",
    "pidusage": "^3.0.2",
    "ps-list": "^8.1.0",
    "node-notifier": "^10.0.1"
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
```

---

## 9. 实现步骤建议

### 第一阶段：骨架搭建（30分钟）
1. `npm init` 创建项目，安装依赖
2. 配置 `bin/memdog.js` 的 commander 命令路由
3. 实现 `config.js`：读写 `~/.memdog/config.json`，确保目录存在
4. 实现 `memdog add/remove/list/interval/threshold` 命令，验证配置读写正常

### 第二阶段：采样逻辑（30分钟）
1. 实现 `monitor.js`：用 `ps-list` + `pidusage` 获取指定进程内存
2. 处理多实例匹配、排除自身 PID
3. 在终端打印采样结果，验证数据准确性
4. 测试 `memdog run` 前台运行模式

### 第三阶段：通知与守护（30分钟）
1. 实现 `notify.js`：用 `node-notifier` 发送测试通知，确认系统能正常弹出
2. 实现 `daemon.js`：把采样逻辑搬到定时循环中，加入阈值判断
3. 实现 `memdog start/stop/status`：PID 文件管理、信号处理
4. 实现 `logger.js`：日志写入 `~/.memdog/log.txt`

### 第四阶段：打磨（30分钟）
1. 加入报警冷却期（5分钟同一进程不重复报警）
2. 加入无 GUI 环境降级（通知失败时写日志）
3. 优化 `memdog log` 命令（读取最近 N 行）
4. 添加 `--cmd` 精确匹配支持
5. 测试边界情况：进程不存在、PID 失效、配置损坏等

---

## 10. 边界情况与注意事项

1. **排除自身**：`monitor.js` 中必须排除 `process.pid`，否则 MemDog 监控自己会导致循环报警
2. **进程消失**：采样时某个 PID 可能已退出，`pidusage` 会抛错，需 try-catch 并记录日志
3. **PID 文件残留**：守护进程崩溃后 PID 文件可能残留，`status` 和 `start` 时需检测并清理
4. **日志轮转**：日志文件可能无限增长，后续可加入按日期切分或限制大小（V2 功能）
5. **权限问题**：某些系统进程可能无法采样内存，`pidusage` 会抛 `EPERM`，需捕获并跳过
6. **进程名大小写**：Windows 进程名可能大小写不敏感，建议匹配时统一转小写比较
7. **命令行匹配**：`ps-list` 返回的 `cmd` 字段在不同平台格式不同，macOS/Linux 是完整命令行，Windows 可能只有路径，需测试适配

---

## 11. 后续可扩展（V2 方向）

- **CPU 监控**：同时监控 CPU 占用率
- **自动重启**：超阈值后自动 kill 并重启进程（危险，需谨慎）
- **Webhook 通知**：除系统通知外，支持企业微信/钉钉/Slack  webhook
- **历史图表**：记录历史数据，生成内存占用趋势图
- **配置文件热重载**：修改配置后无需重启守护进程
- **进程白名单/黑名单**：支持正则匹配、排除特定 PID 模式
