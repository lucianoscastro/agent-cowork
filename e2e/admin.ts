import { join } from 'node:path';

/** The test server's bootstrap settings and the saved login, shared by the config, server wrapper and specs. */
export const PORT = 8099;
export const ADMIN = { username: 'admin', password: 'e2e-password' };
export const STATE = join(import.meta.dirname, '.auth', 'state.json');
