# Documentation Style Guide

## Scope

This guide defines how documentation is organized in this repository after the `doc/` + `docs/` consolidation.

## Single Source Of Truth

- Keep technical documents under `docs/` only.
- Do not add new files under `doc/`.
- Use `docs/README.md` as the global navigation entry.

## Directory Responsibilities

- `docs/00-overview/`: index, conventions, migration notes
- `docs/10-architecture/`: architecture and design
- `docs/20-roadmap/`: plans and roadmap
- `docs/30-phases/`: phase implementation records
- `docs/40-testing/`: test plans and test reports
- `docs/50-bugfix/`: bugfix analysis and postmortems
- `docs/60-analysis/`: deep-dive technical analysis
- `docs/99-archive/`: archived or replaced documents

## Naming Rules

- Use English `kebab-case` file names.
- Keep file names semantic and stable (avoid `-updated`, `-new`, `-final`).
- Put Chinese explanation in Markdown title/content, not in file name.
- Prefer explicit prefixes by category:
  - `design-*` for architecture
  - `roadmap-*` for planning
  - `phase-*` for phase docs
  - `bugfix-*` for incident docs

## Phase Naming Rules

- Use `phase-XX-*` style:
  - Example: `phase-03-04-memory-system.md`
- Keep one overview file per phase:
  - Example: `phase-03-overview.md`
- Put test artifacts into `docs/40-testing/` instead of mixing into phase directory.

## Archive Rules

- When a document is replaced, move old file to `docs/99-archive/`.
- Add an archive note at top:
  - why archived
  - replacement file path
  - archive date

## Link Rules

- Use relative links for repo-local files.
- Update links immediately after each migration batch.
- Keep `docs/README.md` and sub-indexes updated in the same batch.

## Change Process

1. Update `doc-migration-map.md` status first.
2. Move/rename files in small batches by topic.
3. Repair links in the same batch.
4. Mark old files archived or delete after verification.
