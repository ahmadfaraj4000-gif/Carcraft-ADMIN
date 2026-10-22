# Afterpay invoice payment links

## Invoice-link implementation — October 22, 2026

The React admin portal now creates an invoice payment request from an invoice number, exact USD amount, optional internal note, and expiration period (1/3/7/14/30 days). It returns a unique 256-bit random link. The customer opens `after-pay.html?payment=...` to review the invoice and continue to Afterpay when checkout is enabled.

The form no longer previews a 4% fee. Only the invoice total is sent to Afterpay. No customer messages are sent automatically.

### Files and flow

- `src/components/AfterpayManager.jsx`: request creation, copy/open link, latest 100 requests, search/status filters, cancellation and payment verification.
- `src/payments/`: customer invoice page and formatting.
- `convex/payments.ts`: protected admin operations, minimal public invoice lookup, transactional checkout/capture locks and payment audit events.
- `convex/afterpay.ts`: server-only credentials, merchant limits, checkout creation, full capture and read-only reconciliation.
- `convex/schema.ts`: paymentRequests, paymentEvents and paymentConfiguration.
- `after-pay.html`: Vite customer-page entry; the root website version is built from this entry.

Admin → save invoice → copy customer link → customer reviews amount and enters contact details → server creates Afterpay checkout → customer confirms on Afterpay → return page asks server to capture → server verifies token, internal reference, amount, currency and captured state → invoice becomes Paid.

Each link has one checkout token. An expired or definitively declined checkout requires cancelling the unpaid request and creating a replacement. Requests whose capture result is uncertain cannot be cancelled or replaced; use Check payment or retry verification with the same checkout token. Once paid, repeats return the existing result and do not recapture. A browser SUCCESS parameter is never proof of payment.

The public lookup returns only invoice number, amount, currency, status, expiration and payment timestamp, plus checkout availability/test-environment metadata. Internal notes, admin identity, provider credentials and checkout tokens are not returned. Raw link tokens are retained only for authenticated admins to copy existing links; lookup uses a SHA-256 index. Anyone holding a link can view its limited invoice details, so treat it as private.

### Deployment and configuration

No Afterpay credentials were present in the configured Convex deployment at the start of this work. The user does not yet have known sandbox credentials. Link creation does not depend on those credentials, but customer checkout remains unavailable until configured and explicitly enabled.

Set these environment variables privately in the Convex deployment (not in Vite variables, HTML, client JavaScript, source files or chat):

| Variable | Value |
| --- | --- |
| AFTERPAY_ENVIRONMENT | `sandbox` for testing; `production` for real payments |
| AFTERPAY_MERCHANT_ID | Merchant ID for the selected environment |
| AFTERPAY_SECRET_KEY | Secret for the selected environment |
| AFTERPAY_CHECKOUT_ENABLED | `false` during setup; `true` when that environment is ready to accept checkout |
| PAYMENT_PUBLIC_URL | `https://carcraftautobodytowing.com/after-pay.html` by default; must be HTTPS and have no query or fragment |

After credentials are configured, the admin tab offers Check connection. This performs a read-only GET of `/v2/configuration`, verifies USD limits, and stores the limits for up to one day. It does not charge a customer. Credential verification alone does not establish that the complete customer flow has passed certification.

Use sandbox credentials to test approvals, declines, cancel/return flows, expiration, duplicate clicks and refunds, and complete Afterpay’s custom integration certification before enabling production checkout. Do not use sandbox payments to settle real invoices. Requests with a checkout already started are bound to their original environment and merchant account.

Build from this repository using `npm run build`. Deploy Convex functions to the same deployment referenced by `VITE_CONVEX_URL`. The admin GitHub Pages workflow publishes the admin build from `Carcraft-ADMIN`. Copy the built `dist/after-pay.html` and its referenced assets into the separate `Car-Craft-Auto` repository for the public site. Retain older public assets still used by existing pages. The payment link targets the public domain, not the admin domain.

Refunds remain in Afterpay Business Hub. The local status currently records capture, not later refund/dispute changes; confirm those in Business Hub. Payment reconciliation is available through the admin Check payment button. Customer return verification can safely retry the same capture token. No background refund synchronization or email/SMS delivery is implemented.

### Validation

Automated tests cover admin authorization, minimal public data, disabled checkout, exact totals, duplicate invoice handling, expired/cancelled links, token mismatch, environment mismatch, provider amount/state validation, interrupted captures, capture/cancel races, malicious redirect URLs and customer/admin interface behavior. Provider calls are mocked; real sandbox checkout testing remains required.

### Official references

- [Platforms Quickstart supplied by the user](https://developers.cash.app/afterpay/guides/platforms/platforms-quickstart) — directs custom sites to API Quickstart.
- [Create Checkout](https://developers.cash.app/afterpay/api-reference/reference/checkouts/create-checkout-1)
- [Get Configuration](https://developers.cash.app/afterpay/api-reference/reference/configuration/get-configuration)
- [Capture Full Payment](https://developers.cash.app/afterpay/api-reference/reference/payments/capture-full-payment)
- [Get Payment By Token](https://developers.cash.app/afterpay/api-reference/reference/payments/get-payment-by-token)
- [Test environments](https://developers.cash.app/afterpay/guides/api-development/test-environments)
- [Certification](https://developers.cash.app/afterpay/guides/api-development/certification)

