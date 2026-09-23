import { execFile } from 'node:child_process';
import path from 'node:path';

const SHA = /^[a-f\d]{40}$/i;
const REPOSITORY = /^aebens\/[a-z\d_.-]+$/i;

/**
 * Cleanup never discovers its own authority. `record` is an already-authorized
 * merged PR record: {repository, number, headBranch, headSha, mergeSha,
 * baseBranch}. Repository profiles are not ownership or deletion authority.
 *
 * Reservations and queued dependencies are arrays of {repository, branch}.
 * An ownershipManifest entry {repository, branch, clonePath, headSha} attests
 * ownership of that exact local ref in that exact clone. Missing ownership
 * retains the local branch. No manifest entry grants remote cleanup authority.
 * A manifest records ownership, not a writer lock. Before ordinary local
 * `git branch -d`, refresh worktree use and the exact tip. Git's own worktree
 * and ancestry guards remain in force. Unlike remote deletion, local deletion
 * does not have an atomic expected-SHA lease; callers must coordinate owners.
 *
 * `run(command, args, {cwd})` resolves {code, stdout, stderr}. The default runner
 * never invokes a shell. Command output, including possible credentials, is
 * deliberately excluded from returned errors.
 */
export function runCleanupCommand(command, args, { cwd } = {}) {
  return new Promise(resolve => {
    execFile(command, args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
    }, (error, stdout, stderr) => resolve({
      code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
      stdout: stdout ?? '',
      stderr: stderr ?? '',
    }));
  });
}

function sameRepository(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && left.toLowerCase() === right.toLowerCase();
}

function sameSha(left, right) {
  return SHA.test(left ?? '') && SHA.test(right ?? '')
    && left.toLowerCase() === right.toLowerCase();
}

function validBranch(branch) {
  return typeof branch === 'string' && branch.length > 0
    && !branch.startsWith('-') && !branch.startsWith('/')
    && !branch.endsWith('/') && !branch.endsWith('.')
    && !branch.includes('..') && !branch.includes('@{')
    && !branch.includes('//') && branch !== '@'
    && !/[\s\x00-\x1f\x7f~^:?*\[\\]/u.test(branch)
    && branch.split('/').every(part => !part.startsWith('.') && !part.endsWith('.lock'));
}

function validRecord(record) {
  return record && REPOSITORY.test(record.repository ?? '')
    && Number.isSafeInteger(record.number) && record.number > 0
    && validBranch(record.headBranch) && validBranch(record.baseBranch)
    && SHA.test(record.headSha ?? '') && SHA.test(record.mergeSha ?? '');
}

function pathKey(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function validBranchList(entries) {
  return Array.isArray(entries) && entries.every(entry => entry
    && REPOSITORY.test(entry.repository ?? '') && validBranch(entry.branch));
}

function referencesBranch(entries, record) {
  return entries.some(entry => sameRepository(entry.repository, record.repository)
    && entry.branch === record.headBranch);
}

function disposition(status, reason) {
  return { status, reason };
}

function retained(reason) {
  return disposition('retained', reason);
}

function retainBoth(reason) {
  return { remote: retained(reason), local: retained(reason) };
}

/** Pure, fail-closed eligibility evaluation over freshly collected evidence. */
export function planCleanup({
  record,
  snapshot,
  reservedBranches = [],
  queuedBranches = [],
  ownershipManifest = [],
  localSnapshot,
} = {}) {
  if (!validRecord(record)) return retainBoth('invalid-merged-pr-record');
  if (!validBranchList(reservedBranches) || !validBranchList(queuedBranches)
    || !Array.isArray(ownershipManifest)) return retainBoth('invalid-cleanup-scope');
  if (!snapshot?.complete) return retainBoth(snapshot?.reason ?? 'remote-evidence-incomplete');
  if (!sameRepository(snapshot.repository?.fullName, record.repository)) {
    return retainBoth('repository-mismatch');
  }
  const pr = snapshot.pullRequest;
  if (!pr?.merged || pr.state !== 'closed') return retainBoth('pull-request-not-merged');
  if (!sameRepository(pr.baseRepository, record.repository)
    || !sameRepository(pr.headRepository, record.repository)) return retainBoth('fork-or-repository-mismatch');
  if (pr.number !== record.number || pr.headBranch !== record.headBranch
    || pr.baseBranch !== record.baseBranch || !sameSha(pr.headSha, record.headSha)
    || !sameSha(pr.mergeSha, record.mergeSha)) return retainBoth('merged-pr-record-mismatch');
  if (!validBranch(snapshot.repository.defaultBranch)) return retainBoth('default-branch-unknown');
  if (record.headBranch === snapshot.repository.defaultBranch
    || record.headBranch === record.baseBranch) return retainBoth('default-or-merge-target-branch');
  if (referencesBranch(reservedBranches, record)) return retainBoth('reserved-active-branch');
  if (referencesBranch(queuedBranches, record)) return retainBoth('queued-dependency');
  if (!Array.isArray(snapshot.openPullRequests)
    || snapshot.openPullRequests.some(item => !item || !validBranch(item.headBranch)
      || !validBranch(item.baseBranch) || typeof item.headRepository !== 'string'
      || typeof item.baseRepository !== 'string')) return retainBoth('open-pull-request-evidence-incomplete');
  if (snapshot.openPullRequests.some(item =>
    (sameRepository(item.headRepository, record.repository) && item.headBranch === record.headBranch)
    || (sameRepository(item.baseRepository, record.repository) && item.baseBranch === record.headBranch))) {
    return retainBoth('needed-by-open-pull-request');
  }
  if (snapshot.remoteVerified !== true) return retainBoth('remote-url-not-verified');
  const branch = snapshot.remoteBranch;
  if (!branch || typeof branch.exists !== 'boolean') return retainBoth('remote-branch-unknown');
  if (branch.exists && !sameSha(branch.sha, record.headSha)) return retainBoth('remote-tip-changed');
  if (branch.exists && branch.protected === true) return retainBoth('protected-branch');
  const remote = branch.exists
    ? branch.protected === false ? disposition('eligible', 'merged-head-unchanged') : retained('protection-unknown')
    : disposition('already-deleted', 'remote-ref-absent');
  if (remote.status === 'retained') return { remote, local: retained(remote.reason) };
  if (!localSnapshot?.complete) return { remote, local: retained(localSnapshot?.reason ?? 'local-evidence-incomplete') };
  if (localSnapshot.exists === false) return { remote, local: disposition('already-deleted', 'local-ref-absent') };
  if (localSnapshot.exists !== true) return { remote, local: retained('local-ref-unknown') };
  if (branch.protected !== false) return { remote, local: retained(
    branch.protected === true ? 'protected-branch' : 'protection-unknown',
  ) };
  if (!sameSha(localSnapshot.sha, record.headSha)) return { remote, local: retained('local-tip-changed') };
  const owned = ownershipManifest.some(entry => entry
    && sameRepository(entry.repository, record.repository)
    && entry.branch === record.headBranch && sameSha(entry.headSha, record.headSha)
    && pathKey(entry.clonePath) !== null
    && pathKey(entry.clonePath) === pathKey(localSnapshot.clonePath));
  if (!owned) return { remote, local: retained('local-ownership-unknown') };
  if (!Array.isArray(localSnapshot.checkedOutBranches)) return { remote, local: retained('worktree-evidence-incomplete') };
  if (localSnapshot.checkedOutBranches.includes(record.headBranch)) return { remote, local: retained('checked-out-in-worktree') };
  if (!SHA.test(localSnapshot.targetSha ?? '')) return { remote, local: retained('merge-target-unknown') };
  if (localSnapshot.ancestor !== true) return { remote, local: retained(
    localSnapshot.ancestor === false ? 'head-not-ancestor-of-merge-target' : 'merge-target-ancestry-unknown',
  ) };
  return { remote, local: disposition('eligible', 'owned-merged-head-unchanged') };
}

export const evaluateCleanupEligibility = planCleanup;

function repositoryFromUrl(url) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)(aebens\/[a-z\d_.-]+?)(?:\.git)?\/?$/i.exec(url);
  return match?.[1] ?? null;
}

function parseJson(result) {
  if (result.code !== 0) throw new Error('command-failed');
  try { return JSON.parse(result.stdout); } catch { throw new Error('invalid-response'); }
}

function absentBranch(result) {
  if (result.code === 0) return false;
  try {
    const body = JSON.parse(result.stdout);
    return Number(body.status) === 404 && body.message === 'Branch not found';
  } catch { return false; }
}

function remoteRef(result, branch) {
  if (result.code !== 0) throw new Error('remote-ref-query-failed');
  const rows = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error('remote-ref-query-ambiguous');
  const [sha, ref, ...extra] = rows[0].split(/\s+/);
  if (extra.length || !SHA.test(sha ?? '') || ref !== `refs/heads/${branch}`) throw new Error('remote-ref-query-invalid');
  return sha;
}

async function remoteUrls(record, remote, command) {
  for (const args of [['remote', 'get-url', '--all', remote], ['remote', 'get-url', '--push', '--all', remote]]) {
    const result = await command('git', args);
    const urls = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    if (result.code !== 0 || urls.length !== 1
      || !sameRepository(repositoryFromUrl(urls[0]), record.repository)) throw new Error('remote-url-not-verified');
  }
}

async function collectRemote(record, remote, command) {
  try {
    await remoteUrls(record, remote, command);
    const api = endpoint => command('gh', ['api', endpoint]);
    const [repoResult, prResult, openResult, branchResult, tipResult] = await Promise.all([
      api(`repos/${record.repository}`),
      api(`repos/${record.repository}/pulls/${record.number}`),
      command('gh', ['api', '--paginate', '--slurp', `repos/${record.repository}/pulls?state=open&per_page=100`]),
      api(`repos/${record.repository}/branches/${encodeURIComponent(record.headBranch)}`),
      command('git', ['ls-remote', '--heads', remote, `refs/heads/${record.headBranch}`]),
    ]);
    const repo = parseJson(repoResult);
    const pr = parseJson(prResult);
    const pages = parseJson(openResult);
    if (!Array.isArray(pages) || pages.length === 0 || pages.some(page => !Array.isArray(page))) {
      throw new Error('open-pull-request-evidence-incomplete');
    }
    const tip = remoteRef(tipResult, record.headBranch);
    let branch;
    if (branchResult.code === 0) {
      const value = parseJson(branchResult);
      if (value.name !== record.headBranch || !sameSha(value.commit?.sha, tip)) throw new Error('remote-tip-changed-during-read');
      branch = { exists: true, sha: tip, protected: value.protected };
    } else if (absentBranch(branchResult) && tip === null) {
      // An absent ref is complete remotely. Check active rules before considering
      // a surviving local ref, because absence alone says nothing about rulesets.
      const rulesResult = await api(`repos/${record.repository}/rules/branches/${encodeURIComponent(record.headBranch)}`);
      let protection;
      if (rulesResult.code === 0) {
        const rules = parseJson(rulesResult);
        if (Array.isArray(rules)) protection = rules.length > 0;
      }
      branch = { exists: false, protected: protection };
    } else throw new Error('remote-branch-unknown');
    return {
      complete: true,
      remoteVerified: true,
      repository: { fullName: repo.full_name, defaultBranch: repo.default_branch },
      pullRequest: {
        number: pr.number, state: pr.state, merged: pr.merged === true && Boolean(pr.merged_at),
        baseRepository: pr.base?.repo?.full_name,
        headRepository: pr.head?.repo?.full_name,
        headBranch: pr.head?.ref, headSha: pr.head?.sha,
        baseBranch: pr.base?.ref, mergeSha: pr.merge_commit_sha,
      },
      openPullRequests: pages.flat().map(item => ({
        headRepository: item.head?.repo?.full_name,
        baseRepository: item.base?.repo?.full_name,
        headBranch: item.head?.ref,
        baseBranch: item.base?.ref,
      })),
      remoteBranch: branch,
    };
  } catch (error) {
    return { complete: false, reason: safeReason(error) };
  }
}

function safeReason(error) {
  const known = new Set([
    'command-failed', 'invalid-response', 'remote-url-not-verified',
    'remote-ref-query-failed', 'remote-ref-query-ambiguous', 'remote-ref-query-invalid',
    'open-pull-request-evidence-incomplete', 'remote-tip-changed-during-read',
    'remote-branch-unknown', 'local-ref-query-failed', 'local-ref-query-invalid',
    'worktree-evidence-incomplete', 'clone-path-unknown',
    'merge-target-unknown', 'command-runner-failed',
  ]);
  return known.has(error?.message) ? error.message : 'evidence-collection-failed';
}

function worktreeBranches(result) {
  if (result.code !== 0 || !result.stdout.includes('\0')) throw new Error('worktree-evidence-incomplete');
  const records = result.stdout.split('\0\0').filter(Boolean);
  if (records.length === 0) throw new Error('worktree-evidence-incomplete');
  const branches = [];
  for (const entry of records) {
    const fields = entry.split('\0').filter(Boolean);
    if (!fields[0]?.startsWith('worktree ') || !pathKey(fields[0].slice('worktree '.length))) {
      throw new Error('worktree-evidence-incomplete');
    }
    if (fields.includes('bare')) continue;
    const heads = fields.filter(field => field.startsWith('HEAD '));
    const refs = fields.filter(field => field.startsWith('branch '));
    const detached = fields.includes('detached');
    if (heads.length !== 1 || !SHA.test(heads[0].slice('HEAD '.length))
      || (detached ? refs.length !== 0 : refs.length !== 1)) throw new Error('worktree-evidence-incomplete');
    if (detached) continue;
    if (!refs[0].startsWith('branch refs/heads/')) throw new Error('worktree-evidence-incomplete');
    const branch = refs[0].slice('branch refs/heads/'.length);
    if (!validBranch(branch)) throw new Error('worktree-evidence-incomplete');
    branches.push(branch);
  }
  return branches;
}

async function collectLocal(record, remote, command) {
  try {
    const rootResult = await command('git', ['rev-parse', '--show-toplevel']);
    const clonePath = rootResult.stdout.trim();
    if (rootResult.code !== 0 || !pathKey(clonePath)) throw new Error('clone-path-unknown');
    const refResult = await command('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${record.headBranch}`]);
    if (refResult.code === 1 && refResult.stdout.trim() === '') return { complete: true, exists: false, clonePath };
    if (refResult.code !== 0) throw new Error('local-ref-query-failed');
    const sha = refResult.stdout.trim();
    if (!SHA.test(sha)) throw new Error('local-ref-query-invalid');
    const worktrees = await command('git', ['worktree', 'list', '--porcelain', '-z']);
    const checkedOutBranches = worktreeBranches(worktrees);
    // A bare list, detached checkout, and prunable worktree are all valid.
    // Every listed branch, including locked or prunable worktrees, stays reserved.
    const tipResult = await command('git', ['ls-remote', '--heads', remote, `refs/heads/${record.baseBranch}`]);
    const targetSha = remoteRef(tipResult, record.baseBranch);
    if (!targetSha) throw new Error('merge-target-unknown');
    const ancestry = await command('git', ['merge-base', '--is-ancestor', record.headSha, targetSha]);
    return {
      complete: true, exists: true, clonePath, sha, checkedOutBranches, targetSha,
      ancestor: ancestry.code === 0 ? true : ancestry.code === 1 ? false : undefined,
    };
  } catch (error) {
    return { complete: false, reason: safeReason(error) };
  }
}

async function recheckLocal(record, localSnapshot, command) {
  try {
    const rootResult = await command('git', ['rev-parse', '--show-toplevel']);
    const clonePath = rootResult.stdout.trim();
    if (rootResult.code !== 0 || !pathKey(clonePath)) throw new Error('clone-path-unknown');
    const checkedOutBranches = worktreeBranches(await command('git', ['worktree', 'list', '--porcelain', '-z']));
    // Keep the exact-tip read last: no network call or fetch follows it before
    // the pure ownership/eligibility recheck and ordinary non-force deletion.
    const refResult = await command('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${record.headBranch}`]);
    if (refResult.code === 1 && refResult.stdout.trim() === '') return { complete: true, exists: false, clonePath };
    if (refResult.code !== 0) throw new Error('local-ref-query-failed');
    const sha = refResult.stdout.trim();
    if (!SHA.test(sha)) throw new Error('local-ref-query-invalid');
    return { ...localSnapshot, complete: true, exists: true, clonePath, checkedOutBranches, sha };
  } catch (error) {
    return { complete: false, reason: safeReason(error) };
  }
}

/**
 * Dry-run by default. Apply re-reads live evidence before deletion. Remote
 * deletion uses an exact SHA lease. An eligible local candidate gets a targeted
 * fetch without pruning, fresh remote and ancestry checks, then final ownership,
 * worktree, and exact-tip checks before `git branch -d`. No checkout or worktree
 * is switched, detached, or removed; Git refusal preserves the local branch.
 *
 * Git branch -d has no compare-and-swap argument. It can delete an advanced ref
 * when its newer commits are already in HEAD or the upstream, despite our
 * final SHA check. The final recheck narrows, but does not eliminate, that race.
 * Keep one coordinated owner per branch and retain observed changes. Never
 * substitute force deletion or update-ref deletion for the required -d.
 */
export async function cleanupMergedBranch(options = {}, { run = runCleanupCommand } = {}) {
  const {
    record, apply = false, cwd = process.cwd(), remote = 'origin',
    reservedBranches = [], queuedBranches = [], ownershipManifest = [],
  } = options;
  const result = {
    mode: apply === true ? 'apply' : 'dry-run',
    repository: record?.repository, number: record?.number,
    ...retainBoth('not-evaluated'), errors: [],
  };
  if (!validRecord(record) || typeof apply !== 'boolean'
    || !/^[a-z\d][a-z\d_.-]*$/i.test(remote)
    || !validBranchList(reservedBranches) || !validBranchList(queuedBranches)
    || !Array.isArray(ownershipManifest)) {
    return { ...result, ...retainBoth('invalid-cleanup-input') };
  }
  const command = async (executable, args) => {
    try {
      const response = await run(executable, args, { cwd });
      if (!response || !Number.isInteger(response.code)
        || typeof response.stdout !== 'string' || typeof response.stderr !== 'string') throw new Error('command-runner-failed');
      return response;
    } catch { throw new Error('command-runner-failed'); }
  };
  const common = { record, reservedBranches, queuedBranches, ownershipManifest };
  let snapshot = await collectRemote(record, remote, command);
  const remotePlan = planCleanup({ ...common, snapshot });
  if (remotePlan.remote.status === 'retained') return { ...result, ...remotePlan };
  let localSnapshot = await collectLocal(record, remote, command);
  let plan = planCleanup({ ...common, snapshot, localSnapshot });
  Object.assign(result, plan);
  if (!apply) {
    for (const side of ['remote', 'local']) {
      if (result[side].status === 'eligible') result[side] = disposition('dry-run', result[side].reason);
    }
    return result;
  }
  // Refresh all remote guards immediately before the one remote mutation.
  if (plan.remote.status === 'eligible') {
    snapshot = await collectRemote(record, remote, command);
    plan = planCleanup({ ...common, snapshot, localSnapshot });
    result.remote = plan.remote;
    if (plan.remote.status === 'eligible') {
      const removed = await command('git', [
        'push', '--porcelain', `--force-with-lease=refs/heads/${record.headBranch}:${record.headSha}`,
        remote, `:refs/heads/${record.headBranch}`,
      ]).catch(() => ({ code: 1, stdout: '', stderr: '' }));
      let remaining;
      try {
        remaining = remoteRef(await command('git', ['ls-remote', '--heads', remote, `refs/heads/${record.headBranch}`]), record.headBranch);
      } catch {
        result.remote = disposition('failed', 'remote-deletion-unverified');
        result.errors.push('remote-deletion-unverified');
        remaining = undefined;
      }
      if (remaining === null) result.remote = disposition('deleted', 'remote-ref-absence-verified');
      else if (remaining !== undefined) {
        result.remote = removed.code === 0
          ? retained('remote-ref-recreated-or-retained') : disposition('failed', 'remote-delete-rejected');
        if (removed.code !== 0) result.errors.push('remote-delete-rejected');
      }
    }
  }
  // Remote failure never pretends local success. Re-evaluate local cleanup
  // independently, so an unavailable local clone does not obscure remote status.
  snapshot = await collectRemote(record, remote, command);
  const localGuard = planCleanup({ ...common, snapshot });
  if (localGuard.remote.status === 'retained') return { ...result, local: retained(localGuard.remote.reason) };
  localSnapshot = await collectLocal(record, remote, command);
  plan = planCleanup({ ...common, snapshot, localSnapshot });
  result.local = plan.local;
  if (plan.local.status !== 'eligible' && plan.local.reason !== 'merge-target-ancestry-unknown') return result;

  // Fetch only a local deletion candidate. Explicit no-prune/no-tags options
  // override user defaults; no unrelated ref, tag, or submodule is cleaned up.
  const fetched = await command('git', [
    'fetch', '--no-tags', '--no-prune', '--no-prune-tags', '--no-recurse-submodules',
    '--no-write-fetch-head', '--refmap=', remote, `refs/heads/${record.baseBranch}`,
  ]).catch(() => ({ code: 1, stdout: '', stderr: '' }));
  if (fetched.code !== 0) {
    result.local = disposition('failed', 'merge-target-fetch-failed');
    result.errors.push('merge-target-fetch-failed');
    return result;
  }
  snapshot = await collectRemote(record, remote, command);
  localSnapshot = await collectLocal(record, remote, command);
  plan = planCleanup({ ...common, snapshot, localSnapshot });
  result.local = plan.local;
  if (plan.local.status !== 'eligible') return result;

  localSnapshot = await recheckLocal(record, localSnapshot, command);
  result.local = planCleanup({ ...common, snapshot, localSnapshot }).local;
  if (result.local.status !== 'eligible') return result;
  const removed = await command('git', ['branch', '-d', '--', record.headBranch])
    .catch(() => ({ code: 1, stdout: '', stderr: '' }));
  const remaining = await command('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${record.headBranch}`])
    .catch(() => ({ code: 128, stdout: '', stderr: '' }));
  if (remaining.code === 1 && remaining.stdout.trim() === '') {
    result.local = disposition(removed.code === 0 ? 'deleted' : 'already-deleted', 'local-ref-absence-verified');
  } else if (remaining.code !== 0 || !SHA.test(remaining.stdout.trim())) {
    result.local = disposition('failed', 'local-deletion-unverified');
    result.errors.push('local-deletion-unverified');
  } else if (removed.code !== 0) {
    result.local = retained('git-branch-delete-refused');
    result.errors.push('git-branch-delete-refused');
  } else {
    result.local = retained('local-ref-recreated-or-retained');
  }
  return result;
}
