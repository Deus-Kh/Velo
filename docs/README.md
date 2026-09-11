# Velo documentation

Start here. Everything is Markdown; links are relative to this folder.

| Document | What it is | Status |
|---|---|---|
| [PROJECT_ROADMAP.md](PROJECT_ROADMAP.md) | Master roadmap v2 (2026-09-07): verified inventory, parity matrices, defect register, 26-week plan, decisions | **Current** |
| [AGENT_EXECUTION_SPEC.md](AGENT_EXECUTION_SPEC.md) | Task-level execution spec v2 for an implementing agent: rules, tasks T1.0–T4.11, normative ratchet algorithm, wire formats, deviations | **Current** |
| [AUDIT_2026-09-07.md](AUDIT_2026-09-07.md) | Verified audit with file:line evidence for every defect the roadmap cites | **Current** |
| [protocol/ROADMAP.md](protocol/ROADMAP.md) | Original protocol design reference (2026-03). Its status section is superseded by the roadmap §1 | Reference |
| [protocol/SESSION_ESTABLISHMENT_POLICY.md](protocol/SESSION_ESTABLISHMENT_POLICY.md) | Session lifecycle rules. To be rewritten in T2.0 / T2.13 | Reference, stale after Phase 2 |
| [protocol/V2_STABILIZATION_CHECKLIST.md](protocol/V2_STABILIZATION_CHECKLIST.md) | Manual two-device acceptance suite (0/22 checked). Phase 2 gate | Active |
| [design/UI_INTERFACE_ROADMAP.md](design/UI_INTERFACE_ROADMAP.md) | Per-screen UI status and next steps | Reference |
| [design/UX.md](design/UX.md), [design/UserFlow.md](design/UserFlow.md), [design/UI_realization.md](design/UI_realization.md) | Interface design references (Russian) | Reference |
| [design/architecture.md](design/architecture.md) | Layer diagram; no longer matches the code. Rewrite in T4.11 | Stale |
| [archive/PROJECT_ROADMAP.v1.md](archive/PROJECT_ROADMAP.v1.md), [archive/AGENT_EXECUTION_SPEC.v1.md](archive/AGENT_EXECUTION_SPEC.v1.md) | Previous versions (2026-08-07), kept for the change narrative. Credential quotes redacted | Archive |
| [assets/](assets/) | Logo and screenshots | — |

## Folder layout

```
docs/
├── README.md                      this index
├── PROJECT_ROADMAP.md             v2 roadmap
├── AGENT_EXECUTION_SPEC.md        v2 execution spec
├── AUDIT_2026-09-07.md            evidence
├── protocol/                      protocol design, lifecycle policy, manual checklist
├── design/                        UI/UX references
├── archive/                       superseded roadmap and spec
└── assets/                        images
```

## Conventions

- Roadmap and spec are living documents. Close a P-number in the roadmap §3 **and** in the audit when a task lands; update the parity matrices at every phase gate.
- Never paste a secret into any document. The repository is public.
- Line numbers in the audit refer to commit `c9c9267`; re-verify before relying on them after refactors.
