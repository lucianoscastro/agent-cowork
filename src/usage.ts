import { sql } from './db.ts';

/**
 * Token use and estimated cost, summed from the `usage` events every model call records. Nothing is stored
 * twice, so runs from before this page existed count too (without provider, model or cache detail).
 */
const n = (field: string) => `COALESCE(SUM(json_extract(e.data, '$.${field}')), 0)`;
const COLUMNS = `
  COUNT(*) AS calls,
  COUNT(DISTINCT e.run_id) AS runs,
  ${n('inputTokens')} AS input,
  ${n('cacheReadTokens')} + ${n('cacheWriteTokens')} AS cache,
  ${n('outputTokens')} AS output,
  ${n('costUsd')} AS cost`;

export type UsageRow = { calls: number; runs: number; input: number; cache: number; output: number; cost: number };

const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function rows<T>(group: string, select: string, days: number): (T & UsageRow)[] {
  return sql()
    .prepare(`SELECT ${select}, ${COLUMNS} FROM run_events e JOIN runs r ON r.id = e.run_id WHERE e.kind = 'usage' AND e.at >= ? GROUP BY ${group} ORDER BY cost DESC, input DESC`)
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
  };
}

/** Per-run totals for the runs list, keyed by run id. */
export function runsUsage(ids: number[]): Map<number, { tokens: number; cost: number }> {
  if (!ids.length) return new Map();
  const found = sql()
    .prepare(
      `SELECT e.run_id AS id, ${n('inputTokens')} + ${n('cacheReadTokens')} + ${n('cacheWriteTokens')} + ${n('outputTokens')} AS tokens, ${n('costUsd')} AS cost
       FROM run_events e WHERE e.kind = 'usage' AND e.run_id IN (${ids.map(() => '?').join(',')}) GROUP BY e.run_id`,
    )
    .all(...ids) as { id: number; tokens: number; cost: number }[];
  return new Map(found.map((r) => [r.id, { tokens: r.tokens, cost: r.cost }]));
}
