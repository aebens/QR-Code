import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';

const workflowOnly = path => ['AGENTS.md', 'CLAUDE.md', 'docs/agent-review-protocol.md'].includes(path)
  || ['.agent-workflows/', '.agents/skills/', '.claude/commands/', 'docs/agent-workflows/'].some(prefix => path.startsWith(prefix));
export function classifyPaths(paths, { eventName = 'pull_request', draft = false } = {}) {
  const ready = eventName !== 'pull_request' || draft !== true;
  const uiRequired = eventName !== 'pull_request' || paths.length === 0 || paths.some(path => !workflowOnly(path));
  return { ready, uiRequired, reason: !ready ? 'Draft PR: inexpensive checks only; merge gates remain blocked.' : uiRequired ? 'Application, integration, unknown, or post-merge state requires full checks.' : 'Only audited agent workflow files changed; browser checks do not consume these files.' };
}
export function readChangedPaths(base, head, cwd = process.cwd()) {
  if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) throw new Error('CI comparison requires full commit SHAs.');
  // No rename detection: a rename becomes a deletion and addition, preserving both sides.
  return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`], { cwd, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
}
export function runCiScope() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const eventName = process.env.GITHUB_EVENT_NAME;
  const head = event.pull_request?.head.sha || process.env.GITHUB_SHA;
  const base = event.pull_request?.base.sha || event.before;
  const paths = eventName === 'pull_request' ? readChangedPaths(base, head) : [];
  const result = classifyPaths(paths, { eventName, draft: event.pull_request?.draft });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ready=${result.ready}\nui_required=${result.uiRequired}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.reason}\n`);
  console.log(JSON.stringify(result));
  return result;
}
