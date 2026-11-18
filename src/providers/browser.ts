/** The Playwright MCP the image ships, and its Chromium: the browser tools of a Claude call. */
const MCP_CLI = '/usr/local/lib/playwright-mcp/cli.js';
const BROWSER = '/usr/bin/chromium';

/**
 * The MCP config of headless, isolated browser tools, plus `args`. The server starts inside `outDir`, so the
 * screenshots the model names land there, never in a checkout (where the read-only guard would drop them).
 */
export function playwrightConfig(outDir: string, args: string[]): string {
  const all = [MCP_CLI, '--headless', '--isolated', '--no-sandbox', '--executable-path', BROWSER, '--ignore-roots', '--output-dir', outDir, ...args];
  const quote = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;
  return JSON.stringify({ mcpServers: { playwright: { command: 'sh', args: ['-c', `cd ${quote(outDir)} && exec node ${all.map(quote).join(' ')}`] } } });
}
