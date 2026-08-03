import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 3847;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

function isServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 500));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function runTunnel(): ChildProcess {
  return spawn('npx tsx server/scripts/tunnel.ts', {
    cwd: root,
    shell: true,
    stdio: 'inherit',
  });
}

function runServer(): ChildProcess {
  return spawn('npm run start', {
    cwd: root,
    shell: true,
    stdio: 'inherit',
  });
}

async function main() {
  if (await isServerUp()) {
    console.log(`TrotLab kör redan på port ${PORT} — startar bara tunnel.\n`);
    const tunnel = runTunnel();
    tunnel.on('exit', (code) => process.exit(code ?? 1));
    return;
  }

  console.log('Startar TrotLab och tunnel...\n');

  const server = runServer();
  const tunnel = runTunnel();

  const shutdown = (code = 0) => {
    if (!server.killed) server.kill('SIGTERM');
    if (!tunnel.killed) tunnel.kill('SIGTERM');
    process.exit(code);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  server.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`Servern avslutades med kod ${code}.`);
    }
    if (!tunnel.killed) tunnel.kill('SIGTERM');
    process.exit(code ?? 1);
  });

  tunnel.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`Tunneln avslutades med kod ${code}.`);
    }
    if (!server.killed) server.kill('SIGTERM');
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
