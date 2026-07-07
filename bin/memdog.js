#!/usr/bin/env node

const { Command } = require('commander');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  loadConfig,
  addTarget,
  removeTarget,
  removeTargetByIndex,
  setIntervalSec,
  setThreshold,
  setTargetThreshold,
  parseThreshold,
  resolveTargetIndex,
  PID_FILE,
  LOG_FILE,
  CONFIG_DIR
} = require('../lib/config');
const { tail, log: writeLog } = require('../lib/logger');
const { notify } = require('../lib/notify');
const { findTargets, sampleTarget, isOverThreshold } = require('../lib/monitor');

const program = new Command();
const DAEMON_PATH = path.join(__dirname, '..', 'lib', 'daemon.js');

function isDaemonRunning() {
  if (!fs.existsSync(PID_FILE)) return false;
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    fs.unlinkSync(PID_FILE);
    return false;
  }
}

program
  .name('memdog')
  .description('内存看门狗：监控进程内存，超阈值时系统通知告警')
  .version('1.0.0')
  .helpCommand(false);

program
  .command('add <process-name>')
  .description('添加监听进程')
  .option('--cmd <cmd-pattern>', '按命令行精确匹配，如 server.js')
  .option('--threshold <mb>', '该进程的内存阈值（MB），默认 512，最小 1')
  .action((processName, options) => {
    let targetThreshold;
    if (options.threshold !== undefined) {
      targetThreshold = parseThreshold(options.threshold);
      if (targetThreshold === null) {
        console.error('错误: --threshold 必须是大于等于 1 的整数');
        process.exit(1);
      }
    }
    const result = addTarget(processName, options.cmd, targetThreshold);
    if (result.ok) {
      const thresholdInfo = result.target.threshold !== undefined
        ? `, 阈值: ${result.target.threshold} MB`
        : '';
      console.log(`已添加监听: ${processName}${options.cmd ? `(${options.cmd})` : ''}${thresholdInfo}`);
    } else if (result.reason === 'exists') {
      console.log(`监听目标已存在: ${processName}${options.cmd ? `(${options.cmd})` : ''}`);
    } else {
      console.log(`添加失败: ${processName}`);
    }
  });

program
  .command('remove <process-name-or-index>')
  .description('从监听列表移除（支持进程名或 #index）')
  .action((input) => {
    const config = loadConfig();
    const idx = resolveTargetIndex(config, input);
    if (idx !== null) {
      const removed = removeTargetByIndex(idx);
      if (removed) {
        const display = removed.cmdPattern ? `${removed.name}(${removed.cmdPattern})` : removed.name;
        console.log(`已移除监听 #${idx + 1}: ${display}`);
      } else {
        console.log(`移除失败: ${input}`);
      }
      return;
    }

    const removed = removeTarget(input);
    if (removed) {
      console.log(`已移除监听: ${input}`);
    } else {
      console.log(`监听目标不存在: ${input}`);
    }
  });

program
  .command('list')
  .description('查看当前监听名单及运行状态')
  .action(async () => {
    const config = loadConfig();
    if (config.targets.length === 0) {
      console.log('当前没有监听任何进程');
      return;
    }
    const targets = await findTargets(config, process.pid);
    console.log(`采样间隔: ${config.interval} 秒，全局内存阈值: ${config.threshold} MB`);
    console.log('监听目标:');
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const status = target.pids.length === 0
        ? '未运行'
        : `${target.pids.length} 个 PID: ${target.pids.join(', ')}`;
      const display = target.cmdPattern ? `${target.name}(${target.cmdPattern})` : target.name;
      const thresholdInfo = target.threshold !== undefined ? ` 阈值: ${target.threshold} MB` : '';
      console.log(`  #${i + 1} ${display}:${thresholdInfo} ${status}`);
    }
  });

program
  .command('set-threshold <index> <mb>')
  .description('修改指定监听进程的内存阈值（MB），index 可用 #1 或直接 1')
  .action((indexInput, mb) => {
    const config = loadConfig();
    const idx = resolveTargetIndex(config, indexInput);
    if (idx === null) {
      console.error(`错误: 无效的索引 ${indexInput}`);
      process.exit(1);
    }
    const threshold = parseThreshold(mb);
    if (threshold === null) {
      console.error('错误: 阈值必须是大于等于 1 的整数');
      process.exit(1);
    }
    const target = setTargetThreshold(idx, threshold);
    const display = target.cmdPattern ? `${target.name}(${target.cmdPattern})` : target.name;
    console.log(`已设置 #${idx + 1} ${display} 的阈值为 ${threshold} MB`);
  });

program
  .command('interval <seconds>')
  .description('设置采样间隔（秒）')
  .action((seconds) => {
    setIntervalSec(seconds);
    console.log(`采样间隔已设置为 ${seconds} 秒`);
  });

program
  .command('threshold <mb>')
  .description('设置内存阈值（MB）')
  .action((mb) => {
    setThreshold(mb);
    console.log(`内存阈值已设置为 ${mb} MB`);
  });

program
  .command('start')
  .description('后台启动监控')
  .action(() => {
    const running = isDaemonRunning();
    if (running) {
      console.log(`MemDog 守护进程已在运行 (PID: ${running})`);
      return;
    }

    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    const out = fs.openSync(LOG_FILE, 'a');
    const err = fs.openSync(LOG_FILE, 'a');

    const child = spawn(process.execPath, [DAEMON_PATH], {
      detached: true,
      stdio: ['ignore', out, err]
    });

    child.unref();
    fs.writeFileSync(PID_FILE, child.pid.toString());
    console.log(`MemDog 守护进程已启动 (PID: ${child.pid})`);
  });

program
  .command('stop')
  .description('停止监控')
  .action(() => {
    if (!fs.existsSync(PID_FILE)) {
      console.log('MemDog 守护进程未运行');
      return;
    }
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
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
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
      }
    }
  });

program
  .command('status')
  .description('查看守护进程是否运行')
  .action(() => {
    const running = isDaemonRunning();
    if (running) {
      console.log(`MemDog 守护进程: 运行中 (PID: ${running})`);
    } else {
      console.log('MemDog 守护进程: 未运行');
    }
  });

program
  .command('notify-test')
  .description('发送一条测试通知，用于确认通知权限')
  .action(async () => {
    const sent = await notify({
      title: 'MemDog 通知测试',
      message: '如果你看到这条消息，说明通知权限正常 🔔'
    });
    if (sent) {
      console.log('测试通知已发送，请检查系统通知栏。');
    } else {
      console.log(`测试通知发送失败，请查看日志: ${LOG_FILE}`);
    }
  });

program
  .command('log [lines]')
  .description('查看最近 N 行日志（默认 50）')
  .action((lines = 50) => {
    const n = parseInt(lines, 10) || 50;
    console.log(tail(n));
  });

program
  .command('run')
  .description('前台直接运行（不调守护进程，方便调试）')
  .action(async () => {
    const config = loadConfig();
    console.log(`MemDog 前台运行 (PID: ${process.pid})`);
    console.log(`采样间隔: ${config.interval} 秒，内存阈值: ${config.threshold} MB`);
    console.log(`监控目标: ${config.targets.map(t => t.cmdPattern ? `${t.name}(${t.cmdPattern})` : t.name).join(', ')}`);

    const alarmCooldown = new Map();

    async function tick() {
      const tickConfig = loadConfig();
      let targets;
      try {
        targets = await findTargets(tickConfig, process.pid);
      } catch (err) {
        console.error('获取进程列表失败:', err.message);
        return;
      }

      for (const target of targets) {
        if (target.pids.length === 0) {
          console.log(`${new Date().toLocaleTimeString()} ${target.name} 当前未运行`);
          continue;
        }

        const sample = await sampleTarget(target);
        const threshold = target.threshold !== undefined ? target.threshold : tickConfig.threshold;
        const overThreshold = isOverThreshold(sample, threshold);

        if (sample.details.length === 0) {
          console.log(`${new Date().toLocaleTimeString()} ${target.name} 所有 PID 采样失败`);
          continue;
        }

        if (overThreshold) {
          const now = Date.now();
          const lastAlarm = alarmCooldown.get(target.name) || 0;
          if (now - lastAlarm > 5 * 60 * 1000) {
            const message = sample.pids.length === 1
              ? `${target.name} (PID: ${sample.pids[0]}) 内存 ${sample.totalMemory.toFixed(1)} MB，超过阈值 ${threshold} MB`
              : `${target.name} (${sample.pids.length} 个进程) 总内存 ${sample.totalMemory.toFixed(1)} MB，超过阈值 ${threshold} MB`;
            const sent = await notify({ title: 'MemDog 内存告警', message });
            alarmCooldown.set(target.name, now);
            console.log(`${new Date().toLocaleTimeString()} ALARM: ${message}`);
            if (!sent) {
              console.log(`${new Date().toLocaleTimeString()} 通知发送失败，请查看日志: ${LOG_FILE}`);
            }
          } else {
            console.log(`${new Date().toLocaleTimeString()} ${target.name} 总内存 ${sample.totalMemory.toFixed(1)} MB / 阈值: ${threshold} MB (冷却中，未报警)`);
          }
        } else {
          const msg = sample.pids.length === 1
            ? `${target.name} (PID: ${sample.pids[0]}) 内存: ${sample.details[0].memoryMB.toFixed(1)} MB / 阈值: ${threshold} MB`
            : `${target.name} (${sample.pids.length} 个进程) 总内存: ${sample.totalMemory.toFixed(1)} MB / 阈值: ${threshold} MB`;
          console.log(`${new Date().toLocaleTimeString()} ${msg}`);
        }
      }
    }

    await tick();
    const intervalId = setInterval(tick, config.interval * 1000);

    process.on('SIGINT', () => {
      clearInterval(intervalId);
      console.log('\nMemDog 前台运行已停止');
      process.exit(0);
    });
  });

program
  .command('help [command]')
  .description('查看帮助信息')
  .action((commandName) => {
    if (!commandName) {
      printGeneralHelp();
      return;
    }

    const command = program.commands.find(cmd => cmd.name() === commandName);
    if (!command || command.name() === 'help') {
      console.error(`未知命令: ${commandName}`);
      console.error('可运行 memdog help 查看所有命令。');
      process.exitCode = 1;
      return;
    }

    command.outputHelp();
  });

function printGeneralHelp() {
  console.log(`
MemDog - 内存看门狗

用法:
  memdog <命令> [参数]

常用流程:
  memdog add WeChat --threshold 256
  memdog start
  memdog status
  memdog log
  memdog stop

命令:
  add <process-name>              添加监听进程
  remove <process-name-or-index>  移除监听目标
  list                            查看监听名单和运行状态
  threshold <mb>                  设置全局内存阈值
  set-threshold <index> <mb>      设置单个目标阈值
  interval <seconds>              设置采样间隔
  start                           后台启动监控
  stop                            停止监控
  status                          查看守护进程状态
  log [lines]                     查看最近日志
  notify-test                     发送测试通知
  run                             前台运行，方便调试
  help [command]                  查看帮助信息

更多:
  memdog help <command>
  memdog <command> --help
`.trim());
}

program.parse();
