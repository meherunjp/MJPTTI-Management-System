MJPTTI — Production V12 — Final Deep Audit Build
================================

This build keeps the existing MJPTTI UI, print documents and workflows, but adds a Cloudflare D1-backed shared application state and secure server authentication layer.

IMPORTANT
---------
The browser localStorage is now only a compatibility/cache layer. In production, D1 is the primary shared data source when the Cloudflare Functions and D1 binding are configured.

Cloudflare setup
----------------
1. Create a Cloudflare D1 database.
2. Bind it to the Pages/Workers project as: DB
3. Run db/schema.sql against the D1 database.
4. Configure these environment variables/secrets:
   - MJPTTI_AUTH_SECRET: a long random secret (at least 32 random characters)
   - MJPTTI_ADMIN_PASSWORD: required initial admin password; change it after first login
   - MJPTTI_INITIAL_TRAINER_PASSWORD: initial trainer password; change trainer credentials before production
   - MJPTTI_SYNC_KEY: existing QR verification sync secret
5. Deploy the ZIP contents as a Cloudflare Pages project with Functions enabled.

Initial login
-------------
MJPTTI_INITIAL_TRAINER_PASSWORD is required for automatic seed-trainer provisioning; there is no production fallback trainer password.
Both server-side passwords are required before production use. Never deploy with demo credentials.

What was fixed in v1
---------------------
- Shared D1-backed application state instead of browser-only primary storage.
- Secure HttpOnly/Secure/SameSite session cookie.
- PBKDF2 password hashing for admin/trainer/student credentials.
- Server-side role authentication.
- Role-filtered bootstrap: students only receive their own private records; trainers receive students in their assigned courses; admins receive the full state.
- Passwords are stripped before application state is returned from the server.
- Admin credential update uses a server-side hashed password.
- Server-side validation for negative payments, duplicate receipt numbers, unknown student references and total payment exceeding course fee.
- Student Archive workflow added without destroying historical records.
- Student verification function moved into the correct Cloudflare Pages Functions path, with a dedicated public verification-photo route.
- Student verification sync no longer stores base64/local image data in D1; only a real HTTP(S) photo URL is synchronized.
- D1 schema expanded with users, audit_logs, students and payments tables in addition to the central state table.

Migration / existing browser data
---------------------------------
Existing browser data is not automatically uploaded merely by opening the site. Before production, use the existing verification sync or an administrator migration process to move old records into the new D1 state. Administrator-controlled state migration can provision missing portal credentials; trainer state writes cannot provision arbitrary users.

Production status
-----------------
The major production hardening phases listed below are already included in V8/V9. The remaining requirement is live Cloudflare testing.
- D1 shared state + normalized students/payments tables.
- Atomic admission/payment/student/photo mutations with optimistic version checks.
- R2 student photos and public QR verification photo route.
- Server-side Drive/WhatsApp integrations.
- Server-side finance/training mutations and audit logging.
- Full D1 backup export and scheduled R2 backup.
- Secure student password reset.
- Archive/restore workflow; permanent delete is intentionally not enabled.

Existing UI/print design
------------------------
The current UI, branding, print documents, watermark, receipt, certificate, ID-card and Authorized footer design are preserved in this migration. Further visual changes should be made only after the data/security migration is stable.


PHASE 2 — ADMISSION & PAYMENT TRANSACTIONS
--------------------------------------------
New API endpoints:
- POST /api/admissions — creates Student + initial Payment + Student portal user in one D1 batch transaction.
- POST /api/payment-receive — validates current due and creates a unique receipt/payment atomically with the central state update.
- POST /api/student-mutation — admin-only edit/archive/restore with payment reconciliation.

The frontend uses these endpoints automatically when Cloud Mode is active. Local/demo mode remains available for development.

Important: run the current db/schema.sql against the same D1 database used by the application before testing Phase 2.

PHASE 3 - TRAINING RECORDS
==========================
Attendance, exam creation, result publishing and certificate issuing use
/functions/api/training-records.js when Cloudflare D1 mode is active.
The endpoint applies role/course/student authorization and optimistic version
checking so concurrent edits return a conflict instead of silently overwriting
another user's changes.

No additional secret is required for Phase 3 beyond the existing D1/auth setup.
After replacing the deployment files, deploy the project and keep the D1 binding
named DB. Existing app_state data remains the canonical application state.

PHASE 4 — STAFF & FINANCE
-------------------------
This build adds /api/finance-mutation for server-side, atomic finance operations.
Admin/Manager authorization is required for:
- Staff add/update/delete (delete is blocked when attendance/salary history exists)
- Staff attendance save
- Expense creation with receiver details
- Office expense advance creation
- Monthly salary save/update, with linked Staff Salary expense replacement

All finance writes use the app_state optimistic version check. If another user changes the same state first, the request returns DATA_CONFLICT instead of silently overwriting it.

Important: the current application still uses the existing app_state JSON document as the shared D1 state container. This phase hardens financial writes transactionally without changing the existing UI/print data model. A later accounting normalization phase can split high-volume ledgers into dedicated D1 tables if required.

PHASE 5 — INTEGRATIONS, SECURITY & BACKUP HARDENING
===================================================
This phase keeps the existing UI/print workflow but moves external integration credentials off the browser.

R2 student photos
------------------
Create an R2 bucket and bind it as:
  PHOTOS

Student photos are uploaded through /api/photo-upload and served through /api/photo.
The browser no longer needs to store a student's base64 photo in D1 once the R2 binding is configured.

Google Drive archive
--------------------
Configure these server-side variables/secrets:
  MJPTTI_DRIVE_ENDPOINT   = your Google Apps Script / Drive gateway URL
  MJPTTI_DRIVE_API_KEY    = optional secret expected by that gateway
  MJPTTI_DRIVE_ROOT       = MJPTTI Records (optional)

The browser no longer sends the Drive API key. /api/drive-archive proxies authenticated archive requests.

WhatsApp Business Cloud API
---------------------------
Configure these secrets:
  WHATSAPP_TOKEN
  WHATSAPP_PHONE_NUMBER_ID
  WHATSAPP_TEMPLATE_NAME
  WHATSAPP_TEMPLATE_LANGUAGE (optional; default en_US)
  WHATSAPP_GRAPH_VERSION (optional; default v23.0)

The configured template must accept three body variables in this order:
  1) Student name
  2) Notice title
  3) Notice body

Requests are sent server-side by /api/whatsapp-notice. No WhatsApp access token is stored in the browser.

Cloud backup
------------
Admin users can export a full D1 backup with:
  GET /api/backup-export

For automated backups, an optional Worker script is included at:
  workers/scheduled-backup-worker.js

For that Worker, bind:
  DB       = the same D1 database
  BACKUPS  = an R2 bucket used only for backups

Then configure a Cloudflare Cron Trigger. Example: 0 18 * * * (18:00 UTC / 00:00 Bangladesh time during UTC+6).

Security hardening
------------------
- Correct Cloudflare Pages _headers format is included.
- Adds HSTS, CSP, frame protection, permissions policy and no-sniff headers.
- Drive and WhatsApp secrets are server-side only.
- R2 student photos are stored privately; QR verification uses a narrowly validated public photo proxy URL containing a random object key.
- Cloud backup export is Admin-only.

Deployment checks
-----------------
Before production, verify all of the following:
  [ ] D1 binding DB
  [ ] PHOTOS R2 binding
  [ ] BACKUPS R2 binding for scheduled backups
  [ ] MJPTTI_AUTH_SECRET
  [ ] MJPTTI_ADMIN_PASSWORD
  [ ] MJPTTI_INITIAL_TRAINER_PASSWORD
  [ ] MJPTTI_SYNC_KEY
  [ ] MJPTTI_DRIVE_ENDPOINT / MJPTTI_DRIVE_API_KEY if Drive is used
  [ ] WHATSAPP_* secrets if WhatsApp is used
  [ ] Cron Trigger if scheduled backup is used

Never put API tokens, passwords or service-account secrets into app.js, index.html, localStorage, or the D1 application-state JSON.


PHASE 5.1 — FINAL SECURITY AUDIT FIXES
=======================================
- Public bootstrap no longer exposes admin username or Google Drive API key/endpoint settings.
- Authenticated /api/state GET now applies the same role filtering as /api/bootstrap.
- Generic state writes now require the current D1 version and use optimistic concurrency; stale browser saves are rejected instead of overwriting newer data.
- Bootstrap returns the current state version so the frontend can perform safe writes.
- Student admission, edit/archive and R2 photo updates keep the verification `students` table synchronized.
- Verification sync now requires an authenticated Admin session plus the configured sync key.
- Existing inline event handlers are compatible with the supplied CSP; this build intentionally uses `script-src 'self' 'unsafe-inline'` because the legacy UI uses inline onclick handlers.
- Admin credential changes are version-checked and audited.


PHASE 8 — FINAL PRODUCTION HARDENING
====================================
- Public QR verification uses the dedicated public R2 student-photo route.
- Trainer access is denied when no course is assigned; trainers cannot access all students by default.
- Institute notices are Admin-only for create/update/delete through the cloud state API.
- Payments are written to both app_state and the normalized D1 payments table in the same D1 batch.
- Admission initial payments are synchronized to the normalized payments table.
- Admin cloud backup exports app_state, users, audit_logs, students and payments.
- Scheduled R2 backup contains all normalized D1 tables as well as app_state.
- Admin can generate a new student portal password from the student complete file.
- Password resets are hashed server-side and audited; the new password is returned once to the Admin.

FINAL DEPLOYMENT REQUIREMENT
-----------------------------
V8 has passed static JavaScript syntax and ZIP integrity checks in the build environment. A real Cloudflare deployment test is still required for D1/R2 bindings, secrets, login, admission, payment, QR verification, backup and scheduled Cron execution.

Legacy data reconciliation
--------------------------
On Admin login, V8 checks whether the normalized students/payments tables contain fewer records than the canonical app_state and backfills missing legacy records in small D1 batches. This is intended to make existing V6/V7 data safe after upgrading to V8.

V9 — PRE-DEPLOYMENT RUNTIME FIXES
=================================
- Fixed a payment runtime ReferenceError caused by an undeclared payment object.
- Admission API now returns the new D1 state version.
- All cloud API responses carrying a version automatically update the browser's cloudVersion tracker.
- Fixed Student Password Reset SQL and made it create the student portal user if the normalized user record is missing.
- Cloud-mode normalize no longer generates/stores predictable student passwords in browser localStorage.
- Browser localStorage keeps the previous V6 key as a legacy migration source while using a V8 cache key.
- Cloud-mode browser backup restore is disabled to prevent app_state from diverging from normalized D1 users/students/payments tables. Use Full D1 Backup for production recovery.
- Finance mutation responses now include the new state version.

IMPORTANT RECOVERY NOTE
------------------------
The Cloud UI download is a full D1 backup. Do not use the old browser-only backup restore flow while logged into Cloud Mode; it is intentionally blocked to avoid partial restoration.


V10 — DEEP PRE-DEPLOYMENT HARDENING
===================================
- State mutation audit logging now commits in the same D1 batch as the app_state update, preventing a successful mutation from being reported as failed only because audit insertion failed.
- Admin login now reconciles missing seed Admin/Trainer user records individually instead of relying on the users table being completely empty.
- Admin login reconciliation now upserts legacy students/payments every time in small batches, rather than checking only row counts; changed legacy normalized records are corrected as well.
- Browser cache saves now remove admin, trainer and student plaintext passwords and Drive endpoint/API-key fields before writing localStorage.



V11 — FINAL RELEASE AUDIT FIXES
================================
- Server-side state sanitization now removes legacy Google Drive endpoint/API-key fields from every authenticated state response and every saved app_state.
- Generic state saves and finance mutations commit their audit log in the same D1 batch as the state mutation.
- Google Fonts are explicitly allowed by CSP so the existing visual typography is preserved under the security headers.
- Printed Authorized Signature blocks no longer append a role/title underneath the authorization line.
- Cloud admission confirmation does not print a plaintext student password when the password is only returned once during admission.
- Added wrangler.backup.example.toml for the optional scheduled backup Worker. The scheduled Worker is a separate Cloudflare Worker and is NOT deployed by `wrangler pages deploy`. Copy the example to `wrangler.backup.toml`, replace the D1 database ID, verify the R2 bucket name, then deploy it separately with `npx wrangler deploy --config wrangler.backup.toml`.
- Configure the Cron Trigger in that Worker (example: 0 18 * * * = 00:00 Bangladesh time under UTC+6).

FINAL RELEASE NOTE
------------------
The Pages application and the scheduled backup Worker are separate deployments. The main Pages deployment serves the portal; the backup Worker performs the optional scheduled D1-to-R2 backup.

V12 — FINAL DEEP AUDIT FIXES
============================
- Trainer sessions now receive only their own trainer record instead of the full trainer directory.
- Generic /api/state writes validate the D1 version before any credential provisioning; only Admin sessions may provision users from submitted state. This closes a trainer-side account-provisioning privilege path.
- Training-record mutations now commit their audit log in the same D1 batch as the app_state update.
- Admin credential changes sanitize the saved state and atomically upsert the ADMIN user record with the new username/password hash.
- Cloud-mode normalize() no longer queues a second cloud state save after a successful API mutation. This prevents duplicate version increments and mutation races.

DEPLOYMENT NOTE
===============
The main portal is deployed as a Cloudflare Pages project. The optional scheduled backup Worker is a separate deployment and must be configured/deployed separately with wrangler.backup.toml.
