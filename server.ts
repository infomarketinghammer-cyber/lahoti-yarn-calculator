import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const hasTsx = Boolean(
  process.env.__TSX_LOADED__ === 'true' ||
  Boolean((process as any)[Symbol.for('tsx')]) ||
  process.execArgv.some(a => a.includes('tsx'))
);

if (!hasTsx) {
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, __TSX_LOADED__: 'true' },
  });

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (child && !child.killed) {
      child.kill(signal);
    }
  };

  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  process.on('SIGINT', () => forwardSignal('SIGINT'));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
} else {
  await import('./server-app.ts');
}
