Type: grilling
Status: open

## Question

Ticket 01 found that My Path's user-creation feature never calls Microsoft Graph to create/invite Entra accounts — it only manages app-level roster/role rows, assuming the Entra account already exists (provisioned separately by IT). Before the Entra permission scope list can be compiled, decide which pattern Group Compass's user-creation feature follows:

(a) **Same as My Path** — app-level roster/role management only, assuming the Entra account already exists. Needs no Graph permission beyond standard SSO sign-in.
(b) **Actually create/invite the Entra account** — a materially more privileged, more security-sensitive app registration (e.g. `User.Invite.All` for guest invites or `User.ReadWrite.All` for direct creation).

Once decided, compile the exact scope list (SSO scopes, plus whichever of the above applies) for the Group CTO's sign-off, per HANDOFF.md §4. If (b) is chosen, this touches an auth/security boundary — route it through this repo's security-review process once implemented.
