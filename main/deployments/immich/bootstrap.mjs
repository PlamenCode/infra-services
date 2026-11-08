import { writeFileSync, rmSync } from 'node:fs';

// Shares the server's network namespace; no public Service is needed for setup.
const base = 'http://127.0.0.1:2283/api';
const marker = '/status/ready';
rmSync(marker, { force: true });
const credentials = { email: process.env.USERNAME, password: process.env.PASSWORD };
if (!credentials.email?.includes('@') || !credentials.password) {
  console.error('immich-prod requires USERNAME (email address) and PASSWORD.');
  process.exit(1);
}

async function request(path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  // Never log API bodies: these can contain credentials or session tokens.
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}

let config;
for (let attempt = 0; attempt < 180; attempt++) {
  try {
    config = await request('/server/config');
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
try {
  if (typeof config?.isInitialized !== 'boolean') throw new Error('Server configuration unavailable');
  if (!config.isInitialized) {
    await request('/auth/admin-sign-up', { ...credentials, name: 'Family Admin' });
  }
  const session = await request('/auth/login', credentials);
  if (session.isAdmin !== true) throw new Error('Secret credentials do not identify an administrator');
  await request('/auth/logout', {}, session.accessToken);
  writeFileSync(marker, 'ready');
  console.log('Admin credentials verified; public access can become ready.');
  // Remain running so readiness gates the entire Pod, including its public Service.
  setInterval(() => {}, 60000);
} catch (error) {
  console.error(`Admin setup failed: ${error.message}. Check immich-prod; existing accounts are never overwritten.`);
  process.exit(1);
}
