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

Live merchant credentials are now stored privately in the configured Convex deployment, with `AFTERPAY_ENVIRONMENT=production` and `AFTERPAY_CHECKOUT_ENABLED=false`. On October 22, 2026, configuration retrieval returned HTTP 404 on both documented production hosts, and checkout creation returned HTTP 403 / `merchant_channel_setup_error` / `Transaction not allowed` (support error ID `83a85f0a3ff860d9`). No checkout or charge was created. Afterpay must confirm the account's online channel configuration and eligibility. Separate sandbox credentials and completed certification have not been established.

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

## Documentation and implementation audit — October 22, 2026

### Coverage and conclusion

Inventoried all 157 pages in the official [Afterpay documentation index](https://developers.cash.app/afterpay/llms.txt). Audited the applicable custom US web checkout requirements against the backend, customer page, admin page, tests, deployed account setup, and both GitHub repositories. Platform plugin instructions were classified as inapplicable to this React/Convex integration; their existence does not make this site a Shopify, WooCommerce, Stripe, or Cash App Pay Partner API integration.

The current failure is an observed provider-side channel rejection, not evidence of a malformed JSON request or invalid Basic authorization. Its exact administrative cause is not described in the indexed developer pages; support must confirm it. The account's visible Setup guide offers Cash App Pay online setup and Afterpay in-person setup. Settings → Business details exposes merchant credentials; no self-service online Afterpay activation control was visible there. Do not claim certification or complete account readiness solely because the merchant account was approved or keys were issued.

### Findings corrected in this audit

| Finding | Correction and evidence |
| --- | --- |
| Configuration parser rejected a documented response without a minimum order amount | Treat an omitted `minimumAmount` as no minimum, while still requiring a valid USD maximum. Tests cover both current object and legacy array responses. [Configuration reference](https://developers.cash.app/afterpay/api-reference/reference/configuration/get-configuration). |
| Production redirect allowlist omitted the US migration domains | Permit the exact HTTPS hosts `cash.app` and `api.cash.app` alongside `portal.afterpay.com`. Sandbox remains on its sandbox checkout host. Reject lookalike domains, user information and nonstandard ports. [Migration](https://developers.cash.app/afterpay/guides/welcome/afterpay-migration). |
| A slow admin status lookup could overwrite a capture started after that lookup | Version each capture attempt and reject stale result writes. Block new admin lookups while a capture lock is active. A regression test interleaves a delayed DECLINED lookup with a successful capture and proves cancellation remains blocked. |
| Capture timeout did not budget the documented connection plus response time | Allow 85 seconds total for full capture and use a 120-second capture lock; other requests have a 35-second total timeout. [Full capture reference](https://developers.cash.app/afterpay/api-reference/reference/payments/capture-full-payment). |
| Cancelled or incomplete return parameters could initiate capture | Only a SUCCESS confirmation return initiates verification. CANCELLED or missing/unknown status never starts capture. SUCCESS still cannot mark an invoice paid without server verification. |
| Direct API callers could attempt to reopen a definitively declined checkout | Block reuse of declined requests. An admin may cancel and replace that unpaid request. |
| Connection failures discarded useful Afterpay support identifiers | Admin connection checks now retain sanitized HTTP status, error code and error ID, excluding raw provider messages and bodies. |
| Paid history could be mistaken for a current net settlement balance | Added an explicit admin explanation and Business Hub link: local Paid records capture; later refunds, disputes and settlements are managed in the Hub and are not synchronized. |

### Requirement-by-requirement review

| Area | Result / remaining action |
| --- | --- |
| Integration choice | Standard customer-initiated redirect checkout with immediate full capture fits a fixed, finalized invoice. Express checkout, deferred shipping, recurring/on-file grants and PSP onboarding are not used. [Platforms Quickstart](https://developers.cash.app/afterpay/guides/platforms/platforms-quickstart), [API Quickstart](https://developers.cash.app/afterpay/guides/api-development/api-quickstart). |
| Cash App Pay versus installments | Credentials can be shared, but `isCashAppPay: true` selects the separate pay-now product. It is intentionally absent from our Afterpay requests. Adding it is not a fix for a blocked BNPL channel. [Cash App Pay integration](https://developers.cash.app/afterpay/guides/api-development/add-cash-app-pay-to-your-site/overview). |
| Credentials / endpoints / headers | Basic authentication is server-side only. Environment selects the documented production or sandbox base URL. JSON Content-Type, Accept and Merchant ID-bearing User-Agent are present. Secrets are absent from frontend builds and source control. [Authentication](https://developers.cash.app/afterpay/api-reference/reference/introduction/authentication), [headers](https://developers.cash.app/afterpay/api-reference/reference/introduction/request-headers). |
| Merchant limits / currency | USD only; server-side inclusive min/max validation. Limits are cached and refreshed on use after one day. A daily scheduled refresh is recommended by Afterpay; ours is currently on-demand rather than a cron. Confirm approved Pay-in-4 / Pay Monthly products and limits with Afterpay; do not promise an installment count, approval or maximum from generic marketing. |
| Checkout payload | Amount and merchant reference are taken from an immutable server-owned invoice. Customer enters their own contact details. One item represents the invoice total, quantity one. Shipping/billing are optional in the generic standard-checkout schema. A service-specific data requirement may supersede this generic minimum; see launch questions below. [Create Checkout](https://developers.cash.app/afterpay/api-reference/reference/checkouts/create-checkout-1). |
| Service category | Potential launch requirement: Afterpay lists `custom.serviceType`, service start/end dates, city/state/country and consumer tenure for services, subject to Delivery Manager guidance. These fields are not collected by the current invoice-number/amount form. Obtain Car Craft's required fields and approved invoice categories before adding them; never fabricate service dates or tenure. Auto repair/towing approval must not be assumed to cover vehicle sales or every invoice type. [Data requirements](https://developers.cash.app/afterpay/api-reference/reference/introduction/data-requirements). |
| Redirect contract | Confirmation and cancellation URLs are separate, HTTPS and on the public site. Direct use of the server-returned `redirectCheckoutUrl` is supported by the endpoint reference; Afterpay.js is not needed just to follow that URL. Customer cancellation does not capture payment. |
| Capture and proof of payment | Capture is server-side. Paid requires matching stored token, internal reference, amount and USD currency plus APPROVED / CAPTURED and a provider order ID. Authorization-only, partial capture, mismatches and network uncertainty stay under review. Browser query parameters are not evidence of money received. |
| Idempotency / duplicates | The full-capture endpoint is token-idempotent. Reuse the same stored token after an uncertain result; do not issue a replacement. Normalized invoice uniqueness, start/capture locks, captured-state checks and capture-version checks protect duplicate requests. |
| Expiration | Link validity (1–30 days) and Afterpay checkout validity are separate. Honor the returned checkout `expires` timestamp. An old checkout is not regenerated automatically. An in-flight capture can finish after the customer link expires. |
| Lost redirects / recovery | A customer who closes the browser before returning may leave Checkout started. There is no automatic background capture. Use Check payment for a server lookup; a missing payment is not proof of a successful payment. The customer can resume the same valid checkout. Timeout/review cases must be resolved before another invoice payment is requested. |
| Refunds | Full and partial refunds are supported in Business Hub; a separate refund API UI is not required for this first version. Certification still includes the actual refund workflow. Confirm Car Craft's policy, operator access and customer communication. Local records do not synchronize subsequent refunds, and cancellation is never a refund. [Refund guide](https://developers.cash.app/afterpay/guides/api-development/api-quickstart/create-a-refund). |
| Disputes / webhooks | Staff must monitor and handle disputes in Business Hub. The Afterpay webhook guide covers dispute notifications and requires support provisioning plus HMAC verification; it is not a drop-in payment-success webhook. Cash App Pay Partner API `payment.status.updated` belongs to a different API product. No unauthenticated webhook or invented payment event is implemented. [Disputes in Hub](https://developers.cash.app/afterpay/guides/api-development/disputes/manage-disputes-in-the-business-hub), [webhook guide](https://developers.cash.app/afterpay/guides/api-development/webhook-signature-generation). |
| Settlement reconciliation | Capture does not establish the date or net amount of a bank deposit. Reconcile provider order ID and merchant reference against Business Hub settlement reports. Our merchant reference is the internal payment request ID; the customer-facing invoice number is included in the item name. No automated accounting or settlement import exists. [Settlement reports](https://developers.cash.app/afterpay/guides/welcome/business-hub/settlement-reports). |
| Customer data / access | Admin actions require authenticated configured-admin identity. Random 256-bit links expose minimal invoice data; internal notes and secrets are excluded. HTTPS, no-referrer and noindex are set on the customer page. Customer contact data is passed to Afterpay rather than stored with the invoice. |
| Customer disclosures | The checkout page explains contact-data sharing and conditional approval. Public privacy/terms pages exist but do not yet describe the new payment workflow or name Afterpay; update those factual disclosures and confirm the business's actual refund/cancellation terms before launch. This audit does not invent legal/business policies. |
| Branding / messaging | No guaranteed approval, automatic four-payment calculation, interest-free promise or additional payment surcharge is displayed. Obtain approved current checkout branding/custom messaging during certification. Optional On-Site Messaging requires merchant-specific placement IDs and configuration; it does not activate payment processing. [Messaging](https://developers.cash.app/afterpay/guides/afterpay-messaging/implementation). |
| Clover | This web integration does not activate a Clover terminal. In-person activation and the earlier terminal test remain a separate merchant/acquirer workflow. No terminal settings were changed in this audit. |
| Deployment | Admin and public site are separate GitHub Pages repositories; backend deploy is separate again. Build the public payment entry from the admin source and copy its referenced assets to the public repository. A named Convex development deployment currently serves the live site; sandbox checkout QA should use an isolated backend/test site, not switch a live invoice dataset between environments. |

### Documentation inconsistencies accounted for

- The Create-a-checkout guide includes a table entry `/v2/platform/configuration`, while its sequence diagram and endpoint reference specify `/v2/configuration`. Use the actual endpoint reference; do not try unrelated platform APIs as an activation workaround.
- The immediate-capture guide mentions requestId-based retries, but the full-capture endpoint explicitly defines token-based idempotency and says requestId is unnecessary. Our full-capture implementation follows that endpoint contract.
- The Get Checkout page describes temporary details retained for up to 60 minutes, while the capture guide mentions 180 minutes. Use the actual `expires` value returned for the checkout and confirm sandbox timing; do not hard-code either number as a guaranteed lifetime.
- The webhook example mixes base64 generation and hex decoding, while the prose/manual example describes a base64 HMAC. If dispute webhooks are later implemented, confirm the canonical URL and signature format with Afterpay, verify raw bytes and timestamp freshness, and test real signed payloads. Do not copy the conflicting sample blindly.

### Questions for Afterpay / outstanding launch evidence

1. Resolve the observed `merchant_channel_setup_error`; confirm that this merchant ID is provisioned for **online Afterpay installments** and for customer-opened links to finalized repair/towing invoices.
2. Provide sandbox merchant credentials and Sandbox Business Hub access, plus the Delivery Manager/account contact for custom integration certification.
3. Specify required services `custom` fields, eligible invoice categories, allowed fulfillment/capture timing, and whether a single invoice-total item is sufficient or itemization is required.
4. Confirm enabled payment products and actual merchant limits, and provide/approve current checkout branding and messaging.
5. Confirm Business Hub refunds are acceptable for this integration's certification and which staff will handle refunds, disputes and settlement reconciliation.

### Sandbox acceptance checklist (not yet executed against Afterpay)

- Read configuration, including absent minimum and inclusive boundary amounts; reject amounts below/above the actual limits.
- Complete an approved customer checkout and verify the exact invoice total, redirect, one captured provider order and local Paid result.
- Repeat clicks/return requests; prove a single charge. Test a lost capture response and read-only reconciliation of the same token.
- Exercise decline, cancellation, browser back/refresh, missing/forged callback parameters, abandoned checkout, expired checkout and expired invoice link.
- Test desktop and mobile, both approved US checkout host routes where available, and access from a copied customer link.
- Perform full and partial **sandbox** refunds through Business Hub, inspect the provider order/report, and verify the documented local capture-only history limitation is understood.
- Review customer support, refund/cancellation terms, privacy disclosure and approved branding with Afterpay during certification.
- After certification, verify the production configuration and a deliberately authorized launch transaction/refund; enable real customer checkout only after those checks. Automated mocked tests do not satisfy this checklist or Afterpay certification.

### Automated validation

The audit expanded the suite from 41 to 60 passing tests (29 backend payment cases and 8 payment UI cases, plus 23 existing tests). TypeScript payment checks pass. New coverage includes omitted minimums, US redirect migration hosts and hostile host variants, decline replacement, late reconciliation/capture races, safe provider error identifiers, and cancelled/unknown callbacks. No real customer charge or refund was performed during this audit.

