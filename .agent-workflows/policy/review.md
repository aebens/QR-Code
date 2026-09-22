# Review and orchestration

## Independent review

Assign one qualified independent reviewer for ordinary changes. Add specialists
when material correctness, architecture, accessibility, security, data integrity,
or delivery risks require them. Give reviewers the raw diff, requirements,
current head and base, and their lens without supplying expected findings.
Do not require a three-agent panel for every change.

Independence follows actual authorship, not model name or branch prefix. The
reviewer must not have written or materially designed the implementation being
reviewed and must not edit its branch. Merely reporting a defect does not make
a reviewer an author. The coordinator may assign a fresh qualified reviewer
without asking Ashley if existing participants authored the work. A reviewer
receives bounded review authority, not permission to broaden the queue or merge.
Keep the original session coordinator fixed. Only the current branch owner
edits and commits; stop that edit if ownership evidence conflicts.

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
   checks, discussion, draft state, and conflicts. Run independent review.
2. Consolidate evidence-backed findings and post one actionable checklist.
   Have the branch owner address blockers. Verify the exact staged checkpoint
   with the project validator before committing and pushing a cohesive revision.
3. Obtain independent confirmation of that checklist, the changed code and
   affected contracts, and new regressions. Use additional specialists only
   when risk warrants them. There is no fixed revision limit, but do not reopen
   resolved preferences or repeat an unchanged full review.
4. Give every finding a disposition. Do not let nonblocking improvements hold
   the queue. Park a PR with an unresolved blocker or unapproved reserved
   decision and continue independent items.
5. Immediately before merge, verify the current head/base pair, independent
   recommendation, all required checks and approvals, resolved blockers,
   dispositioned threads, non-draft status, and repository mergeability.
   A head change invalidates the old recommendation and requires review of the
   delta plus applicable verification; it does not automatically require a
   new full panel. A base change requires a refreshed integration assessment.
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
| Confirm | Independently verify accepted findings, the revision, and regressions; post consolidated confirmation. | Report the recommendation to Ashley; no editing, issue creation, review-state change, or merge. |
| Merge | Verify existing independent review and every current merge gate, merge the named eligible PRs, and perform explicitly authorized cleanup. | Report results to Ashley; do not fix, dispatch reviewers, or begin another assignment. |

A manual reviewer can perform proportionate analysis itself. Specialist agent
dispatch requires an explicit addition to that manual assignment. Missing
independence, evidence, or approval returns to Ashley rather than silently
switching modes.
