# Implementation handoff

Use this workflow for new implementation, separate from PR review. Approval of
a plan does not automatically authorize publishing its implementation.

Before the first external action, state the intended branch owner, existing or
new PR target, whether a planning PR remains documentation-only, the authorized
editing/commit/push/PR actions, and whether work stops after one PR or continues
through a named sequence. Reuse decisions already explicit in Ashley's current
instruction; do not ask for them again. Ask only for a material missing scope or
authority decision, after making independent planning work reviewable.

Inspect current branch state and relevant diffs. Treat unexpected changes as
another person's work. Isolate overlapping work and preserve all unrelated
edits. Implement only approved scope, validate the exact staged checkpoint with
the project profile, and commit coherent changes using explicit staged paths.
Publish only to the authorized target. Follow the project's existing PR and
attribution conventions.

Identify a separate primary reviewer of the family opposite the branch owner:
Claude for Codex-owned work and Codex for Claude-owned work. The reviewer must
not have contributed to the implementation. Supporting subagents cannot replace
that reviewer. After publication, obtain its own current head/base confirmation
as specified in review.md before any authorized merge.

For blocker fixes to existing PRs in an authorized orchestrated queue, the
kickoff already supplies the bounded external-action authority and continuous
cadence. Do not repeat this handoff or seek permission for every fix or push.
The owner still validates and preserves branch ownership. Unrelated feature
work and new implementation PRs remain outside a queue naming existing PRs.

Manual fix work ends after the assigned fix stage. Return the revision and
verification evidence to Ashley; do not trigger review or merge automatically.

Write PR descriptions from the final diff. Lead with the concrete problem and
resulting behavior; include actual verification and material compatibility or
data effects. Do not invent passed checks, accepted decisions, issue closures,
or independent approval. Keep repository-specific vocabulary and attribution
requirements in the project profile rather than this shared policy.
