@AGENTS.md
@docs/product-strategy.md
@LAUNCH_READINESS.md

Current state and remaining launch work: read docs/launch/master-checklist.md
("Verified state", "Launch blockers", "PRs") first, then docs/launch/handover.md.

LAUNCH MODE (owner's instruction, 8 Oct 2026): LAUNCH_READINESS.md is the launch
checklist. Don't add new features unless they're a genuine launch blocker
(security, legal compliance, payment or booking reliability, customer/host
safety) or the owner has explicitly asked for them. On 12 Oct the owner asked
for: admin AI listing creation and host/guest management, a login password
show/hide toggle, a customer email sender update, UI navigation fixes, host
calendar sync, guest verification fixes, search filters and Google Places
location search.

## Working rules (owner, permanent)

- **Build, Check, Fix, Continue.** Implement the task, run the relevant normal
  checks (unit tests, `npm run typecheck`, `npm run lint`, build where
  relevant, `npm run db:check-migrations` when migrations change), fix
  anything broken, then move to the next checklist item.
- **Verify enough to know it works**, no more: no repetitive audits, and don't
  recheck completed work without a reason.
- **Own the launch checklist.** Pick and implement the next actionable task
  without waiting for the owner to choose it.
- **Git, without asking:** commit, push the task's own branch and open a PR into
  `claude/airbnb-competitor-1fjjpk` when appropriate. Fix CI failures on that
  branch. Never ask the owner to do routine Git operations.
- **Keep it proportionate:** reuse existing architecture, keep each change
  focused. No over-engineering, oversimplifying, duplicate PRs, unnecessary
  abstractions or excessive reporting.
- **Never without the owner's explicit approval:** merge into
  `claude/airbnb-competitor-1fjjpk` (it deploys to Production), deploy to
  Production, change live settings or credentials, run the Production database
  migration workflow, or start a real-money transaction.
- **Legal identity:** the business structure isn't final. Never publish
  placeholder or invented legal details (entity, address, company number).
  PR #7 (refuse live payments without trader identity) stays unmerged until
  the owner confirms the entity.
- **New migrations:** add them to `prisma/migration-manifest.json` with
  `npm run db:manifest` in the same commit (CI checks it).
- **Interrupt the owner only** for a genuine business or legal decision, a
  required credential or permission, or a material risk that can't be
  resolved safely without them.
- **Progress updates:** brief, plain English, phone-friendly: what was built,
  whether the normal checks passed, and any genuine blocker.
