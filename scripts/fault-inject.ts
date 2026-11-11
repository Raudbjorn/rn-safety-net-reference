/**
 * Mutation check: does the suite go red when the code is wrong?
 *
 *   tsx scripts/fault-inject.ts            # run every mutation
 *   tsx scripts/fault-inject.ts M4 M6      # run only the named ones
 *   tsx scripts/fault-inject.ts --why      # also list which tests failed, to confirm the RIGHT test caught it
 *
 * Each mutation is applied to a THROWAWAY COPY of the repo (node_modules is symlinked, nothing in the
 * working tree is touched), then the check that should catch it is run. Three outcomes:
 *   KILLED       the check failed, as it should
 *   SURVIVED     the check passed with broken code: a gap in the tests
 *   NOT-APPLIED  the pattern was not found in the file (stale mutation): reported, never counted as a pass
 * Exit code is 1 unless every selected mutation was KILLED.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const COPY_EXCLUDES = new Set(['node_modules', '.git', '.expo', 'coverage', 'reports', 'android', 'ios']);
const CHECK_TIMEOUT_MS = 180_000;

type Check = 'jest' | 'api' | 'rules';

interface Mutation {
  id: string;
  /** The requirement the mutation breaks. */
  breaks: string;
  file: string;
  find: string;
  replace: string;
  check: Check;
}

const MUTATIONS: Mutation[] = [
  {
    id: 'M1', breaks: 'REQ-DRILL-001 (persist before any network call)',
    file: 'src/sync/queue.ts',
    find: "    await this.persist(); // REQ-DRILL-001: durable before any network attempt\n",
    replace: '',
    check: 'jest',
  },
  {
    id: 'M2', breaks: 'REQ-DRILL-006 (a duplicate answer means synced)',
    file: 'src/sync/queue.ts',
    find: "        case 'stored':\n        case 'duplicate':\n",
    replace: "        case 'stored':\n",
    check: 'jest',
  },
  {
    id: 'M3', breaks: 'REQ-DRILL-003/004 (stop at the first unavailable; keep order)',
    file: 'src/sync/queue.ts',
    find: '      if (summary.stoppedUnavailable) break;\n',
    replace: '',
    check: 'jest',
  },
  {
    id: 'M4', breaks: 'REQ-DRILL-005 (idempotent create)',
    file: 'server/gateway.ts',
    find: 'const existing = store.get(record.id);',
    replace: 'const existing: DrillRecord | undefined = undefined;',
    check: 'api',
  },
  {
    id: 'M5', breaks: 'REQ-DRILL-003/006 (5xx must stay retryable, not permanent)',
    file: 'src/sync/httpTransport.ts',
    find: "        return { kind: 'unavailable' };\n      } catch {",
    replace: "        return { kind: 'rejected', reason: 'server error' };\n      } catch {",
    check: 'jest',
  },
  {
    id: 'M6', breaks: 'REQ-AUTHZ-002 (append-only)',
    file: 'firestore.rules',
    find: 'allow update, delete: if false;',
    replace: 'allow update, delete: if true;',
    check: 'rules',
  },
  {
    id: 'M7', breaks: 'REQ-AUTHZ-001 (body vessel must match path)',
    file: 'firestore.rules',
    find: '        && request.resource.data.vesselId == vesselId\n',
    replace: '',
    check: 'rules',
  },
  {
    id: 'M8', breaks: 'REQ-AUTHZ-003 (read needs active crew, not just a login)',
    file: 'firestore.rules',
    find: 'allow read: if isActiveCrew(vesselId);',
    replace: 'allow read: if signedIn();',
    check: 'rules',
  },
  {
    id: 'M9', breaks: 'REQ-DRILL-005 (same id, different content is a conflict, not a duplicate)',
    file: 'src/domain/drill.ts',
    find: '    a.type === b.type &&\n',
    replace: '',
    check: 'api',
  },
];

const COMMANDS: Record<Check, string[]> = {
  jest: ['npx', 'jest', '--silent'],
  api: ['npx', 'tsx', '--test', 'tests/api/gateway.test.ts'],
  rules: [
    'npx', 'firebase', 'emulators:exec', '--only', 'firestore', '--project', 'demo-safety-net',
    '--non-interactive', 'npx tsx --test tests/rules/drills.rules.test.ts',
  ],
};

type Outcome = 'KILLED' | 'SURVIVED' | 'NOT-APPLIED';

function makeCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fault-'));
  cpSync(ROOT, dir, { recursive: true, filter: (src) => !COPY_EXCLUDES.has(src.split('/').pop() ?? '') });
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

const FAILED_TEST_LINE = /^\s*(?:●|✖|✕)\s+(.*)$/;

/** Exit status and failing test titles. A timeout or spawn failure throws: it is not evidence either way. */
function runCheck(dir: string, check: Check): { status: number; failed: string[] } {
  const [cmd, ...args] = COMMANDS[check] as [string, ...string[]];
  const result = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS });
  if (result.error) throw result.error;
  const failed = `${result.stdout}\n${result.stderr}`
    .split('\n')
    .map((line) => FAILED_TEST_LINE.exec(line)?.[1]?.trim())
    .filter((title): title is string => Boolean(title) && /REQ-|›|\[/.test(title ?? ''));
  return { status: result.status ?? 1, failed: [...new Set(failed)] };
}

function run(m: Mutation): { outcome: Outcome; failed: string[] } {
  const dir = makeCopy();
  try {
    const target = join(dir, m.file);
    const before = readFileSync(target, 'utf8');
    if (before.split(m.find).length !== 2) return { outcome: 'NOT-APPLIED', failed: [] }; // absent, or ambiguous
    writeFileSync(target, before.replace(m.find, () => m.replace));
    const { status, failed } = runCheck(dir, m.check);
    return { outcome: status === 0 ? 'SURVIVED' : 'KILLED', failed };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Without this, a copy that cannot run the checks at all would make every mutant look KILLED. */
function baselineIsGreen(checks: Check[]): boolean {
  const dir = makeCopy();
  try {
    return checks.every((check) => {
      const { status } = runCheck(dir, check);
      console.log(`baseline ${check.padEnd(5)} ${status === 0 ? 'green' : `RED (exit ${status})`}`);
      return status === 0;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const showWhy = process.argv.includes('--why');
const wanted = new Set(process.argv.slice(2).filter((a) => !a.startsWith('--')));
const selected = MUTATIONS.filter((m) => wanted.size === 0 || wanted.has(m.id));
if (!baselineIsGreen([...new Set(selected.map((m) => m.check))])) {
  console.error('\nunmutated copy is not green: fix that first, the results below would mean nothing');
  process.exit(2);
}
let allKilled = true;
for (const m of selected) {
  const { outcome, failed } = run(m);
  if (outcome !== 'KILLED') allKilled = false;
  console.log(`${m.id.padEnd(3)} ${outcome.padEnd(12)} ${m.check.padEnd(5)} ${m.breaks}`);
  if (showWhy) for (const title of failed) console.log(`      caught by: ${title}`);
}
console.log(allKilled ? `\nall ${selected.length} mutations killed` : '\nsome mutations were NOT killed (see above)');
process.exit(allKilled ? 0 : 1);
