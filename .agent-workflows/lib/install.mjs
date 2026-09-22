import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { digest, within, repositoryRoot } from './profile.mjs';

function isLink(path) {
  try { return lstatSync(path).isSymbolicLink(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function bundleFiles(source, revision) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Install requires a full source commit SHA.');
  const entries = execFileSync('git', ['-C', source, 'ls-tree', '-rz', revision, '--', 'bin', 'lib', 'policy'], { encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
  return entries.map(entry => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t((?:bin|lib|policy)\/[^\r\n]+)$/.exec(entry);
    if (!match || match[3].includes('\\') || match[3].split('/').some(part => part === '..' || part === '.' || part.includes(':'))) throw new Error('Workflow source must contain only safe regular files.');
    return { name: match[3], blob: match[2] };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
export function installBundle({ source, target, profile, revision }) {
  source = resolve(source); target = resolve(repositoryRoot(resolve(target)));
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Install requires a full source commit SHA.');
  if (profile.schemaVersion !== 1 || !/^aebens\/[A-Za-z0-9_.-]+$/.test(profile.repository)) throw new Error('Invalid target profile.');
  const remote = execFileSync('git', ['-C', target, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true }).trim();
  const identity = remote.replace(/^https:\/\/github\.com\//, '').replace(/^git@github\.com:/, '').replace(/\/$/, '').replace(/\.git$/, '');
  if (identity !== profile.repository) throw new Error('Install target does not match the profile repository.');
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  if (git(['rev-parse', 'HEAD']) !== revision || git(['status', '--porcelain', '--', 'bin', 'lib', 'policy'])) throw new Error('Install only a clean, committed source bundle at the requested revision.');
  const destination = resolve(target, '.agent-workflows');
  if (isLink(destination) || (existsSync(destination) && !within(realpathSync(target), realpathSync(destination)))) throw new Error('Workflow destination must be inside the target repository.');
  const safeDestination = name => {
    const path = resolve(destination, name);
    if (!within(destination, path)) throw new Error(`Unsafe destination path: ${name}`);
    let current = path;
    while (current !== target) {
      if (isLink(current)) throw new Error(`Unsafe destination link: ${name}`);
      current = dirname(current);
    }
    return path;
  };
  safeDestination('manifest.json');
  safeDestination('profile.json');
  const manifestPath = resolve(destination, 'manifest.json');
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { files: {} };
  const files = [...bundleFiles(source, revision), { name: '.gitattributes', bytes: Buffer.from('* -text\n') }];
  if (!files.some(file => file.name === 'policy/core.md')) throw new Error('Committed policy bundle is incomplete.');
  for (const { name } of files) {
    const path = safeDestination(name);
    let ancestor = dirname(path);
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    if (!within(realpathSync(target), realpathSync(ancestor)) || (existsSync(path) && lstatSync(path).isSymbolicLink())) throw new Error(`Unsafe destination directory: ${name}`);
    if (existsSync(path) && (!previous.files[name] || digest(readFileSync(path)) !== previous.files[name])) throw new Error(`Preserving locally modified or unmanaged file: ${name}`);
  }
  const manifest = { schemaVersion: 1, source: 'aebens/agent-workflows', revision, files: {} };
  for (const { name, blob, bytes: literal } of files) {
    const bytes = literal ?? execFileSync('git', ['-C', source, 'cat-file', 'blob', blob], { windowsHide: true });
    const path = resolve(destination, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    manifest.files[name] = digest(bytes);
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(resolve(destination, 'profile.json'), JSON.stringify({ ...profile, schemaVersion: 1, policyRevision: revision }, null, 2) + '\n');
  return { repository: profile.repository, revision, files: files.length };
}
