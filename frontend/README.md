# Sketchable — Frontend

A mobile-first drawing app for two, built with React 19, TypeScript, Vite,
Tailwind CSS v4, and Fabric.js. See [`CLAUDE.md`](./CLAUDE.md) for the drawing
architecture; this file covers running it and the auth/pairing setup.

## Quick start

```bash
npm install
cp .env.example .env   # then fill in the values (see below)
npm run dev
```

Without a configured `.env`, the app boots to a "Auth isn't configured yet"
notice instead of crashing.

## Environment variables

All are `VITE_`-prefixed and inlined into the bundle at build time (so none are
true secrets). See `.env.example`.

| Var                    | What                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `VITE_AUTH0_DOMAIN`    | Your Auth0 tenant domain (e.g. `your-tenant.us.auth0.com`)                                                              |
| `VITE_AUTH0_CLIENT_ID` | The Auth0 SPA application's Client ID                                                                                   |
| `VITE_AUTH0_AUDIENCE`  | **Required** — your Auth0 API identifier; makes Auth0 issue a verifiable JWT. Must match the backend's `AUTH0_AUDIENCE` |
| `VITE_API_BASE_URL`    | Deployed HTTP API base URL (SAM stack output `ApiBaseUrl`)                                                              |

## Auth0 setup (one-time)

The app signs users in with Google via Auth0 and uses the Auth0 user id (`sub`)
as the stable per-user id (so the same Google account is the same user on any
device).

1. **Create the app** — In the [Auth0 dashboard](https://manage.auth0.com),
   go to **Applications → Create Application**, choose **Single Page Web
   Application**, and pick the React SDK.
2. **Enable Google** — **Authentication → Social → Create Connection → Google**.
   For production, add your own Google OAuth client; the Auth0 dev keys work for
   local testing.
3. **Configure URLs** — On the application's **Settings**, set:
    - **Allowed Callback URLs**: `https://localhost:5173`
    - **Allowed Logout URLs**: `https://localhost:5173`
    - **Allowed Web Origins**: `https://localhost:5173`

    If you open the app from another HTTPS host on your LAN, add that exact
    origin too. For this workspace the current LAN callback is
    `https://192.168.68.72:5173`; add it to Auth0 as well, or set
    `VITE_AUTH0_REDIRECT_URI` to your own LAN URL and add that exact URL.

    Add your deployed origin (e.g. `https://app.example.com`) to each, comma-
    separated, when you ship.

4. **Create an API** — **Applications → APIs → Create API**. Give it an
   **Identifier** (any URI-ish string, e.g. `https://api.sketchable`). This is
   the _audience_; set the same value in `VITE_AUTH0_AUDIENCE` and the backend's
   `AUTH0_AUDIENCE`. Without it, Auth0 returns an opaque token the Lambda can't
   verify.
5. **Copy credentials** — Put the **Domain** and **Client ID** into `.env` as
   `VITE_AUTH0_DOMAIN` / `VITE_AUTH0_CLIENT_ID`, and the API Identifier into
   `VITE_AUTH0_AUDIENCE`.

> Vite's dev server defaults to port **5173**. If you run on a different port,
> update the three Auth0 URL fields to match, and keep the scheme `https` while
> using the dev SSL server.

## How auth + pairing flow works

The gate lives in [`src/App.tsx`](./src/App.tsx):

1. **Not signed in →** `OnboardingScreen` — intro + "Continue with Google".
2. **Signed in, not paired →** `PairingScreen` — shows the user's own 6-char
   invite code (copy/share) and an input to redeem a partner's code. It polls
   `GET /pair`, so when your partner enters _your_ code, you advance
   automatically — **either** partner redeeming binds **both**.
3. **Signed in + paired →** the full drawing app (`MainApp`), with the active
   session (`userId`, `pairId`, `partnerId`, `code`) available via
   `useSession()`. `SendNote` flattens the sketch and `POST`s it to the shared
   pair stream.

Pairing endpoints (`GET /pair`, `POST /pair/redeem`) live in the backend Lambda;
see `backend/lambda/README.md`.
