const { loadConfig } = require('./config');
const { log } = require('./logger');
const { notify } = require('./notify');
const { findTargets, sampleTarget, isOverThreshold } = require('./monitor');

const ALARM_COOLDOWN_MS = 5 * 60 * 1000;

async function startDaemon() {
  const config = loadConfig();
  const alarmCooldown = new Map();
  const targetStates = new Map();

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
      const key = targetKey(target);

      if (target.pids.length === 0) {
        logStateChange(targetStates, key, 'missing', `${formatTarget(target)} 当前未运行`);
        continue;
      }

      const sample = await sampleTarget(target);
      const threshold = target.threshold !== undefined ? target.threshold : tickConfig.threshold;
      const overThreshold = isOverThreshold(sample, threshold);

      if (sample.details.length === 0) {
        logStateChange(targetStates, key, 'sample_failed', `${formatTarget(target)} 所有 PID 采样失败`);
        continue;
      }

      if (overThreshold) {
        const now = Date.now();
        const lastAlarm = alarmCooldown.get(key) || 0;
        const shouldNotify = now - lastAlarm > ALARM_COOLDOWN_MS;
        const message = formatOverThresholdMessage(target, sample, threshold);

        if (shouldNotify) {
          const sent = await notify({ title: 'MemDog 内存告警', message });
          alarmCooldown.set(key, now);
          log(`ALARM: ${message}`);
          log(sent ? '通知已发送' : '通知发送失败');
          targetStates.set(key, 'over');
        } else if (targetStates.get(key) !== 'over') {
          log(`超过阈值: ${message} (通知冷却中，未报警)`);
          targetStates.set(key, 'over');
        }
      } else {
        const previousState = targetStates.get(key);
        const usageMessage = formatNormalUsageMessage(target, sample, threshold);
        if (previousState === 'over') {
          log(`恢复正常: ${usageMessage}`);
        } else if (previousState === 'missing') {
          log(`恢复运行: ${usageMessage}`);
        } else if (previousState === 'sample_failed') {
          log(`采样恢复: ${usageMessage}`);
        } else {
          targetStates.set(key, 'normal');
          continue;
        }
        targetStates.set(key, 'normal');
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
  return targets.map(formatTarget).join(', ');
}

function formatTarget(target) {
  return target.cmdPattern ? `${target.name}(${target.cmdPattern})` : target.name;
}

function targetKey(target) {
  return `${target.name}\0${target.cmdPattern || ''}`;
}

function logStateChange(targetStates, key, state, message) {
  if (targetStates.get(key) === state) return;
  targetStates.set(key, state);
  log(message);
}

function formatOverThresholdMessage(target, sample, threshold) {
  if (sample.pids.length === 1) {
    return `${formatTarget(target)} (PID: ${sample.pids[0]}) 内存 ${sample.totalMemory.toFixed(1)} MB，超过阈值 ${threshold} MB`;
  }
  return `${formatTarget(target)} (${sample.pids.length} 个进程) 总内存 ${sample.totalMemory.toFixed(1)} MB，超过阈值 ${threshold} MB`;
}

function formatNormalUsageMessage(target, sample, threshold) {
  if (sample.pids.length === 1) {
    return `${formatTarget(target)} (PID: ${sample.pids[0]}) 内存 ${sample.details[0].memoryMB.toFixed(1)} MB / 阈值: ${threshold} MB`;
  }
  return `${formatTarget(target)} (${sample.pids.length} 个进程) 总内存 ${sample.totalMemory.toFixed(1)} MB / 阈值: ${threshold} MB`;
}

startDaemon().catch(err => {
  log(`守护进程异常: ${err.message}`);
  process.exit(1);
});
