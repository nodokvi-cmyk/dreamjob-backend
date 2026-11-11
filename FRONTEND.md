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
- Response fields: `_id`, `firstName`, `lastName`, `birthDate?`, `age?`, `email`, `googleId?`, `phone`, `role`, `isVerified`, `isCvPublic`, `isProfilePublic`, `isEmailPublic`, `isPhonePublic`, `appliedVacancies` (ids), `createdAt`, `updatedAt`, `avatarUrl`, `hasCv`. `__v` is also present; ignore it. Secrets and S3 keys are never returned. Handle a missing `age`. `phone: ''` clears the phone. `null` or empty values on other fields are ignored.
- Files, one per request, max 4 MB: `PATCH|DELETE /users/:id/avatar` (multipart field `avatar`, JPEG/PNG/WebP), `PATCH|DELETE /users/:id/cv` (field `cv`, PDF only), `PATCH /users/:id/cv-visibility { isCvPublic }`, `PATCH /users/:id/contact-visibility { isEmailPublic?, isPhonePublic? }` (self; both default `false`; one switch sends only its own field, unsent fields stay as they are; an empty body gives 400), `PATCH /users/:id/profile-visibility { isProfilePublic }` (self; default `true`; does not change `isCvPublic`), `GET /users/:id/cv` returns a link valid 5 minutes (the owner always; an approved company only when `isProfilePublic` and `isCvPublic` are both true; everyone else, admins included, gets 404 `CV not found`).
- **Public profile:** `GET /users/:id/public`, no login needed (send the token when you have one, so the owner is recognized). Unknown user: 404. Fields: `id`, `firstName`, `lastName`, `avatarUrl`, `isPrivate`. When `isPrivate` is true (profile switched off, viewer is not the owner) only those fields come back: show name, avatar and "This profile is private" (like a private Steam profile). Otherwise `hasCv` is present, plus `email` only when the user turned `isEmailPublic` on and `phone` (may be `''`) only when `isPhonePublic` is on (both default off; the owner always gets both). `hasCv`: `hasCv` is true for the owner whenever a CV exists, and for an approved company only when a CV exists, `isCvPublic` is on and the profile is public. Show a "View CV" button only when `hasCv` is true; it calls `GET /users/:id/cv`. The owner always sees the full view, even with the profile switched off.

## Companies (`/companies`)

- `GET /companies` admin. `GET /companies/:id` self or admin (private: has email, phone, director). `PATCH /companies/:id` self. `PATCH /companies/:id/approve` and `/revoke` admin. `DELETE /companies/:id` self or admin. `PATCH /companies/:id/plan` self (see Billing).
- Response fields: `_id`, `googleId?`, `createdAt`, `updatedAt`, `companyName`, `email`, `isVerified`, `approved`, `phone`, `location`, `description`, `website`, `operatingCities`, `director?`, `logoUrl`, `isProfileComplete`, and the billing fields `plan?` (`payAsYouPublish`, `plus`, `elite`; missing until a plan is chosen), `credits`, `purchasedCredits`, `planRenewsAt?`, `planEndsAtPeriodEnd`. `GET /auth/me` returns the same for a company. `''` clears `phone`, `location`, `website`; `director: null` removes the director.
- `isProfileComplete` is true only when `companyName` and `description` are not empty and a `plan` is chosen. `PATCH /companies/:id/approve` answers 400 until then (the admin screen must show why).
- Logo: `PATCH|DELETE /companies/:id/logo` (field `logo`).
- An unapproved company cannot create or edit vacancies, submit them or extend them (403). Show "Waiting for admin approval". Closing and deleting a vacancy and reading stay allowed.
- **Public company profile:** `GET /companies/:id/public`, no login needed. Approved companies only: a missing, unapproved or revoked company gives 404, so do not link a company name to this page unless it is approved. Fields: `id`, `companyName`, `description`, `website`, `location`, `operatingCities`, `logoUrl`, `email`, `phone`, `director` (`{ fullName, phone }` or `null`). Billing and account fields are never returned.

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

## Applications

Built: apply, reapply and withdraw (users), the user's own list, the company's applicant list, status changes by the company, and links to the application files. Not yet built: the Apply/Reapply/Applied state on vacancy cards and the detail page (`myApplication`, comes later). Until then, a card or detail page cannot tell whether the user already applied (a repeat apply answers 409); the "My applications" page can.

**Apply or reapply:** `POST /vacancies/:id/applications`, `multipart/form-data`. All fields are optional, so a user can apply with nothing at all:
- `message`: text, at most 100 words and 800 characters (trimmed; empty means no message).
- `useProfileCv`: `true` or `false`. `true` attaches a copy of the user's profile CV.
- `cv`: one PDF file, at most 2 MB. Do not send it together with `useProfileCv: true` (400).
- `coverLetter`: one PDF file, at most 2 MB.
- `keepPrevious`: `true` or `false`, used only on a reapply (ignored on a first apply). `true` keeps the message, CV and cover letter the application already holds for every field the request does not send again. A field that is sent replaces the old one. After a reject the application still holds everything the user sent; after a withdraw it holds nothing, so there is nothing to keep.

The same route sends a first application and a reapply. Response (both apply and withdraw):

```
{ id, vacancy, status, message, hasCv, hasCoverLetter, submissions, locked, previousOutcome, appliedAt, firstAppliedAt }
```

`status`: `submitted`, `viewed`, `interview`, `accepted`, `rejected`, `withdrawn`. `submissions` is 1 or 2. `previousOutcome` is `null`, or `withdrawn` / `rejected` after a reapply. `message` is `''` when none. `appliedAt` is the time of the latest submission; `firstAppliedAt` is the time of the first one and never changes, so on a reapply (`submissions` 2) show both, the original time in a quieter style and the reapply time as the main one (design is up to the frontend).

Errors:
- 404 `Vacancy not found`: the vacancy does not exist or is not public.
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
  vacancy: { id, title, company, deadline, status } | null,
  companyApproved,
  canReapply
}
```

- `vacancy.status` is `published`, `expired`, `closed` or `unavailable`. `unavailable` means the company edited the vacancy and it waits for admin review (or the edit was rejected); the details page answers 404 to users meanwhile. Show "Temporarily unavailable" and the title as plain text. Link the title to the vacancy only for `published`, `expired` and `closed`. The application itself always stays in the list and keeps its own status.
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
  isReapply, previousOutcome, message, hasCv, hasCoverLetter,
  applicant: { id, firstName, lastName, avatarUrl, email, phone, age }
}
{ id, status, appliedAt, hidden: true }
```

- `hidden: true` is a withdrawn application or a deleted user. Show only the status ("Withdrawn" or "Deleted user") and the time, no link, no files, no status controls. `id` is the application's id, for the row key and `focus`.
- `isReapply` is true on a second submission; then show `previousOutcome` and the reapply time (`appliedAt`) as the main time and `firstAppliedAt` in a quieter style.
- `age` is `null` for applicants without a birth date: show nothing. `avatarUrl` is `''` when none: show initials. Small square avatar.
- `applicant.id` links to the public profile `GET /users/:id/public`. Application data (message, files, email, phone) is shown here whatever the user's profile switches say.
- Use skeleton loaders while the list loads.

### Status change (role `company`)

`PATCH /applications/:id/status { status }`, `status` one of `viewed`, `interview`, `accepted`, `rejected`, in any order (a rejected application can be changed later). Approved company owning the vacancy only. Returns `{ id, status, appliedAt }` only; update the status on the card you already have, do not expect applicant details in the answer. Errors: 404 `Application not found`, 403 `No permission`, 403 `Your company must be approved to manage applications`, 400 `A withdrawn application cannot be changed`, 400 `This applicant deleted their account` (status controls are hidden on hidden rows, so this only comes from a direct call), 409 `Application changed, try again` (the user withdrew at the same moment; reload).

### Application files (roles `user` and `company`)

`GET /applications/:id/cv` and `GET /applications/:id/cover-letter` return `{ url, expiresIn }`, a link valid 300 seconds, the same shape as `GET /users/:id/cv`. Allowed for the applicant and for the vacancy's approved company; everyone else, and any withdrawn application, deleted user or missing file, gets 404 `File not found`. Admins get 403. Show "CV" and "Cover letter" buttons only when `hasCv` / `hasCoverLetter` is true.
- The PDF opens in the browser's PDF viewer; the viewer chooses whether to download it.
- Call the route on every click and never store the link: after 5 minutes it answers an S3 "Access Denied" page (a download already started still finishes).
- Open it in a new tab without being stopped by pop-up blockers: on click, open an empty tab first (`const tab = window.open('', '_blank')`), then set `tab.location.href = url` when the request answers, and close the tab if the request fails.

## Notifications (roles `user` and `company`, `/notifications`)

A bell in the header for users and companies. Admins get 403 on every route. No event creates notifications yet: the routes work and the list stays empty until the next backend release wires the events. Build the bell and the panel now.

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
- `type`: `newApplication`, `applicationWithdrawn`, `vacancyApproved`, `vacancyRejected`, `companyApproved`, `companyRevoked`, `planEnded` (companies); `applicationStatusChanged`, `applicantCompanyRevoked` (users). Build the sentence from `type` and `data`; the click targets per type come with the next release.
- `data`: a snapshot taken when the notification was made, so it stays readable after the vacancy or company changes or is deleted. Only the fields a type needs are present: `vacancyTitle`, `companyName`, `status`, `reason`, `planName`, `isReapply`. `{}` when none.
- `target`: `{ vacancyId, applicationId }`, each a string or `null`. The target may be deleted by now; a 404 when opening it is normal.

**Badge.** Red circle on the bell with `unseenCount`: notifications created since the bell was last opened. The number is capped at 100, so show `99+` when it is above 99, and hide the circle at 0. Call `GET /notifications/badge` on page load and refresh it every minute or so. When the user opens the bell, call `PATCH /notifications/seen` and hide the circle. The badge has nothing to do with read state.

**Panel.** Opens in the page (not a new page or tab) and loads `GET /notifications?take=5&page=N`; pages change inside the panel. Unread items (`read: false`) are bold, read ones normal. A click calls `PATCH /notifications/:id/read`, then opens the target. `unreadCount` is there if you want to show it. Use skeleton loaders while it loads.

**Lifetime and lock.** Every notification is deleted automatically 30 days after it was created. The lock icon is one toggle button: send `{ locked: !item.locked }` and replace the item with the answer. Locking freezes the countdown; unlocking resumes it with the time that was left (locked with 1 day left, unlocked a week later: deleted 1 day after unlocking). Sending the state it already has changes nothing.
- Show the countdown from the backend values, never compute dates yourself.
- Unlocked (`locked: false`): `expiresAt` is set, `lockedAt` is `null`. Show "Deleted in N days" from `daysLeft`; when `daysLeft` is 0, show "Deleted in N hours" from `hoursLeft`. You may also show the date from `expiresAt`.
- Locked (`locked: true`): `expiresAt` is `null`, `lockedAt` is the time it was locked. Show "Frozen, N days left" (`daysLeft`, or hours from `hoursLeft` when 0) and "locked since <lockedAt>".
- `hoursLeft` is `null` whenever `daysLeft` is 1 or more.

**Deleting.** The X on an unlocked notification calls `DELETE /notifications/:id` at once. The X on a locked one first asks "Delete this locked notification?" and deletes only after confirming. "Clear all" calls `DELETE /notifications`, which skips locked notifications; reload the panel afterwards.

**Errors.** 404 `Notification not found` (wrong id, another account's notification, or already deleted), 409 `Notification changed, try again` on lock when another tab changed it at the same moment (reload), 400 when `locked` is missing or not a boolean.

## Not built yet (do not build screens for these)

Apply button states on vacancy cards and the detail page, saved jobs, chatbot, public company page, past vacancies section, a billing history list inside the site (use the portal), Stripe payments for anything except plans, vacancy submits and vacancy extensions.
