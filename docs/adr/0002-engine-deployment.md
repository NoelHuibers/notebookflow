# ADR 0002 — Engine deployment experience

- **Status:** Accepted (2026-07-19) — decision for #21
- **Deciders:** @NoelHuibers

## Context

NotebookFlow's web app and Python execution engine deploy separately. The engine
already ships as a portable Docker image with a Fly.io configuration, but asking
every user to install a provider CLI, create an app, configure authentication and
CORS, provision storage, deploy, and paste the resulting URL into NotebookFlow is
not a one-click product experience.

Issue #21 asked whether NotebookFlow should offer a hosted engine, a provider
deploy button, or recipes for several hosts, and how an engine's shared secret
would reach the browser.

The architecture has changed since the issue was opened:

- The hosted web app now signs users in with BetterAuth and gives the engine a
  short-lived JWT. The engine verifies it against the web app's JWKS endpoint.
- The web app has an Engine URL override for advanced bring-your-own-engine use.
- The production container accepts `PORT`, supports WebSockets, and can use a
  persistent `NOTEBOOKFLOW_DATA_DIR`.
- A shared hosted engine is acceptable only for the trusted closed beta. ADR
  0001 still requires a safe runtime or per-user sandbox before arbitrary public
  users may execute code on NotebookFlow-operated infrastructure.

## Comparison

| Approach | User flow | Auth and secret handling | WebSockets and persistence | Operational fit | Decision |
|---|---|---|---|---|---|
| **NotebookFlow-hosted engine** | No deployment step; sign in and run | The web app mints short-lived JWTs; the engine verifies the web app's JWKS. No static secret is handed to the browser | Already supported by the current Fly service; durable uploads require `NOTEBOOKFLOW_DATA_DIR` on a persistent volume | Simplest product experience, but the shared executor remains limited to trusted beta users by ADR 0001 | **Chosen hosted default** |
| **Fly Launch** | Install/authenticate `flyctl`, create an app, set configuration and secrets, then `fly deploy` | Operator sets a Fly secret or configures JWKS; Fly's documented launch flow is CLI-based and does not complete cross-service credential setup | Current `fly.toml` supports HTTPS/WebSockets and scale-to-zero; a volume still needs explicit provisioning for durable uploads | Best current operator path because it already exists and is exercised, but it is not one click | **Keep as the primary self-host recipe** |
| **Render Blueprint button** | Browser-based review and deploy from `render.yaml` | Blueprints can generate a secret, but an engine-only button cannot securely deliver that value to a separately hosted NotebookFlow frontend | Web services support WebSockets; durable uploads require a persistent disk | Strong button experience, but secure frontend pairing and paid persistent storage remain separate concerns | Defer until there is a full-stack self-host template |
| **Railway template** | Browser-based template deployment with generated domain and variables | Template functions can generate secrets, but the same engine-only handoff problem remains | Public HTTP endpoints and attached volumes fit the engine | Good future template candidate, but adds a second provider-specific configuration surface to maintain | Defer until there is a full-stack self-host template |
| **Modal adapter** | Install/authenticate the Modal CLI and deploy Modal-specific Python code | Uses Modal secrets or proxy tokens rather than the existing container contract | ASGI apps support WebSockets and Modal Volumes provide persistence, but the application and storage semantics need an adapter | Useful later for isolated/serverless execution, not a drop-in deployment of the current Docker service | Reject for this issue |
| **NotebookFlow provisioning service** | A NotebookFlow button creates and manages infrastructure in the user's provider account | Requires provider OAuth, scoped infrastructure credentials, billing/lifecycle handling, secret exchange, and teardown | Provider-dependent | This is a separate control-plane product with substantial security and support obligations | Reject for the current stage |

## Decision

**Do not build an engine-only “Deploy” button.** It would stop halfway through the
actual setup: the user would still need to discover the generated URL, coordinate
CORS, connect the frontend, and transfer or configure authentication. Presenting
that as one click would hide the most security-sensitive part of the flow.

Use two explicit product paths:

1. **Hosted NotebookFlow:** the engine is part of the service. A signed-in trusted
   beta user does not deploy or configure it. BetterAuth JWT/JWKS authentication
   is the credential flow. Before public arbitrary-code execution, apply the
   isolation decision in ADR 0001.
2. **Self-hosted NotebookFlow:** the operator deploys the existing Docker image,
   with Fly.io as the maintained reference recipe. The operator owns the engine,
   frontend, CORS origin, persistent storage, and authentication configuration.
   Other container hosts remain compatible but are not maintained as separate
   one-click products.

A full-stack Render Blueprint or Railway template can be reconsidered when there
is demand for self-hosting the frontend and engine together. The template must
configure both services in one flow, use durable storage, and avoid copying a
secret through a URL or documentation step.

## Secret-token answer

There is no generated static secret in the hosted flow. The user's authenticated
web session produces a short-lived engine JWT, and the engine verifies it using
`NOTEBOOKFLOW_JWKS_URL` (plus issuer/audience checks in production).

For a full self-host deployment, the operator chooses one of two modes:

- Configure the engine against that deployment's web-app JWKS endpoint; or
- Generate a high-entropy value locally, store it as
  `NOTEBOOKFLOW_AUTH_TOKEN` in the engine's secret store, and provide the same
  value to the operator-built frontend as `VITE_NOTEBOOKFLOW_ENGINE_TOKEN`.

The token must not be put in a deploy-button query parameter, committed to the
repository, logged, or exposed by an onboarding endpoint. A provider-generated
secret that cannot be securely shared with the separate frontend does not solve
the end-to-end setup.

## Consequences

- Hosted users get the only genuine one-step experience: there is no deployment
  step.
- NotebookFlow maintains one production engine deployment path instead of
  several provider-specific templates.
- The existing Dockerfile remains portable to other container hosts without a
  support promise for each provider's template system.
- Bring-your-own-engine remains an advanced trust-boundary feature, not the
  default onboarding path.
- This decision does not claim that the current shared executor is safe for open
  public arbitrary-code execution; ADR 0001 continues to govern that boundary.

## Revisit when

- Users ask for a repeatable full-stack self-host installation, not only an
  engine container;
- The frontend and engine can be paired without manual secret copying;
- Persistent storage, upgrades, and deletion are represented in the same
  template; and
- NotebookFlow is prepared to test and support another provider continuously.

## References

- [Fly Launch: create an app](https://fly.io/docs/launch/create/)
- [Fly Launch: deploy an app](https://fly.io/docs/launch/deploy/)
- [Fly app secrets](https://fly.io/docs/apps/secrets/)
- [Render Deploy button](https://render.com/docs/deploy-to-render)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render WebSockets](https://render.com/docs/websocket)
- [Railway templates](https://docs.railway.com/templates/create)
- [Railway public networking](https://docs.railway.com/public-networking)
- [Modal Web Functions](https://modal.com/docs/guide/webhooks)
- [Modal Volumes](https://modal.com/docs/guide/volumes)
- ADR 0001 — Multi-tenant execution isolation
- #10 — Engine authentication
- #21 — Engine deployment as a one-click flow
