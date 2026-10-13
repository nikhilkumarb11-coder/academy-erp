# Scripts (phase 7)

Node scripts that automate `docs/06-Tenant-Provisioning-Runbook.md`. They read `deploy/registry.json` (git-ignored).

| Script | Does |
|---|---|
| `new-tenant <slug> --preset <id>` | Creates `deploy/<slug>`, runs `clasp create` + `push` + `deploy`, writes `tenants/<slug>.json` from the template, and adds the tenant to the registry. Manual steps that remain: Script Properties, running `setupTenant()`, and seeding. |
| `deploy-all [--only <slug>]` | For each tenant: `clasp push`, then `clasp deploy -i <deploymentId>`, then `system.migrate`, then a `system.ping` smoke test. Deploys to `demo` first and stops on the first failure. |
| `health` | Pings every tenant and reports apiVersion, schemaVersion, last migration, and (phase 4+) open payment links and last reconciliation time. |
