# Cleanup after verified merge

Cleanup must be expressly included in the queue kickoff or manual merge-stage
assignment. It covers only branches for named PRs whose merges were verified.
Do not sweep historical branches or change automatic-deletion settings. Prefer
coordinator-controlled cleanup so all safety checks precede deletion.

Record the PR's repository, head repository, branch name, reviewed head commit,
merge target, and verified merge result before cleanup. Preserve a branch when
any condition is uncertain. Check current repository protection and rulesets,
not only its default branch name.

## GitHub branch

Immediately before deletion, verify that the PR is merged, the head repository
is the authorized `aebens` repository, and the remote branch still points to
the recorded merged head. Preserve default or protected branches, branches
with advanced tips, branches used as the head or base of another open PR, and
branches required by queued work or an active owner.

Delete only the exact head ref with an explicit expected-SHA lease. A narrowly
scoped `--force-with-lease=refs/heads/<branch>:<recorded-head>` combined with a
delete refspec is permitted for this deletion only. It does not authorize
force-pushing replacement content, rewriting history, broad pruning, or other
force operations. A concurrent update must make deletion fail. Do not use a
merge command's bundled branch-deletion option, which bypasses this separate
inspection. Already absent means cleanup is complete.

## Local branch

Resolve the exact repository and inspect all its linked worktrees. Preserve a
branch checked out anywhere, owned by active work, needed by another open PR
or queued dependency, protected, or different from the recorded merged head.
Fetch the merge target without pruning. Require the local branch tip to match
the recorded head and be an ancestor of the fetched merge target.

Recheck ownership, worktree use, and the tip immediately before deletion. Use
only non-force `git branch -d`; do not bypass Git's safeguards with `-D` or
direct ref deletion. If safe exclusive coordination cannot be established,
retain the branch. Squash and rebase merges can fail ancestry checks: retain
and report those branches rather than force-delete them. Never switch another
worktree, detach its branch, remove a worktree, or delete its files to enable
cleanup.

The current shared helper cannot establish enforceable exclusive coordination,
so it reports existing local branches as retained. An ownership manifest alone
does not establish a writer lock. Do not bypass that result with a separate
deletion command. Remote cleanup can still proceed with its exact-SHA lease.

## Results

Report remote and local outcomes separately as deleted, already absent, or
retained with the reason. Failure to clean up does not undo a successful merge
or block independent queue items. Before retrying, repeat every safety check;
old approval evidence does not prove that a branch still has the same tip.
