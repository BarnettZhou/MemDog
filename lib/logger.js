const fs = require('fs');
const path = require('path');
const { LOG_FILE } = require('./config');

const DEFAULT_MAX_LOG_BYTES = 1024 * 1024;
const configuredMaxLogBytes = parseInt(process.env.MEMDOG_MAX_LOG_BYTES || '', 10);
const MAX_LOG_BYTES = Number.isFinite(configuredMaxLogBytes) && configuredMaxLogBytes > 0
  ? configuredMaxLogBytes
  : DEFAULT_MAX_LOG_BYTES;

function ensureLogFile() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
  }
}

function nowString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function log(message) {
  ensureLogFile();
  const line = `[${nowString()}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf8');
  trimLogFileIfNeeded();
}

function trimLogFileIfNeeded() {
  const stat = fs.statSync(LOG_FILE);
  if (stat.size <= MAX_LOG_BYTES) return;

  const marker = Buffer.from(`[${nowString()}] 日志超过上限，已保留最新内容\n`, 'utf8');
  const keepBytes = Math.max(0, MAX_LOG_BYTES - marker.length);
  const buffer = Buffer.alloc(keepBytes);
  const fd = fs.openSync(LOG_FILE, 'r');

  try {
    fs.readSync(fd, buffer, 0, keepBytes, Math.max(0, stat.size - keepBytes));
  } finally {
    fs.closeSync(fd);
  }

  const newlineIndex = buffer.indexOf('\n');
  const tail = newlineIndex >= 0 ? buffer.subarray(newlineIndex + 1) : buffer;
  fs.writeFileSync(LOG_FILE, Buffer.concat([marker, tail]));
}

function tail(lines = 50) {
  ensureLogFile();
  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const allLines = content.split('\n');
  if (allLines[allLines.length - 1] === '') {
    allLines.pop();
  }
  const start = Math.max(0, allLines.length - lines);
  return allLines.slice(start).join('\n');
}

module.exports = {
  log,
  tail,
  MAX_LOG_BYTES
};
