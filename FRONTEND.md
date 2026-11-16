# FRONTEND.md

API contract for the GetDreamJob frontend. The backend is built in steps: build only what is listed here. When the backend adds routes, this file is updated first. Types in the frontend are hand-written from this file, not generated.

**Backend status (2026-11-13):** everything in this file is built and pushed, including applications, bookmarks, notifications, billing and the light vacancy cards. Only the "Not built yet" list at the end is missing. The frontend `CLAUDE.md` line "Not in the backend yet: applications, saved jobs, payments, chatbot" is outdated: only the chatbot is missing. Build every screen this file describes that the frontend does not have yet, and update existing screens to the current response shapes (several sections below are marked as breaking changes).

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
- **Salary display (decided 2026-11-15):** one shared component for vacancies and publications, on every card, detail page, list and board. `salaryMin` and `salaryMax` are each `null` when not set and independent of each other:
  - both `null`: show "Negotiable" (neutral, muted text, never "0" or a dash);
  - only `salaryMin`: "From 1,500 USD"; only `salaryMax`: "Up to 2,000 USD";
  - both: "1,000 - 2,000 USD".
  Use `currency` for the code (or its symbol) and thousands separators. On the filter side, a salary filter leaves out items that show "Negotiable".
- **Pictures (decided 2026-11-13):** `avatarUrl` (users) and `logoUrl` (companies) are `''` when nothing is uploaded. Two rules:
  - **Vacancy cards and the vacancy details page** (main list, home latest block, bookmarks, the vacancy part of "My applications", admin list): show the company logo small only when `logoUrl` is not `''`. When it is `''`, show no logo and no placeholder, so that card is a bit thinner.
  - **Everywhere else** (header avatar, user profile and public profile, company profile and public company page, applicant list, company dashboard): when `avatarUrl` or `logoUrl` is `''`, show a default picture: a grey square with a centered icon, a person for users and a company icon (briefcase or building) for companies. Build it as a small component with the existing lucide icons and the theme's muted colors (it follows dark mode); never upload default images and never use initials.

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

`request { newEmail }` (code to the current email) then `confirm-current { code }` (code to the new email) then `confirm-new { code }`. `resend-new` has no body. Login email changes only at the last step. Admins are stored as users, so they change their email with the same `/auth/users/email-change/...` routes (offer it on the admin's profile too).

## Users (`/users`)

- `GET /users` admin, paginated. `GET /users/:id` self or admin. `PATCH /users/:id` self only. `DELETE /users/:id` self or admin.
- Response fields: `_id`, `firstName`, `lastName`, `birthDate?`, `age?`, `email`, `googleId?`, `phone`, `role`, `isVerified`, `isCvPublic`, `isProfilePublic`, `isEmailPublic`, `isPhonePublic`, `createdAt`, `updatedAt`, `avatarUrl`, `hasCv`. `id` (the same value as `_id`, a string) and `__v` are also present; use `_id` and ignore `__v`. Secrets and S3 keys are never returned. Handle a missing `age`. `phone: ''` clears the phone. `null` or empty values on other fields are ignored.
- Removed (2026-11-13): `appliedVacancies` is no longer in the user response. Drop it from the user type (`types.ts`) and the user parser (`services/users.service.ts`). Applied vacancies come only from `GET /applications/mine` and `myApplication` on vacancies.
- Files, one per request, max 4 MB: `PATCH|DELETE /users/:id/avatar` (multipart field `avatar`, JPEG/PNG/WebP), `PATCH|DELETE /users/:id/cv` (field `cv`, PDF only), `PATCH /users/:id/cv-visibility { isCvPublic }`, `PATCH /users/:id/contact-visibility { isEmailPublic?, isPhonePublic? }` (self; both default `false`; one switch sends only its own field, unsent fields stay as they are; an empty body gives 400), `PATCH /users/:id/profile-visibility { isProfilePublic }` (self; default `true`; does not change `isCvPublic`), `GET /users/:id/cv` returns a link valid 5 minutes (the owner always; an approved company only when `isProfilePublic` and `isCvPublic` are both true; everyone else, admins included, gets 404 `CV not found`).
- **Public profile:** `GET /users/:id/profile`, no login needed (send the token when you have one, so the owner is recognized). Unknown user: 404. Fields: `id`, `firstName`, `lastName`, `avatarUrl`, `isPrivate`. When `isPrivate` is true (profile switched off, viewer is not the owner) only those fields come back: show name, avatar and "This profile is private" (like a private Steam profile). Otherwise `hasCv` is present, plus `email` only when the user turned `isEmailPublic` on and `phone` (may be `''`) only when `isPhonePublic` is on (both default off; the owner always gets both). `hasCv`: `hasCv` is true for the owner whenever a CV exists, and for an approved company only when a CV exists, `isCvPublic` is on and the profile is public. Show a "View CV" button only when `hasCv` is true; it calls `GET /users/:id/cv`. The owner always sees the full view, even with the profile switched off.

## Companies (`/companies`)

- `GET /companies` admin. `GET /companies/:id` self or admin (private: has email, phone, director). `PATCH /companies/:id` self. `PATCH /companies/:id/approve` and `/revoke` admin. `DELETE /companies/:id` self or admin. `PATCH /companies/:id/plan` self (see Billing).
- Response fields: `_id`, `googleId?`, `createdAt`, `updatedAt`, `companyName`, `email`, `isVerified`, `approved`, `phone`, `location`, `description`, `website`, `operatingCities`, `director?`, `logoUrl`, `isProfileComplete`, and the billing fields `plan?` (`payAsYouPublish`, `plus`, `elite`; missing until a plan is chosen), `credits`, `purchasedCredits`, `planRenewsAt?`, `planEndsAtPeriodEnd`. `id` (the same value as `_id`) and `__v` are also present; use `_id` and ignore `__v`. `GET /auth/me` returns the same for a company. `''` clears `phone`, `location`, `website`; `director: null` removes the director.
- `isProfileComplete` is true only when `companyName` and `description` are not empty and a `plan` is chosen. `PATCH /companies/:id/approve` answers 400 until then (the admin screen must show why).
- Logo: `PATCH|DELETE /companies/:id/logo` (field `logo`).
- **Deleting a company** (`DELETE /companies/:id`) also deletes its vacancies, their applications and bookmarks, its notifications and its logo. The company's Stripe billing account is closed at once: a paid plan (Plus or Elite) is cancelled (no more monthly charges, no refund for the rest of the month, unused credits are lost) and saved cards are removed. The confirm window must say so when `plan` is `plus` or `elite`. If Stripe cannot be reached the answer is 500 `Could not close the billing account, try again` and nothing is deleted; let the company retry.
- An unapproved company cannot create or edit vacancies, submit them or extend them (403). Show "Waiting for admin approval". Closing and deleting a vacancy and reading stay allowed.
- **Public company profile:** `GET /companies/:id/profile`, no login needed. Approved companies only: a missing, unapproved or revoked company gives 404, so do not link a company name to this page unless it is approved. Fields: `id`, `companyName`, `description`, `website`, `location`, `operatingCities`, `logoUrl`, `email`, `phone`, `director` (`{ fullName, phone }` or `null`). Billing and account fields are never returned.

## Vacancies (`/vacancies`)

Fields: `title`, `description`, `category`, `employmentType` (`full-time`, `part-time`, `internship`, `temporary`), `workMode` (`remote`, `onsite`, `hybrid`), `location` (required unless remote), `salaryMin?`, `salaryMax?`, `currency` (`USD`, `GEL`, `EUR`), `requirements` (max 20), `deadline` (in the future, at most 60 days from today), `photos` as `[{ id, url }]` (max 3), `company` (id only), `status`, `createdAt`. Owner and admin also get `rejectionReason`, `submittedAt?`, `firstPublishedAt?`, `freeWindowEndsAt?` and `updatedAt`. The last three are missing until the vacancy is first approved (`submittedAt` until it is submitted).

Status values the API returns: `notSubmitted`, `pending`, `published`, `rejected`, `closed`, `expired`. `notSubmitted` and `expired` are worked out by the server; the database never stores them. `notSubmitted` means created but not yet sent for review. `expired` means the deadline has passed and the vacancy is not closed. `notSubmitted` vacancies are visible only to their owner company (admins never see them, the public gets 404).

Response ids: a vacancy uses `id` (not `_id`).

### Lists return light cards (breaking change)

`GET /vacancies`, `GET /vacancies/mine` and `GET /vacancies/admin` return light cards, not full vacancies. Every card has:

```
{ id, title, excerpt, category, employmentType, workMode, location, salaryMin, salaryMax, currency, deadline, createdAt, company, companyName, logoUrl, status, companyApproved }
```

(`companyName`, `logoUrl` and `companyApproved` are on every card except `GET /vacancies/mine`, where every card is the caller's own company.)

- `company` is the company id. `companyName` and `logoUrl` (`''` when there is no logo: show no logo and a thinner card, see "Pictures" under Base) come with it, so show the employer on every card and on the details page from these fields. Delete `useCompanyNames` and the `CompanyCard` fetch: they call `GET /companies/:id`, which is self or admin only, so visitors and users get 403. A revoked company still sends its name and logo; show the name as plain text (see `companyApproved` below).

- `excerpt`: the start of the description, at most 250 characters, cut at a word boundary and ending with `...` (the whole text when it is shorter). Cards have no `description` and no `requirements`; the details page has them.
- `salaryMin` and `salaryMax` are `null` when not set (the details page still leaves them out when not set).
- `companyApproved: false`: show the warning "This company currently has no approved status" and the company name as plain text (its public page answers 404).

Per list:
- `GET /vacancies` (public): also `myApplication` and `isBookmarked` (below). `status` is always `published`. No photos.
- `GET /vacancies/mine` (company): no `companyApproved` (every card is the caller's own company; show one banner or icon at the top of the dashboard from `approved` on `GET /auth/me`, not a warning on each card). Also `rejectionReason`, `submittedAt?`, `firstPublishedAt?`, `freeWindowEndsAt?`, `updatedAt`, and `photos` as `[{ id, url }]` (kept for the delete confirm, which counts them).
- `GET /vacancies/admin`: also `rejectionReason`, `submittedAt?`, `firstPublishedAt?`, `freeWindowEndsAt?`, `updatedAt`. No photos. Admin vacancies page: default the status filter to `pending` on first load, since pending vacancies are the admin's main work; clearing the filter (no `status`) shows all submitted vacancies.

`GET /vacancies/:id` still returns the full vacancy (photos, description, requirements, `status`) and now also `companyName`, `logoUrl`, `companyApproved`, `myApplication` and `isBookmarked`. Create, update, close, submit, extend, approve, reject, photo and delete responses keep the full vacancy without these five fields.

**`myApplication` and `isBookmarked`** (on public cards, bookmark cards and the details page):
- `myApplication`: `{ id, status, canReapply, submissions }` or `null` when the user never applied. `canReapply` is true only when the application is `rejected` or `withdrawn`, it was the first submission, it is not locked, the vacancy is `published` (not expired) and the company is approved.
- `isBookmarked`: `true` or `false`.
- Real values only for a request with a user token. Anonymous visitors, companies and admins always get `null` and `false`.

**Send the token.** `GET /vacancies` now reads an optional token (a missing or bad token counts as anonymous). The vacancies page and the latest-vacancies block on the home page load on the Next.js server, which has no access to the token in `localStorage`. For a logged-in user, fetch the list (and the details page) from the browser with the `Authorization` header, or `myApplication` is always `null` and `isBookmarked` always `false`. Anonymous visitors can keep the server-rendered list.

**Parsers to change.** `parseVacancy` requires `requirements`, which cards do not have, so list items (public list, home latest block, `mine`, `admin`) need a card parser; the details page keeps the full parser.

**Apply button** (cards and details page, role `user`):
- Green "Apply", clickable: `myApplication` is `null` and the vacancy is open (published, not expired, `companyApproved` true).
- Blue "Reapply", clickable: `myApplication.canReapply` is true.
- Grey "Applied" (`submissions` 1) or "Reapplied" (`submissions` 2), disabled: any other application.
- Grey "Apply", disabled: no application and the vacancy is expired, closed or `companyApproved` is false.
- The button text never says why it is disabled; a tooltip on a wrapper around the button shows the reason on hover, and on tap on phones.
- Anonymous visitors see Apply; it goes to sign-in.
- TODO (later, decided 2026-11-12): also show a small badge with the application status on cards and the details page, read from `myApplication.status` (for example "Interview" or "Rejected"). The backend already sends it; no backend change.

**Bookmark heart** (cards and details page): only for logged-in users, filled when `isBookmarked` is true; a click calls `POST` or `DELETE /vacancies/:id/bookmark`. Hidden for anonymous visitors (decided), and for companies and admins, who cannot bookmark (403).

| Route | Who |
| --- | --- |
| `GET /vacancies` | public, published and not expired |
| `GET /vacancies/:id` | public sees `published` and `closed`; the owner sees all; an admin sees every submitted vacancy (a `notSubmitted` one gives 404) |
| `GET /vacancies/mine` | company, all statuses including `notSubmitted`, filter `status` |
| `GET /vacancies/admin` | admin, submitted vacancies only, filters `status` (not `notSubmitted`: 400), `companyId` |
| `POST /vacancies` | company, JSON body. Creates a `notSubmitted` vacancy (not final, see below). Send photos separately. 404 `Company not found` if the company was deleted while the request ran |
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
  - `{ kind: 'vacancy', paid, vacancyId?, purpose? ('submit' or 'extend'), vacancyStatus?, deadline?, credits, purchasedCredits }` (`vacancyStatus` is the same derived status as in the vacancy list). `vacancyStatus` and `deadline` are missing when the vacancy no longer exists (deleted after paying; the payment then became one purchased credit). `vacancyId` and `purpose` come from the Stripe session and may be missing on a session not made by this site. Treat all four as optional.
  If `paid` is false show "Payment not completed".
- **Saved cards:** the Stripe payment page for a vacancy (submit or extend) lists the company's saved cards, including the card of its plan, so the company can pick one, or type a new card and tick "save" to keep it for next time. Plan checkouts save their card automatically, because the monthly renewal needs it. The page and the cards are Stripe's; the site stores no card data and needs no card form. Add one line near the billing button: "Your saved cards can be managed in the billing portal."
- **Portal:** `POST /payment/portal` (no body) returns `{ url }`. The company adds and removes saved cards, chooses the default card (the one plan renewals charge), cancels the plan and sees invoices there, and returns to `/company/billing`. 400 `No billing account yet` for a company that never started a Stripe payment (a vacancy payment page or a plan checkout creates the billing account, even if the company leaves without paying). Cancelling keeps the plan until the end of the billing period: `planEndsAtPeriodEnd` is true and `planRenewsAt` is the end date, show "Ends on <date>".
- **Plan ends.** If a renewal payment fails the plan ends at once: `plan` becomes `payAsYouPublish` and `credits` becomes 0, and the company gets an email. If the bank asks for confirmation (3D Secure) the plan stays for up to 5 days while the company confirms through the emailed link. Published vacancies are not affected when a plan ends.
- **Warnings to show:** no cash refunds anywhere; a rejected never-published vacancy returns its credit; a published vacancy is never refunded.
- The webhook (`POST /payment/webhook`) is Stripe to backend only. Do not call it.
- Rate limit: checkout, portal, plan, submit and extend allow 5 requests a minute (429).

## Applications

Built: apply, reapply and withdraw (users), the user's own list, the company's applicant list, status changes by the company, links to the application files, and `myApplication` on vacancy cards and the details page (see "Lists return light cards" under Vacancies).

**Apply or reapply:** `POST /vacancies/:id/applications`, `multipart/form-data`. All fields are optional, so a user can apply with nothing at all:
- `message`: text, at most 100 words and 800 characters (trimmed; empty means no message).
- `useProfileCv`: `true` or `false`. `true` attaches a copy of the user's profile CV.
- `cv`: one PDF file, at most 2 MB. Do not send it together with `useProfileCv: true` (400).
- `coverLetter`: one PDF file, at most 2 MB.
- `keepPrevious`: `true` or `false`, used only on a reapply (ignored on a first apply). `true` keeps the message, CV and cover letter the application already holds for every field the request does not send again. A field that is sent replaces the old one. After a reject the application still holds everything the user sent; after a withdraw it holds nothing, so there is nothing to keep.

The same route sends a first application and a reapply. Response (both apply and withdraw):

```
{ id, vacancy, status, message, hasCv, hasCoverLetter, submissions, locked, viaInvitation, previousOutcome, appliedAt, firstAppliedAt }
```

`viaInvitation` is `true` when the latest submission was made by accepting a company's invitation (see "Invitations"); a normal apply or reapply sets it to `false`.

`status`: `submitted`, `viewed`, `interview`, `accepted`, `rejected`, `withdrawn`. `submissions` is 1 or 2. `previousOutcome` is `null`, or `withdrawn` / `rejected` after a reapply. `message` is `''` when none. `appliedAt` is the time of the latest submission; `firstAppliedAt` is the time of the first one and never changes, so on a reapply (`submissions` 2) show both, the original time in a quieter style and the reapply time as the main one (design is up to the frontend).

Errors:
- 404 `Vacancy not found`: the vacancy does not exist or is not public, or it was deleted while the request ran (nothing is saved then).
- 404 `User not found`: the account no longer exists (an old token after account deletion). Sign the person out.
- 400 `This vacancy is closed`, `This vacancy has expired`, `This company is not accepting applications right now` (the company is not approved).
- 400 `You have no profile CV` (with `useProfileCv: true`), 400 `Choose either your profile CV or a new CV file, not both`, 400 `Only PDF files are allowed`. A file over 2 MB gives 413.
- 409 `You already applied to this vacancy`: an active application exists.
- 409 `You cannot apply to this vacancy again`: both attempts are used, or the user withdrew an accepted application.
- 403 for a company or admin token.

**Reapply rules:** a user gets at most two submissions per vacancy, never two active at once. A reapply is allowed only after the first application ended (`rejected` by the company or `withdrawn` by the user), and never after withdrawing an `accepted` application (`locked: true`). A reapply replaces the old files and message with the newly sent ones; anything not sent is removed, unless `keepPrevious: true` is sent, which keeps every field that is not sent again.

**Same-content warning (decided 2026-11-09):** when a user reapplies after a reject, the frontend warns if the new submission would repeat the rejected one. It counts as a repeat when `keepPrevious: true` is sent with nothing new, or when the old application had no message, no CV and no cover letter and the new one has none either (the user was rejected for an empty application and is sending an empty one again), or when the typed message equals the old one and no file changed. The text is the same in every case, for example: "Sending new files or a new message is recommended, because this application was rejected earlier and you are about to send the same content again." Two buttons, yes (send anyway) and no (go back to the form). The frontend needs the old message, `hasCv` and `hasCoverLetter` for this: they come from `GET /applications/mine`. A reapply after a withdraw has no old content, so only the empty-versus-empty case can apply.

**Withdraw:** `PATCH /applications/:id/withdraw` (no body). Allowed from `submitted`, `viewed`, `interview` and `accepted`, whatever the vacancy status. It deletes the CV copy, the cover letter and the message. Errors: 400 `Application is already withdrawn`, 400 `A rejected application cannot be withdrawn`, 403 `No permission` (someone else's), 404 `Application not found`, 409 `Application changed, try again` (the company changed the status at the same moment; reload and retry).

**Apply flow in the UI (decided 2026-11-09):**
- The full apply form (message, CV choice, cover letter) lives only on the vacancy details page. One CV source at a time: the profile CV or a new upload.
- The Apply button on a vacancy card opens a small confirm window saying that a CV, a cover letter and a short message can be attached on the details page. Its buttons are "Apply anyway" (sends the apply request with no message and no files), "Go to details" (opens the details page with the apply form), and a separate "Cancel" (closes the window, sends nothing, the user keeps browsing). Reapply from a card works the same way, with "Reapply anyway".
- A visitor who is not logged in also sees Apply; it goes to sign-in.
- Message counters (decided 2026-11-09): the textarea always shows a word counter, "42 / 100 words", counted like the backend (trim, split on whitespace, empty text is 0). The textarea has a hard `maxLength={800}`. A character counter, "790 / 800 characters", appears only once the text passes about 700 characters, turns red at 800, and its space is reserved so the layout does not jump.
- Show a disclaimer on the form when sending without a CV, without a cover letter or message, or with none of them.
- Always show this note on the apply form (and in the card's confirm window): "Applying shares your email and phone number with this company, even if they are private on your profile." The vacancy's company sees the applicant's current email and phone in its applicant list whatever the profile switches say; no other company, user or admin sees them through applications.
- On a reapply, show that this is a reapply after a withdraw or a reject (from `previousOutcome`) and that no attempts remain after it.
- Withdraw asks first: "Withdraw and delete your CV and cover letter from this application?", with a warning that only one reapply is allowed.
- Rate limit: apply and withdraw allow 5 requests a minute (429).

Account deletion: deleting a user keeps their applications for the company as "Deleted user" with no name, files or message. Deleting a vacancy or a company deletes its applications.

### My applications (role `user`)

`GET /applications/mine?page=&take=&status=&q=&sort=`: the user's own applications, newest `appliedAt` first by default. `take` defaults to 10, max 30.
- `status`: filters by application status (any of the six).
- `q`: searches the vacancy title, up to 64 characters. Each typed word (at most 5) must start a word in the title, case ignored, in any order. It combines with `status` and `sort`; `total` respects it. Send it after a short typing pause and reset `page` to 1 when it changes.
- `sort`: `-date` (default, newest first) or `date` (oldest first), by the time of the latest submission (`appliedAt`).

 Response `{ items, total, page, take }`; each item is the apply response above plus:

```
{
  ...apply response fields,
  vacancy: { id, title, company, companyName, logoUrl, deadline, status } | null,
  companyApproved,
  canReapply
}
```

- `vacancy.status` is `published`, `expired`, `closed` or `unavailable`. `unavailable` means the company edited the vacancy and it waits for admin review (or the edit was rejected); the details page answers 404 to users meanwhile. Show "Temporarily unavailable" and the title as plain text. Link the title to the vacancy only for `published`, `expired` and `closed`. The application itself always stays in the list and keeps its own status. While `unavailable`, `vacancy.title` is the last title the admin approved, never the edited one, and `q` searches that same title.
- `vacancy` is `null` only if the vacancy was deleted during the request (its applications are deleted with it); skip such an item.
- `companyApproved: false`: show the warning "This company currently has no approved status" and the company name as plain text (its public page answers 404).
- `canReapply: true` shows the blue Reapply button on that item. It is true only when the application is `rejected` or `withdrawn`, it was the first submission, it is not locked, the vacancy is `published` and the company is approved.
- Use skeleton loaders while the list loads.

### Applicant list (role `company`)

`GET /vacancies/:id/applications?page=&take=&status=&q=&sort=&focus=`: the applicants of one of the company's own vacancies. Only an approved company can use it (403 `Your company must be approved to manage applications`; the applications stay and show again after approval). 404 `Vacancy not found`, 403 `No permission` for another company's vacancy.
- `status`: filter by application status.
- `q`: name search, up to 64 characters (a search box above the list). Each typed word (at most 5) must start the first name or the last name, case ignored, in any order: "ana zu" finds Ana Zuri. Withdrawn and deleted-user rows never match, so they disappear while `q` is set. `total`, `sort` and `focus` all respect `q`; results keep the chosen `sort` (no match ranking). Send it after a short typing pause, and reset `page` to 1 when it changes.
- `sort`: `-date` (default, newest `appliedAt` first), `date`, `name` (last name, then first name, A to Z, case ignored; a user without a last name sorts by first name), `-name`, `age` (youngest first), `-age` (oldest first). In the name and age sorts hidden rows go last; in the age sorts applicants without a birth date (Google sign-ups) come after those with one and before hidden rows.
- `focus=<applicationId>`: returns the page that contains that application for the given `status` and `sort`, and `page` in the response is that page. Show it, scroll to the row with that `id` and highlight it. Use it when a notification opens an applicant. If the application is not in the filtered list, the requested `page` is returned as usual.

Response `{ items, total, page, take }`. Two item shapes, told apart by `hidden`:

```
{
  id, status, appliedAt, firstAppliedAt, hidden: false,
  isReapply, viaInvitation, previousOutcome, message, hasCv, hasCoverLetter,
  applicant: { id, firstName, lastName, avatarUrl, email, phone, age }
}
{ id, status, appliedAt, hidden: true }
```

- `viaInvitation: true`: the applicant applied by accepting this company's invitation from one of their publications. Show a small "Invited" badge on the row. Such an application has no message; its CV and cover letter are copies of the publication's files (either may be missing).

- `hidden: true` is a withdrawn application or a deleted user. Show only the status ("Withdrawn" or "Deleted user") and the time, no link, no files, no status controls. `id` is the application's id, for the row key and `focus`.
- `isReapply` is true on a second submission; then show `previousOutcome` and the reapply time (`appliedAt`) as the main time and `firstAppliedAt` in a quieter style.
- `age` is `null` for applicants without a birth date: show nothing. `avatarUrl` is `''` when none: show the default user picture (see "Pictures" under Base). Small square avatar.
- `applicant.id` links to the public profile `GET /users/:id/profile`. Application data (message, files, email, phone) is shown here whatever the user's profile switches say.
- Use skeleton loaders while the list loads.

### Status change (role `company`)

`PATCH /applications/:id/status { status }`, `status` one of `viewed`, `interview`, `accepted`, `rejected`, in any order (a rejected application can be changed later). Approved company owning the vacancy only. Returns `{ id, status, appliedAt }` only; update the status on the card you already have, do not expect applicant details in the answer. Errors: 404 `Application not found`, 403 `No permission`, 403 `Your company must be approved to manage applications`, 400 `A withdrawn application cannot be changed`, 400 `This applicant deleted their account` (status controls are hidden on hidden rows, so this only comes from a direct call), 409 `Application changed, try again` (the user withdrew at the same moment; reload).

### Application files (roles `user` and `company`)

`GET /applications/:id/cv` and `GET /applications/:id/cover-letter` return `{ url, expiresIn }`, a link valid 300 seconds, the same shape as `GET /users/:id/cv`. Allowed for the applicant and for the vacancy's approved company; everyone else, and any withdrawn application, deleted user or missing file, gets 404 `File not found`. Admins get 403. Show "CV" and "Cover letter" buttons only when `hasCv` / `hasCoverLetter` is true.
- The PDF opens in the browser's PDF viewer; the viewer chooses whether to download it.
- Call the route on every click and never store the link: after 5 minutes it answers an S3 "Access Denied" page (a download already started still finishes).
- Open it in a new tab without being stopped by pop-up blockers: on click, open an empty tab first (`const tab = window.open('', '_blank')`), then set `tab.location.href = url` when the request answers, and close the tab if the request fails.

## Notifications (roles `user` and `company`, `/notifications`)

A bell in the header for users and companies. Admins get 403 on every route. The backend creates notifications by itself when the events below happen; the frontend only reads and manages them.

| Route | Body / query | Returns |
|---|---|---|
| `GET /notifications/badge` | none | `{ unseenCount }` |
| `PATCH /notifications/seen` | none | `{ unseenCount: 0 }` |
| `GET /notifications` | `page`, `take` (use `take=5`) | `{ items, total, page, take, unreadCount }`, newest first |
| `PATCH /notifications/:id/read` | none | the notification |
| `PATCH /notifications/:id/lock` | `{ locked: true \| false }` | the notification |
| `DELETE /notifications/:id` | none | the deleted notification |
| `DELETE /notifications` | none | `{ deleted }` (number removed) |

**Item:** `{ id, type, read, createdAt, data, target, locked, expiresAt, lockedAt, daysLeft, hoursLeft }`.
- `type`: one of the fifteen below. Build the sentence from `type` and `data`.
- `data`: a snapshot taken when the notification was made, so it stays readable after the vacancy, publication or company changes or is deleted. Only the fields a type needs are present: `vacancyTitle`, `companyName`, `status`, `reason`, `planName`, `isReapply`, `publicationTitle`, `alreadyApplied`. `{}` when none.
- `target`: `{ vacancyId, applicationId, publicationId, invitationId }`, each a string or `null`. The target may be deleted by now; a 404 when opening it is normal (show a short "This item no longer exists" message).

**Types.** Who gets it, when, which fields are present, and where a click goes. The suggested sentences are examples; keep them short.

| `type` | Recipient | When | `data` | `target` | Click opens | Example sentence |
|---|---|---|---|---|---|---|
| `newApplication` | company | a user applies or reapplies to one of its vacancies | `vacancyTitle`, `isReapply` | `vacancyId`, `applicationId` | the vacancy's applicant list with `focus=<applicationId>`: jump to the page it returns, scroll to the row and highlight it | "New application for Frontend Developer" / "New reapplication for ..." when `isReapply` |
| `applicationWithdrawn` | company | a user withdraws an application to its vacancy | `vacancyTitle` | `vacancyId`, `applicationId` | the same applicant list with `focus` (the row is now a hidden withdrawn row) | "An applicant withdrew from Frontend Developer" |
| `vacancyApproved` | company | an admin approves its vacancy | `vacancyTitle` | `vacancyId` | the company's vacancy detail | "Frontend Developer is published" |
| `vacancyRejected` | company | an admin rejects its vacancy | `vacancyTitle`, `reason` (only when the admin gave one) | `vacancyId` | the company's vacancy detail | "Frontend Developer was not approved: <reason>" |
| `companyApproved` | company | an admin approves the company | `companyName` | none | the company dashboard | "Your company is approved" |
| `companyRevoked` | company | an admin revokes the company's approval | `companyName` | none | the company dashboard | "Your company approval was revoked" |
| `planEnded` | company | a paid plan ends: a failed renewal or a cancellation that reached its end date | `planName` | none | `/company/billing` | "Your Plus plan has ended" |
| `planPaymentActionRequired` | company | a plan renewal needs the bank's confirmation (3D Secure); the company has 5 days, and if it does not confirm, `planEnded` follows | `planName` | none | `/company/billing` | "Your bank needs a confirmation for your Plus renewal. Check your email within 5 days to keep your plan." |
| `applicationStatusChanged` | user | a company moves the user's application to `interview`, `accepted` or `rejected` (never for `viewed`) | `vacancyTitle`, `companyName`, `status` | `vacancyId`, `applicationId` | the vacancy detail (`/vacancies/:vacancyId`); once a "My applications" page exists, that page with the application highlighted | "Acme moved your application for Frontend Developer to interview" |
| `applicantCompanyRevoked` | user | an admin revokes a company the user has an active (not withdrawn) application with; one notice per revoke, however many of its vacancies the user applied to | `companyName` | none | "My applications" when that page exists, otherwise nothing (mark read only) | "Acme is no longer approved; your applications to it are on hold" |
| `publicationApproved` | user | an admin approves the user's publication (new or edited) | `publicationTitle` | `publicationId` | the user's publication detail | "Your publication Frontend Developer is published" |
| `publicationRejected` | user | an admin rejects the user's publication | `publicationTitle`, `reason` (only when the admin gave one) | `publicationId` | the user's publication detail | "Your publication Frontend Developer was not approved: <reason>" |
| `invitationReceived` | user | an approved company invites one of the user's publications to one of its vacancies | `companyName`, `vacancyTitle`, `publicationTitle` | `vacancyId`, `publicationId`, `invitationId` | `/invitations?focus=<invitationId>` | "Acme invited you to apply to Frontend Developer" |
| `invitationAccepted` | company | the user accepted the company's invitation; when the accept created or reapplied an application, this is also the company's notice of it (no separate `newApplication` is sent) | `vacancyTitle`, `publicationTitle`, `isReapply` (true when accepting used the user's reapply), `alreadyApplied` (true when the user already had an active application on that vacancy, so the accept created nothing; the application is the one the company already knows, and its row has no "Invited" badge) | `vacancyId`, `applicationId`, `invitationId` | the vacancy's applicant list with `focus=<applicationId>` (the row has the "Invited" badge unless `alreadyApplied`) | "Your invitation was accepted: new application for Frontend Developer"; when `alreadyApplied`: "Your invitation for Frontend Developer was accepted; the applicant had already applied" |
| `invitationDeclined` | company | the user declined the company's invitation | `vacancyTitle`, `publicationTitle` | `vacancyId`, `invitationId` | the company's sent invitations, filtered to that vacancy | "Your invitation for Frontend Developer was declined" |

Approving an already approved company or revoking an already revoked one creates nothing. A company approved, revoked, approved and revoked again gets a notice each time.

**Tone, color and icon.** Show importance with three tones, not a color per type, and keep the panel calm:
- Color only on a small icon and a thin left border of the item. Text and background stay the normal theme colors.
- No red inside the panel: red belongs to the badge. Amber is the strongest tone.
- Read state is separate: unread bold, read normal, in every tone.

| Tone | Color | Types |
|---|---|---|
| Positive | green | `vacancyApproved`, `companyApproved`, `publicationApproved`, `invitationReceived`, `invitationAccepted`, `applicationStatusChanged` with `status` `interview` or `accepted` |
| Needs attention | amber | `vacancyRejected`, `companyRevoked`, `planEnded`, `planPaymentActionRequired`, `applicantCompanyRevoked`, `publicationRejected`, `applicationStatusChanged` with `status` `rejected` |
| Info | neutral (the theme's muted color) | `newApplication`, `applicationWithdrawn`, `invitationDeclined` |

Each type also gets its own icon shape, so items differ even within one tone (lucide names): `newApplication` inbox, `applicationWithdrawn` undo, `vacancyApproved`, `companyApproved` and `publicationApproved` check, `vacancyRejected` and `publicationRejected` x, `companyRevoked` and `applicantCompanyRevoked` shield-off, `planEnded` credit-card, `planPaymentActionRequired` triangle-alert, `applicationStatusChanged` calendar for `interview`, check for `accepted`, x for `rejected`, `invitationReceived` mail, `invitationAccepted` handshake, `invitationDeclined` mail-x.

**Emails.** Some events also send an email; the bell notification is created either way. Emailed: `companyApproved`, `companyRevoked`, `applicationStatusChanged`, `invitationReceived`, `planEnded` only after a payment failure (a failed renewal or a 3D Secure confirmation that was not made in time; a cancellation the company chose gets the bell only), and `planPaymentActionRequired` (the email carries the confirmation link; the bell notice only points to billing and the email). Not emailed: `vacancyApproved`, `vacancyRejected`, `newApplication`, `applicationWithdrawn`, `applicantCompanyRevoked`, `publicationApproved`, `publicationRejected`, `invitationAccepted`, `invitationDeclined`. The email buttons link to these frontend pages, so keep them working: `/dashboard` (company approved or revoked), `/vacancies/:id` (application status), `/company/billing` (plan ended), `/invitations?focus=<invitationId>` (invitation received).

**Badge.** Red circle on the bell with `unseenCount`: notifications created since the bell was last opened. The number is capped at 100, so show `99+` when it is above 99, and hide the circle at 0. Call `GET /notifications/badge` on page load and refresh it every 5 minutes, only while the browser tab is visible (every call is a backend function run, so do not poll faster). When the user opens the bell, call `PATCH /notifications/seen` and hide the circle. The badge has nothing to do with read state.

**Panel.** Opens in the page (not a new page or tab) and loads `GET /notifications?take=5&page=N`; pages change inside the panel. Unread items (`read: false`) are bold, read ones normal. A click calls `PATCH /notifications/:id/read`, then opens the target. `unreadCount` is there if you want to show it. Use skeleton loaders while it loads.

**Lifetime and lock.** Every notification is deleted automatically 30 days after it was created. The lock icon is one toggle button: send `{ locked: !item.locked }` and replace the item with the answer. Locking freezes the countdown; unlocking resumes it with the time that was left (locked with 1 day left, unlocked a week later: deleted 1 day after unlocking). Sending the state it already has changes nothing.
- Show the countdown from the backend values, never compute dates yourself.
- Do not print the countdown as a text line on every notification. Show a small warning icon only on unlocked notifications with `daysLeft` 5 or less (including `daysLeft` 0 with `hoursLeft`); older ones and locked ones show no warning. On hover (desktop) or tap (phones) it opens a tooltip with the countdown text below, and for an unlocked notification a hint that the lock icon keeps it. The icon needs its own tap target, so tapping it does not open the notification.
- Unlocked (`locked: false`): `expiresAt` is set, `lockedAt` is `null`. Show "Deleted in N days" from `daysLeft`; when `daysLeft` is 0, show "Deleted in N hours" from `hoursLeft`, or "Deleted in less than an hour" when `hoursLeft` is 0. You may also show the date from `expiresAt`.
- Locked (`locked: true`): `expiresAt` is `null`, `lockedAt` is the time it was locked. Show "Frozen, N days left" (`daysLeft`, or hours from `hoursLeft` when `daysLeft` is 0, or "less than an hour left" when `hoursLeft` is 0) and "locked since <lockedAt>".
- `daysLeft` rounds up (a new notification shows 30). `hoursLeft` is `null` whenever `daysLeft` is 1 or more; under one day it is a whole number of hours rounded down, so `0` means under an hour. Check `hoursLeft !== null`, not whether it is truthy.

**Deleting.** The X on an unlocked notification calls `DELETE /notifications/:id` at once. The X on a locked one first asks "Delete this locked notification?" and deletes only after confirming. "Clear all" calls `DELETE /notifications`, which skips locked notifications; reload the panel afterwards.

**Errors.** 404 `Notification not found` (wrong id, another account's notification, or already deleted), 409 `Notification changed, try again` on lock when another tab changed it at the same moment (reload), 400 when `locked` is missing or not a boolean.

## Bookmarks (role `user`, saved vacancies)

Only users bookmark; companies and admins get 403 on all three routes.

- `POST /vacancies/:id/bookmark`: adds. No body. Answers `{ bookmarked: true }`. Sending it again changes nothing and answers the same, so a double click is safe. 404 `Vacancy not found` unless the vacancy is publicly visible: published, expired or closed ones can be bookmarked; drafts, pending and rejected ones answer 404, the same as the details page.
- `DELETE /vacancies/:id/bookmark`: removes. Answers `{ bookmarked: false }` whether or not it was bookmarked. Works for any vacancy id, so an unavailable vacancy can still be removed from the list.
- `GET /bookmarks?page=&take=`: the user's bookmarks, newest bookmark first. `take` defaults to 10, max 30. Answers `{ items, total, page, take }`.

```
{
  id,
  createdAt,
  vacancy: { id, title, excerpt, category, employmentType, workMode, location, salaryMin, salaryMax, currency, deadline, createdAt, company, companyName, logoUrl, status, companyApproved, myApplication, isBookmarked } | null
}
```

Breaking change: `vacancy` is now the same light card as the public list (see "Lists return light cards" under Vacancies), and `companyApproved` moved from the item into `vacancy`. Render it with the same card component, so Apply, Reapply and the heart behave the same as on the main list; `isBookmarked` is always `true` here.

- `id` is the bookmark id; use `vacancy.id` for the remove call and for links.
- `vacancy.status` is `published`, `expired`, `closed` or `unavailable`. `unavailable` means the company edited the vacancy and it waits for admin review (or the edit was rejected); the details page answers 404 to users meanwhile. Show "Temporarily unavailable" and the title as plain text, with the remove button. Link the title only for `published`, `expired` and `closed`. Bookmarks of unavailable, closed and expired vacancies stay in the list until the user removes them.
- While `unavailable`, the card shows the last version the admin approved (title, excerpt, category, work mode, employment type, location, salary, currency), never the edited one; `deadline` and `status` are current.
- `salaryMin` and `salaryMax` are `null` when not set.
- `vacancy` is `null` only if the vacancy was deleted during the request (bookmarks are deleted with it); skip such an item.
- `vacancy.companyApproved: false`: show the warning "This company currently has no approved status" and the company name as plain text (its public page answers 404).
- Deleting the user account deletes the bookmarks.
- Use skeleton loaders while the list loads.

## Publications (job seekers' "looking for a job" posts)

A user publishes a post saying what job they are looking for; an admin reviews it; approved companies browse published posts and invite the user to one of their vacancies. Free for users. Built: the user side, admin review, the company board (browse, open, files) and invitations (see "Invitations" below).

Only role `user` creates and manages publications; admins review them. Approved companies browse the board and open publications and their files (read only); every other publication route answers 403 for companies.

**Routes (owner = the user who created it):**

| Route | Who | Body / query | Returns |
|---|---|---|---|
| `POST /publications` | user | JSON, fields below | the publication |
| `GET /publications` | approved company or admin | board query, see "Company board" | `{ items, total, page, take }` (cards) |
| `GET /publications/mine` | user | `page`, `take`, `status`, `sort` (`date`, `-date`, default `-date`) | `{ items, total, page, take }` |
| `GET /publications/:id` | owner, admin, or approved company | none | the publication (another user: 403; a company gets the company view, see "Company board") |
| `PATCH /publications/:id` | owner | JSON, any fields below | the publication |
| `PATCH /publications/:id/accepting-invites` | owner | `{ acceptingInvites: true \| false }` | the publication |
| `PATCH /publications/:id/close` | owner | none | the publication |
| `POST /publications/:id/extend` | owner | none | the publication |
| `DELETE /publications/:id` | owner | none | the deleted publication |
| `PATCH /publications/:id/cv` | owner | multipart, field `cv` | the publication |
| `PATCH /publications/:id/cover-letter` | owner | multipart, field `coverLetter` | the publication |
| `DELETE /publications/:id/cv`, `/cover-letter` | owner | none | the publication |
| `GET /publications/:id/cv`, `/cover-letter` | owner, admin, or approved company | none | `{ url, expiresIn }` (presigned, 300 s) |
| `GET /publications/admin` | admin | `page`, `take`, `status`, `sort`, `userId` | `{ items, total, page, take }` |
| `PATCH /publications/:id/approve` | admin | none | the publication |
| `PATCH /publications/:id/reject` | admin | `{ reason? }` (max 1000) | the publication |

**Fields (create and edit):**
- `title` (required, max 128), `about` (required, max 3000 characters and 500 words), `category` (required, free text, max 64).
- `employmentTypes` (`full-time`, `part-time`, `internship`, `temporary`) and `workModes` (`remote`, `onsite`, `hybrid`): arrays, any number, no duplicates; empty means "any".
- `locations`: up to 10 cities or regions, each max 128. `skills`: up to 20, each max 50.
- `salaryMin`, `salaryMax`: optional desired range (`salaryMin` must be less than `salaryMax`, equal values answer 400; to ask for one fixed amount, send only `salaryMin`), `currency` (`USD` default, `GEL`, `EUR`). On edit `null` removes a salary.
- `experienceYears`: optional whole number 0 to 60. On edit `null` removes it.
- There are no contact fields on a publication. Companies never see the user's email or phone from a publication; they invite, and the user's profile email and phone become visible to that company only when the user accepts the invitation (it creates an application, as for any application). Tell the user this in the publication form: "Companies can invite you; your email and phone are shared only if you accept".
- Edits use the same fields; send only what changes. Empty strings for `title`, `about` and `category` answer 400; arrays sent empty clear the list.

**Item:** `{ id, user, title, about, category, employmentTypes, workModes, locations, salaryMin, salaryMax, currency, skills, experienceYears, acceptingInvites, hasCv, hasCoverLetter, status, expiresAt, createdAt, rejectionReason, timerPaused, updatedAt }`. `salaryMin`, `salaryMax`, `experienceYears` and `expiresAt` are `null` when not set; `rejectionReason` is `''` when none.

**Status:** `pending` (waiting for admin review), `published`, `rejected` (show `rejectionReason` when not empty), `closed` (final), `expired` (its 60 days ran out). There is no draft and no submit step: a new publication goes straight to `pending`.
- Editing a `published` or `rejected` publication, or uploading a CV or cover letter, sends it back to `pending` for a new review. Removing a file sends only a `rejected` one back. Show a short note before saving: "Changes need a new admin review; meanwhile companies cannot see this publication".
- On a `rejected` publication, tell the user to edit and resend it, or delete it to free a slot.
- `closed` and `expired` publications cannot be edited (400). Expired ones must be extended first.

**Limit: 3 active publications.** `pending`, `published` and `rejected` count; `closed`, `expired` and deleted ones do not. Creating a fourth, or extending an expired one while 3 others are active, answers 400 "You can have at most 3 active publications. Close or delete one first". Show the count (for example "2 of 3 active") on the "My publications" page and disable "New publication" at 3.

**Lifetime: 60 days, free to extend.**
- The 60 days start when an admin first approves it; `expiresAt` is the end date. Show "Visible until <expiresAt>" on published ones.
- While an edited publication waits for review (or was rejected after an edit), the timer is paused: `timerPaused: true`. Show "Timer paused during review" instead of the date. The paused time is added back when it is approved again.
- `POST /publications/:id/extend` works on `published` and `expired` ones (400 otherwise) and sets `expiresAt` to 60 days from now. Offer "Extend" on expired publications and on published ones close to the end.

**Accepting invites:** `acceptingInvites` (default `true`) is the user's own visibility switch, changed with `PATCH /publications/:id/accepting-invites`. When it is off, the publication disappears from the company board, companies can no longer open it or its files (404, except a company with an open or accepted invitation, see "Invitations"), and no new invites can come in; invitations already received stay and can still be accepted; the owner still sees it in their own list. It needs no review. It changes nothing else: `status`, `expiresAt` and `timerPaused` stay as they are, and the 60-day timer keeps running while the publication is hidden. Show it as a toggle on the publication, next to the status badge. Do not confuse it with `timerPaused`, which only means the lifetime timer is stopped while an edit waits for admin review. The wording and design of the toggle are up to the frontend.

**Creating a publication (one form, several requests).** The form shows the text fields, the CV and the cover letter on one screen with one "Create" button, but the backend takes them in separate requests, because of Vercel's request size limit:
1. `POST /publications` with the JSON fields.
2. Then, with the new `id`, upload the chosen files one after another: `PATCH /publications/:id/cv`, then `PATCH /publications/:id/cover-letter`.
Show a single "Saving..." state for the whole sequence. If an upload fails, the publication is already saved: keep the user on that publication and say "Publication saved, CV upload failed, try again" with a retry button for that file only. Never create the publication a second time. Uploading right after creating needs no extra review, because a new publication is already `pending`. Editing works the same way: send the changed fields with `PATCH /publications/:id`, then upload any changed file.

**Files:** CV and cover letter are PDFs up to 2 MB, one file per request (`cv` or `coverLetter` field). A new upload replaces the old file. Open them through the `GET` routes, inline in a new tab, the same way as application files. Errors: 400 `Only PDF files are allowed`, 413 when over 2 MB, 404 `CV not found` / `Cover letter not found` when removing a file that is not there, 404 `File not found` when opening one that does not exist.

**Close and delete:** "Close" (any status except closed) ends the publication for good and frees its slot; it stays in the list as closed. "Delete" removes it and its files at once; ask "Delete this publication and its CV and cover letter?" first. Deleting the account deletes all publications.

**Admin review page:** list `GET /publications/admin`. With no `status` it returns publications in every status, like `GET /vacancies/admin`; the admin page must default its filter to `pending` on first load (send `status=pending` and keep it in the page URL) and let the admin switch to the others. Each item has `user` (the user id) for a link to `/users/:id/profile`. The admin can open the CV and cover letter to check for scams. Approve and reject only work on `pending` (400 otherwise, 404 when it no longer exists, 409 "Publication changed, try again" when the user edited it at the same moment: reload). The user gets a bell notification for both.

**Admin: queue and account history.** Show these in two places, using the same list routes:
- **Admin panel (moderation queue):** `GET /vacancies/admin` and `GET /publications/admin`, both with `status=pending` set by the page on first load (neither route defaults to it). Approve and reject here.
- **An account's profile, admin view (history):** add a "Vacancies" tab on a company's profile and a "Publications" tab on a user's profile, listing every existing item of that account in any status (deleted ones are gone). Companies work now: `GET /vacancies/admin?companyId=<id>` (drafts stay hidden from admins). Users' publications: `GET /publications/admin?userId=<id>` returns all that user's publications in every status when no `status` is sent (built). Each item carries its owner id (`company` on vacancies, `user` on publications), so the queue can link to the profile and the tab can link back to the item.

**Company board (approved companies and admins).** `GET /publications` lists publications that are `published`, not expired and have `acceptingInvites` on. An unapproved company gets 403 `Company is not approved` (show the same "waiting for approval" banner as elsewhere); users get 403.
- Query: `page`, `take`, `q` (each word must start a word in the title, the about text or a skill; up to 5 words), `category` (exact, any case), `location` (word start in any of the preferred locations), `workMode`, `employmentType` (a publication with an empty list means "any" and matches every value), `salaryMin`, `salaryMax`, `currency`, `sort`. Salary works like the vacancy filters: overlapping ranges match, and publications without a salary are left out when a salary filter is sent.
- **Relevance (decided 2026-11-15):** when `q` is sent and `sort` is not, results are ordered by relevance first: a word found in the title counts most, then in the skills, then in the about text (with several words the scores add up); ties are newest first. When `sort` is sent it always wins and there is no relevance ordering, so do not send `sort` from the search box by default; send it only after the user picks a sort. There is no `relevance` value for `sort`.
- `sort`: `-date` (default, newest first), `date`, `salary`, `-salary` (by the top of the desired range, else its bottom), `experience`, `-experience` (by `experienceYears`). Publications without a salary, or without experience years, go last in both directions.
- Card: `{ id, title, excerpt, category, employmentTypes, workModes, locations, salaryMin, salaryMax, currency, skills, experienceYears, hasCv, hasCoverLetter, expiresAt, createdAt, author, invitation }`. `excerpt` is the first 250 characters of `about`, cut at a word, with `...` when shortened. `salaryMin`, `salaryMax`, `experienceYears` are `null` when not set.
- `author` is `{ id, firstName, lastName, avatarUrl }` (`avatarUrl` is `''` when none; `author` is `null` in the rare case the account was just deleted). Link the name to `/users/:id/profile`, which applies the user's own privacy switches.
- `invitation`: the state between the viewing company and this publication: `none`, `invited` (sent, not answered), `accepted` or `declined`. Show the "Invite" button only for `none`; for the others show a small status label instead ("Invited", "Accepted", "Declined"). A company can invite a publication only once ever, whatever the vacancy. Admins always get `'none'` and never see an Invite button.
- Company detail: `GET /publications/:id` for an approved company works while the publication is on the board (published, not expired, accepting invites), and also while it is published and not expired and the company has an `invited` invitation on it, or an `accepted` one whose application is not withdrawn (even with `acceptingInvites` off); a `declined` invitation gives no extra access, and withdrawing the application ends the access of an accepted one; otherwise 404 `Publication not found`, and an unapproved company gets 403 `Company is not approved`. It returns the item without `rejectionReason`, `timerPaused` and `updatedAt`, plus `author`, `invitation`, `invitationId` and `invitedVacancyId` (both `null` when `invitation` is `none`; use `invitationId` for a "Cancel invitation" button while `invited`). The CV and cover letter links follow the same rule (404 `File not found` otherwise, also for an unapproved company). Open them inline in a new tab.
- No email or phone anywhere on the board or the detail (see Fields). Use skeleton loaders on the board cards.

**Errors:** 404 `Publication not found`, 403 `No permission` (another user's publication), 409 `Publication changed, try again` (edited in another tab at the same moment: reload), 404 `User not found` (the account was deleted).

Use skeleton loaders on the lists.

## Invitations (approved companies invite publications; users accept or decline)

An approved company invites a user's publication to one of its own vacancies. The user sees the invitation in their inbox and accepts it (which applies to that vacancy for them) or declines it.

| Route | Who | Body / query | Returns |
|---|---|---|---|
| `POST /publications/:id/invitations` | approved company | `{ vacancyId, message? }` | the invitation |
| `DELETE /invitations/:id` | approved company (sender) | none | the deleted invitation |
| `GET /invitations/sent` | company | `page`, `take`, `status`, `vacancyId` | `{ items, total, page, take }` |
| `GET /invitations/quota` | company | none | `{ used, limit, resetsAt }` |
| `GET /invitations/mine` | user | `page`, `take`, `status`, `vacancyId`, `focus` | `{ items, total, page, take }` |
| `PATCH /invitations/:id/accept` | user (recipient) | none | `{ invitation, application }` |
| `PATCH /invitations/:id/decline` | user (recipient) | none | the invitation |

**Invitation (write responses):** `{ id, status, message, publication, vacancy, company, applicationId, createdAt, respondedAt }`. `status` is `invited`, `accepted` or `declined`. `message` is `''` when none. `publication`, `vacancy`, `company` are ids. `applicationId` is set after an accept. `respondedAt` is when the user accepted or declined (`null` before).

**Invite (company).** The Invite button on a board card or the company detail opens a small form: pick one of the company's own vacancies that is published and not expired (from `GET /vacancies/mine?status=published`), and an optional message (max 500 characters and 100 words; show a word counter like the apply form). Show the remaining quota in the form ("3 of 5 invitations left this month"). Errors:
- 403 `Company is not approved`; 403 `No permission` (not the company's vacancy).
- 404 `Publication not found` (no longer on the board), 404 `Vacancy not found`.
- 400 `Only a published vacancy that has not expired can be used for an invitation`.
- 409 `You already invited this publication` (one invitation per company and publication, ever; a cancelled one frees it).
- 400 `Monthly invitation limit reached (N). It resets at the start of next month (UTC).`

**Monthly quota.** Each company has a number of invitations per calendar month (UTC): 5 on Pay as you publish (or no plan yet), 25 on Plus, 50 on Elite. `GET /invitations/quota` returns `used` (this month), `limit` and `resetsAt` (the first moment of next month, UTC). Show it on the board and the sent list, and disable Invite when `used >= limit`. A failed invite uses nothing; cancelling an invitation does not give it back.

**Sent invitations (company).** `GET /invitations/sent`, newest first. Item: the invitation above plus `vacancy: { id, title } | null`, `publication: { id, title } | null` (the title as it was when invited) and `publicationAvailable` (true when the company can still open the publication: it is on the board, or the publication is published and not expired and the invitation is `invited`, or `accepted` with an application that is not withdrawn; link the title only then). Offer "Cancel" on `invited` items: `DELETE /invitations/:id` (400 `Only an invitation that was not answered yet can be cancelled`, 409 `Invitation changed, try again` when the user answered at the same moment: reload). Accepted items link to the vacancy's applicant list with `focus=<applicationId>`.

**Inbox (user).** A new page `/invitations` that loads `GET /invitations/mine`, newest first. The email and the bell open `/invitations?focus=<invitationId>`: send `focus`, show the `page` the response returns, scroll to that item and highlight it (like the applicant list). Item:

```
{
  id, status, message, createdAt, respondedAt,
  publication: { id, title } | null,
  vacancy: { id, title, deadline, status } | null,
  company: { id, companyName, logoUrl, approved },
  application: { id, status, canReapply, submissions } | null
}
```

- `vacancy.status` is `published`, `expired`, `closed` or `unavailable` (same meaning as in "My applications"); link the title only for `published`, `expired`, `closed`. `company.approved: false`: show the "no approved status" warning and the name as plain text.
- `application` is the user's own application on that vacancy, if any (it may come from a normal apply or from this invitation).
- Show Accept and Decline only on `invited` items. Disable Accept (with the reason in a tooltip) when `vacancy.status` is not `published`, when `company.approved` is false, or when `application` is ended (`rejected` or `withdrawn`) and `canReapply` is false.

**Accept.** One confirm window before the call: "Accepting applies to <vacancy> with the CV and cover letter of your publication. Your email and phone number become visible to this company." (the same note as the apply form). When `application` is `rejected` or `withdrawn` and `canReapply` is true, add: "You applied here before and were rejected / withdrew. Accepting uses your only reapply." What accept does:
- No application yet: creates one with copies of the publication's CV and cover letter (whichever exist), no message, `viaInvitation: true`.
- An active application already exists: nothing new is sent; the invitation is just marked accepted.
- An ended application with a reapply left: reapplies with the publication's files; old files are always replaced or removed (there is no "keep previous" option here).
- Response `{ invitation, application }` (application shape as in "Applications"). `invitation` is `null` in the rare case the company cancelled it at the same moment; the application still stands.
- Errors: 409 `Your publication is under review. You can accept this invitation once it is published again`, 409 `Your publication is closed`, 409 `Your publication has expired. Extend it to accept this invitation`, 400 `This vacancy is closed`, 400 `This vacancy has expired`, 400 `This company is not accepting applications right now`, 409 `You cannot apply to this vacancy again`, 400 `This invitation was already answered`, 403 `No permission`, 404 `Invitation not found`. On any of these the invitation stays `invited`. Rate limit: 5 a minute.

**Decline.** No confirm needed beyond a simple "Decline this invitation?". Final. It only stops this company inviting this publication again; the user can still apply to the vacancy normally. Errors: 400 `This invitation was already answered`, 409 `Invitation changed, try again`.

**Deletion.** Deleting a publication or the user account deletes its invitations; deleting a vacancy or a company deletes the invitations that point to it. Applications created by an accepted invitation stay like any other application.

Use skeleton loaders on both lists.

## Not built yet (do not build screens for these)

Chatbot, a list of a company's vacancies on its public page (open and past; the page itself and `GET /companies/:id/profile` exist), a billing history list inside the site (use the portal), Stripe payments for anything except plans, vacancy submits and vacancy extensions.
