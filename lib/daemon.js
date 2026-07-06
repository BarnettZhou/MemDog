const { loadConfig } = require('./config');
const { log } = require('./logger');
const { notify } = require('./notify');
const { findTargets, sampleTarget, isOverThreshold } = require('./monitor');

const ALARM_COOLDOWN_MS = 5 * 60 * 1000;

async function startDaemon() {
  const config = loadConfig();
  const alarmCooldown = new Map();

  log(`MemDog 守护进程启动 (PID: ${process.pid})`);
  log(`当前监控目标: ${formatTargets(config.targets)}`);
  log(`采样间隔: ${config.interval} 秒，内存阈值: ${config.threshold} MB`);

  async function tick() {
    const tickConfig = loadConfig();
    let targets;
    try {
      targets = await findTargets(tickConfig, process.pid);
    } catch (err) {
      log(`获取进程列表失败: ${err.message}`);
      return;
    }

    for (const target of targets) {
      if (target.pids.length === 0) {
        log(`${target.name} 当前未运行`);
        continue;
      }

      const sample = await sampleTarget(target);
      const threshold = target.threshold !== undefined ? target.threshold : tickConfig.threshold;
      const overThreshold = isOverThreshold(sample, threshold);

      if (sample.details.length === 0) {
        log(`${target.name} 所有 PID 采样失败`);
        continue;
      }

      if (overThreshold) {
        const now = Date.now();
        const lastAlarm = alarmCooldown.get(target.name) || 0;

        if (now - lastAlarm > ALARM_COOLDOWN_MS) {
          const message = sample.pids.length === 1
            ? `${target.name} (PID: ${sample.pids[0]}) 内存 ${sample.totalMemory.toFixed(1)} MB，超过阈值 ${threshold} MB`
            : `${target.name} (${sample.pids.length} 个进程) 总内存 ${sample.totalMemory.toFixed(1)} MB，超过阈值 ${threshold} MB`;

          notify({ title: 'MemDog 内存告警', message });
          alarmCooldown.set(target.name, now);
          log(`ALARM: ${message}`);
          log('通知已发送');
        } else {
          log(`${target.name} 总内存 ${sample.totalMemory.toFixed(1)} MB / 阈值: ${threshold} MB (冷却中，未报警)`);
        }
      } else {
        if (sample.pids.length === 1) {
          log(`${target.name} (PID: ${sample.pids[0]}) 内存: ${sample.details[0].memoryMB.toFixed(1)} MB / 阈值: ${threshold} MB`);
        } else {
          log(`${target.name} (${sample.pids.length} 个进程) 总内存: ${sample.totalMemory.toFixed(1)} MB / 阈值: ${threshold} MB`);
        }
      }
    }
  }

  // 立即执行一次，之后按间隔循环
  await tick();
  const intervalId = setInterval(tick, config.interval * 1000);

  process.on('SIGTERM', () => {
    clearInterval(intervalId);
    log('MemDog 守护进程停止');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    clearInterval(intervalId);
    log('MemDog 守护进程停止');
    process.exit(0);
  });
}

function formatTargets(targets) {
  if (targets.length === 0) return '无';
  return targets.map(t => t.cmdPattern ? `${t.name}(${t.cmdPattern})` : t.name).join(', ');
}

startDaemon().catch(err => {
  log(`守护进程异常: ${err.message}`);
  process.exit(1);
});
