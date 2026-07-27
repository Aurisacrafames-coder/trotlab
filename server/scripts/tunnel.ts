import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 3847;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

function waitForServer(maxMs = 60_000): Promise<void> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/game-sessions`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - start > maxMs) {
        reject(new Error('Servern svarade inte — kör npm run start eller npm run share först.'));
        return;
      }
      setTimeout(probe, 400);
    };

    probe();
  });
}

function watchForPublicUrl(text: string) {
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (!match) return;

  const url = match[0];
  console.log('\n════════════════════════════════════════');
  console.log('  Dela denna länk (fungerar var som helst):');
  console.log(`  ${url}`);
  console.log('════════════════════════════════════════');
  console.log('  Länken gäller tills du stänger terminalen.\n');
}

async function main() {
  console.log(`Väntar på TrotLab på port ${PORT}...`);
  await waitForServer();
  console.log('Skapar publik tunnel (Cloudflare)...\n');

  const tunnel = spawn(
    `npx --yes cloudflared tunnel --url http://127.0.0.1:${PORT}`,
    { cwd: root, shell: true },
  );

  tunnel.stdout.on('data', (buf: Buffer) => {
    const text = buf.toString();
    process.stdout.write(text);
    watchForPublicUrl(text);
  });

  tunnel.stderr.on('data', (buf: Buffer) => {
    const text = buf.toString();
    process.stderr.write(text);
    watchForPublicUrl(text);
  });

  tunnel.on('exit', (code) => {
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
