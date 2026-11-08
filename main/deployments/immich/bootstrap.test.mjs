import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./bootstrap.mjs', import.meta.url), 'utf8')
  .replace("import { writeFileSync, rmSync } from 'node:fs';", '');

async function run({ initialized = true, isAdmin = true, loginStatus = 200, env, unavailable = false } = {}) {
  const calls = [];
  let ready = false;
  let exit;
  const context = {
    process: {
      env: env ?? { USERNAME: 'admin@example.com', PASSWORD: 'test-password' },
      exit: (code) => { exit = code; throw new Error('exit'); },
    },
    console: { log() {}, error() {} },
    rmSync: () => { ready = false; },
    writeFileSync: () => { ready = true; },
    setTimeout: (callback) => callback(),
    setInterval() {},
    AbortSignal,
    fetch: async (url, options) => {
      const path = new URL(url).pathname;
      calls.push({ path, options });
      if (unavailable) throw new Error('unavailable');
      const status = path.endsWith('/login') ? loginStatus : 200;
      return {
        ok: status === 200, status,
        json: async () => path.endsWith('/config')
          ? { isInitialized: initialized }
          : { isAdmin, accessToken: 'test-token' },
      };
    },
  };
  try { await vm.runInNewContext(`(async () => { ${source} })()`, context); }
  catch (error) { if (error.message !== 'exit') throw error; }
  return { calls, ready, exit };
}

test('new database registers from Secret, verifies admin and logs out before readiness', async () => {
  const result = await run({ initialized: false });
  assert.equal(result.ready, true);
  assert.deepEqual(result.calls.map(({ path }) => path), [
    '/api/server/config', '/api/auth/admin-sign-up', '/api/auth/login', '/api/auth/logout',
  ]);
  assert.deepEqual(JSON.parse(result.calls[1].options.body), {
    email: 'admin@example.com', password: 'test-password', name: 'Family Admin',
  });
});
test('existing database verifies without registering or resetting accounts', async () => {
  const result = await run();
  assert.equal(result.ready, true);
  assert.equal(result.calls.some(({ path }) => path.endsWith('admin-sign-up')), false);
});
for (const [name, options] of [
  ['wrong password', { loginStatus: 401 }],
  ['non-admin account', { isAdmin: false }],
  ['missing Secret values', { env: {} }],
  ['unavailable server', { unavailable: true }],
]) {
  test(`${name} never marks the Pod ready`, async () => {
    const result = await run(options);
    assert.equal(result.ready, false);
    assert.equal(result.exit, 1);
  });
}
