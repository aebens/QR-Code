import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readProfile } from './profile.mjs';

const exec = promisify(execFile);

async function readGitBlob(command, cwd, object, signal) {
  try {
    const result = await exec(command.executable, [...command.args, 'cat-file', 'blob', object], {
      cwd, signal, windowsHide: true, encoding: 'buffer', timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    throw new ValidationError('staged-policy-read', `Could not read the staged policy blob ${object}: ${error.message}`);
  }
}

const enginePath = fileURLToPath(import.meta.url);
const defaultDependencyFiles = [
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock',
  'requirements.txt', 'pyproject.toml', 'poetry.lock', 'uv.lock', 'Cargo.lock', 'go.sum',
];
const gitTargetVariables = ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY'];

export class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

const digest = value => createHash('sha256').update(value).digest('hex');

/** Exact input identity, never an inference that two revisions are equivalent. */
export function validationKey(identity) {
  return digest(JSON.stringify(stable(identity)));
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new ValidationError('interrupted', 'Staged validation was interrupted.');
}

function validateCommand(command, description) {
  if (!command || typeof command.name !== 'string' || !command.name.trim()
    || !Array.isArray(command.argv) || command.argv.length === 0
    || command.argv.some(value => typeof value !== 'string' || value.includes('\0'))
    || !command.argv[0]) {
    throw new ValidationError('invalid-profile', `${description} must have a name and a nonempty argv array of strings.`);
  }
  if (Object.keys(command).some(key => !['name', 'argv'].includes(key))) {
    throw new ValidationError('invalid-profile', `${description} supports name and argv only; shell strings and command-specific working directories are unsupported.`);
  }
}

function validationSettings(profile) {
  if (profile?.schemaVersion !== 1 || !/^aebens\/[A-Za-z0-9_.-]+$/.test(profile.repository ?? '')
    || !/^[a-f0-9]{40}$/i.test(profile.policyRevision ?? '')) {
    throw new ValidationError('invalid-profile', 'A schemaVersion 1 profile with an aebens repository and full policyRevision SHA is required.');
  }
  const settings = profile.validation;
  if (!settings || !Array.isArray(settings.commands) || settings.commands.length === 0) {
    throw new ValidationError('invalid-profile', 'validation.commands must contain at least one explicit validation command.');
  }
  const allowed = ['commands', 'install', 'dependencyFiles', 'timeoutMs'];
  if (Object.keys(settings).some(key => !allowed.includes(key))) {
    throw new ValidationError('invalid-profile', 'Unsupported validation setting. Supported fields are commands, install, dependencyFiles, and timeoutMs.');
  }
  settings.commands.forEach((command, index) => validateCommand(command, `validation.commands[${index}]`));
  if (new Set(settings.commands.map(command => command.name)).size !== settings.commands.length) {
    throw new ValidationError('invalid-profile', 'Validation command names must be unique.');
  }
  if (settings.install !== undefined) validateCommand(settings.install, 'validation.install');
  if (settings.dependencyFiles !== undefined && !Array.isArray(settings.dependencyFiles)) {
    throw new ValidationError('invalid-profile', 'validation.dependencyFiles must be an array.');
  }
  const files = [...new Set([...defaultDependencyFiles, ...(settings.dependencyFiles ?? [])])];
  for (const file of files) {
    if (typeof file !== 'string' || !file || isAbsolute(file) || file.includes('\\')
      || file.split('/').some(part => !part || part === '.' || part === '..') || file.includes('\0')) {
      throw new ValidationError('invalid-profile', 'Dependency files must be repository-relative paths using forward slashes.');
    }
  }
  const timeoutMs = settings.timeoutMs ?? 20 * 60 * 1000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60 * 60 * 1000) {
    throw new ValidationError('invalid-profile', 'validation.timeoutMs must be between 1 and 3600000 milliseconds.');
  }
  return { ...settings, dependencyFiles: files, timeoutMs };
}

async function executablePath(command) {
  if (command === 'node' || command === 'node.exe') return process.execPath;
  const hasPath = isAbsolute(command) || command.includes('/') || command.includes('\\');
  if (hasPath && !isAbsolute(command)) {
    throw new ValidationError('unsupported-command', `Use a PATH executable or an absolute executable path, not ${command}. Run repository scripts through node or the package manager.`);
  }
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map(value => value.trim().toLowerCase()).filter(Boolean)
    : [''];
  // Windows npm ships both a POSIX shell script named npm and npm.cmd.
  // Only consider PATHEXT launchers for an extensionless Windows command;
  // the shell script exists but cannot be launched with shell: false.
  const names = process.platform === 'win32'
    && !extensions.some(extension => command.toLowerCase().endsWith(extension))
    ? extensions.map(extension => command + extension)
    : [command];
  const candidates = hasPath ? names : (process.env.PATH ?? '').split(delimiter).filter(Boolean)
    .flatMap(directory => names.map(name => join(directory, name)));
  for (const candidate of candidates) {
    try {
      await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      if ((await stat(candidate)).isFile()) return await realpath(candidate);
    } catch { /* Try the next PATH candidate. */ }
  }
  throw new ValidationError('missing-command', `Validation executable was not found: ${command}`);
}

async function resolveCommand(argv) {
  const executable = await executablePath(argv[0]);
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)) {
    const name = basename(executable).replace(/\.(?:cmd|bat)$/i, '').toLowerCase();
    if (name !== 'npm' && name !== 'npx') {
      throw new ValidationError('unsupported-command', `Windows batch executable ${argv[0]} is unsupported. Supply its underlying executable or Node entry point.`);
    }
    const cli = join(dirname(executable), 'node_modules', 'npm', 'bin', `${name}-cli.js`);
    try {
      await access(cli);
    } catch {
      throw new ValidationError('unsupported-command', `Cannot locate ${name}'s Node entry point beside ${executable}. Supply an absolute Node entry point.`);
    }
    return { executable: process.execPath, args: [cli, ...argv.slice(1)], files: [process.execPath, executable, cli] };
  }
  return { executable, args: argv.slice(1), files: [executable] };
}

async function run(command, { cwd, signal, timeoutMs = 120_000, input, env = {}, onOutput, captureAll = false } = {}) {
  abortIfNeeded(signal);
  return await new Promise((resolveRun, reject) => {
    let output = '';
    let failure;
    let settled = false;
    const child = spawn(command.executable, command.args, {
      cwd, env: { ...process.env, ...env }, windowsHide: true, shell: false,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stop = error => {
      if (settled || failure) return;
      failure = error;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        // Only this validator's own freshly spawned process tree is targeted.
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    };
    const abort = () => stop(new ValidationError('interrupted', 'Staged validation was interrupted.'));
    const timer = setTimeout(() => stop(new ValidationError('timeout', `Validation command exceeded ${timeoutMs} milliseconds.`)), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const append = (chunk, stream) => {
      const text = chunk.toString();
      output = captureAll ? output + text : (output + text).slice(-64 * 1024);
      if (captureAll && output.length > 16 * 1024 * 1024) {
        stop(new ValidationError('output-too-large', 'Git output exceeded the supported 16 MiB limit. Validation did not complete.'));
      }
      try { onOutput?.(text, stream); } catch (error) { stop(error); }
    };
    child.stdout.on('data', chunk => append(chunk, 'stdout'));
    child.stderr.on('data', chunk => append(chunk, 'stderr'));
    child.on('error', error => { failure = new ValidationError('command-launch', `Could not start ${command.executable}: ${error.message}`); });
    child.on('close', code => {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new ValidationError('command-failed', `Command failed (${code}): ${command.executable}\n${output.trim()}`));
      else resolveRun(output.trim());
    });
    child.stdin.on('error', () => { /* The process error/close handler owns failure. */ });
    child.stdin.end(input);
    if (signal?.aborted) abort();
  });
}

async function removeSnapshot(temporaryRoot) {
  if (!temporaryRoot) return;
  const parent = await realpath(tmpdir());
  const target = await realpath(temporaryRoot);
  const child = relative(parent, target);
  if (!child || child.startsWith(`..${sep}`) || child === '..' || isAbsolute(child)
    || !basename(target).startsWith('agent-workflows-validation-')) {
    throw new ValidationError('unsafe-cleanup', 'Refusing to remove a validation snapshot outside its allocated temporary directory.');
  }
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/**
 * Validate only the staged tree. Commands run at the root of an isolated local
 * clone, with no working-tree or untracked dependencies. validation.install is
 * a named argv command responsible for installing dependencies in that clone.
 * Successful receipts are local to this Git directory and exact input identity.
 * These receipts are a development guardrail, never substitutes for required CI.
 */
export async function validateStaged({ cwd, profile, signal, onOutput, force = false } = {}) {
  const settings = validationSettings(profile);
  for (const variable of gitTargetVariables) {
    if (process.env[variable]) throw new ValidationError('unsupported-git-environment', `Unset ${variable} before validating the ordinary staged index.`);
  }
  const gitCommand = await resolveCommand(['git']);
  const git = (args, options = {}) => run({ ...gitCommand, args }, { cwd, signal, captureAll: true, ...options });
  const root = await git(['rev-parse', '--show-toplevel']);
  cwd = await realpath(root);
  const gitDirectory = await git(['rev-parse', '--absolute-git-dir']);
  const tree = await git(['write-tree']);
  let parentHead;
  try { parentHead = await git(['rev-parse', '--verify', 'HEAD']); }
  catch (error) { if (error.code !== 'command-failed') throw error; }
  const files = (await git(['ls-tree', '-r', '--name-only', '-z', tree])).split('\0').filter(Boolean);
  const profilePath = '.agent-workflows/profile.json';
  const manifestPath = '.agent-workflows/manifest.json';
  let workingManifest;
  try { workingManifest = await readFile(join(cwd, manifestPath), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (workingManifest !== undefined) {
    // A production adoption must exist in the commit being validated, not only
    // in the caller's working directory. Synthetic low-level fixtures without
    // an installed manifest can still supply their explicit command profile.
    const adopted = readProfile(cwd);
    if (!adopted.adopted || !files.includes(profilePath) || !files.includes(manifestPath)) {
      throw new ValidationError('missing-staged-policy', 'Stage the complete adopted policy and profile before validating.');
    }
    if (JSON.stringify(stable(adopted.profile)) !== JSON.stringify(stable(profile))) {
      throw new ValidationError('profile-mismatch', 'The supplied profile differs from the verified working adoption.');
    }
    const stagedModes = new Map((await git(['ls-tree', '-r', '-z', tree, '--', '.agent-workflows']))
      .split('\0').filter(Boolean).map(entry => {
        const match = /^(\d+) (\S+) [a-f0-9]+\t([\s\S]+)$/.exec(entry);
        if (!match) throw new ValidationError('invalid-staged-policy', 'Could not inspect staged policy file modes.');
        return [match[3], { mode: match[1], type: match[2] }];
      }));
    const requireRegularBlob = path => {
      const entry = stagedModes.get(path);
      if (!entry) throw new ValidationError('missing-staged-policy', `Missing staged policy file: ${path}`);
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) {
        throw new ValidationError('unsafe-staged-policy', `Staged policy files must be regular files: ${path}`);
      }
    };
    requireRegularBlob(profilePath);
    requireRegularBlob(manifestPath);
    const manifest = JSON.parse(workingManifest);
    const stagedManifest = await git(['show', `${tree}:${manifestPath}`]);
    if (JSON.stringify(stable(JSON.parse(stagedManifest))) !== JSON.stringify(stable(manifest))) {
      throw new ValidationError('staged-policy-mismatch', 'The staged policy manifest differs from the verified working adoption.');
    }
    for (const [name, hash] of Object.entries(manifest.files)) {
      const path = `.agent-workflows/${name}`;
      requireRegularBlob(path);
      // cat-file through the normal text runner would trim blob whitespace.
      // Git's own hash-object is not SHA-256 content hashing, so read the exact
      // blob bytes with a dedicated binary capture below.
      const blob = await readGitBlob(gitCommand, cwd, `${tree}:${path}`, signal);
      if (digest(blob) !== hash) throw new ValidationError('staged-policy-mismatch', `Staged policy file differs from its pinned copy: ${name}`);
    }
  }
  if (files.includes(profilePath)) {
    let stagedProfile;
    try { stagedProfile = JSON.parse(await git(['show', `${tree}:${profilePath}`])); }
    catch { throw new ValidationError('invalid-profile', 'The staged workflow profile is not valid JSON.'); }
    if (JSON.stringify(stable(stagedProfile)) !== JSON.stringify(stable(profile))) {
      throw new ValidationError('profile-mismatch', 'The supplied workflow profile differs from the staged profile. Stage the intended profile first.');
    }
  }
  let sourceOrigin;
  try { sourceOrigin = await git(['remote', 'get-url', 'origin']); }
  catch (error) {
    if (files.includes(profilePath) || error.code !== 'command-failed') {
      throw new ValidationError('repository-mismatch', 'An adopted workflow profile requires a readable origin for its named repository.');
    }
  }
  if (sourceOrigin) {
    const originMatch = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)(aebens\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(sourceOrigin);
    if (originMatch?.[1] !== profile.repository) {
      throw new ValidationError('repository-mismatch', 'The source origin does not match the aebens repository named in the workflow profile.');
    }
  }
  const dependencyHashes = {};
  for (const file of settings.dependencyFiles) {
    if (files.includes(file)) dependencyHashes[file] = digest(await git(['show', `${tree}:${file}`]));
  }
  let dependenciesRequired = Object.keys(dependencyHashes).some(file => file !== 'package.json');
  if (files.includes('package.json')) {
    let pkg;
    try { pkg = JSON.parse(await git(['show', `${tree}:package.json`])); }
    catch { throw new ValidationError('invalid-package', 'The staged package.json is not valid JSON.'); }
    dependenciesRequired ||= Boolean(pkg.workspaces)
      || ['dependencies', 'devDependencies', 'optionalDependencies'].some(key => Object.keys(pkg[key] ?? {}).length > 0);
  }
  if (dependenciesRequired && !settings.install) {
    throw new ValidationError('installation-required', 'Staged dependency inputs require validation.install. Existing node_modules and environment dependencies are not reused.');
  }
  const specifications = [...(settings.install ? [settings.install] : []), ...settings.commands];
  const commands = await Promise.all(specifications.map(command => resolveCommand(command.argv)));
  const executableHashes = {};
  for (const file of new Set([process.execPath, ...gitCommand.files, ...commands.flatMap(command => command.files)])) {
    executableHashes[file] = digest(await readFile(file));
  }
  // Commands can read arbitrary environment variables. Bind the whole effective
  // environment, but store only its hash so credentials never enter receipts.
  const executionEnvironment = { ...process.env, CI: '1' };
  const identity = {
    schemaVersion: 1, repository: profile.repository, root: cwd, tree, parentHead: parentHead ?? null,
    profileHash: validationKey(profile), policyRevision: profile.policyRevision,
    engineHash: digest(await readFile(enginePath)), dependencyHashes, executableHashes,
    runtime: { platform: process.platform, arch: process.arch, node: process.version,
      git: await git(['--version']), environmentHash: validationKey(executionEnvironment) },
  };
  const key = validationKey(identity);
  const directory = join(gitDirectory, 'agent-workflows', 'validation');
  await mkdir(directory, { recursive: true });
  const receiptPath = join(directory, `${key}.json`);
  const lockPath = join(directory, `${key}.lock`);
  try {
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new ValidationError('validation-locked', `This snapshot is already being validated, or an interrupted process left ${lockPath}. Verify its owner has exited before removing that lock.`);
    throw error;
  }
  let temporaryRoot;
  let temporaryReceipt;
  try {
    abortIfNeeded(signal);
    await git(['diff', '--cached', '--check']);
    let receipt;
    try { receipt = JSON.parse(await readFile(receiptPath, 'utf8')); } catch { /* Missing or malformed receipts cannot pass. */ }
    if (!force && receipt?.status === 'passed' && receipt.key === key && receipt.tree === tree
      && JSON.stringify(receipt.commands) === JSON.stringify(settings.commands.map(command => command.name))) {
      abortIfNeeded(signal);
      if (await git(['write-tree']) !== tree) throw new ValidationError('index-changed', 'The staged index changed while validation evidence was being checked.');
      return { ok: true, reused: true, tree, receiptPath, commands: receipt.commands };
    }
    await rm(receiptPath, { force: true });
    temporaryRoot = await mkdtemp(join(tmpdir(), 'agent-workflows-validation-'));
    const snapshot = join(temporaryRoot, 'snapshot');
    const snapshotCommit = await git(['commit-tree', tree, ...(parentHead ? ['-p', parentHead] : [])], {
      input: 'Temporary staged validation snapshot\n',
      env: { GIT_AUTHOR_NAME: 'Agent workflow validation', GIT_AUTHOR_EMAIL: 'validation@local.invalid',
        GIT_COMMITTER_NAME: 'Agent workflow validation', GIT_COMMITTER_EMAIL: 'validation@local.invalid' },
    });
    await git(['clone', '--shared', '--no-checkout', '--quiet', '--', cwd, snapshot]);
    // Git does not install --shared alternates when the source is shallow.
    // Explicitly borrow this source's object database in our private clone so
    // its unreferenced staged commit is available without changing source refs.
    const sourceObjects = await realpath(await git(['rev-parse', '--path-format=absolute', '--git-path', 'objects']));
    if (/[\r\n]/.test(sourceObjects)) {
      throw new ValidationError('unsupported-object-path', 'Git object directory paths containing newlines cannot be encoded safely as alternates.');
    }
    const alternates = join(snapshot, '.git', 'objects', 'info', 'alternates');
    await mkdir(dirname(alternates), { recursive: true });
    await writeFile(alternates, `${sourceObjects.split(sep).join('/')}\n`);
    if (sourceOrigin) {
      // The shared clone initially names a local path as origin. Give read-only
      // repository checks the verified identity without copying credentials.
      await git(['remote', 'set-url', 'origin', `https://github.com/${profile.repository}.git`], { cwd: snapshot });
    }
    // Do not let the user's global Windows autocrlf setting alter ordinary
    // staged blobs. Repository .gitattributes remains the checkout contract.
    await git(['config', 'core.autocrlf', 'false'], { cwd: snapshot });
    await git(['config', 'core.eol', 'lf'], { cwd: snapshot });
    await git(['checkout', '--detach', '--quiet', snapshotCommit], { cwd: snapshot });
    for (let index = 0; index < commands.length; index += 1) {
      abortIfNeeded(signal);
      onOutput?.(`Validating: ${specifications[index].name}\n`, 'status');
      await run(commands[index], { cwd: snapshot, signal, timeoutMs: settings.timeoutMs, env: { CI: '1' }, onOutput });
    }
    await git(['diff', '--exit-code', 'HEAD', '--'], { cwd: snapshot });
    abortIfNeeded(signal);
    if (await git(['write-tree']) !== tree) throw new ValidationError('index-changed', 'The staged index changed during validation. Stage the intended checkpoint and validate again.');
    // Complete cleanup before issuing successful evidence. A cleanup error is a failure.
    await removeSnapshot(temporaryRoot);
    temporaryRoot = undefined;
    abortIfNeeded(signal);
    if (await git(['write-tree']) !== tree) throw new ValidationError('index-changed', 'The staged index changed before the validation receipt could be written.');
    receipt = { status: 'passed', key, tree, identity, commands: settings.commands.map(command => command.name), completedAt: new Date().toISOString() };
    temporaryReceipt = `${receiptPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    await rename(temporaryReceipt, receiptPath);
    temporaryReceipt = undefined;
    return { ok: true, reused: false, tree, receiptPath, commands: receipt.commands };
  } catch (error) {
    await rm(receiptPath, { force: true });
    throw error;
  } finally {
    try {
      await removeSnapshot(temporaryRoot);
      if (temporaryReceipt) await rm(temporaryReceipt, { force: true });
    } finally {
      await rm(lockPath, { force: true });
    }
  }
}
