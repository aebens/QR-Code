import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

export const digest = data => createHash('sha256').update(data).digest('hex');
export function within(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
export function repositoryRoot(cwd) {
  return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export function readProfile(cwd, { verify = true } = {}) {
  const root = repositoryRoot(cwd);
  const directory = resolve(root, '.agent-workflows');
  const path = resolve(directory, 'profile.json');
  if (!existsSync(path)) return { root, adopted: false };
  const profile = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  if (profile.schemaVersion !== 1 || !/^aebens\/[A-Za-z0-9_.-]+$/.test(profile.repository)) throw new Error('Invalid workflow profile repository or schema.');
  if (!/^[a-f0-9]{40}$/.test(profile.policyRevision)) throw new Error('Policy must be pinned to a full commit SHA.');
  if (!profile.defaultBranch || !Array.isArray(profile.requiredChecks) || !Array.isArray(profile.validation?.commands)) throw new Error('Profile is missing its branch, required checks, or validation commands.');
  const remote = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true }).trim();
  const identity = remote.replace(/^https:\/\/github\.com\//, '').replace(/^git@github\.com:/, '').replace(/\/$/, '').replace(/\.git$/, '');
  if (identity !== profile.repository) throw new Error('Workflow profile does not match the origin repository.');
  if (verify) {
    const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.revision !== profile.policyRevision || manifest.source !== 'aebens/agent-workflows') throw new Error('Policy manifest and profile revisions disagree.');
    if (!manifest.files || !Object.hasOwn(manifest.files, 'policy/core.md')) throw new Error('Policy manifest is incomplete.');
    for (const [name, hash] of Object.entries(manifest.files)) {
      const file = resolve(directory, name);
      if (!within(directory, file) || !existsSync(file) || !within(realpathSync(directory), realpathSync(file))) throw new Error(`Missing or unsafe policy file: ${name}`);
      if (digest(readFileSync(file)) !== hash) throw new Error(`Policy file differs from its pinned copy: ${name}`);
    }
  }
  return { root, directory, profile, adopted: true };
}
