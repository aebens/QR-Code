import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readProfile } from './profile.mjs';

const SHA = /^[a-f0-9]{40}$/;
const REPO = /^aebens\/[A-Za-z0-9_.-]+$/;
const AGENTS = new Set(['codex', 'claude']);
const text = value => typeof value === 'string' && value.length > 0 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const session = value => value && AGENTS.has(value.agent) && text(value.sessionId);
function requireThat(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: 'REVIEW_GATE_BLOCKED' });
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function reviewContext(cwd, policyRevision) {
  requireThat(SHA.test(policyRevision ?? ''), 'Supply the explicit session-approved --policy-revision as a full commit SHA.');
  const state = readProfile(cwd);
  if (state.adopted) return { root: state.root, repository: state.profile.repository, policyRevision,
    installedPolicyRevision: state.profile.policyRevision };
  const remote = execFileSync('git', ['-C', state.root, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true }).trim();
  requireThat(['https://github.com/aebens/agent-workflows.git', 'https://github.com/aebens/agent-workflows', 'git@github.com:aebens/agent-workflows.git'].includes(remote), 'Repository has not adopted the shared workflow.');
  execFileSync('git', ['-C', state.root, 'cat-file', '-e', `${policyRevision}^{commit}`], { windowsHide: true, stdio: 'pipe' });
  return { root: state.root, repository: 'aebens/agent-workflows', policyRevision, installedPolicyRevision: null };
}

// The reviewer posts this marker with its own findings. The URL is assigned
// after posting, so it is excluded from the digest. This binds declared evidence,
// not a cryptographic identity for the model operating the shared GitHub account.
export function reviewDigest(record) {
  const input = structuredClone(record);
  if (input.evidence) delete input.evidence.reviewUrl;
  return createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
}

export function assertReviewRecord(record, current) {
  requireThat(record?.schemaVersion === 1 && current && REPO.test(current.repository ?? '')
    && Number.isSafeInteger(current.number) && current.number > 0
    && SHA.test(current.headSha ?? '') && SHA.test(current.baseSha ?? '')
    && SHA.test(current.policyRevision ?? ''), 'Missing valid review record or current PR identity.');
  for (const field of ['repository', 'number', 'headSha', 'baseSha', 'policyRevision']) {
    requireThat(record[field] === current[field], `Review does not match current ${field}.`);
  }
  requireThat(session(record.branchOwner) && session(record.coordinator) && session(record.reviewer), 'Identify the owner, coordinator, and primary reviewer sessions.');
  requireThat(record.reviewer.sessionType === 'primary', 'Supporting subagents cannot be the reviewer of record.');
  requireThat(record.reviewer.agent !== record.branchOwner.agent, 'Codex-owned work requires Claude review; Claude-owned work requires Codex review.');
  requireThat(record.reviewer.sessionId !== record.coordinator.sessionId, 'The reviewer must be a separate session from the coordinator.');
  requireThat(Array.isArray(record.contributors) && record.contributors.length > 0 && record.contributors.every(session)
    && record.contributors.some(author => author.sessionId === record.branchOwner.sessionId && author.agent === record.branchOwner.agent), 'Declare contributing sessions, including the branch owner.');
  requireThat(!record.contributors.some(author => author.sessionId === record.reviewer.sessionId)
    && record.reviewer.authoredImplementation === false, 'An implementation author cannot approve its own work.');
  requireThat(record.recommendation === 'merge', 'The reviewer has not recommended merge.');
  requireThat(['orca', 'manual-relay'].includes(record.evidence?.kind) && text(record.evidence.reference), 'Record the actual Orca dispatch or Ashley manual relay reference.');
  const prefix = `https://github.com/${record.repository}/pull/${record.number}#`;
  requireThat(typeof record.evidence.reviewUrl === 'string' && record.evidence.reviewUrl.startsWith(prefix), 'Link the reviewer confirmation on this PR.');
  const anchor = record.evidence.reviewUrl.slice(prefix.length);
  const match = /^(pullrequestreview|issuecomment)-([1-9][0-9]*)$/.exec(anchor);
  requireThat(match, 'Use the exact GitHub review or issue-comment permalink.');
  return { kind: match[1], id: match[2], digest: reviewDigest(record) };
}

function github(args, cwd) {
  try {
    return JSON.parse(execFileSync('gh', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch {
    throw Object.assign(new Error('Cannot verify current GitHub review evidence.'), { code: 'REVIEW_GATE_BLOCKED' });
  }
}

export function checkPublishedReview({ record, repository, policyRevision, cwd, readGithub = args => github(args, cwd) }) {
  requireThat(REPO.test(repository ?? '') && record?.repository === repository
    && Number.isSafeInteger(record.number) && record.number > 0 && SHA.test(policyRevision ?? ''), 'Review target or policy is invalid.');
  const pr = readGithub(['pr', 'view', String(record.number), '--repo', repository, '--json', 'url,number,state,isDraft,headRefOid,baseRefOid']);
  requireThat(pr.url === `https://github.com/${repository}/pull/${record.number}` && pr.number === record.number
    && pr.state === 'OPEN' && pr.isDraft === false, 'The target PR must be open and ready for review.');
  const current = { repository, number: record.number, headSha: pr.headRefOid, baseSha: pr.baseRefOid, policyRevision };
  const confirmation = assertReviewRecord(record, current);
  const endpoint = confirmation.kind === 'pullrequestreview'
    ? `repos/${repository}/pulls/${record.number}/reviews/${confirmation.id}`
    : `repos/${repository}/issues/comments/${confirmation.id}`;
  const posted = readGithub(['api', endpoint]);
  requireThat(posted.html_url === record.evidence.reviewUrl && typeof posted.body === 'string'
    && posted.body.split(/\r?\n/).includes(`Agent-Workflow-Review: ${confirmation.digest}`), 'Published confirmation does not match the reviewer record.');
  if (confirmation.kind === 'pullrequestreview') {
    requireThat(posted.commit_id === current.headSha && ['COMMENTED', 'APPROVED'].includes(posted.state), 'Published review is stale, dismissed, or blocking.');
  } else {
    requireThat(posted.issue_url === `https://api.github.com/repos/${repository}/issues/${record.number}`, 'Published comment belongs to another PR.');
  }
  return { ok: true, ...current, reviewer: { agent: record.reviewer.agent, sessionId: record.reviewer.sessionId },
    evidenceUrl: posted.html_url, digest: confirmation.digest,
    limitation: 'Declared session provenance and authorship require coordinator verification; this does not authenticate a model identity or authorize merging.' };
}
