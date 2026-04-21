---
description: Regenerate docs/ARCHITECTURE.md and docs/DATA_MODELS.md from the current codebase, bumping the version.
---

Regenerate the documentation in `docs/` so it reflects the current state of the codebase.

## Files to regenerate

1. `docs/ARCHITECTURE.md` — system diagram (Mermaid), runtime sequence diagrams, consolidation opportunities.
2. `docs/DATA_MODELS.md` — UML class diagrams for every JSON document in `output/` plus `lenses.json` and the dashboard's `DashboardData`.

## Steps

1. **Read the current docs** to capture the existing `Version:` header from each file.
2. **Re-survey the codebase** — don't trust the previous version. Check:
   - `src/*.ts` — look for new pipeline scripts, renamed functions, or deleted files.
   - `package.json` scripts — any new entry points.
   - `dashboard/src/types.ts` — the canonical TypeScript shapes.
   - `dashboard/src/hooks/useDashboardData.ts` — which output files the UI reads.
   - `output/` — which JSON files actually exist on disk.
   - `lenses.json` — check for new fields on `Lens` / sub-objects.
3. **Compare** what you find against the existing docs. If nothing material changed, tell the user and stop — do not bump the version for a no-op.
4. **Bump the version** using semver:
   - **Major** (x.0.0) — a top-level section was added or removed, or a data model was restructured in a breaking way.
   - **Minor** (x.y.0) — a new enrichment pipeline, new JSON file, new interface, or new subsection.
   - **Patch** (x.y.z) — field additions, typo fixes, diagram label changes, refined wording.
5. **Update both files' version headers** with the new version and today's date. Format:

   ```markdown
   > **Version:** X.Y.Z &middot; **Generated:** YYYY-MM-DD
   > Regenerate via `/regenerate-docs` (see `.claude/commands/regenerate-docs.md`).
   ```

6. **Append a one-line changelog entry** at the bottom of each updated file under a `## Changelog` heading (create the heading if missing). Format:

   ```markdown
   - **X.Y.Z** (YYYY-MM-DD) — short summary of what changed.
   ```

7. **Report** to the user: version before → after, and a 1–3 bullet summary of what changed in the codebase that drove the bump.

## Rules

- Always regenerate *both* files together, even if only one changed, so their version headers stay in lockstep.
- Keep Mermaid diagrams syntactically valid — test-render them mentally before writing.
- Do not invent pipelines, files, or fields that aren't in the code. If something is speculative (e.g., a planned but not-yet-built feature), omit it.
- Consolidation opportunities in `ARCHITECTURE.md` should be re-evaluated: if a duplication has since been fixed, remove it from the list.
