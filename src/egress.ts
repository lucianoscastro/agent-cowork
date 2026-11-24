import { lookup } from 'node:dns/promises';
import { createServer, request, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { read } from './config.ts';
import { log } from './sh.ts';

/**
 * Where agents reach the network: only through this proxy, and only to allowed hosts (General, DEFAULT_HOSTS). The
 * container's firewall keeps the agents' user off every other address (entrypoint.sh); the platform's own requests do
 * not pass here.
 */

/** Whether `host` matches the list. Exported for tests. */
export function allowedBy(list: string[], host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
  return list.some((e) => {
    const entry = e.toLowerCase().replace(/^\[(.*)\]$/, '$1');
    return entry === '*' || entry === h || (entry.startsWith('*.') && h.endsWith(entry.slice(1)));
  });
}

/** General's list, plus the hosts of the projects' test environments, which the Sentinel's browser opens. */
function allowedNow(): string[] {
  const environments = read('projects').items.flatMap((p) => Object.values(p.environment?.repos ?? {}).map((r) => r.baseUrl));
  return [...read('general').allowedHosts, ...environments.flatMap((url) => URL.parse(url)?.hostname ?? [])];
}

const blocked = new Map<string, { count: number; at: string }>();

/** Hosts refused lately, newest first, for the admin to allow what agents need. */
export const recentlyBlocked = () =>
  [...blocked].map(([host, b]) => ({ host, ...b })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);

function refuse(host: string): void {
  const b = blocked.get(host) ?? { count: 0, at: '' };
  blocked.delete(host);
  blocked.set(host, { count: b.count + 1, at: new Date().toISOString() });
  if (blocked.size > 200) blocked.delete(blocked.keys().next().value!);
  if (b.count === 0) log(`network: blocked ${host}: not in General → Allowed hosts`);
}

/** Link-local addresses, a cloud's metadata service among them (it hands out the machine's credentials): never reached. */
const LINK_LOCAL = /^(169\.254\.|::ffff:169\.254\.|fe[89ab][0-9a-f]:)/i;

/** The address to connect to, resolved here so the check sees what is reached. */
async function address(host: string): Promise<string> {
  const { address } = await lookup(host.replace(/^\[(.*)\]$/, '$1'));
  if (LINK_LOCAL.test(address)) throw new Error(`${host} resolves to a link-local address`);
  return address;
}

let port = 0;

/** The environment that sends an agent's requests through the proxy; empty until it listens. */
export function proxyEnv(): NodeJS.ProcessEnv {
  if (!port) return {};
  const url = `http://127.0.0.1:${port}`;
  const local = 'localhost,127.0.0.1,::1';
  return { HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url, NO_PROXY: local, no_proxy: local, NODE_USE_ENV_PROXY: '1' };
}

/** The proxy's address, for a browser told it on its command line (an environment variable is not read by every one). */
export const proxyUrl = () => (port ? `http://127.0.0.1:${port}` : undefined);

/**
 * Starts the proxy on a free loopback port: HTTPS through CONNECT, plain HTTP forwarded. `allowed` gives the list in
 * use, read on each request (a parameter for tests).
 */
export function startEgress(allowed: () => string[] = allowedNow): Promise<Server> {
  const server = createServer((req, res) => {
    const url = URL.parse(req.url ?? '');
    if (!url || url.protocol !== 'http:') return void res.writeHead(400).end('Only proxy requests for http:// addresses');
    if (!allowedBy(allowed(), url.hostname)) {
      refuse(url.hostname);
      return void res.writeHead(403, { 'content-type': 'text/plain' }).end(`agentCowork: ${url.hostname} is not an allowed host (General → Allowed hosts)`);
    }
    const headers = { ...req.headers };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    address(url.hostname).then(
      (ip) => {
        const upstream = request({ host: ip, port: url.port || 80, method: req.method, path: `${url.pathname}${url.search}`, headers }, (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        });
        upstream.on('error', () => res.destroy());
        req.pipe(upstream);
      },
      (err: Error) => res.writeHead(502, { 'content-type': 'text/plain' }).end(`agentCowork: ${err.message}`),
    );
  });
  server.on('connect', (req, client: Socket, head) => {
    client.on('error', () => {});
    const target = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(req.url ?? '');
    const targetPort = Number(target?.[2]);
    if (!target || targetPort < 1 || targetPort > 65535) return void client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    if (!allowedBy(allowed(), target[1])) {
      refuse(target[1]);
      return void client.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\nagentCowork: ${target[1]} is not an allowed host (General → Allowed hosts)`);
    }
    let upstream: Socket | undefined;
    client.on('close', () => upstream?.destroy());
    address(target[1]).then(
      (ip) => {
        if (client.destroyed) return;
        const up = connect(targetPort, ip, () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          up.write(head);
          up.pipe(client);
          client.pipe(up);
        });
        upstream = up;
        up.on('error', () => client.destroy());
      },
      (err: Error) => client.end(`HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/plain\r\n\r\nagentCowork: ${err.message}`),
    );
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      server.on('close', () => (port = 0));
      resolve(server);
    });
  });
}

/** Whether the container's firewall holds agents to the proxy, and why not (entrypoint.sh says). */
export function firewall(): { on: boolean; reason?: string } {
  const state = process.env.AGENTCOWORK_FIREWALL;
  if (state === 'on') return { on: true };
  return { on: false, reason: state?.replace(/^off:\s*/, '') || 'the container starts as node, so nothing set the firewall up' };
}
