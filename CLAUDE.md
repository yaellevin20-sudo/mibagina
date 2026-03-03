# mi bagina — Build Spec & Constraints

## Design System

**`DESIGN.md` is the single source of truth for all UI work** — colors, typography, component shapes, screen patterns, icons, assets, and RTL layout. Read it before writing or modifying any screen or component. The canonical brand green is `#3D7A50` (not `#16a34a`).

## ⚠️ Critical Invariants (Read Before Every Task)

- **Deep-link scheme is `mibagina`** — not migagina, not mi-bagina. Use this exact string everywhere: app.json, invite link generation, join/[token].tsx handler, and all documentation.
- **`session_id` is internal only** — never return it to the client. Use a derived `session_token` (HMAC or JWT) for the "Still There?" prompt.
- **`checked_in_at` and `expires_at` are always set server-side** — never accept these from the client.
- **`expires_at IS NULL` means active** — do not treat null as inactive. A group is active if `expires_at IS NULL OR expires_at >= current_date`.
- **Always filter check-ins by BOTH** `expires_at > now()` AND `status != 'expired'` — never rely on status alone.
- **All join-table inserts use `ON CONFLICT DO NOTHING`.**
- **`invite_token` is NOT NULL** — every group must always have a token. To disable joining, rotate or delete the token. Never set it to null.
- **All RPCs: `revoke execute from anon`, `grant execute to authenticated`.**
- **`co_guardian_visibility` is enforced at the DB layer** — do not re-implement it client-side.
- **`guardian_id` in Edge Functions comes from the verified JWT only** — never from the request body.
- **`touch_last_active()` returns boolean** — `false` means guardian row not found. Log it; do not treat as a hard error.
- **No RLS policies on views** — views are for TypeScript type generation only.
- **All client data access goes through security-definer RPCs** — no direct table queries from the client.
- **Duplicate child merge is a 7-step atomic transaction** — never do this partially.
- **Age always from server-computed `age_years`** — never compute from raw DOB client-side.
- **No Supabase Realtime** — 30-second polling via RPC on Home Screen. Cancel on unmount/background.
- **All multi-step mutations via security-definer server functions** — never direct client writes.

---

## App Overview

**mi bagina** (Hebrew: "Who's in the park?") — mobile app for parents to signal they're at a playground so group members can spontaneously join.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | React Native + Expo (managed workflow) |
| Language | TypeScript throughout |
| Backend & DB | Supabase (auth + PostgreSQL) |
| Navigation | Expo Router (file-based routing) |
| Styling | NativeWind (Tailwind for React Native) |
| Push notifications | Expo Push Notifications (via Edge Function — not pg_cron) |

---

## Localization

- Primary: Hebrew (he). Fallback: English (en). Use `i18next` + `react-i18next`. No hardcoded strings in components.
- Translation files: `locales/he.json` and `locales/en.json`. All strings via `t('key')`.
- RTL default. `I18nManager.forceRTL(true)` on app init for Hebrew. LTR on English switch (requires restart).
- Use `start`/`end` over `left`/`right`. Israeli locale for dates/numbers.

| Key | Hebrew | English |
|---|---|---|
| `home.empty_state` | "עדיין אף אחד בגן. תהיו ראשונים!" | "No one at the playground yet. Be the first!" |
| `home.still_there_prompt` | "עדיין שם?" | "Still there?" |
| `playground.did_you_mean` | "התכוונת ל-[name]?" | "Did you mean [name]?" |
| `checkin.leaving` | "יוצאים" | "Leaving" |
| `checkin.still_there` | "עדיין פה" | "Still here" |
| `children.siblings_collapsed` | "+ N אחים/אחיות" | "+ N sibling(s)" |

Add to this table as new strings are introduced.

---

## Auth

- Email/password or Google OAuth. JWT expiry: 1h, refresh enabled. No email verification required (disabled in Supabase).
- First login with no `guardians` row: prompt display name → create via server-side function.
- Call `touch_last_active()` after login and session restore. Log if returns `false`.
- Inactivity: `last_active_at > 6 months` → sign out, require full re-login with email/password. No exceptions.

---

## Deep Linking

- Primary share format: `https://mibagina.co.il/join/[token]` (Universal Links / App Links — opens app directly on iOS and Android; falls back to web landing page with store links).
- Internal fallback scheme: `mibagina://join/[token]` — remains valid for backward-compat and the "Open in app" button on the landing page.
- Apply HTTPS format in: `app.json` (`associatedDomains`, Android intent filters, `extra.router.origin`), invite sharing in `groups.tsx`, `join/[token].tsx` handler, all docs.
- If unauthenticated on join link: store token, redirect to auth, resume after.
- Web files live in `web/` (deployed as standalone Vercel project at `mibagina.co.il`): `vercel.json`, `.well-known/apple-app-site-association`, `.well-known/assetlinks.json`, `join.html`, `index.html`.
- `apple-app-site-association` uses modern `"components"` format (not legacy `"paths"`). Replace `TEAMID` placeholder before deploying.
- `assetlinks.json`: replace `YOUR_SHA256_FINGERPRINT` with Play Console → App integrity → **App signing key** certificate fingerprint (not upload key).
- Native rebuild required after `app.json` changes (`eas build --platform all`) — entitlements and manifest changes are not OTA-updatable.

---

## Database Schema

Enums: `checkin_status (active, extended, expired)`, `checkin_source (app, whatsapp)`, `audit_operation (INSERT, UPDATE, DELETE)`

Tables:
- **guardians** `(id→auth.users, name, email UNIQUE, last_active_at, created_at)`
- **children** `(id, first_name, last_name, date_of_birth CHECK(<=current_date), created_by_guardian_id, created_at)` — no direct client writes
- **guardian_children** `(guardian_id, child_id)` PK
- **co_guardian_visibility** `(child_id, from_guardian_id, to_guardian_id, can_see_checkins)` — directional; CHECK(from ≠ to)
- **groups** `(id, name, invite_token NOT NULL UNIQUE, is_public, expires_at DATE, created_at)`
- **group_admins** `(group_id, guardian_id)` PK
- **guardian_child_groups** `(guardian_id, child_id, group_id)` — composite FK to guardian_children enforces ownership
- **guardian_group_settings** `(guardian_id, group_id, notification_threshold, muted_at)`
- **playgrounds** `(id, name, normalized_name CHECK(trim length > 0), created_by, created_at)`
- **check_ins** `(id, child_id, playground_id, posted_by, session_id INTERNAL ONLY, still_there_prompted_at, checked_in_at, expires_at, status, source, created_at)`
- **audit_log** `(id, table_name, operation, row_pk, actor_id, old_data, new_data, occurred_at)` — actor_id null = service-initiated (expected)
- **rate_limit_log** `(id, ip_hash, endpoint, attempted_at)` — ip_hash = SHA-256 of IP, never raw IP

### Required Indexes
```sql
create index on check_ins (child_id, expires_at);
create index on check_ins (posted_by, checked_in_at);
create index on guardian_child_groups (group_id, child_id);
create index on guardian_children (child_id);
create index on rate_limit_log (endpoint, ip_hash, attempted_at desc);
```

### Type-Shape Views (TypeScript generation only — NO RLS policies, NO client queries)
- `v_shape_checkins_public` — check_ins minus session_id
- `v_shape_children_private` — own children + `age_years`
- `v_shape_children_shared` — shared children + `age_years`

---

## Security-Definer RPCs

All RPCs: `security definer`, `set search_path = public`, reject null `auth.uid()`, `revoke execute from anon`, `grant execute to authenticated`.

Key RPCs (see migration for full SQL):
- **`touch_last_active()`** → boolean. `false` = guardian row not found (log, not error). Call after login and session restore.
- **`get_playground_children(p_playground_id)`** → `{ named[], anonymous_ages[], no_visible_children }`. `DISTINCT ON` prevents race duplicates. `co_guardian_visibility` applied in both named and anonymous branches. `Access denied` = genuine auth failure. `no_visible_children=true` = timing race (render "No one here right now", not an error).
- **`get_my_children()`** → children with `age_years` for Children tab.

---

## Row Level Security (RLS)

Enable RLS on all tables. No policies on `v_shape_*` views.

- **guardians** — read/write own row only
- **children** — no direct client access; all via RPC
- **guardian_children** — read if linked; mutations via server function
- **co_guardian_visibility** — read if participant; update only if `from_guardian_id`
- **check_ins** — no direct client access; all via RPC
- **guardian_child_groups** — read if member; mutations via server function
- **groups** — read if in `guardian_child_groups` OR `group_admins`; update/delete: admins only. Active = `expires_at IS NULL OR expires_at >= current_date`. Do not reject NULL.
- **group_admins** — read own + co-admins for shared groups; mutations via server function
- **guardian_group_settings** — read/write own rows
- **playgrounds** — read via co-guardian check-in history (not global list); insert: creator only
- **audit_log** / **rate_limit_log** — service role only

---

## group_admins Lifecycle

Admin-only state (in `group_admins`, not yet in `guardian_child_groups`) is valid immediately after group creation.

Remove guardian from group:
1. Delete all `guardian_child_groups` rows for guardian + group
2. Delete `guardian_group_settings`
3. Delete from `group_admins` if present
4. **Block if last admin — assign another first**

---

## Triggers & Server-side Enforcement

All trigger functions and RPCs: `set search_path = public`. `security definer` required on RPCs and `audit_trigger_func` only.

- **`check_daily_checkin_limit`** (BEFORE INSERT on check_ins) — 10/guardian/day, Israel TZ (`Asia/Jerusalem`), source-global. Uses `coalesce(new.checked_in_at, now())`.
- **`expire_previous_checkins`** (AFTER INSERT on check_ins) — sets `status='expired'` AND `expires_at=least(expires_at,now())` for prior active/extended rows. Source-global.
- **`update_last_active_from_posted_by`** (AFTER INSERT on check_ins) — updates `guardians.last_active_at`
- **`update_last_active_from_guardian_id`** (AFTER INSERT on guardian_group_settings, guardian_children)
- **`audit_trigger_func`** (AFTER INSERT/UPDATE/DELETE on children, guardian_children, check_ins) — actor_id null for service ops
- **Cleanup** (inside scheduled Edge Function): delete expired check_ins older than 24h

Race note: concurrent inserts can both pass before trigger fires. Acceptable for MVP; `DISTINCT ON` in `get_playground_children` handles UI duplicates.

---

## Invite Token Security

- `invite_token` NOT NULL always. Rotate (not null) to disable joining.
- Rate limit: max 10 attempts/IP/hour via `rate_limit_log`. Any request counts (not just invalid tokens).
- Regenerate: single atomic UPDATE — old token invalid on commit.
- Validate active (`expires_at IS NULL OR >= current_date`) before returning any group data.
- Production: replace `rate_limit_log` with Upstash Redis or Cloudflare.

---

## Playground Name Normalization

1. Lowercase + trim whitespace
2. Strip generic words: `park`, `garden`, `playground`, `square`, `sq`, `גן`, `גינה`, `פארק`
3. NFKC unicode normalize
4. Empty result → reject: "Please enter a more specific name"
5. One match → confirm "Did you mean [name]?" — Yes: link. No: create new. **Never auto-merge.**
6. No match → create new record

---

## App Structure (Expo Router)

```
app/
  (auth)/    landing.tsx  login.tsx  signup.tsx  name.tsx
             children.tsx  groups-onboard.tsx  notifications-ask.tsx
  (tabs)/    index.tsx  children.tsx  groups.tsx  profile.tsx
  auth/      callback.tsx  (OAuth callback)
  playground/[id].tsx
  checkin/index.tsx
  join/[token].tsx
  add-child.tsx
  reset-password.tsx
```

---

## Core Screens & Logic

### Auth (login/signup → name.tsx)
On success: call `touch_last_active()`. No `guardians` row → name.tsx → server function creates row. `last_active_at > 6 months` → sign out. Arrived via join link → store token, resume after auth.

### Children Tab
- List via `get_my_children()` RPC (includes `age_years`).
- Add: security-definer atomic function — inserts children, guardian_children, co_guardian_visibility (all ON CONFLICT DO NOTHING).
- Toggle "Sees your check-ins": updates `co_guardian_visibility` where `from_guardian_id = auth.uid()`.
- Remove: security-definer function — deletes guardian_children, co_guardian_visibility, orphaned children row.

### Groups Tab
- List: guardian in `guardian_child_groups` OR `group_admins`.
- Create: server function → groups + group_admins + guardian_group_settings (all ON CONFLICT DO NOTHING).
- Admin actions: rename, regenerate invite (atomic UPDATE), remove guardian (see lifecycle above), remove child.

### Join Flow (join/[token].tsx)
1. Look up group by `invite_token`. Validate active. If unauthed: store token, redirect.
2. Show group name. Select children.
3. Duplicate check Edge Function: JWT + child data + group_id → NFKC+trim+case-insensitive → returns first_name + birth year (never full DOB).
4. If confirmed: 7-step atomic merge — (1) insert guardian_children ON CONFLICT DO NOTHING, (2) insert guardian_child_groups, (3) remove old guardian_child_groups for duplicate, (4) delete old guardian_children link, (5) delete orphaned child, (6) rebuild co_guardian_visibility, (7) notify guardians.
5. No match / declined: normal guardian_child_groups insert + notify admin.
6. Insert guardian_group_settings ON CONFLICT DO NOTHING.

### Check-in Flow
Server function: validate guardian-child link → daily limit → generate `session_id` server-side → insert check_ins rows (expire_previous_checkins trigger handles conflicts) → return `session_token` (NOT session_id).

### "Still There?" Prompt (scheduled Edge Function, every 5 min)
- Query: `status='active' AND checked_in_at <= now()-45min AND still_there_prompted_at IS NULL`
- Group by session_id server-side. Push `{ session_token, children[{check_in_id, first_name, age_years}] }`.
- Update `still_there_prompted_at=now()`. One prompt per row maximum.
- Separate pass: set `status='expired'` for rows where `expires_at <= now()`.
- "Still here": client sends check_in_id → extend +30min, status=extended.
- "Leaving" or no response within 60min → status=expired.

### Home Screen
- 30s polling via RPC. Cancel on unmount or app background. No Supabase Realtime.
- Active = `expires_at > now() AND status != 'expired'`. Grouped by playground. Age from RPC.
- Siblings collapsed "+ N sibling(s)", expandable. Empty state: `t('home.empty_state')`.

### Playground View
Three states from `get_playground_children(playground_id)`:
1. Data present → render normally
2. `no_visible_children=true` → "No one here right now" (timing race, not error)
3. `Access denied` exception → real auth failure

### Profile / Email Change / Delete Account
- Email change: verify guardians row → update auth.users.email → catch unique violation → `signOut(userId, 'others')` → update guardians.email.
- Delete account saga: mark deleting → DB transaction (guardian_children, orphaned children, co_guardian_visibility, guardian_child_groups, guardian_group_settings, group_admins, guardians) → `admin.deleteUser(userId)` with retry/compensation → sign out.

---

## Orphan Child Invariant

Enforced by security-definer server functions only (no DB constraint can atomically prevent transient orphans during multi-step deletes).

Scheduled Edge Function (daily monitoring):
```sql
select id, first_name, last_name from children
where id not in (select child_id from guardian_children);
-- Alert ops. Do not silently delete — investigate first.
```

---

## Future Plumbing (schema only, no logic needed yet)

- `check_ins.source` — triggers are source-global; update explicitly if per-source semantics needed when WhatsApp ships
- `groups.expires_at` / `groups.is_public` — not used in MVP
- `guardian_group_settings.notification_threshold` — add CHECK constraint once range finalized
- `guardian_group_settings.muted_at`

---

## Build Status

All MVP phases complete. App is in post-MVP polish / production-prep.

| Phase | Scope | Status |
|---|---|---|
| 1 | Database migration SQL: enums, tables, indexes, views, RLS, all RPCs, all triggers | ✅ |
| 2 | Supabase client setup, TypeScript types, auth helpers, session management, i18n setup | ✅ |
| 3 | Auth screens: login.tsx, signup.tsx, name.tsx | ✅ |
| 4 | Children tab + Groups tab | ✅ |
| 5 | Join flow (join/[token].tsx) including duplicate merge | ✅ |
| 6 | Check-in flow + "Still There?" Edge Function | ✅ |
| 7 | Home screen + Playground view | ✅ |
| 8 | Profile screen + account deletion | ✅ |
| 9 | Edge Functions: rate limiting, orphan monitoring, scheduled cleanup | ✅ |
| + | Google OAuth, onboarding flow, push notifications, EAS build config, pretty invite URLs (mibagina.co.il) | ✅ |
