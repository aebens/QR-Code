import { readProfile } from './profile.mjs';
export function startupContext(cwd) {
  let state;
  try { state = readProfile(cwd); }
  catch (error) {
    if (String(error.stderr || '').includes('not a git repository')) return { ok: true, adopted: false, message: '' };
    return { ok: false, message: `Shared workflow could not be verified: ${error.message} Read the effective AGENTS.md and CLAUDE.md. Resolve policy integrity before commits, pushes, merges, or branch deletion. This diagnostic does not establish authorization.` };
  }
  if (!state.adopted) return { ok: true, adopted: false, message: '' };
  return { ok: true, adopted: true, message: [
    `Shared workflow: ${state.profile.repository}, policy ${state.profile.policyRevision}.`,
    `Verified local files: ${state.directory}/policy/core.md and ${state.directory}/profile.json. Read core.md and the workflow for the assigned stage before acting.`,
    'Orchestration requires Ashley\'s live scoped kickoff. Manual stages stop for her relay. Codex-owned work needs a separate primary Claude reviewer; Claude-owned work needs a separate primary Codex reviewer. The reviewer must not be an author; supporting subagents cannot approve. Require its current head/base confirmation and review-check before merge. Log only confirmed deduplicated bugs. Use exact staged validation; CI remains required. Cleanup preserves active work.',
    'This output verifies policy files and supplies context; delivery must be observed in the host. It does not prove understanding, validation success, or permission.'
  ].join('\n') };
}
