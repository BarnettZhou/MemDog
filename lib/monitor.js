const pidusage = require('pidusage');
const { log } = require('./logger');

let psListCache = null;

async function getPsList() {
  if (!psListCache) {
    // ps-list v8+ is ESM-only, load dynamically from CommonJS
    const mod = await import('ps-list');
    psListCache = mod.default || mod;
  }
  return psListCache;
}

async function findTargets(config, ownPid = process.pid) {
  const psList = await getPsList();
  const allProcs = await psList();
  const results = [];

  for (const target of config.targets) {
    const matched = allProcs.filter(p => {
      if (p.pid === ownPid) return false;
      if (target.cmdPattern) {
        const cmd = p.cmd || '';
        return cmd.includes(target.cmdPattern);
      }
      const nameLower = (p.name || '').toLowerCase();
      return nameLower === target.name.toLowerCase();
    });

    results.push({
      name: target.name,
      pids: matched.map(p => p.pid),
      cmdPattern: target.cmdPattern,
      threshold: target.threshold
    });
  }

  return results;
}

async function sampleTarget(target) {
  const details = [];
  let totalMemory = 0;

  for (const pid of target.pids) {
    try {
      const stats = await pidusage(pid);
      const memoryMB = stats.memory / 1024 / 1024;
      totalMemory += memoryMB;
      details.push({ pid, memoryMB });
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'ESRCH') {
        log(`PID ${pid} 采样失败: ${err.message}`);
      } else {
        log(`PID ${pid} 采样失败: ${err.message}`);
      }
    }
  }

  return {
    name: target.name,
    pids: target.pids,
    cmdPattern: target.cmdPattern,
    details,
    totalMemory
  };
}

function isOverThreshold(sample, threshold) {
  return sample.details.some(d => d.memoryMB > threshold) || sample.totalMemory > threshold;
}

module.exports = {
  findTargets,
  sampleTarget,
  isOverThreshold
};
