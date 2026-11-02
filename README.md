# ITECCS Premium Tutoring — booking & Stripe package

## Included
- Responsive `public/tutoring.html` matching the ITECCS midnight navy / gold visual language.
- Interactive month and time-slot selector, per-service prices, customer details and session summary.
- Node/Express backend that reserves a selected slot, opens a **new Stripe Checkout session for that specific booking**, verifies payment via signed webhook, and confirms booking.
- SQLite persistent reservations to prevent overlapping appointments; 35-minute payment hold (Stripe checkout expires after 30 minutes).
- Confirmation page and downloadable iCalendar invitation. Optional SMTP booking confirmation emails with calendar invitation and admin BCC. Stripe receipt URL after a verified payment.
- Complimentary 20-minute consultation option.

## IMPORTANT: Before putting this on a public website
The site is a ready-to-configure application, **not a payment-connected live booking site**. The original `index.html` provided by the user is preserved and was used only as a visual reference. ITECCS's existing `https://iteccs.com/howtopay` is a generic Stripe payment portal, which is *not suitable for automatic scheduling* because it does not tie a payment to a specific time slot. This application instead uses your Stripe account's secret key on the server to make booking-specific Checkout Sessions.

### 1. Install
1. Use a hosting provider with **Node 20+ and persistent disk** (or substitute a hosted DB for SQLite). A basic static HTML-only host will not run bookings or payments.
2. Run `npm install`, copy `.env.example` to `.env` and set `SITE_URL` to your real `https://` URL, e.g. `https://iteccs.com` if the booking application is hosted on that same origin.
3. Set `STRIPE_SECRET_KEY` to your Stripe secret key **server-side only**; never paste a secret key into HTML or JavaScript.
4. Set `STRIPE_WEBHOOK_SECRET` (below) and run `npm start`.
5. Link to `/tutoring.html` on your existing homepage navigation; if using a separate subdomain change the link to its actual URL.

### 2. Stripe webhook (required)
In Stripe Dashboard > Developers > Webhooks, register an HTTPS endpoint `https://YOUR-BOOKING-DOMAIN/api/stripe-webhook`.
Subscribe to:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

Set the endpoint's `whsec_...` value in `.env` as `STRIPE_WEBHOOK_SECRET`. Test with Stripe test mode before using live mode. **Never mark a booking paid based only on the URL redirect.**

Stripe sends actual customer receipts if `Settings > Business > Customer emails > Successful payments` is enabled. The confirmation page also displays a Stripe receipt link if available. The optional custom booking email is *not* a tax receipt.

### 3. Schedule and booking policies
`server.js` contains the initial **example** availability in `weeklySchedule`: Mon–Thu 6–9pm, Fri 5–8pm, Sat 10am–3pm, Sundays unavailable, business timezone `America/Chicago`. **Replace with your true hours before launch.** Slots can be reserved 12 hours to 45 days in advance, in 20-minute increments, for either 60-minute or 20-minute sessions. Set `BLOCKED_DATES` in `.env` to block holidays or other days. Existing reservations are checked before showing and before holding each slot.

**Calendar synchronization is not yet connected to your personal Google or Microsoft calendar.** The web booking calendar is internally managed via SQLite. External conflicts should be blocked in the schedule or by adding dates to `BLOCKED_DATES`. A two-way calendar integration requires calendar authorization, checking conflicts before reservation, and creating an event on confirmation. Do not advertise live Google Calendar sync until it is added.

**Free consultations currently have no per-email booking limit.** If you wish to offer one complimentary session per customer, implement and test an appropriate eligibility rule. A booking reschedule/cancel portal is not implemented; those requests go through your contact page.

### 4. Optional email confirmations
Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and optionally `BOOKING_ADMIN_EMAIL` in `.env`. The server sends a booking confirmation with an `.ics` appointment after successful payment or a confirmed free reservation. Meeting links are not automatically generated; send them separately or add a calendar integration.

### 5. Prices and services
Adjust the `offerings` object in `server.js` for authoritative prices, names and durations; update the matching labels in `public/tutoring.html`. Prices currently default to $100/hour for paid tutoring and $0 for a 20-minute introduction.

### 6. Compliance and deployment checklist
- Add your actual tutoring cancellation / refund / rescheduling terms and privacy notice before collecting customer information.
- Verify your business address/contact information and any tax requirements with your tax advisor; optional Stripe tax setup is not enabled here.
- Use HTTPS, protect server environment variables and SQLite backups, ensure webhook endpoint is reachable, set an appropriate database backup strategy.
- Run test payments, successful and failed webhooks, multiple simultaneous bookings, cancellation, email delivery, receipt delivery, and DST schedule transitions.
- Avoid copying `.env`, `data/*.sqlite` or logs into any publicly served directory. `public/` is the only exposed static directory.
- If hosting in a serverless or horizontally scaled environment, replace local SQLite with shared transactional database storage.
- A confirmation page can be viewed by someone possessing its unguessable UUID; consider customer authentication if adding personal notes or a self-service booking portal.

### Local preview
`npm install && npm start` then visit `http://localhost:3000/tutoring.html`. The static design can also be opened by double-clicking `public/tutoring.html`, but live booking requires the server.


## November 2026 curriculum / visual update
- The uploaded original `reference/original_user_tutoring.html` is retained for comparison.
- New curriculum explorer uses course labels exactly as published at https://iteccs.com/coremath (five groups).
- New optional course selector writes selected course into the booking notes to help personalize the session.
- ITECCS brand colors now match the main site (`#07101f`, `#0b2a5b`, `#ffcc00`).
- Stripe checkout remains transaction-specific through the existing backend. A live API key, webhook secret, deployment, and test transactions are required before taking payments.

## Launch safety (November 2026 revision)
**BOOKING_ENABLED=false is the safe default.** This is intentional: the example schedule is NOT the actual availability of ITECCS staff. Set `BOOKING_ENABLED=true` only after defining confirmed operating hours and finishing the end-to-end checks below. On the live server, paid bookings additionally require a valid secret key, webhook signing secret and HTTPS `SITE_URL`.

Define the schedule without editing JavaScript using `WEEKLY_SCHEDULE_JSON`, mapping Sunday `0` to Saturday `6`. E.g. `WEEKLY_SCHEDULE_JSON={"0":[],"1":[["19:30","21:30"]],"2":[],"3":[],"4":[],"5":[],"6":[]}`. Times are local to `BUSINESS_TIMEZONE`. Enter only verified availability and block vacation dates.

The backend no longer automatically frees a pending Stripe checkout after the local reservation hold expires: pending slots remain held until a signed Stripe expiry/failure event or successful payment. This avoids the risk of a late paid webhook confirming an already rebooked timeslot. If the webhook is unavailable, pending reservations will remain blocked and require Stripe-event reconciliation. **Reliable webhooks and monitoring are mandatory before accepting customers**.

`GET /api/health` reports readiness status (no sensitive credentials). `GET /api/config` provides public service availability. The application does not automatically synchronize personal Google Calendar, does not issue meeting links, and does not guarantee email delivery until SMTP and Stripe receipts are configured.

### Test before allowing customers
1. Deploy to HTTPS with persistent disk; keep `.env`, database, backups outside `public/`.
2. Configure Stripe **test** secret key and test webhook signing key (never put either key in HTML). Configure corresponding public SITE_URL.
3. Set verified hours, a `BLOCKED_DATES` list, optional SMTP, and `BOOKING_ENABLED=true` in staging only.
4. Make a paid test booking; verify the card-payment event's Stripe signature, unique booking ID, confirmed status, calendar attachment and receipt URL. Check a simultaneous booking for the same slot fails.
5. Test failed/cancelled/expired payment sessions; ensure slots are only freed after a verified Stripe event.
6. Enable Stripe's successful-payment customer emails. Test a real email address and mailbox delivery.
7. Switch to Stripe live key + matching live webhook secret and live SITE_URL, then run a small live transaction and check your actual Stripe account before opening bookings publicly.

**No deployment or live Stripe account connection has been carried out as part of generating this package.**


## Curriculum expansion (November 2026)
The tutoring front end now features seven curricular pathways with discipline filtering and search: Core Mathematics, Applied & Computational Mathematics, Applied Statistics & Probability, Mechanical Engineering, Materials Science & Engineering, Computer Science, and Data Science & AI. The course topics were selected from the six supplied official ITECCS pages and the existing Core Math catalog. Each pathway links to the full official curriculum. Selecting a pathway preselects its first course in the booking form; customers can change to any listed course. The selected course is stored in the booking notes (not used to change the Stripe price).

The project does not add new Stripe products or alter the server price table; $100/hour paid session pricing is unchanged. Live bookings remain disabled until configuration, deployment and real payment tests are completed.


## Visual refinement (November 2026)
The supplied ITECCS wordmark is packaged locally as `public/iteccs-logo.webp` and used in the navigation and footer. Updated editorial copy, responsive logo sizing, subtle curve-drawing, gentle floating and hover-shine effects have been added. `prefers-reduced-motion` disables animations. The standalone preview embeds the logo and assets for offline visual review. Live booking and payment still require Namecheap Node hosting, Stripe credentials/webhooks, real availability, SMTP, and end-to-end testing.


## Blue Edition (November 2026)

- Official blue-and-white logo included as `public/iteccs-logo.png`.
- All 168 listed individual courses are directly selectable by clicking **Book** beside each title. Selections populate the booking form.
- Visitors can also type another course or topic; this is included in the booking notes server-side.
- Seven program pages link to the original ITECCS curricula. Main site, education, research and payment links included.
- Motion is CSS-based, respects `prefers-reduced-motion`, and does not interfere with payments.
- IMPORTANT: This ZIP is deployment-ready source code, not a live activated service. Configure Namecheap Node.js hosting, persistent data, Stripe, booking schedule, and SMTP before enabling payments.


## Signature Navy & Gold edition (November 2026)
The premium visual refresh merges the original navy-and-gold design with the multidisciplinary individual-course directory. Brand logo is included in public/iteccs-logo.png. Preview is a local, design-only HTML file. Course booking API, Stripe payments, confirmation emails, and receipts require live configuration and end-to-end testing. Never put a Stripe secret key in HTML or a frontend JavaScript file. The server's configuration remains disabled by default until required environment variables are configured.


## Signature Editorial 2026 design update
Includes larger readable typography outside the unchanged-scale hero headline, new STEM-focused hero copy, no numeric section counters, four local SVG academic illustrations, expanded curriculum typography, wider layout and reduced-motion-friendly subtle animations. Booking, Stripe backend and hosting requirements are unchanged; deploying is required before payments or real bookings.
