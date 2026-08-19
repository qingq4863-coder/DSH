# Upstream absorption receipt

## Pinned source

- Repository: `https://github.com/mattpocock/skills`
- Ref: `main`
- Tree SHA observed: `9c9f36ccd3995266cd675468af71639c8dde1ec5`
- Retrieval: GitHub recursive tree API
- Receipt purpose: baseline for future `matt_upstream_sync_plan`; this is not a claim that moving `main` is permanently stable.

## Absorption status

### Absorbed as DSH-native toolkit

- diagnosis, tdd, review, research, disclosure
- acceptance contracts and wf plans
- route planning, executable calls, conditional routes, evidence mapping
- grilling, docs-backed grilling, wayfinder, wait-what
- domain modeling, codebase design, architecture survey
- conversation-to-spec, tracer-bullet tickets, writing-for-agents
- tracker-neutral triage
- bounded prototype planning
- merge-conflict planning

### Absorbed as host-safe integration plans

- upstream inventory and pinned absorption matrix
- upstream sync planning between pinned refs
- install/upgrade/rollback lifecycle planning
- external operation planning with authorization, idempotency, receipt, reread, and compensation gates

### Intentionally not executed by this toolkit

- direct GitHub/Linear or other tracker mutation
- direct git merge/rebase or conflict-file edits
- credentialed installation or external deployment
- automatic moving-branch synchronization
- direct message sending
- UI prototype generation/deployment

These remain explicit host operations requiring authorization, a preview, a real receipt, independent reread, and rollback or compensation evidence.

## Future update protocol

1. Pin current and candidate refs/tree SHAs.
2. Run `matt_upstream_inventory` for the candidate.
3. Run `matt_upstream_sync_plan` against this receipt.
4. Classify every changed path before editing.
5. Add tests and schema checks before build.
6. Build, reload, verify active fiber, and cold-start Web/headless.
7. Replace this receipt only after review and evidence.

## Evidence boundary

This document records source provenance and design status. It does not claim that external systems were modified or that a future upstream ref has been synchronized.
