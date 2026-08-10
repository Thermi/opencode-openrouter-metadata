import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);

function run(command, commandArgs) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolveProcess();
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

await run(process.execPath, [resolve(root, 'scripts', 'generate-opencode-schema.mjs'), ...args]);
await run(process.execPath, [resolve(root, 'node_modules', 'typescript', 'bin', 'tsc')]);
