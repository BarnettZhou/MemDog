const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { log } = require('./logger');

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');

function escapeAppleScript(str) {
  return String(str).replace(/[\\"]/g, '\\$&');
}

function notify({ title, message }) {
  const t = title || 'MemDog';

  if (process.platform === 'darwin') {
    const hasIcon = fs.existsSync(ICON_PATH);
    const iconClause = hasIcon
      ? ` with icon file (POSIX file "${escapeAppleScript(ICON_PATH)}")`
      : '';
    const script = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(t)}" sound name "default"${iconClause}`;
    const child = spawn('osascript', ['-e', script], {
      detached: true,
      stdio: 'ignore'
    });
    child.on('error', (err) => {
      log(`[通知发送失败] ${t}: ${message} (${err.message})`);
    });
    child.unref();
    return;
  }

  // Fallback for Windows/Linux using node-notifier
  const notifier = require('node-notifier');
  const options = {
    title: t,
    message,
    sound: true,
    timeout: 10
  };

  if (fs.existsSync(ICON_PATH)) {
    options.icon = ICON_PATH;
  }

  notifier.notify(options, (err) => {
    if (err) {
      log(`[通知发送失败] ${t}: ${message}`);
    }
  });
}

module.exports = {
  notify
};
