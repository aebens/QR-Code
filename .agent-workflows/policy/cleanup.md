# Cleanup after verified merge

Ashley's authorization to merge a PR includes safe cleanup of its completed
branch by default, unless Ashley explicitly excludes cleanup. Do not ask for a
second cleanup permission or require a special sentence in a queue kickoff.
This standing instruction applies across adopted repositories. It does not
authorize merging an unapproved PR. Review-only and drafting assignments still
stop at their assigned stage.

Routine cleanup covers the merged PR and its completed task workspace. A sweep
of historical branches requires an assignment to clean those repositories;
when Ashley gives that assignment, apply the same evidence checks to every
candidate without requesting permission for each branch.

Record the repository, branch, inspected head, merge target, verified merge
result, and cleanup outcome. Preserve default and protected branches, active
work, open PR dependencies, and tips that change during inspection. A missing
branch is already complete. Retain a branch when a required condition is uncertain
or unverifiable. Cleanup must not run tests, CI, or deployments.

## GitHub branch

GitHub's automatic deletion of merged PR head branches is the normal repository
setting when Ashley authorizes its installation. Preserve branch protection
and repository rules. Treat an automatically removed head as complete; do not
recreate it just to run cleanup. Enabling the setting requires repository
configuration authority and does not follow from a single PR review request.

For a surviving remote branch, verify that the PR is merged, its head repository
is the authorized aebens repository, its tip still matches the recorded merged
head, and no open PR or active task needs it as head or base. Check current branch
protection and rulesets. Delete with an explicit expected-SHA lease and delete
refspec. A concurrent update must reject deletion. This narrow lease permits
deletion only, never force-pushing replacement content or rewriting history.
Do not use bundled merge-command deletion such as gh pr merge --delete-branch;
it bypasses the separate ownership checks and expected-SHA lease.

## Local branch and completed worktree

Resolve the exact clone and inspect every linked worktree. Require clear task
ownership, a matching branch tip, and ancestry in the fetched merge target.
Fetch without pruning before applying local deletion. Recheck ownership,
worktree occupancy, and the exact tip immediately before ordinary git branch -d.
Use Git's non-force deletion safeguard; retain and report any refusal. Do not
use branch -D or direct ref deletion. Squash and rebase merges without ancestry
proof remain retained. A final tip check and Git's ancestry checks are normal
cleanup safeguards; git branch -d does not provide an atomic expected-SHA lease.
Do not invent a universal exclusive-writer-lock requirement that disables all
local cleanup.

A checked-out branch cannot be deleted while its worktree exists. Once the task
has completed, a clean, inactive linked worktree may be removed as part of merge
cleanup, followed by ordinary local branch deletion. Verify that no active or
unverifiable agent, terminal, task, PR dependency, unsaved change, untracked user
file, or ignored user data needs the workspace. A completed card alone is not
proof. Recognized generated dependencies or test/build output are disposable;
unknown ignored files, local settings, credentials, and user data are preserved.
Inspect ignored paths explicitly with git status --porcelain --ignored or an
equivalent inventory. Non-force worktree removal can still delete ignored files,
so retain the workspace if any ignored path is not a recognized generated artifact.

Use Orca's supported worktree removal for Orca-managed workspaces. Verify the
resolved absolute path is the exact intended linked worktree inside its managed
workspace before removal. Never remove the main checkout, force removal of a
dirty worktree, stop another active session, or switch or detach another task's checkout to
make deletion possible. If the coordinator or an owner is still using that
worktree, finish and release the task before removing it, or report it retained.
The shared branch helper reports checked-out branches as retained; the
orchestrator owns the separate completed-worktree check and removal.

## Results

Report remote branch, local branch, and worktree outcomes separately as deleted,
already absent, or retained with a concrete reason. Failure to clean up does not
undo a successful merge or block independent work. Repeat current safety checks
before a retry. Never claim that configured automation deleted existing branches
or that a retained local branch was cleaned up.
