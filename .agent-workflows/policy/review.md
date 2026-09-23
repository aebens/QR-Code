# Review and orchestration

## Independent review

Assign one qualified independent reviewer for ordinary changes. Add specialists
when material correctness, architecture, accessibility, security, data integrity,
or delivery risks require them. Give reviewers the raw diff, requirements,
current head and base, and their lens without supplying expected findings.
Do not require a three-agent panel for every change.

The orchestrator coordinates independent Codex and Claude sessions. For
Codex-owned work, the reviewer of record must be Claude. For Claude-owned work,
the reviewer of record must be Codex. Name that reviewer and its separate primary
session before review. The reviewer session must differ from the coordinator
session. An Orca-dispatched primary Claude or Codex session qualifies; a model's
internal subagent, panelist, background agent, or renamed role does not.

Supporting subagents may investigate or test within their assigned scope, but
their reports cannot replace the reviewer of record, supply its confirmation,
or satisfy the merge gate. The designated reviewer must perform and own the
review and issue its own recommendation. The coordinator routes findings to the
branch owner, obtains fixes and verification, and waits for that recommendation.

The reviewer must not have written or materially designed any implementation
it approves, including shared code in its review scope, and must not edit the
branch. Changing model families alone does not resolve an authorship conflict.
Merely reporting a defect does not make a reviewer an author. If both families
contributed, appoint a fresh primary session of the family opposite the branch
owner with no authorship of the reviewed implementation. Record the scope of
reused source reviews separately from repository adoption reviews; do not claim
an adoption check independently reviewed every bundled implementation file.

In an authorized orchestrated queue, the coordinator may appoint or launch the
eligible primary session without another routine permission request. If none is
available or authorship is uncertain, park that PR and continue independent
items. Never substitute its own subagents. Manual assignments return the missing
review to Ashley and stop. Keep the original coordinator and branch owner fixed.

## Recorded confirmation before merge

Both orchestrated and manual merge stages require a reviewer-authored record
identifying the repository, PR, fixed policy revision, branch-owner family,
coordinator session, contributing sessions, and reviewer family and primary
session. The reviewer declares that it did not author the implementation and
records its recommendation against the exact head and base commits. Include a
link to that reviewer's consolidated PR review or comment and its actual Orca
dispatch or Ashley's manual relay reference. A coordinator summary or an
implementation owner's test report is not the reviewer's confirmation.

When recommending merge, the reviewer writes the full record described in the
README and runs `node .agent-workflows/bin/workflow.mjs review-digest --record
<record.json>`. The reviewer posts both the full JSON record in a fenced block
and the exact generated marker on a separate line in its own consolidated PR
confirmation. After posting, it adds the permalink to `evidence.reviewUrl` and
supplies the record and link to the coordinator, or to Ashley for a manual relay.
Only that permalink is excluded from the digest, so the next stage can recover
the exact record from the post and add its URL without changing the marker.

Run `node .agent-workflows/bin/workflow.mjs review-check --record <record.json> --policy-revision <session-approved-full-SHA>`
immediately before merging. It rejects subagents, the wrong reviewer family,
coordinator or contributor self-review, absent evidence, and stale revisions
using the current GitHub PR head and base. Independently inspect the recorded
session provenance and PR evidence: the helper checks declared evidence and
live PR state; it does not authenticate which model operated an account or
establish the truth of authorship declarations. GitHub checks and shared account
names alone do not prove reviewer independence. Do not bypass a rejected or
unverifiable record with an ad hoc merge command.

Pass the fixed governing session pin explicitly in every repository. A policy
adoption does not replace that pin with the incoming profile revision. Use a
reviewed source/runtime helper and `--cwd <adopting-repository>` during adoption;
do not trust a modified helper in the PR being reviewed. Verify the approved
policy content separately. Store reviewer records outside the reviewed checkout.

Refresh recorded confirmation after any head or base change, including an
unrelated base advance. The reviewer may assess only the relevant delta and
integration effects when sufficient; a full review need not repeat. Each merge
advances the base of other queued PRs targeting that branch and therefore costs
a fresh bounded reviewer confirmation. Schedule it when each PR reaches merge
to avoid repeatedly confirming the whole queue. A prior record is not
transferable to a new revision. Review-rule changes themselves
follow the existing session policy plus Ashley's explicit approved amendment;
this file cannot authorize its own change or review.

## Findings and bug logging

Separate a finding's urgency from its type. Blockers include defects, unmet
acceptance criteria, missing evidence, failed required checks, merge conflicts,
and unresolved high-cost decisions. Fix PR-caused blockers in the current PR;
never relabel them as follow-up work to obtain a merge.

Automatic issue logging is for verified bugs only. A bug is demonstrated
behavior that violates an established requirement or supported contract,
including accessibility, security, privacy, and data integrity. A concrete
incorrect operational instruction can be a bug. Preferences, speculative risks,
refactors, enhancements, generic coverage gaps, and reversible design choices
do not qualify merely because a reviewer noticed them. Record their disposition
or decision in the PR instead. Explicit user requests can authorize other work.

Before logging a bug, search open and closed issues for the same failure and
completion condition. Reuse a matching open issue. Reopen a matching closed
issue only when the same defect remains or has returned and the assignment
authorizes reopening; otherwise report the needed action. A distinct regression
may warrant a linked issue explaining the distinction. Include evidence,
affected behavior, reproduction, and a concrete completion condition. Use live
labels and milestones only; classification uncertainty does not justify a
duplicate or block an otherwise eligible merge. Never create a tracking issue
solely for the queue or a review preference.

Nonblocking bugs may be logged within an authorized queue. Review requests
alone do not authorize issue creation. Every finding needs a durable disposition:
fixed, linked bug, accepted nonbug suggestion, or declined with rationale. Do
not require an issue for every review thread. Resolve only threads the acting
reviewer owns, unless Ashley separately authorizes more; never dismiss another
reviewer's objection by inference.

## Orchestrated queue

A direct kickoff naming the PRs authorizes the stated continuous sequence:
inspect, review, post findings, coordinate in-scope fixes, commit, push, confirm,
change review state, log deduplicated bugs, and merge eligible PRs. Use the
current Orca orchestration guide and real runtime when the kickoff requests
Orca. Do not substitute terminal text or an unrelated agent system for its
coordination state. A fresh worker can join the existing bounded session;
moving coordination to a replacement conversation needs a fresh kickoff.

For each PR:

1. Refresh its owner, full diff, requirements, dependencies, exact head/base,
   checks, discussion, draft state, and conflicts. Assign the eligible separate
   opposite-family primary reviewer and obtain its independent review.
2. Consolidate evidence-backed findings and post one actionable checklist.
   Have the branch owner address blockers. Verify the exact staged checkpoint
   with the project validator before committing and pushing a cohesive revision.
3. Obtain the reviewer of record's independent confirmation of that checklist, the changed code and
   affected contracts, and new regressions. Use additional specialists only
   when risk warrants them. There is no fixed revision limit, but do not reopen
   resolved preferences or repeat an unchanged full review.
4. Give every finding a disposition. Do not let nonblocking improvements hold
   the queue. Park a PR with an unresolved blocker or unapproved reserved
   decision and continue independent items.
5. Immediately before merge, verify the current head/base pair, the eligible
   reviewer's own recorded recommendation and passing review-check, all required checks and approvals, resolved blockers,
   dispositioned threads, non-draft status, and repository mergeability.
   A head change invalidates the old recommendation and requires review of the
   delta plus applicable verification; it does not automatically require a
   new full panel. Any base change requires the reviewer's refreshed integration
   assessment and a new recorded confirmation, even if the changes are unrelated.
   Reuse evidence only when the validated state and project policy permit it.
6. Merge using an atomic expected-head guard and the repository's permitted
   merge strategy. Never bypass a required gate. Verify the result, perform
   authorized [cleanup](cleanup.md), and continue without a per-PR permission
   question. Report merged, parked, remaining, and cleanup outcomes at handback.

## Manual stages

Ashley personally relays each stage. Stop after the assigned stage; do not
dispatch another agent, contact the author to start work, or start the next
stage automatically.

| Stage | Authorized work | Stop point |
| --- | --- | --- |
| Review | Inspect independently and post consolidated findings to the named PRs. | Report findings to Ashley; no edits, commits, pushes, issue creation, review-state change, or merge. |
| Fix | The branch owner fixes the supplied accepted findings, validates, commits, and pushes to the named existing PRs. | Report the revision to Ashley; do not appoint a reviewer, post review findings, approve, or merge. |
| Confirm | Independently verify accepted findings, the revision, and regressions; post consolidated confirmation. For a merge recommendation, include the full reviewer record and review-digest marker as specified above. | Give Ashley the record, permalink, and recommendation for her relay; no tracked-file editing, issue creation, review-state change, or merge. |
| Merge | Verify existing independent review and every current merge gate, merge the named eligible PRs, and perform default safe post-merge cleanup. | Report results to Ashley; do not fix, dispatch reviewers, or begin another assignment. |

A manual reviewer can perform proportionate analysis itself. Specialist agent
dispatch requires an explicit addition to that manual assignment. Missing
independence, evidence, or approval returns to Ashley rather than silently
switching modes.
