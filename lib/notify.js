const { execFile } = require('child_process');
const { log } = require('./logger');

function escapeAppleScript(str) {
  return String(str).replace(/[\\"]/g, '\\$&');
}

function notify({ title, message }) {
  const t = title || 'MemDog';

  if (process.platform === 'darwin') {
    const script = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(t)}" sound name "default"`;
    return new Promise((resolve) => {
      execFile('/usr/bin/osascript', ['-e', script], (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || err.message || '').trim();
          log(`[通知发送失败] ${t}: ${message}${detail ? ` (${detail})` : ''}`);
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }

  // Fallback for Windows/Linux using node-notifier
  const notifier = require('node-notifier');
  const options = {
    title: t,
    message,
    sound: true,
    timeout: 10
  };

  return new Promise((resolve) => {
    notifier.notify(options, (err) => {
      if (err) {
        log(`[通知发送失败] ${t}: ${message}${err.message ? ` (${err.message})` : ''}`);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

module.exports = {
  notify
};
