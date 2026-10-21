# Admin route guard

`src/app/admin/layout.tsx` wraps every page under `/admin` (currently
`/admin/streams`, `/admin/streams/[id]` and `/admin/audit`).

Before rendering any child page it checks, in order:

1. `useAuth()` - while `isLoading` is `true` (auth state still resolving),
   nothing is rendered and no redirect happens yet.
2. `isAuthenticated` - if `false`, the caller is redirected to
   `/access-denied`.
3. `useIsAdmin()` - if the connected wallet is not on the admin allowlist
   (`NEXT_PUBLIC_ADMIN_WALLETS`, parsed by `src/lib/adminAccess.ts`), the
   caller is redirected to `/access-denied`.

Only once all three checks pass does the layout render its children.

This is a **client-side UX guard**, not the security boundary - the backend
independently enforces admin access via `adminMiddleware`
(`ADMIN_STELLAR_PUBKEYS`), so a request that reaches the API is still checked
there regardless of what this layout allowed through. The list pages
(`/admin/streams` and `/admin/audit`) additionally render their own
`ForbiddenState` if a 403 comes back from the API, as defense in depth for the
case where wallet state changes after the layout's initial check.
`/admin/streams/[id]` has no `ForbiddenState` yet: a 403 there surfaces through
its generic `ErrorState` message.
