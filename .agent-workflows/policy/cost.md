# Validation and delivery cost

Use the repository profile's validation commands and existing quality floors.
Do not replace authoritative required checks with an agent's assurance. Run
the shared validator directly against the exact staged checkpoint, with the
profile and policy revision recorded. Invalidate evidence when the staged
content, governing inputs, or required environment changes. Preserve unrelated
working-tree edits and never stage them to simplify validation.

Codex must use direct validation, not a project commit hook. Remove only the
workflow-owned legacy Codex commit hook during adoption and preserve unrelated
hooks. Do not claim a Codex hook ran or introduce a wrapper workaround. Claude
may use its adapter only after a live canary proves enforcement in that exact
environment; otherwise use direct validation. A passing hook or local check
does not replace CI.

## Avoid duplicate work

Keep commits cohesive, batch one accepted revision into a reviewable push, and
cancel superseded runs. Retest affected contracts after changes. Broaden checks
when required by the profile or new evidence, not merely because another
review round started. Do not push incomplete checkpoints just to use CI as a
development loop. Never skip required checks through commit messages or bypass
repository protection to save money.

CI classification must be conservative and visible. Required aggregate gates
must always report and must reject failed classification, missing results,
cancellation, and unexpectedly skipped suites. Permit an intentional skip only
when the complete change set proves that suite unnecessary. Unknown paths or
incomplete comparisons require full coverage. Test the classifier and its
failure paths before adopting it.

Domain and store changes can affect rendering, validation, persistence, and
export; their directory names do not justify skipping all browser tests.
Documentation may also be an executable test input. Preserve a project's
platform-specific screenshot authority. Separate cheaper behavioral tests only
after validating equivalent coverage. Measure total billed runner time and
repeated setup, not just elapsed completion time, before changing shard counts.

Do not replace post-merge full checks with smoke checks unless current combined
PR/base coverage, protected integration, and an automatic full-check fallback
for unverified changes establish equivalent assurance. Keep project floors
until Ashley approves the specific CI-policy change.

## Deployment

Where Vercel is configured, keep the profile's production branch deployment automatic and
create branch previews only when requested. Queue authority does not authorize
changing Vercel or repository settings. An expressly approved adoption change
may implement that deployment policy. A requested preview does not authorize
an additional production release. Reuse the requested preview until a relevant
revision requires rebuilding it.
