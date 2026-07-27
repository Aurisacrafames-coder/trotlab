/**
 * Verifies production-facing environment variables before sharing the app.
 * Usage: npm run check:deploy
 */

const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  for (const name of ['.env.local', '.env']) {
    const envPath = path.join(__dirname, '..', name);
    if (!fs.existsSync(envPath)) continue;

    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && !process.env[key]) process.env[key] = value;
    }
  }
}

function fail(message) {
  console.error(`Deploy check failed: ${message}`);
  process.exitCode = 1;
}

loadEnvLocal();

if (!process.env.ACCESS_PASSWORD) {
  fail('ACCESS_PASSWORD is missing. Sätt ett lösenord innan appen delas publikt.');
}

const siteUrl = process.env.SITE_URL;
if (!siteUrl) {
  fail('SITE_URL is missing. Sätt den publika adressen, t.ex. https://trotlab-production.up.railway.app');
} else {
  try {
    const parsed = new URL(siteUrl);
    if (parsed.protocol !== 'https:' && !parsed.hostname.startsWith('localhost')) {
      fail('SITE_URL should use https in production.');
    }
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      fail('SITE_URL still points to localhost.');
    }
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      fail('SITE_URL should be only the origin, for example https://trotlab-production.up.railway.app.');
    }
  } catch {
    fail('SITE_URL is not a valid URL.');
  }
}

if (!process.exitCode) {
  console.log('Deploy env looks ready for shared use.');
}
