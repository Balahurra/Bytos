# Bytos Terms of Service — LOCAL DRAFT

**Status:** Draft only. Not published, not legal advice, and not effective.
**Drafted:** 2026-11-10
**Applies to:** the Bytos VS Code extension, the Bytos account service, and
`https://bytos.dev` (together, the "Service").

> This draft is intentionally incomplete. Every `[OWNER DECISION]`,
> `[MISSING]`, and `[LEGAL REVIEW]` marker is a fact or decision that is not
> established in the repository. Do not publish this document until the owner
> and qualified legal counsel have supplied and approved every marker.
>
> The public `https://bytos.dev/tos` route is currently missing. The extension
> account UI links to that URL, so publishing this draft (or a reviewed version)
> at that route is an external release blocker.

## 1. Who operates the Service

The Service is operated by **[MISSING: legal entity name, registered address,
country of incorporation, and business contact]**. References to "Bytos",
"we", "us", and "our" mean that entity.

- **[OWNER DECISION]** Confirm the legal entity that contracts with users.
- **[OWNER DECISION]** Confirm whether the Bytos project, a company, or an
  individual owns the account service and the `bytos.dev` domain.
- **[LEGAL REVIEW]** Confirm the operator disclosures required in the target
  markets.

## 2. The Service

Bytos is an open-source, bring-your-own-key coding agent for Visual Studio Code.
The extension can read a workspace, propose and apply edits, run terminal
commands, use a browser, and call MCP tools, subject to user approval settings.

The core extension is licensed under the Apache License 2.0. The licence for the
software is separate from these Terms, which govern the hosted account and
website portions of the Service.

The Bytos account is optional. Chat, BYOK provider configuration, and local
models work without an account. There is no hosted subscription, credit
purchase, or payment flow in this build.

## 3. Eligibility

**[OWNER DECISION]** State the minimum age and any geographic restrictions.

**[LEGAL REVIEW]** Confirm whether parental consent, age verification, or
jurisdiction-specific eligibility rules apply.

## 4. Accounts

To use account features, you create an account through `https://bytos.dev`.
Authentication is provided by Supabase Auth. You are responsible for keeping
your credentials confidential and for activity under your account.

- The extension stores a signed-in session in VS Code SecretStorage only when
  you choose to stay signed in; otherwise the session is kept in memory.
- Signing out clears the local session and asks Supabase to end it.
- The 1.0.2 build has no in-product account-deletion or data-export control.
  **[OWNER DECISION]** Publish the deletion/export request process and response
  period before presenting the account as a complete service.
- **[OWNER DECISION]** State whether accounts may be shared, transferred, or
  used by organisations, and how organisation administrators are designated.

## 5. Your content and prompts

You retain ownership of the code, prompts, files, and other content you submit.
You grant Bytos only the limited rights needed to operate the Service.

- **[OWNER DECISION]** Define the exact licence users grant for hosted
  processing, support, and security operations.
- **[OWNER DECISION]** State how account data and user content are handled when
  an account is deleted.
- **[LEGAL REVIEW]** Confirm the wording for user content, feedback, and
  organisation-owned content.

## 6. Model providers and third-party services

Bytos does not proxy model prompts or code through a Bytos model backend. Model
requests go from your machine to the provider you configure. Your use of a
provider is governed by that provider's terms, and you are responsible for the
fees, keys, and permissions you configure.

The optional account flow uses:

- Supabase Auth for account registration and sessions;
- the Bytos sign-in exchange worker for the extension handoff;
- the Bytos API at `https://api.bytos.dev` for authenticated account data such
  as profile, organisations, credits, usage, and remote configuration;
- Cloudflare for website hosting and request logs; and
- PostHog only if you explicitly enable telemetry.

MCP servers, browser targets, GitHub, OpenRouter, ClinePass, and model providers
are third-party services you choose to use.

- **[OWNER DECISION]** Identify the contracting entity for any future paid
  services and publish the price, billing cycle, cancellation, refund, and tax
  terms. Do not introduce a hosted subscription or credit product without new
  terms.
- **[LEGAL REVIEW]** Confirm the third-party-service disclaimers and the
  allocation of responsibility for provider outages, model outputs, and MCP
  actions.

## 7. Acceptable use

**[OWNER DECISION]** Define prohibited conduct. At minimum, the owner should
consider unlawful use, malware, credential theft, unauthorised access, abuse of
third-party services, circumvention of rate limits, and infringement.

**[LEGAL REVIEW]** Confirm enforcement, suspension, and appeal wording.

## 8. Privacy

The published privacy policy is at `https://bytos.dev/privacy`. The extension
data map is in [`apps/vscode/PRIVACY.md`](../../apps/vscode/PRIVACY.md). Those
documents describe what the current build sends to model providers, Supabase,
the Bytos API, Cloudflare, PostHog (opt-in only), MCP servers, and other
third-party services.

- **[OWNER DECISION]** Appoint and publish a privacy contact.
- **[OWNER DECISION]** Confirm retention periods, lawful bases, international
  transfer mechanisms, and the account deletion/export process.
- **[LEGAL REVIEW]** Confirm GDPR, UK GDPR, CCPA/CPRA, and other applicable
  privacy obligations.

## 9. Availability, changes, and support

The Service is provided on an as-is and as-available basis. The repository does
not contain a service-level commitment or uptime guarantee. Features may change
or be removed.

- **[OWNER DECISION]** State whether any support response time is promised.
- **[OWNER DECISION]** State how material changes to these Terms are notified.
- **[LEGAL REVIEW]** Confirm consumer-law limits on changing or suspending the
  Service.

## 10. Disclaimers and limitation of liability

The software is licensed under the Apache License 2.0, which includes its own
warranty and liability provisions. Those provisions apply to the software.

- **[LEGAL REVIEW]** Draft the disclaimers and limitation of liability for the
  hosted account and website.
- **[OWNER DECISION]** Confirm whether any liability cap, exclusions, or
  mandatory consumer rights apply.

## 11. Termination

**[OWNER DECISION]** State the grounds for suspension or termination, notice
periods, and what happens to account data and paid credits.

**[LEGAL REVIEW]** Confirm the termination and survival wording.

## 12. Governing law and disputes

**[MISSING]** Governing law, jurisdiction, venue, and dispute-resolution process.

**[LEGAL REVIEW]** Confirm the choice of law, consumer protections, and any
arbitration or class-action wording permitted in the target markets.

## 13. Contact

**[MISSING]** Legal notice address, support contact, privacy contact, and
security contact. The repository currently points security reports to the GitHub
security advisory flow in `SECURITY.md`.

## 14. Missing owner and legal information

| Item | Status |
|---|---|
| Legal entity and registered address | Missing |
| Country/jurisdiction of the operator | Missing |
| Governing law and venue | Missing |
| Minimum age and eligibility restrictions | Missing |
| Account deletion/export process and contact | Missing |
| Retention periods and lawful bases | Missing |
| Paid subscription, credits, payments | Not offered in this build |
| Acceptable-use rules and enforcement process | Missing |
| User-content licence and organisation ownership | Missing |
| Liability cap, disclaimers, and consumer-law position | Missing |
| Notice method for changes to the Terms | Missing |
| Support, privacy, and legal contact addresses | Missing |
| Trademark ownership and permitted use | Owner confirmation required |

## 15. Verified implementation facts used in this draft

The factual statements above are based on the current repository:

- `apps/vscode/src/services/auth/supabaseAccountService.ts` — Supabase config
  fetch, browser handoff, SecretStorage session keys, exchange through the
  Bytos API worker.
- `apps/vscode/src/sdk/account-service.ts` and
  `apps/vscode/src/sdk/auth-service.ts` — authenticated Bytos API requests for
  account and organisation data.
- `apps/vscode/webview-ui/src/App.tsx` — the optional one-time account intro and
  the non-blocking close behaviour.
- `apps/vscode/webview-ui/src/components/account/` — account, privacy, and
  account-deletion links.
- `apps/vscode/PRIVACY.md` — the data map for local storage, providers, and
  account services.

Nothing in this draft establishes a legal entity, a jurisdiction, a retention
period, a lawful basis, or a payment term. Those remain owner and legal-review
decisions.
