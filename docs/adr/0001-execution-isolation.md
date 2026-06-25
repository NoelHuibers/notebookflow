# ADR 0001 — Multi-tenant execution isolation

- **Status:** Accepted (2026-06-26) — decision for #55
- **Deciders:** @NoelHuibers

## Context

The engine runs untrusted user Python with `exec(source, namespace)` in the
**shared FastAPI server process** (`engine/notebookflow/core/executor.py`),
deployed as a **single Fly.io instance**. That is fine for single-tenant / local
/ trusted use, but for **open public multi-tenant** signups it is
remote-code-execution-as-a-service: any user could read the server filesystem,
reach the network, exfiltrate other tenants' data, or attack the host. The BYOK
data work (#59/#60/#70/#61/#62) isolates *data* between tenants; it does **not**
sandbox *code*.

Threat model that matters: **anonymous sign-ups running arbitrary Python on
infrastructure we operate.** That threat **does not exist for a closed, trusted
group** — if everyone with access is someone we trust, running their code on a
shared box is acceptable (same as a shared internal tool).

Product shape that makes this cheap to defer:
- The web app already supports **bring-your-own-engine** (Settings "Engine URL
  override" + `VITE_NOTEBOOKFLOW_ENGINE_URL` + engine auth) — a user can point at
  their own engine, moving untrusted execution onto *their* infra and *their*
  trust boundary, exactly like BYO-key.
- Execution is **multi-surface**: the untrusted-shared-server problem only exists
  for the hosted web tier; VS Code / JupyterLab run locally and are trusted.

## Options considered

| Dimension | A. Pyodide (in-browser) | B. Per-user server sandbox | C. Kernel-per-user |
|---|---|---|---|
| **Isolation** | Strongest in practice — nothing of ours runs the code; per-user by construction | Strong (gVisor/Firecracker ≈ VM); plain Docker weaker | **Insufficient alone** — a bare kernel owns the host; only safe if each kernel is *also* sandboxed (→ B) |
| **Libraries** | Pyodide set + pure-Python (numpy/pandas/matplotlib/scikit ✓; arbitrary C-ext ✗) | **Full** | Full |
| **Ops cost** | Lowest (no exec infra) | **Highest** (sandbox fleet) or managed-service spend | Medium, and doesn't solve security |
| **Compute cost** | Client (~$0 for us) | Server (we pay per run) | Server |
| **Fit to code** | Large rewrite (exec → browser) | Smallest logic change, most infra | Moderate |

## Decision

**For now: do nothing to the runtime. Keep the single shared Fly engine and the
`exec()` model, and keep the hosted product CLOSED to a trusted group of beta
testers.** The untrusted-multi-tenant threat is removed by *access control*, not
by sandboxing — so no sandbox fleet to build, operate, or pay for during the beta.

**When we open to the public, adopt a tiered model (separate PRDs, not now):**
1. **Bring-your-own-engine** — power users / arbitrary-library / heavy / sensitive
   workloads run on their own engine. Their infra, their trust boundary. ~90%
   already built; just needs UX polish.
2. **Safe hosted default** — for casual hosted users, either **Pyodide** (Option
   A; no server exec) or simply keep the hosted engine **trust-gated** longer.
3. **Managed sandbox (Option B)** — the escape hatch for *open public users
   running anything on our compute*. Reach for it only when that's the goal.

**Rejected:** Option C standalone (process-per-tenant is isolation theatre for
untrusted code). Building Option A or B *now* (premature — a closed beta doesn't
need it, and it's the most expensive work in the roadmap).

## Consequences — "closed beta" is only real once BOTH gates are set

Today the hosted surface is effectively **open**, on two fronts. Both must be
closed before the URL is shared beyond people we trust:

1. **Engine auth (security-critical, currently OFF).** The Fly engine
   (`notebookflow-engine.fly.dev`) has no auth configured yet, so anyone who
   knows the URL can `POST /pipelines/{id}/run` and exec code directly —
   bypassing the web app entirely. **Fix:** set the engine to verify JWTs:
   `fly secrets set NOTEBOOKFLOW_JWKS_URL=https://notebookflow.vercel.app/api/auth/jwks -a notebookflow-engine`
   (and/or a static `NOTEBOOKFLOW_AUTH_TOKEN`). After this, only valid sessions
   from our web app can run code.
2. **Sign-in allowlist (currently OPEN).** GitHub/Google sign-in accepts *anyone*,
   and a signed-in user gets a JWT the engine will trust. **Fix:** add an
   allowlist gate in BetterAuth (reject sign-in / sign-up for emails not on a
   beta allowlist) so only approved testers get a session.

Until #1 and #2 are both in place, "closed beta" is aspirational, not actual.

Other consequences:
- `exec()` stays as the runtime for self-host / local / the beta hosted engine.
- The eventual public launch carries real work (BYO-engine polish; Pyodide; or a
  managed-sandbox tier) — scoped when public scale justifies it, not before.

## Reference — how Option B would work (the future escape hatch)

The engine becomes a **controller**: per run it creates a **fresh, ephemeral
sandbox** (CPU/mem/time limits, no network except the AI provider, wiped on
teardown), ships in the code + data, runs it, streams results out, destroys it.

Sandbox layer choices, easiest → most control:
- **Managed:** **E2B** (Firecracker microVMs built for "run untrusted/AI-generated
  code") or **Modal** (serverless gVisor containers) — call an SDK, build almost
  no infra. *Recommended starting point if we ever do B.*
- **Fly Machines** (we're already on Fly) — programmatic create/destroy of
  Firecracker VMs from our engine image; one vendor, more control, we build the
  lifecycle (+ a warm pool to hide cold starts).
- **Self-hosted** gVisor / Firecracker / nsjail+seccomp — cheapest at scale,
  operates security-critical infra ourselves; not advisable for a small team.

What B requires regardless of provider: controller/runner engine split; per-run
sandbox lifecycle (+ warm pool); per-user quotas/rate-limits/kill-switches;
egress locked to the AI provider; BYOK key injected per-run (never baked in);
and **cost accounting** — per-second compute means hard usage caps or a paid tier.

## Follow-up scope

- **Now (to make the beta actually closed):** engine auth on Fly (#1 above) +
  a sign-in allowlist (small BetterAuth gate) (#2 above).
- **Before public:** bring-your-own-engine UX polish (engine picker / "connect
  your engine" / health + version check).
- **For open casual hosted use:** Pyodide runtime PRD (Option A).
- **For open arbitrary compute on our infra:** managed-sandbox tier PRD (Option B).

## Links

- PRD #53 — Multi-tenant, bring-your-own-key NotebookFlow
- #55 — this decision
- #9 — KernelBridge (trusted-local kernel path, distinct from hosted)
