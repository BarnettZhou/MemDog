const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.memdog');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LOG_FILE = path.join(CONFIG_DIR, 'log.txt');
const PID_FILE = path.join(CONFIG_DIR, 'daemon.pid');

const DEFAULT_CONFIG = {
  interval: 60,
  threshold: 512,
  targets: []
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    saveConfig(DEFAULT_CONFIG);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      interval: parsed.interval ?? DEFAULT_CONFIG.interval,
      threshold: parsed.threshold ?? DEFAULT_CONFIG.threshold,
      targets: Array.isArray(parsed.targets) ? parsed.targets : []
    };
  } catch (err) {
    console.error('读取配置文件失败，使用默认配置:', err.message);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function parseThreshold(value) {
  const num = parseInt(value, 10);
  if (Number.isNaN(num) || num < 1) {
    return null;
  }
  return num;
}

function addTarget(name, cmdPattern, targetThreshold) {
  const config = loadConfig();
  const exists = config.targets.find(t => t.name === name && (t.cmdPattern || null) === (cmdPattern || null));
  if (exists) {
    return { ok: false, reason: 'exists' };
  }
  const target = { name, cmdPattern: cmdPattern || undefined };
  if (targetThreshold !== undefined && targetThreshold !== null) {
    target.threshold = targetThreshold;
  }
  config.targets.push(target);
  saveConfig(config);
  return { ok: true, target };
}

function removeTarget(name) {
  const config = loadConfig();
  const before = config.targets.length;
  config.targets = config.targets.filter(t => t.name !== name);
  saveConfig(config);
  return config.targets.length < before;
}

function setIntervalSec(seconds) {
  const config = loadConfig();
  config.interval = parseInt(seconds, 10);
  saveConfig(config);
}

function resolveTargetIndex(config, input) {
  const match = input.match(/^#?(\d+)$/);
  if (!match) return null;
  const idx = parseInt(match[1], 10) - 1;
  if (idx < 0 || idx >= config.targets.length) return null;
  return idx;
}

function removeTargetByIndex(index) {
  const config = loadConfig();
  if (index < 0 || index >= config.targets.length) return null;
  const removed = config.targets.splice(index, 1)[0];
  saveConfig(config);
  return removed;
}

function setTargetThreshold(index, mb) {
  const config = loadConfig();
  if (index < 0 || index >= config.targets.length) return null;
  config.targets[index].threshold = parseInt(mb, 10);
  saveConfig(config);
  return config.targets[index];
}

function setThreshold(mb) {
  const config = loadConfig();
  config.threshold = parseInt(mb, 10);
  saveConfig(config);
}

module.exports = {
  CONFIG_DIR,
  CONFIG_FILE,
  LOG_FILE,
  PID_FILE,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  addTarget,
  removeTarget,
  removeTargetByIndex,
  setIntervalSec,
  setThreshold,
  setTargetThreshold,
  parseThreshold,
  resolveTargetIndex
};
