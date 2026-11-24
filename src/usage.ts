import { sql } from './db.ts';

/**
 * Token use, summed from the `usage` events every model call records. Nothing is stored
 * twice, so runs from before this page existed count too (without provider, model or cache detail).
 */
const n = (field: string) => `COALESCE(SUM(json_extract(e.data, '$.${field}')), 0)`;
const COLUMNS = `
  COUNT(*) AS calls,
  COUNT(DISTINCT e.run_id) AS runs,
  ${n('inputTokens')} AS input,
  ${n('cacheReadTokens')} + ${n('cacheWriteTokens')} AS cache,
  ${n('outputTokens')} AS output`;

const TOKENS = `${n('inputTokens')} + ${n('cacheReadTokens')} + ${n('cacheWriteTokens')} + ${n('outputTokens')}`;

export type UsageRow = { calls: number; runs: number; input: number; cache: number; output: number };

const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function rows<T>(group: string, select: string, days: number): (T & UsageRow)[] {
  return sql()
    .prepare(`SELECT ${select}, ${COLUMNS} FROM run_events e JOIN runs r ON r.id = e.run_id WHERE e.kind = 'usage' AND e.at >= ? GROUP BY ${group} ORDER BY input + cache + output DESC`)
    .all(since(days)) as (T & UsageRow)[];
}

function total(days: number): UsageRow {
  return sql().prepare(`SELECT ${COLUMNS} FROM run_events e WHERE e.kind = 'usage' AND e.at >= ?`).get(since(days)) as UsageRow;
}

export function usageSummary() {
  return {
    totals: { today: total(1), week: total(7), month: total(30) },
    byAgent: rows<{ agent: string }>('r.agent', 'r.agent AS agent', 30),
    byModel: rows<{ provider: string; model: string }>(
      'provider, model',
      `COALESCE(json_extract(e.data, '$.provider'), 'unknown') AS provider, COALESCE(json_extract(e.data, '$.model'), 'unknown') AS model`,
      30,
    ),
    byDay: sql()
      .prepare(`SELECT substr(e.at, 1, 10) AS day, ${COLUMNS} FROM run_events e WHERE e.kind = 'usage' AND e.at >= ? GROUP BY day ORDER BY day DESC`)
      .all(since(14)) as ({ day: string } & UsageRow)[],
    outcomes: outcomesByModel(),
  };
}

export type ModelOutcome = { provider: string; model: string; cards: number; merged: number; closed: number; tokens: number; tokensPerMerged: number | null };

/**
 * What each model's card work came to, over every live Developer run (a card's run item is its key, PR follow-ups
 * included). A card counts for every model that spent tokens on it: merged when any of its PRs merged, closed when all
 * closed without a merge (as the follow-up left the item done), open otherwise. tokensPerMerged is all the model's
 * tokens on cards over its merged ones, so closed and open cards are part of the price.
 */
export function outcomesByModel(): ModelOutcome[] {
  return sql()
    .prepare(
      `WITH cards AS (
         SELECT COALESCE(json_extract(e.data, '$.provider'), 'unknown') AS provider, COALESCE(json_extract(e.data, '$.model'), 'unknown') AS model,
           r.item AS card, ${TOKENS} AS tokens
         FROM run_events e JOIN runs r ON r.id = e.run_id
         WHERE e.kind = 'usage' AND r.agent = 'developer' AND r.dry_run = 0 GROUP BY provider, model, card
       ), ends AS (
         SELECT c.*, json_type(i.data, '$.closed') IS 'array' AS ended,
           EXISTS (SELECT 1 FROM json_each(i.data, '$.closed') WHERE value LIKE '%: merged') AS merged
         FROM cards c LEFT JOIN items i ON i.key = 'developer:' || c.card AND i.status = 'done'
       )
       SELECT provider, model, COUNT(*) AS cards, SUM(merged) AS merged, SUM(ended AND NOT merged) AS closed, SUM(tokens) AS tokens,
         ROUND(SUM(tokens) * 1.0 / NULLIF(SUM(merged), 0)) AS tokensPerMerged
       FROM ends GROUP BY provider, model ORDER BY tokens DESC`,
    )
    .all() as ModelOutcome[];
}

/** Per-run totals for the runs list, keyed by run id. */
export function runsUsage(ids: number[]): Map<number, number> {
  if (!ids.length) return new Map();
  const found = sql()
    .prepare(
      `SELECT e.run_id AS id, ${TOKENS} AS tokens
       FROM run_events e WHERE e.kind = 'usage' AND e.run_id IN (${ids.map(() => '?').join(',')}) GROUP BY e.run_id`,
    )
    .all(...ids) as { id: number; tokens: number }[];
  return new Map(found.map((r) => [r.id, r.tokens]));
}

export type ModelUse = { provider: string | null; model: string | null; tokens: number; ms: number | null };

/** One run's use per model, in the order first called; ms is null when no call recorded its time (calls before it was). */
export function runModels(id: number): ModelUse[] {
  return sql()
    .prepare(
      `SELECT json_extract(e.data, '$.provider') AS provider, json_extract(e.data, '$.model') AS model, ${TOKENS} AS tokens,
       SUM(json_extract(e.data, '$.durationMs')) AS ms
       FROM run_events e WHERE e.kind = 'usage' AND e.run_id = ? GROUP BY provider, model ORDER BY MIN(e.id)`,
    )
    .all(id) as ModelUse[];
}
