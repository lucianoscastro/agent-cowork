import { expect, test as setup } from '@playwright/test';
import { ADMIN, STATE } from './admin.ts';

// One API login shared by every test: the server allows only 10 login attempts a minute per IP.
setup('log in', async ({ request }) => {
  const res = await request.post('/api/login', { headers: { 'x-agentcowork': '1' }, data: ADMIN });
  expect(res.ok()).toBe(true);
  await request.storageState({ path: STATE });
});
