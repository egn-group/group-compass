Type: research
Status: resolved

## Question

The user wants a generic admin user-creation feature in the Group DNA module, modeled on the one already in My Path (a sibling EGN app at `/home/jap/projects/my-path`). How does My Path implement this — how does it create/provision an Entra ID account (or does it only create an app-level user record and expect Entra provisioning separately?), what role/permission model does it assign, what Microsoft Graph API permissions/scopes does it require, and what does its UI/API surface look like?

Findings here directly inform ticket 02 (Entra permission scopes to request).

## Answer

My Path's "user creation" is **app-level roster management only** — it never calls Microsoft Graph to create or invite an Entra ID account. It assumes the person's Entra account already exists (provisioned separately, e.g. by IT); "adding a user" just appends `{email, name, isAdmin, isHR, managerEmail, department, country}` to a JSON blob in one Azure Table Storage row (`OrgUsers`, via `api/putOrgUsers`/`api/getOrgUsers`). Role is a simple two-boolean flag pair (`isAdmin`, `isHR`), not derived from Entra groups/claims. The app registration's only Graph usage anywhere is `Mail.Send` (app permission, client-credentials) for an unrelated send-email function — **zero Graph permissions are used for user creation**. Auth guard pattern worth reusing: SWA's `x-ms-client-principal` header is resolved server-side to look up the caller's own role row (never trust a client-sent role field); a bootstrap exception gates the very first write on a server-only `INITIAL_ADMIN_EMAILS` env var.

**This forks ticket 02**: if Group Compass's user-creation feature should work the same way (manage app-level roster/role rows, assuming the Entra account already exists via IT), it needs **no additional Graph permission** beyond standard SSO sign-in. If instead it should actually create/invite the Entra account itself, that's new territory My Path doesn't model, and would need real Graph write permissions (e.g. `User.Invite.All` for guest invites or `User.ReadWrite.All` for direct creation) — a materially more privileged, more security-sensitive app registration. Ticket 02 now needs this choice made explicitly before compiling the scope list.

Full agent report retained in this session's transcript if deeper detail (file:line references) is needed later.
