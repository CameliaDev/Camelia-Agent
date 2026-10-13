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

Any of:

- Build-time: `VITE_GITHUB_OAUTH_CLIENT_ID=Ov23… pnpm --filter @camelia/ui build`
- Runtime: paste once in Account menu / Settings → stored in `localStorage` key `camelia.githubOAuthClientId`
- Bake into `packages/ui/src/window/github-auth.ts` (`BAKED_GITHUB_OAUTH_CLIENT_ID`)

Scopes requested: `read:user public_repo` (avatar + in-app feedback issues).

PAT paste remains under “use a personal access token instead”.
