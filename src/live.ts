import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** One terminal line of a run: what the agent says, a tool or command it runs, its output, or an error. */
export type LiveLine = { kind: 'say' | 'tool' | 'out' | 'err' | 'info'; text: string };

const OUT_LINES = 12;
const OUT_CHARS = 1500;

/** Keeps the start of long output, like a terminal that was scrolled past. */
function clip(text: string): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  const head = lines.slice(0, OUT_LINES).join('\n').slice(0, OUT_CHARS);
  const hidden = lines.length - OUT_LINES;
  return hidden > 0 ? `${head}\n… ${hidden} more lines` : head;
}

/** A tool call in one line: the command, the file, or the pattern; never the whole input. */
function describeTool(name: string, input: Record<string, unknown> = {}): string {
  const first = ['command', 'file_path', 'path', 'pattern', 'url', 'description', 'skill', 'query', 'prompt'].find((k) => typeof input[k] === 'string');
  const detail = first ? String(input[first]) : JSON.stringify(input);
  return `${name} ${detail.split('\n')[0].slice(0, 300)}`;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const toolResultText = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: Json) => c.text ?? '').join('\n') : '';

/**
 * Turns one transcript line from any runtime into terminal lines. Exported for tests.
 * Claude: stream-json messages. Codex: `exec --json` items. agy: one final JSON envelope.
 */
export function parseTranscriptLine(raw: string): LiveLine[] {
  let e: Json;
  try {
    e = JSON.parse(raw);
  } catch {
    return raw.trim() ? [{ kind: 'out', text: clip(raw) }] : [];
  }
  // The platform's own verify commands (agents/verify.ts)
  if (e.type === 'verify.start') return [{ kind: 'tool', text: `$ ${e.role}: ${e.command}` }];
  if (e.type === 'verify.out') return String(e.text).trim() ? [{ kind: 'out', text: String(e.text).replace(/\s+$/, '') }] : [];
  if (e.type === 'verify.end') return [{ kind: e.code === 0 ? 'info' : 'err', text: e.code === 0 ? 'passed' : `exit ${e.code}${e.timedOut ? ' (timed out)' : ''}` }];
  // Claude Code
  if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
    return e.message.content.flatMap((c: Json): LiveLine[] => {
      if (c.type === 'text' && c.text?.trim()) return [{ kind: 'say', text: c.text.trim() }];
      if (c.type === 'tool_use') return [{ kind: 'tool', text: describeTool(c.name, c.input) }];
      return [];
    });
  }
  if (e.type === 'user' && Array.isArray(e.message?.content)) {
    return e.message.content
      .filter((c: Json) => c.type === 'tool_result')
      .map((c: Json): LiveLine => ({ kind: c.is_error ? 'err' : 'out', text: clip(toolResultText(c.content)) || '(no output)' }));
  }
  if (e.type === 'result') return [{ kind: e.is_error ? 'err' : 'info', text: e.is_error ? `failed: ${String(e.result ?? e.subtype)}` : 'finished' }];
  // Codex
  const item = e.item as Json | undefined;
  if (e.type === 'item.started' && item?.type === 'command_execution') return [{ kind: 'tool', text: `$ ${item.command}` }];
  if (e.type === 'item.completed' && item) {
    if (item.type === 'agent_message' && item.text?.trim()) return [{ kind: 'say', text: item.text.trim() }];
    if (item.type === 'command_execution') {
      const out = clip(String(item.aggregated_output ?? ''));
      return [{ kind: item.exit_code ? 'err' : 'out', text: `${out || '(no output)'}${item.exit_code ? `\nexit ${item.exit_code}` : ''}` }];
    }
    if (item.type === 'file_change') return [{ kind: 'tool', text: `edit ${(item.changes ?? []).map((c: Json) => c.path).join(', ')}` }];
    if (item.type === 'mcp_tool_call') return [{ kind: 'tool', text: `${item.server}.${item.tool}` }];
  }
  if (e.type === 'turn.failed' || e.type === 'error') return [{ kind: 'err', text: String(e.error?.message ?? e.message ?? 'error') }];
  if (e.type === 'turn.completed') return [{ kind: 'info', text: 'finished' }];
  // agy: a single envelope when the call ends
  if (typeof e.status === 'string' && 'response' in e) {
    return [
      ...(String(e.response).trim() ? [{ kind: 'say' as const, text: String(e.response).trim() }] : []),
      { kind: e.status === 'SUCCESS' ? 'info' : 'err', text: e.status === 'SUCCESS' ? 'finished' : `failed: ${e.error ?? e.status}` },
    ];
  }
  return [];
}

// Parsed lines per transcript, extended with only the bytes appended since the last read.
const cache = new Map<string, { offset: number; rest: string; lines: LiveLine[] }>();

async function readTranscript(path: string): Promise<LiveLine[]> {
  const { size } = await stat(path);
  const entry = cache.get(path) ?? { offset: 0, rest: '', lines: [] };
  if (size > entry.offset) {
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(size - entry.offset);
      await fh.read(buf, 0, buf.length, entry.offset);
      const chunks = (entry.rest + buf.toString('utf8')).split('\n');
      entry.rest = chunks.pop() ?? '';
      for (const line of chunks) {
        for (const l of parseTranscriptLine(line)) {
          // Runtimes repeat their end marker (one per subagent and one for the call): show it once.
          const last = entry.lines.at(-1);
          if (l.kind === 'info' && last?.kind === 'info' && last.text === l.text) continue;
          entry.lines.push(l);
        }
      }
      entry.offset = size;
    } finally {
      await fh.close();
    }
  }
  cache.set(path, entry);
  return entry.lines;
}

/**
 * A run's terminal: every transcript in the order its calls ran (calls run one after another, so the
 * last modified is the latest), each under a header with its
 * label, from line `after` on. Polled by the UI while the run is going.
 */
export async function liveOutput(dir: string, after: number): Promise<{ lines: LiveLine[]; next: number }> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const transcripts = await Promise.all(
    files.filter((f) => f.endsWith('.jsonl')).map(async (f) => ({ f, born: (await stat(join(dir, f))).mtimeMs })),
  );
  const all: LiveLine[] = [];
  for (const { f } of transcripts.sort((a, b) => a.born - b.born)) {
    all.push({ kind: 'info', text: `── ${f.replace(/\.jsonl$/, '')} ──` }, ...(await readTranscript(join(dir, f))));
  }
  // ponytail: the cache keeps every transcript ever opened; a restart clears it, which is fine at this scale.
  return { lines: all.slice(after), next: all.length };
}
