#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readProfile } from '../lib/profile.mjs';
import { startupContext } from '../lib/startup.mjs';

const [command, ...args] = process.argv.slice(2);
function values(flag) { return args.flatMap((value, index) => value === flag ? [args[index + 1]] : []); }
function value(flag, fallback) { return values(flag).at(-1) ?? fallback; }
const cwd = resolve(value('--cwd', process.cwd()));
try {
  if (command === 'startup') {
    let input = {};
    if (args.includes('--hook')) { try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* CLI launch can omit input. */ } }
    const result = startupContext(input.cwd || cwd);
    if (args.includes('--hook')) {
      if (result.message) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name || 'SessionStart', additionalContext: result.message } }));
    } else { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1; }
  } else if (command === 'prompt') {
    const { renderPrompt } = await import('../lib/prompt.mjs');
    console.log(renderPrompt({ policyReference: value('--policy'), mode: value('--mode', 'orchestrated'), stage: value('--stage', 'execute'), prs: values('--pr'), approvedDecisions: values('--decision') }));
  } else if (command === 'verify') {
    const state = readProfile(cwd);
    if (!state.adopted) throw new Error('Repository has not adopted the shared workflow.');
    console.log(JSON.stringify({ ok: true, repository: state.profile.repository, policyRevision: state.profile.policyRevision }));
  } else if (command === 'validate') {
    const state = readProfile(cwd);
    if (!state.adopted) throw new Error('Repository has not adopted the shared workflow.');
    const { validateStaged } = await import('../lib/validate.mjs');
    console.log(JSON.stringify(await validateStaged({ cwd: state.root, profile: state.profile, onOutput: text => process.stderr.write(String(text)) }), null, 2));
  } else if (command === 'review-digest' || command === 'review-check') {
    if (!value('--record')) throw new Error('Supply --record with the designated reviewer confirmation.');
    const record = JSON.parse(readFileSync(resolve(value('--record')), 'utf8'));
    const { reviewDigest, checkPublishedReview, reviewContext } = await import('../lib/review.mjs');
    if (command === 'review-digest') console.log(`Agent-Workflow-Review: ${reviewDigest(record)}`);
    else {
      const seen = new Set();
      for (let index = 0; index < args.length; index += 2) {
        const flag = args[index];
        if (!['--record', '--cwd', '--policy-revision'].includes(flag) || seen.has(flag)
          || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Invalid, duplicate, or unused review-check argument.');
        seen.add(flag);
      }
      const context = reviewContext(cwd, value('--policy-revision'));
      console.log(JSON.stringify({ ...checkPublishedReview({ record, repository: context.repository,
        policyRevision: context.policyRevision, cwd: context.root }), installedPolicyRevision: context.installedPolicyRevision }, null, 2));
    }
  } else if (command === 'cleanup') {
    if (!value('--record')) throw new Error('Supply --record with the authorized merged-PR record.');
    const record = JSON.parse(readFileSync(resolve(value('--record')), 'utf8'));
    const { cleanupMergedBranch } = await import('../lib/cleanup.mjs');
    console.log(JSON.stringify(await cleanupMergedBranch({ ...record, cwd, apply: args.includes('--apply') }), null, 2));
  } else {
    console.log('workflow startup [--hook] | verify | validate | review-digest --record <file> | review-check --record <file> --policy-revision <session-pin> | prompt --policy <pinned-reference> --pr <url> [--mode manual --stage review] | cleanup --record <file> [--apply]');
    if (command && command !== 'help') process.exitCode = 1;
  }
} catch (error) { console.error(`${error.code || 'WORKFLOW_ERROR'}: ${error.message}`); process.exitCode = 1; }
