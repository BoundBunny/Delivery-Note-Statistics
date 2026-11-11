'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require('electron'), [path.join(__dirname, process.argv[2] || 'ui-regression.cjs'), ...process.argv.slice(3)], {
  env, encoding: 'utf8', windowsHide: true, timeout: 180000,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 ? 0 : 1;
