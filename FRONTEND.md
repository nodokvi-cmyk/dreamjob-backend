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
- Copy on the sign-up "Your route" panel: the password step must say the person sets it after verifying the email, for example "Once your email is verified, you choose your password." Never imply a password is asked at sign-up, and keep the same wording on both account types.
- Every code screen: 60 second countdown on resend (resends during the cooldown are skipped silently and still look like success), and the line "Use the newest code we sent you". Code lifetime 10 minutes, 5 wrong tries kill the code (401, request a new one).
- Resend buttons: verify email `resend-code`; reset password `forgot-password`; email change step 1 `email-change/request`; email change step 2 `email-change/resend-new`. "Forgot password" link on sign-in and profile.
- Google users: no `birthDate`, `lastName` may be empty, `age` may be missing. A new Google company has empty `companyName` and `description`: show "Complete your company profile" while `isProfileComplete` is false, saved with `PATCH /companies/:id`.

## Email change (authenticated, `/auth/users/email-change/...` or `/auth/companies/email-change/...`)

`request { newEmail }` (code to the current email) then `confirm-current { code }` (code to the new email) then `confirm-new { code }`. `resend-new` has no body. Login email changes only at the last step.

## Users (`/users`)

- `GET /users` admin, paginated. `GET /users/:id` self or admin. `PATCH /users/:id` self only. `DELETE /users/:id` self or admin.
- Response fields: `_id`, `firstName`, `lastName`, `birthDate?`, `age?`, `email`, `googleId?`, `phone`, `role`, `isVerified`, `isCvPublic`, `appliedVacancies` (ids), `createdAt`, `updatedAt`, `avatarUrl`, `hasCv`. `__v` is also present; ignore it. Secrets and S3 keys are never returned. Handle a missing `age`. `phone: ''` clears the phone. `null` or empty values on other fields are ignored.
- Files, one per request, max 4 MB: `PATCH|DELETE /users/:id/avatar` (multipart field `avatar`, JPEG/PNG/WebP), `PATCH|DELETE /users/:id/cv` (field `cv`, PDF only), `PATCH /users/:id/cv-visibility { isCvPublic }`, `GET /users/:id/cv` returns a link valid 5 minutes (self, or an approved company when the CV is public).

## Companies (`/companies`)

- `GET /companies` admin. `GET /companies/:id` self or admin (private: has email, phone, director). `PATCH /companies/:id` self. `PATCH /companies/:id/approve` and `/revoke` admin. `DELETE /companies/:id` self or admin. `PATCH /companies/:id/plan` self (see Billing).
- Response fields: `_id`, `googleId?`, `createdAt`, `updatedAt`, `companyName`, `email`, `isVerified`, `approved`, `phone`, `location`, `description`, `website`, `operatingCities`, `director?`, `logoUrl`, `isProfileComplete`, and the billing fields `plan?` (`payAsYouPublish`, `plus`, `elite`; missing until a plan is chosen), `credits`, `purchasedCredits`, `planRenewsAt?`, `planEndsAtPeriodEnd`. `GET /auth/me` returns the same for a company. `''` clears `phone`, `location`, `website`; `director: null` removes the director.
- `isProfileComplete` is true only when `companyName` and `description` are not empty and a `plan` is chosen. `PATCH /companies/:id/approve` answers 400 until then (the admin screen must show why).
- Logo: `PATCH|DELETE /companies/:id/logo` (field `logo`).
- An unapproved company cannot create or edit vacancies, submit them or extend them (403). Show "Waiting for admin approval". Closing and deleting a vacancy and reading stay allowed.
- No public company page route exists yet. Do not build one yet.

## Vacancies (`/vacancies`)

Fields: `title`, `description`, `category`, `employmentType` (`full-time`, `part-time`, `internship`, `temporary`), `workMode` (`remote`, `onsite`, `hybrid`), `location` (required unless remote), `salaryMin?`, `salaryMax?`, `currency` (`USD`, `GEL`, `EUR`), `requirements` (max 20), `deadline` (in the future, at most 60 days from today), `photos` as `[{ id, url }]` (max 3), `company` (id only), `status`, `createdAt`. Owner and admin also get `rejectionReason`, `submittedAt?`, `firstPublishedAt?`, `freeWindowEndsAt?` and `updatedAt`. The last three are missing until the vacancy is first approved (`submittedAt` until it is submitted).

Status values the API returns: `notSubmitted`, `pending`, `published`, `rejected`, `closed`, `expired`. `notSubmitted` and `expired` are worked out by the server; the database never stores them. `notSubmitted` means created but not yet sent for review. `expired` means the deadline has passed and the vacancy is not closed. `notSubmitted` vacancies are visible only to their owner company (admins never see them, the public gets 404).

Response ids: a vacancy uses `id` (not `_id`).

| Route | Who |
| --- | --- |
| `GET /vacancies` | public, published and not expired |
| `GET /vacancies/:id` | public sees `published` and `closed`; owner and admin see all |
| `GET /vacancies/mine` | company, all statuses including `notSubmitted`, filter `status` |
| `GET /vacancies/admin` | admin, submitted vacancies only, filters `status` (not `notSubmitted`: 400), `companyId` |
| `POST /vacancies` | company, JSON body. Creates a `notSubmitted` vacancy (not final, see below). Send photos separately |
| `POST /vacancies/:id/photos` | company owner, one image per request (max 4 MB) |
| `DELETE /vacancies/:id/photos/:photoId` | company owner |
| `PATCH /vacancies/:id` | company owner, any create field |
| `POST /vacancies/:id/submit` | company owner, no body, sends the vacancy for review (may need payment) |
| `POST /vacancies/:id/extend { deadline }` | company owner, moves the deadline later (may need payment) |
| `PATCH /vacancies/:id/close` | company owner, only an active `published` vacancy (else 400) |
| `PATCH /vacancies/:id/approve`, `/reject { reason? }` | admin, only `pending` vacancies with a future deadline (else 400) |
| `DELETE /vacancies/:id` | owner or admin (admin cannot delete a `notSubmitted` one: 404) |

`POST /vacancies` also accepts multipart with a `photos` field, but do not use it: Vercel rejects request bodies over about 4.5 MB, so upload one photo per request with `POST /vacancies/:id/photos`.

### Creating is not final: submit

- A new vacancy is `notSubmitted`. It never reaches the admin until the company calls `POST /vacancies/:id/submit`. Show a clear "Not submitted" label, a short message ("Submit this vacancy to send it for review") and a Submit button on the owner's list and detail page.
- Submit works only on a `notSubmitted` vacancy of an approved company with a deadline in the future. Errors (400): `Vacancy is already submitted`, `The deadline has passed, change it before submitting` (edit the deadline with `PATCH`, then submit). 409 `Vacancy changed, try again` and `Another payment was just started, try again`: retry.
- Submit takes one credit: first a plan credit (`credits`), then a purchased credit (`purchasedCredits`). With no credit the company pays for this one vacancy with Stripe: $5 on Pay as you publish, $3 on Plus, $2 on Elite.
- Both submit and extend answer `200` with one of two shapes. Branch on `status`:
  - `{ status: 'done', vacancy }`: finished. For submit the vacancy is now `pending`.
  - `{ status: 'paymentRequired', checkoutUrl }`: send the browser to `checkoutUrl` (`window.location.assign`). Pressing Submit again while a payment is open returns the same link.
- After a payment the person comes back to `/company/vacancies?payment=success&session_id=cs_...` (or `?payment=cancelled`). On success call `GET /payment/confirm?sessionId=<session_id>` (see Billing), then reload the list.
- Warn near the Submit button and before the Stripe redirect: credits and payments are not refunded in cash.

### Review, rejection and refunds

- The admin approves or rejects a `pending` vacancy. Approve sets `published`. A first approval starts the 60-day window (below).
- Rejecting a vacancy that was **never published** returns the credit that paid for it (a plan credit goes back to `credits` up to the plan limit, a purchased one or a paid vacancy goes to `purchasedCredits`). Editing it afterwards makes it `notSubmitted` again: the company must press Submit again and pay again. Tell the company this on the rejected screen.
- Rejecting a vacancy that was **published before** gives no refund. Editing it sends it back to `pending` for free, no new Submit.
- Deleting a `notSubmitted` vacancy is free. Deleting a `pending` never-published vacancy returns its credit. Deleting any other vacancy returns nothing. An admin delete never returns a credit.
- Editing content on a `published` or `rejected` vacancy (any field except `deadline`, or adding a photo) sends it back to `pending`. Removing a photo sends only a `rejected` vacancy back. A change of the deadline alone never changes the status.

### The 60-day window, deadline and extension

- At the first approval the vacancy gets a window of 60 days: `freeWindowEndsAt` (owner and admin view only) is the latest deadline the company can set without paying again. The deadline itself is chosen by the company and is at most 60 days from today when set in a create or edit.
- Once a vacancy has been published (`firstPublishedAt` is set), `PATCH` refuses a later deadline (400 `Use the extend route to move the deadline later`). A shorter deadline is allowed through `PATCH`.
- Extend: `POST /vacancies/:id/extend { deadline }`. Only vacancies published at least once and not closed (400 `Only vacancies that were published can be extended`, `Closed vacancies cannot be extended`). The new deadline must be later than the current one and in the future (400 `The new deadline must be later than the current one`).
  - Deadline on or before the window end: free, immediate, no admin review. An expired vacancy becomes live again. Answer `{ status: 'done', vacancy }`.
  - Deadline after the window end: costs one credit (plan, then purchased) or a payment ($5, $3 or $2 by plan), and the window grows by 60 days. The deadline can be at most the window end plus 60 days (400 `A paid extension can move the deadline to <ISO date> at most`). Answer is `done` or `paymentRequired`, as in submit. A paid extension is never refunded.
- While a published-before vacancy is not live (`pending` or `rejected`) the window clock is paused. The pause is added to the window when the admin approves, and the real free limit of an extension grows while the vacancy waits. `freeWindowEndsAt` does not show that growth, so write the extend screen as "free until about X" and let the response decide: `done` means it was free, `paymentRequired` means it needs a credit or a payment. Do not promise a price before the call.
- If the deadline passes while a vacancy waits for review, the admin cannot approve it (400, `Only pending vacancies with a future deadline can be reviewed`). The status shows `expired`. A vacancy published before: the company uses Extend. A vacancy never published: the company sets a new deadline with `PATCH` (a deadline-only change is free and keeps it in the review queue).
- Expired vacancies that were published before cannot be edited until extended (400 `Expired vacancies must be extended before they can be changed`). Show a clear Extend button on them.
- Frontend copy to add: a note at creation and next to Submit about the 60-day rule, the window end date on the owner's detail page, and on the extend screen "free until about X" or "may cost 1 credit and adds 60 days".

Filters on every list: `q`, `category`, `location`, `workMode`, `employmentType`, `salaryMin`, `salaryMax`, `currency`, `sort` (`date`, `-date`, `salary`, `-salary`, `deadline`, `-deadline`, default `-date`), plus `page` and `take`. The category dropdown is a fixed list for now.

## Billing and plans (company only, `/payment` and `PATCH /companies/:id/plan`)

All amounts are USD. Stripe hosts every payment page: the frontend only redirects there and handles the return.

| Plan (`plan` value) | Price | Credits | One vacancy without a credit |
| --- | --- | --- | --- |
| `payAsYouPublish` | $0 a month | 0 | $5 |
| `plus` | $29.99 a month | 15 a month | $3 |
| `elite` | $44.99 a month | 40 a month | $2 |

- **Credits.** One credit pays for one submit or one paid extension. `credits` are plan credits: set to the plan amount when a plan starts, reset to it on every monthly renewal, no rollover, 0 when the plan ends. `purchasedCredits` never expire: they come from refunds of vacancies paid with money. Plan credits are spent first. Both numbers are on the company response and on `GET /auth/me`.
- **Onboarding.** Choosing a plan is the last onboarding step: until a plan exists `isProfileComplete` is false and the admin cannot approve the company. Free plan: `PATCH /companies/:id/plan { plan: 'payAsYouPublish' }` (self only, accepts only that value, 400 `A plan is already chosen` if one exists) returns the company. Paid plan: `POST /payment/checkout { plan: 'plus' | 'elite' }` returns `{ url }`; redirect there. It answers 400 `Cancel your current plan before choosing another one` when the company already has a paid plan: there is no in-place switching, the company cancels in the portal and subscribes to the other one.
- **Return from a plan checkout:** `/company/billing?status=success&session_id=cs_...` or `/company/billing?status=cancelled`. On success call confirm.
- **Confirm:** `GET /payment/confirm?sessionId=<the session_id from the URL>` (company only). It checks the payment with Stripe and applies it if the webhook has not yet, so call it on the return page and it is safe to call again. 404 `Checkout session not found` for a session that is not this company's. Two shapes, tell them apart by `kind`:
  - `{ kind: 'subscription', paid, plan, credits, purchasedCredits, planRenewsAt, planEndsAtPeriodEnd }`
  - `{ kind: 'vacancy', paid, vacancyId, purpose ('submit' or 'extend'), vacancyStatus, deadline, credits, purchasedCredits }` (`vacancyStatus` is the same derived status as in the vacancy list)
  If `paid` is false show "Payment not completed".
- **Portal:** `POST /payment/portal` (no body) returns `{ url }`. The company changes the card, cancels the plan and sees invoices there, and returns to `/company/billing`. 400 `No billing account yet` for a company that never paid. Cancelling keeps the plan until the end of the billing period: `planEndsAtPeriodEnd` is true and `planRenewsAt` is the end date, show "Ends on <date>".
- **Plan ends.** If a renewal payment fails the plan ends at once: `plan` becomes `payAsYouPublish` and `credits` becomes 0, and the company gets an email. If the bank asks for confirmation (3D Secure) the plan stays for up to 5 days while the company confirms through the emailed link. Published vacancies are not affected when a plan ends.
- **Warnings to show:** no cash refunds anywhere; a rejected never-published vacancy returns its credit; a published vacancy is never refunded.
- The webhook (`POST /payment/webhook`) is Stripe to backend only. Do not call it.
- Rate limit: checkout, portal, plan, submit and extend allow 5 requests a minute (429).

## Not built yet (do not build screens for these)

Applications, saved jobs, chatbot, public company page, past vacancies section, a billing history list inside the site (use the portal), Stripe payments for anything except plans, vacancy submits and vacancy extensions.
