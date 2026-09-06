# Reeflect docs

TL;DR: what is **shipped** in the extension today. The multiplatform roadmap, the sync server, the crypto contract and the shared Rust core are designed and built outside this repo; this repo carries the extension's side of sync in [cloud-sync](features/cloud-sync.md).

## Shipped — the extension today

- [Architecture](architecture/architecture.md) — event-sourced aggregator, DNR blocking.
- [Tracking internals](appendix/tracking-internals-pre-interval.md) — range engine, flush cycle.
- [Interval storage](appendix/tracking-interval-storage-design.md) — the base data unit, and the store cloud sync replicates.
- [Enforcement](features/enforcement.md) — web-only limit blocking.
- [Cloud sync](features/cloud-sync.md) — opt-in, encrypted, recovery-phrase account; the Sync page and what the extension stores and sends.
- [Entity model](features/entity-model.md) — resource identity, entity and alias resolution, fan-out; the core implements its rule.
- Others: [guided tour](features/guided-tour.md), [subdomain tracking](features/subdomain-tracking.md), [timeline](appendix/timeline-deferred-improvements.md), [bucket→interval migration](appendix/tracking-bucket-to-interval-migration.md).

## Who owns what

One owning doc per fact; the others link and never restate. This is what stops drift.

| Topic | Owner |
|---|---|
| Shipped web-only blocking | [enforcement](features/enforcement.md) |
| The interval log | [interval-storage](appendix/tracking-interval-storage-design.md) |
| Resource identity, entity/alias resolution, fan-out | [entity-model](features/entity-model.md) |
| Sync as the extension does it: page states, row schema v2, what leaves the device | [cloud-sync](features/cloud-sync.md) |
| Sync protocol, crypto, core surface, roadmap, rationale | outside this repo |

## Doc conventions

- **Diagrams and tables carry the content.** Prose only where a diagram genuinely can't say it.
- **Rationale lives in a decisions log**, not inline. Specs say *what*; the log says *why*, with sources.
