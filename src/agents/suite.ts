import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Project } from '../config.ts';
import { gh, ghJson } from '../integrations/github.ts';
import { forEachLimit } from '../sh.ts';

/**
 * End-to-end suites the Sentinel can run: found in a repository by its own files, run with the
 * repository's package manager, and reported in a format the platform picks (never the project's own
 * reporter setup), so nothing depends on how one company wired its suite.
 */
export type Framework = 'playwright' | 'cucumber' | 'cypress';
export type ReportFormat = 'playwright-json' | 'cucumber-json' | 'junit';

export type SuiteSetup = {
  framework: Framework;
  /** Folder inside the repository holding the suite's package.json; '' for the root. */
  workdir: string;
  setupCommands: string[];
  runCommand: string;
  /** Arguments that run one test; {file} and {line} come from the report, {title} is its name. */
  isolateArgs: string;
  reportFormat: ReportFormat;
  /** Appended to every run; {report} is the platform's report path. */
  reportArgs: string;
  /** Variables pointed at the platform's report path, for reporters configured by environment. */
  reportEnv: string[];
  /** Variables the suite reads its target URL from; all are set to the environment's base URL. */
  urlVars: string[];
  /** Variables the suite reads credentials from: to be stored as the environment's secrets. */
  secretVars: string[];
};

export type Detection = { repo: string; found?: SuiteSetup; notes: string[] };

type Files = { tree: string[]; read: (path: string) => string | undefined };

const URLISH = /^[A-Z][A-Z0-9_]*(URL|HOST|ORIGIN|DOMAIN)[A-Z0-9_]*$/;
const SECRETISH = /(USER|USERS|LOGIN|EMAIL|PASS|PASSWORD|PWD|TOKEN|SECRET|CREDENTIAL|API_KEY|APIKEY)/;
const ENV_REF = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])|Cypress\.env\(['"]([A-Za-z][\w]*)['"]\)/g;

/** Environment variable names a suite's own code reads. Exported for tests. */
export function envRefs(sources: string[]): string[] {
  const names = new Set<string>();
  for (const s of sources) {
    for (const m of s.matchAll(ENV_REF)) names.add(m[1] ?? m[2] ?? (m[3] ? `CYPRESS_${m[3]}` : ''));
    // const { A, B = 'x', C: c } = process.env
    for (const m of s.matchAll(/\{([^{}]*)\}\s*=\s*process\.env\b/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/[\s:=]/)[0];
        if (/^[A-Z][A-Z0-9_]*$/.test(name)) names.add(name);
      }
    }
  }
  names.delete('');
  return [...names].sort();
}

const pm = (tree: string[], dir: string) => {
  const at = (f: string) => tree.includes(dir ? `${dir}/${f}` : f);
  return at('pnpm-lock.yaml') ? 'pnpm' : at('package-lock.json') ? 'npm' : at('yarn.lock') ? 'yarn' : undefined;
};

/** Finds the end-to-end suite in a repository's files. Pure: tested without the network. */
export function detectSuite(files: Files): { found?: SuiteSetup; notes: string[] } {
  const { tree, read } = files;
  const notes: string[] = [];
  const shallow = (re: RegExp) => tree.filter((p) => re.test(p) && p.split('/').length <= 3);
  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  // Only the files that were fetched (the end-to-end folders): unit tests elsewhere never count.
  const sourcesUnder = (dir: string, re: RegExp) =>
    tree.filter((p) => (!dir || p.startsWith(`${dir}/`)) && re.test(p) && !p.includes('node_modules/')).flatMap((p) => read(p) ?? []);

  const dotnet = tree.filter((p) => p.endsWith('.csproj')).filter((p) => /Microsoft\.Playwright|Reqnroll|SpecFlow/.test(read(p) ?? ''));
  if (dotnet.length) notes.push(`.NET end-to-end projects found (${dotnet.join(', ')}): not supported yet (installing Playwright for .NET browsers needs PowerShell).`);

  const candidates: { framework: Framework; dir: string }[] = [];
  for (const p of shallow(/(^|\/)playwright\.config\.(ts|js|mjs|cjs)$/)) candidates.push({ framework: 'playwright', dir: dirOf(p) });
  for (const p of shallow(/(^|\/)cypress\.config\.(ts|js|mjs|cjs)$/)) candidates.push({ framework: 'cypress', dir: dirOf(p) });
  for (const p of shallow(/(^|\/)package\.json$/)) {
    const pkg = read(p) ?? '';
    if (/"@cucumber\/cucumber"\s*:/.test(pkg) && tree.some((f) => f.endsWith('.feature'))) candidates.push({ framework: 'cucumber', dir: dirOf(p) });
  }
  // Cucumber wraps Playwright when both are there: run Cucumber, which owns the scenarios.
  const pick = candidates.find((c) => c.framework === 'cucumber') ?? candidates.find((c) => c.framework === 'playwright') ?? candidates[0];
  if (!pick) {
    notes.push('No end-to-end suite found (no Playwright, Cucumber or Cypress setup).');
    return { notes };
  }
  const manager = pm(tree, pick.dir);
  if (manager !== 'pnpm') {
    notes.push(`The suite in ${pick.dir || 'the repository root'} uses ${manager ?? 'no lockfile'}; the image runs pnpm only, so the suite may not install.`);
  }
  const install = manager === 'pnpm' || !manager ? 'pnpm install --frozen-lockfile' : `pnpm import && pnpm install`;
  const code = sourcesUnder(pick.dir, /\.(ts|js|mjs|cjs)$/).filter((s) => /process\.env|Cypress\.env/.test(s));
  const refs = envRefs(code);
  // The base URL goes to the variables that name a base; other URLs (an API, a CDN) keep their own values.
  const allUrls = refs.filter((n) => URLISH.test(n));
  const urlVars = allUrls.some((n) => /BASE/.test(n)) ? allUrls.filter((n) => /BASE/.test(n)) : allUrls;
  const otherUrls = allUrls.filter((n) => !urlVars.includes(n));
  if (otherUrls.length) notes.push(`The suite also reads ${otherUrls.join(', ')}: not set to the URL; add them to the test variables if the environment needs them.`);
  const secretVars = refs.filter((n) => SECRETISH.test(n) && !URLISH.test(n));

  const base = { workdir: pick.dir, secretVars };
  let found: SuiteSetup;
  if (pick.framework === 'playwright') {
    found = {
      ...base,
      framework: 'playwright',
      setupCommands: [install, 'pnpm exec playwright install chromium'],
      runCommand: 'pnpm exec playwright test',
      isolateArgs: '{file}:{line}',
      reportFormat: 'playwright-json',
      reportArgs: '--reporter=json',
      reportEnv: ['PLAYWRIGHT_JSON_OUTPUT_NAME'],
      urlVars: urlVars.length ? urlVars : ['BASE_URL', 'PLAYWRIGHT_BASE_URL'],
    };
  } else if (pick.framework === 'cucumber') {
    found = {
      ...base,
      framework: 'cucumber',
      setupCommands: tree.some((f) => f.endsWith('package.json') && /"(@playwright\/test|playwright)"\s*:/.test(read(f) ?? '')) ? [install, 'pnpm exec playwright install chromium'] : [install],
      runCommand: 'pnpm exec cucumber-js',
      isolateArgs: '{file}:{line}',
      reportFormat: 'cucumber-json',
      reportArgs: '--format json:{report}',
      reportEnv: [],
      urlVars: urlVars.length ? urlVars : ['BASE_URL'],
    };
  } else {
    found = {
      ...base,
      framework: 'cypress',
      setupCommands: [install, 'pnpm exec cypress install'],
      runCommand: 'pnpm exec cypress run',
      isolateArgs: '--spec {file}',
      reportFormat: 'junit',
      reportArgs: '--reporter junit --reporter-options mochaFile={report},toConsole=false',
      reportEnv: [],
      urlVars: [...new Set(['CYPRESS_BASE_URL', ...urlVars])],
    };
  }
  if (!urlVars.length) notes.push('The suite does not read its URL from an environment variable the scan could find; check the URL variables.');
  if (candidates.length > 1) notes.push(`Several setups found (${candidates.map((c) => `${c.framework} in ${c.dir || 'root'}`).join(', ')}); using ${pick.framework}.`);
  return { found, notes };
}

/** Reads a repository's tree and the files detection needs, through the GitHub API. */
export async function detectInRepo(repo: string, branch: string): Promise<Detection> {
  const { tree } = await ghJson<{ tree: { path: string; type: string }[] }>(['api', `repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`]);
  const paths = tree.filter((t) => t.type === 'blob').map((t) => t.path);
  const manifests = paths.filter((p) => !p.includes('node_modules/') && (/(^|\/)(package\.json|playwright\.config\.\w+|cypress\.config\.\w+)$/.test(p) || p.endsWith('.csproj')));
  // Suite code lives in end-to-end folders; a large app's unit tests must not crowd it out.
  const suiteCode = paths
    .filter((p) => !p.includes('node_modules/') && /\.(ts|js|mjs|cjs)$/.test(p) && /(^|\/)(e2e|cypress|playwright|step[_-]?definitions|steps|support|features|world|fixtures)(\/|$)/i.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length);
  const wanted = [...manifests.slice(0, 20), ...suiteCode.slice(0, 60)];
  const contents = new Map<string, string>();
  // A few requests at a time: fast enough for the page, gentle on the API rate limit.
  await forEachLimit(wanted, 8, async (p) => {
    const body = await gh(['api', `repos/${repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`, '-H', 'Accept: application/vnd.github.raw']).catch(() => undefined);
    if (body !== undefined) contents.set(p, body);
  });
  return { repo, ...detectSuite({ tree: paths, read: (p) => contents.get(p) }) };
}

export type ResolvedSuite = SuiteSetup & { repo: string; branch: string };

/**
 * The suite a repository runs now, detected on its branch (the given one, else the project's base branch,
 * else the repository's default). Used by every run and by the page that shows it, so both always agree.
 */
/** The branch a repository is tested on: the one given, else the project's base branch, else the repository's default. */
export const branchOf = async (project: Project, repo: string, branch?: string): Promise<string> =>
  branch || project.baseBranch || (await gh(['repo', 'view', repo, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name']));

export async function resolveSuite(project: Project, repo: string, branch?: string): Promise<{ suite?: ResolvedSuite; branch?: string; notes: string[] }> {
  try {
    const ref = await branchOf(project, repo, branch);
    const found = await detectInRepo(repo, ref);
    return { suite: found.found && { ...found.found, repo, branch: ref }, branch: ref, notes: found.notes };
  } catch (err) {
    return { notes: [`Could not read the repository: ${(err as Error).message.slice(0, 200)}`] };
  }
}

// --- reports: one shape for every format ---

export type TestResult = {
  /** Stable identity across runs: file and title. */
  id: string;
  title: string;
  file: string;
  line: number;
  status: 'passed' | 'failed' | 'other';
  failedStep?: string;
  error?: string;
  screenshots: { type: string; data: string }[];
};

/** A short, label-safe fingerprint of a test, for Jira deduplication. */
export const testLabel = (id: string) => `sentinel-${createHash('sha1').update(id).digest('hex').slice(0, 10)}`;

type CucumberStep = { keyword?: string; name?: string; result?: { status?: string; error_message?: string }; embeddings?: { data: string; mime_type?: string; media?: { type?: string } }[] };
type CucumberElement = { type?: string; name?: string; line?: number; steps?: CucumberStep[] };

export function parseCucumberJson(report: unknown): TestResult[] {
  const out: TestResult[] = [];
  for (const feature of (Array.isArray(report) ? report : []) as { uri?: string; elements?: CucumberElement[] }[]) {
    let background: CucumberStep[] = [];
    for (const el of feature.elements ?? []) {
      if (el.type === 'background') {
        background = el.steps ?? [];
        continue;
      }
      const steps = [...background, ...(el.steps ?? [])];
      background = [];
      const failed = steps.find((s) => s.result?.status === 'failed');
      const statuses = steps.map((s) => s.result?.status);
      const file = feature.uri ?? '';
      out.push({
        id: `${file} › ${el.name ?? ''}`,
        title: el.name ?? '',
        file,
        line: el.line ?? 0,
        status: failed ? 'failed' : statuses.length && statuses.every((s) => s === 'passed') ? 'passed' : 'other',
        failedStep: failed ? `${(failed.keyword ?? '').trim()} ${failed.name ?? ''}`.trim() : undefined,
        error: failed?.result?.error_message?.slice(0, 4000),
        screenshots: steps
          .flatMap((s) => s.embeddings ?? [])
          .filter((e) => (e.mime_type ?? e.media?.type ?? '').startsWith('image/'))
          .map((e) => ({ type: e.mime_type ?? e.media?.type ?? 'image/png', data: e.data })),
      });
    }
  }
  return out;
}

type PwAttachment = { name?: string; contentType?: string; path?: string; body?: string };
type PwSpec = { title: string; file: string; line: number; tests: { status?: string; results?: { status?: string; error?: { message?: string }; attachments?: PwAttachment[] }[] }[] };
type PwSuite = { title?: string; file?: string; specs?: PwSpec[]; suites?: PwSuite[] };

export function parsePlaywrightJson(report: unknown, readFile: (path: string) => Buffer | undefined = (p) => {
  try {
    return readFileSync(p);
  } catch {
    return undefined;
  }
}): TestResult[] {
  const out: TestResult[] = [];
  const walk = (suite: PwSuite, path: string[]) => {
    const here = suite.title && !suite.title.endsWith('.ts') && !suite.title.endsWith('.js') ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) {
      const tests = spec.tests ?? [];
      const results = tests.flatMap((t) => t.results ?? []);
      const lastFailed = [...results].reverse().find((r) => r.status === 'failed' || r.status === 'timedOut');
      const failed = tests.some((t) => t.status === 'unexpected');
      const passed = tests.length > 0 && tests.every((t) => t.status === 'expected' || t.status === 'flaky');
      const title = [...here, spec.title].join(' › ');
      out.push({
        id: `${spec.file} › ${title}`,
        title,
        file: spec.file,
        line: spec.line,
        status: failed ? 'failed' : passed ? 'passed' : 'other',
        error: lastFailed?.error?.message?.slice(0, 4000),
        screenshots: (lastFailed?.attachments ?? [])
          .filter((a) => (a.contentType ?? '').startsWith('image/'))
          .flatMap((a) => {
            const data = a.body ?? (a.path ? readFile(a.path)?.toString('base64') : undefined);
            return data ? [{ type: a.contentType!, data }] : [];
          }),
      });
    }
    for (const inner of suite.suites ?? []) walk(inner, here);
  };
  for (const suite of ((report as { suites?: PwSuite[] })?.suites ?? [])) walk(suite, []);
  return out;
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** JUnit XML (Cypress, and most runners): one result per testcase; the file comes from the testcase or its suite. */
export function parseJunit(xml: string): TestResult[] {
  const out: TestResult[] = [];
  for (const suite of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g)) {
    const suiteFile = attr(suite[1], 'file') ?? '';
    for (const tc of suite[2].matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const body = tc[3] ?? '';
      const failure = body.match(/<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/);
      const skipped = /<skipped\b/.test(body);
      const title = decode(attr(tc[1], 'name') ?? '');
      const file = attr(tc[1], 'file') ?? suiteFile;
      out.push({
        id: `${file} › ${decode(attr(tc[1], 'classname') ?? '')} › ${title}`,
        title,
        file,
        line: 0,
        status: failure ? 'failed' : skipped ? 'other' : 'passed',
        error: failure ? decode((attr(failure[2] ?? failure[5] ?? '', 'message') ?? '') + '\n' + (failure[3] ?? '')).trim().slice(0, 4000) : undefined,
        screenshots: [],
      });
    }
  }
  return out;
}

export function parseReport(format: ReportFormat, text: string): TestResult[] {
  if (format === 'junit') return parseJunit(text);
  const json = JSON.parse(text);
  return format === 'playwright-json' ? parsePlaywrightJson(json) : parseCucumberJson(json);
}

/** The arguments that run one test again, from its report entry. */
export const isolate = (template: string, t: TestResult) =>
  template.replace('{file}', t.file).replace('{line}', String(t.line)).replace('{title}', t.title.replace(/["$`\\]/g, '\\$&'));
