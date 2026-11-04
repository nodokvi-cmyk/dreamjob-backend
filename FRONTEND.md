# FRONTEND.md

API contract for the GetDreamJob frontend. The backend is built in steps: build only what is listed here. When the backend adds routes, this file is updated first. Types in the frontend are hand-written from this file, not generated.

## Brand

The site name shown to people is **GetDreamJob** (domain `getdreamjob.vercel.app`). Use it in the logo, page titles, meta tags, headings, footer, copy and emails. The word "DreamJob" must not appear anywhere visible on the site. Folder, repo and package names may keep `dreamjob`.

Visible occurrences found in the frontend `src/` on 2026-11-04 (change each to GetDreamJob): `services/api.ts:33`, `app/vacancies/[id]/page.tsx:45` and `:68`, `components/vacancies/ListStates.tsx:83`, `app/layout.tsx:47-48` (title default and template), `app/not-found.tsx:18`, `app/page.tsx:182`, `app/(auth)/sign-in/SignInScreen.tsx:58`, `app/profile/CvPanel.tsx:17`, `app/profile/ProfileScreen.tsx:260`, `components/layout/SiteHeader.tsx:59` (aria-label), `components/layout/SiteFooter.tsx:43` and `:71`, `components/layout/StationMark.tsx:22` (the logo text). Also check the logo SVG, favicon, Open Graph image and `metadataBase`. The `dreamjob.*` keys in `lib/authDraft.ts` are storage keys, not visible: leave them.

## Base

- Backend: `https://dreamjob-backend.vercel.app` (local `http://localhost:3000`). Frontend env `NEXT_PUBLIC_API_URL` or `VITE_API_URL`.
- Auth: `Authorization: Bearer <token>`. Token from sign-in, verify-email or Google, kept in `localStorage['token']`, valid 1 hour.
- One `services/api.ts` wrapper adds the header and throws `Error(message)` on non-2xx. Error body: `{ statusCode, message, error }`; `message` can be a string or a string array (validation).
- One service module per backend resource. Global state in contexts (`AuthContext`). Gate pages with `ProtectedRoute` and `AdminRoute`.
- Rate limit: 429 `Too Many Requests` (30 per minute per IP, 5 per minute on sensitive routes). Show a calm "try again in a minute".
- Lists return `{ items, total, page, take }`. Query `page` (default 1), `take` (default 10, max 30).
- Roles in the token: `user`, `admin`, `company`. `GET /auth/me` tells which one you are.

## Auth flow (users under `/auth/users/...`, companies under `/auth/companies/...`, same shapes)

| Route | Body | Result |
| --- | --- | --- |
| `POST sign-up` | user: `firstName`, `lastName`, `email`, `birthDate`, `phone?`; company: `companyName`, `email`, `description`, `phone?`, `location?`, `website?`, `operatingCities?`, `director?` | message, code emailed. No password yet |
| `POST verify-email` | `email`, `code` | `{ token }` |
| `POST resend-code` | `email` | generic message |
| `POST sign-in` | `email`, `password` | `{ token }`, generic 401 on any failure |
| `POST forgot-password` | `email` | generic message |
| `POST reset-password` | `email`, `code`, `newPassword`, `confirmNewPassword` | `{ message }`, then sign in |
| `POST google` | `idToken` | `{ token }` |
| `GET /auth/me` | none | the account, plus `passwordSetupRequired`; companies also `isProfileComplete` |

- Sign-up returns 409 with `code: 'EMAIL_NOT_VERIFIED'` when the email waits for verification: go to the verify page, call `resend-code` on arrival if no code was just sent.
- After verify-email, keep the person on a set-password step while `passwordSetupRequired` is true: `PATCH /users/:id/password` or `/companies/:id/password` with `newPassword`, `confirmNewPassword` (no `currentPassword` for a first password).
- Password: 8 to 64 chars, upper, lower, digit, symbol, printable ASCII only. Always two fields. Sign-in does not reveal the rules.
- Every code screen: 60 second countdown on resend (resends during the cooldown are skipped silently and still look like success), and the line "Use the newest code we sent you". Code lifetime 10 minutes, 5 wrong tries kill the code (401, request a new one).
- Resend buttons: verify email `resend-code`; reset password `forgot-password`; email change step 1 `email-change/request`; email change step 2 `email-change/resend-new`. "Forgot password" link on sign-in and profile.
- Google users: no `birthDate`, `lastName` may be empty, `age` may be missing. A new Google company has empty `companyName` and `description`: show "Complete your company profile" while `isProfileComplete` is false, saved with `PATCH /companies/:id`.

## Email change (authenticated, `/auth/users/email-change/...` or `/auth/companies/email-change/...`)

`request { newEmail }` (code to the current email) then `confirm-current { code }` (code to the new email) then `confirm-new { code }`. `resend-new` has no body. Login email changes only at the last step.

## Users (`/users`)

- `GET /users` admin, paginated. `GET /users/:id` self or admin. `PATCH /users/:id` self only. `DELETE /users/:id` self or admin.
- Response fields: `firstName`, `lastName`, `birthDate?`, `age?`, `email`, `phone`, `role`, `isVerified`, `avatarUrl`, `hasCv`, `isCvPublic`. Handle a missing `age`. `phone: ''` clears the phone. `null` or empty values on other fields are ignored.
- Files, one per request, max 4 MB: `PATCH|DELETE /users/:id/avatar` (multipart field `avatar`, JPEG/PNG/WebP), `PATCH|DELETE /users/:id/cv` (field `cv`, PDF only), `PATCH /users/:id/cv-visibility { isCvPublic }`, `GET /users/:id/cv` returns a link valid 5 minutes (self, or an approved company when the CV is public).

## Companies (`/companies`)

- `GET /companies` admin. `GET /companies/:id` self or admin (private: has email, phone, director). `PATCH /companies/:id` self. `PATCH /companies/:id/approve` and `/revoke` admin. `DELETE /companies/:id` self or admin.
- Response fields: `companyName`, `email`, `isVerified`, `approved`, `phone`, `location`, `description`, `website`, `operatingCities`, `director?`, `logoUrl`, `isProfileComplete`. `''` clears `phone`, `location`, `website`; `director: null` removes the director.
- Logo: `PATCH|DELETE /companies/:id/logo` (field `logo`).
- An unapproved company cannot create or edit vacancies (403). Show "Waiting for admin approval".
- No public company page route exists yet. Do not build one yet.

## Vacancies (`/vacancies`)

Fields: `title`, `description`, `category`, `employmentType` (`full-time`, `part-time`, `internship`, `temporary`), `workMode` (`remote`, `onsite`, `hybrid`), `location` (required unless remote), `salaryMin?`, `salaryMax?`, `currency` (`USD`, `GEL`, `EUR`), `requirements` (max 20), `deadline` (future, at most 180 days), `photos` as `[{ id, url }]` (max 3), `company` (id only), `status`. Owner and admin also get `rejectionReason` and `updatedAt`.

Status: `pending`, `published`, `rejected`, `closed`, and derived `expired`. Editing a published or rejected vacancy sends it back to `pending`.

| Route | Who |
| --- | --- |
| `GET /vacancies` | public, published and not expired |
| `GET /vacancies/:id` | public sees `published` and `closed`; owner and admin see all |
| `GET /vacancies/mine` | company, all statuses, filter `status` |
| `GET /vacancies/admin` | admin, filters `status`, `companyId` |
| `POST /vacancies` | company, JSON body (create without photos) |
| `POST /vacancies/:id/photos` | company owner, one image per request |
| `DELETE /vacancies/:id/photos/:photoId` | company owner |
| `PATCH /vacancies/:id` | company owner, any create field |
| `PATCH /vacancies/:id/close` | company owner |
| `PATCH /vacancies/:id/approve`, `/reject { reason? }` | admin |
| `DELETE /vacancies/:id` | owner or admin |

Filters on every list: `q`, `category`, `location`, `workMode`, `employmentType`, `salaryMin`, `salaryMax`, `currency`, `sort` (`date`, `-date`, `salary`, `-salary`, `deadline`, `-deadline`, default `-date`), plus `page` and `take`. The category dropdown is a fixed list for now.

## Not built yet (do not build screens for these)

Applications, saved jobs, payments (Stripe), chatbot, public company page, past vacancies section.
