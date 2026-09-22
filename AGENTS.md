# Repository workflow

Read `.agent-workflows/policy/core.md` and `.agent-workflows/profile.json` before work. Use the pinned `review.md` for reviews and queues, `implementation-handoff.md` for implementation handoffs, and `cost.md` for validation and deployment. Keep repository-specific requirements when applying the shared workflow.

Verify the pinned bundle with `node .agent-workflows/bin/workflow.mjs verify`. After reviewing and staging the approved file list, run `node .agent-workflows/bin/workflow.mjs validate` before committing. These local commands use the committed copy and do not require access to the private policy source.

Preserve the static page and the requirements in style-guide.md. Page changes need focused browser and accessibility verification.

The profile checks policy integrity only. It does not establish product behavior or content correctness; perform applicable review and focused verification for the actual change.
