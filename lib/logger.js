const fs = require('fs');
const path = require('path');
const { LOG_FILE } = require('./config');

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
  tail
};
