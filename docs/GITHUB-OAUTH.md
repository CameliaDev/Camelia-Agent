# GitHub OAuth (device flow)

Camelia desktop signs in with GitHub **device authorization** (same idea as VS Code):
show a one-time code, open the browser, poll until the user authorizes.

## One-time: create the OAuth App

1. Open https://github.com/settings/applications/new (CameliaDev account).
2. Application name: `Camelia Desktop`
3. Homepage URL: `https://github.com/CameliaDev/Camelia-Agent`
4. Authorization callback URL: `http://127.0.0.1` (device flow does not use it, but GitHub requires a value)
5. Register → copy the **Client ID** (no client secret needed for device flow).

## Ship the Client ID

`BAKED_GITHUB_OAUTH_CLIENT_ID` in `packages/ui/src/window/github-auth.ts` is **empty**. This repository does not contain an OAuth Client ID. Device flow does not complete until one is supplied. The app must not claim that GitHub login works without an `Ov23…` id.

Resolution order:

1. Build-time: `VITE_GITHUB_OAUTH_CLIENT_ID=Ov23… pnpm --filter @camelia/ui build`
2. Runtime: paste once in the account menu or the login page. Stored in `localStorage` key `camelia.githubOAuthClientId`
3. A future bake of that same constant

If none of those is set, **Sign in with GitHub** opens the paste field and shows the missing-client-id error. It does not start the device request.

Scopes requested: `read:user public_repo` (avatar + in-app feedback issues).

PAT paste stays under “use a personal access token instead”. It is the fallback, not the primary path.

In-app feedback defaults to `CameliaDev/camelia-feedback`, which exists and is public. Creating an issue still needs the user’s own token from this device flow (or a PAT).
