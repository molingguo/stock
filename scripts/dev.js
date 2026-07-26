const { spawn } = require('node:child_process');

const processes = [
  spawn(process.execPath, ['server/index.js'], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['node_modules/react-scripts/bin/react-scripts.js', 'start'], {
    stdio: 'inherit',
    env: process.env,
  }),
];

let shuttingDown = false;
function shutdown(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  processes.forEach((child) => child.kill(signal));
}

processes.forEach((child) => {
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) process.exitCode = code || 1;
    shutdown();
  });
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
