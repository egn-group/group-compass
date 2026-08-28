Type: research
Status: resolved

## Question

The Group CTO wants an Azure-only email service for notifications, undecided between Azure Communication Services Email and SendGrid on Azure (HANDOFF.md §4). Research and recommend one, weighing setup effort, cost at pilot volume (~16-20 users, low-frequency notification events), and deliverability.

## Answer

**Recommendation: Azure Communication Services (ACS) Email.** At pilot volume (a few hundred emails/month across ~16-20 users), ACS costs well under $1-2/month (pay-as-you-go, $0.00025/email + $0.00012/MB) versus SendGrid's mandatory ~$20/month Essentials tier now that its free plan is retired (May 2025) — 20-40x the cost for capacity the pilot won't use. ACS also has an official Node.js/TypeScript SDK (`@azure/communication-email`), domain verification (SPF/DKIM/DMARC) done entirely inside the Azure portal alongside the app's other resources, and adequate deliverability tooling (managed suppression list, bounce-rate monitoring) for well-behaved low-volume transactional mail.

Critically for the CTO's stated "Azure-only" preference: SendGrid via Azure Marketplace is billing convenience, not product integration — it still provisions a real Twilio SendGrid account requiring a separate SendGrid-console login (via SSO) for sender authentication/API keys, with support routed through Twilio, not Azure. ACS is the only genuinely Azure-native option of the two.

SendGrid remains a reasonable fallback if volume/marketing-grade needs grow well past pilot scale, but nothing here justifies it now.
