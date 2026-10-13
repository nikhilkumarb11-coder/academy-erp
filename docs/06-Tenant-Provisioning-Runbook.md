# Tenant Provisioning Runbook

Target: a new academy live in **under 2 hours**, with **no code changes**.
Phase 0 covers the manual steps below. Phase 7 automates steps 3–7 with `scripts/new-tenant`.

## Prerequisites (once, on your machine)
- Node.js LTS and `npm i -g @google/clasp` (v3+).
- Enable the Apps Script API at https://script.google.com/home/usersettings for **each** tenant Google account.

## Steps

### 1. Collect from the institution (see `07-Owner-Inputs-Checklist.md`)
Name, logo, colours, label preferences, preset type, courses and fees, fee plans, Razorpay keys, and the WhatsApp template wording.

### 2. Create the tenant Google account
- Use a dedicated account such as `<slug>.erp@gmail.com`, or a Workspace user for higher quotas.
- Store the credentials in your password manager.
- Add the owner's personal Google account as a viewer on the Drive folder created below (transparency and data ownership).

### 3. Create the spreadsheet and Drive folders (signed in as the tenant account)
- Drive folder `Academy ERP – <Name>` with subfolders `Receipts` and `Backups`.
- A blank Google Sheet named `<Name> – Data` inside it. Copy its ID from the URL.

### 4. Create the Apps Script project
Run these from the **repository root**. clasp 3.4+ refuses a `rootDir` outside the folder that holds the project file, so each tenant's project file lives at the root as `.clasp.<slug>.json` (git-ignored):
```bash
clasp login --user <slug>              # signs in as the tenant account, stored under that name
clasp --user <slug> create --type standalone --title "<Name> ERP API" --rootDir backend
mv .clasp.json .clasp.<slug>.json      # PowerShell: Rename-Item .clasp.json .clasp.<slug>.json
```
Keep a copy of the `scriptId` in your tenant registry.
`clasp create` **overwrites** `backend/appsscript.json` with Google's default (New York timezone, no web-app block). Restore it with `git checkout backend/appsscript.json` before pushing.
All later commands take `--user <slug> -P .clasp.<slug>.json`.

### 5. Push the code and set Script Properties
```bash
clasp --user <slug> -P .clasp.<slug>.json push --force
```
In the Apps Script editor, open Project Settings → Script Properties and add:

| Property | Value |
|---|---|
| `SPREADSHEET_ID` | from step 3 |
| `INITIAL_PASSWORD` | a strong temporary password (deleted automatically) |
| `RECEIPTS_FOLDER_ID` | from step 3 (phase 3) |
| `BACKUP_FOLDER_ID` | optional: the `Backups` folder from step 3. If blank, the first backup creates "<Academy> - Backups" and saves its ID here. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | the tenant's keys (phase 4) |
| `FORWARD_TOKEN` | a random 40+ character string, the same as the Worker secret (phase 4) |

### 6. Run setup
In the editor, run `setupTenant()` and approve the permission prompt. Check the log: every tab should be created, `schema_version` should be 1, and settings should be added.

### 7. Deploy the web app (first time only)
```bash
clasp --user <slug> -P .clasp.<slug>.json deploy --description "v1"
```
- Record the **deployment ID**. The API URL is `https://script.google.com/macros/s/<deploymentId>/exec`.
- **For later updates, always use** `clasp --user <slug> -P .clasp.<slug>.json deploy -i <deploymentId> -d "vX"` so the URL never changes.

### 8. Tenant config and seed
- Copy `tenants/_template.json` to `tenants/<slug>.json` and fill in the branding, labels, preset and `apiUrl`.
- Log in to the app, then run `system.seed` with the chosen preset (the onboarding screen does this from phase 7).
- Enter the course fees in the Course master.

### 9. Payment webhook (phase 4)
- Worker: add the tenant to `TENANTS` in `worker/wrangler.toml`, then run `wrangler secret put RZP_WEBHOOK_SECRET_<SLUG>` and `FORWARD_TOKEN_<SLUG>`, then deploy.
- Razorpay dashboard → Webhooks: URL `https://<worker-domain>/rzp/<slug>`, events `payment_link.paid` and `payment.captured`, and the same secret.

### 10. Verify
- `system.ping` returns the expected `apiVersion`.
- Log in on a phone and a desktop.
- Create a test admission, record a cash payment, and confirm a receipt is produced.
- (Phase 4+) Make a Rs 1 test payment link and confirm the due auto-updates and a notification appears.
- Hand over the password and ask the owner to change it.

## Tenant registry
Keep `deploy/registry.json` out of git (it holds IDs, not secrets, but treat it as private):
```json
{ "rays": { "account": "rays.erp@gmail.com", "scriptId": "...", "deploymentId": "...", "spreadsheetId": "..." } }
```
`deploy-all` (phase 7) loops over this file.
