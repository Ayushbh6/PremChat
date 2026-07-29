---
socrates_doc: repo_rules
schema_version: 1
owner_tool: edit
scope: workspace
index_tags: [repo_docs]
---

# Repo Rules

This file records durable engineering rules for this workspace. Keep it short, current, and practical.

<!-- socrates:section id="hard_rules" kind="rules" tags="constraints" -->
## Hard Rules

- Prefer checked-in files and these repo docs over stale chat memory.
- Keep changes scoped to the user's request and the surrounding module boundary.
- Follow existing language, framework, naming, formatting, and test patterns.
- Preserve user work; do not revert unrelated changes.
- Verify meaningful changes with the narrowest reliable test or build command.
<!-- /socrates:section -->

<!-- socrates:section id="workflows" kind="workflow" tags="process" -->
## Workflows

- Read current files before editing them.
- Use targeted edits or structured patches for existing files.
- Use governed `read`/`search` on `socrates://project/memory` or `socrates://project/notes`, then edit one exact section URI for durable project state.
- Use governed `read`/`search` on `socrates://project/repo-docs`, then edit one exact file/section URI for durable repo doctrine.
- Do not claim success until the relevant command/tool confirms it.
<!-- /socrates:section -->

<!-- socrates:section id="verification" kind="verification" tags="tests" -->
## Verification

- Verify meaningful changes with the narrowest reliable test or build command.
- Record stable verification workflows here when they become repo-specific.
<!-- /socrates:section -->

<!-- socrates:section id="known_pitfalls" kind="pitfalls" tags="risk" -->
## Known Pitfalls

- Add recurring mistakes or sharp edges here after they are confirmed.
<!-- /socrates:section -->

<!-- socrates:section id="update_triggers" kind="rules" tags="maintenance" -->
## Update Triggers

- Update when a stable repo convention is discovered.
- Update when a recurring mistake needs a guardrail.
- Update when the preferred verification workflow changes.
<!-- /socrates:section -->
