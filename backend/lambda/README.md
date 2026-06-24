# Sketchable — Lambda API

Secure upload gatekeeper for the Sketchable couple-sketching app. Sits behind an
API Gateway **HTTP API** with proxy integration.

## Architecture

**Individual User Streams with Pair-Scoped Pathing** — no database. Each sketch
is stored as a PNG in a private S3 bucket, and a per-stream `index.json` manifest
holds the ordered history (newest first). CloudFront (with Origin Access Control)
serves the images read-only.

S3 key schema:

```
{bucket}/
└── users/
    └── {userId}/
        └── {pairId}/
            ├── index.json          <- ordered Unix-timestamp array (newest first)
            ├── 1718991200.png      <- historical sketch
            └── 1718995000.png      <- newest sketch
```

## Layout

```
backend/lambda/
├── handler.py        # Lambda entry point + (method, path) router
├── test_handler.py   # Unit tests (no AWS / no boto3 needed — fake S3 client)
├── requirements.txt  # Runtime deps: PyJWT[crypto] (boto3 comes from the runtime)
├── template.yaml     # AWS SAM template (Lambda + S3 + CloudFront/OAC + IAM)
└── README.md
```

## Routes

| Method | Path           | Handler                | Auth         | Notes                                    |
|--------|----------------|------------------------|--------------|------------------------------------------|
| GET    | `/health`      | `handle_health`        | none         | Liveness check                           |
| POST   | `/upload`      | `handle_upload`        | Bearer JWT   | Store a sketch + update history manifest |
| GET    | `/sketches`    | `handle_list_sketches` | Bearer JWT   | Read your own / your partner's history   |
| GET    | `/pair`        | `handle_get_pairing`   | Bearer JWT   | Get/create the caller's invite code + status |
| POST   | `/me/username` | `handle_set_username`  | Bearer JWT   | Set the caller's display username         |
| POST   | `/pair/redeem` | `handle_redeem_code`   | Bearer JWT   | Redeem a partner's code to bind both users |

CORS preflight (`OPTIONS`) is answered automatically.

## Authentication

Every protected request must carry an Auth0 **access token** as
`Authorization: Bearer <jwt>`. The handler verifies the token's RS256 signature
against the tenant's JWKS (`https://{AUTH0_DOMAIN}/.well-known/jwks.json`) and
checks the issuer, audience, and expiry, then derives the caller's `userId` from
the verified `sub` claim (run through the same path-safe sanitizer as the
frontend). **The client never asserts its own identity** — request bodies and
query strings can't name a `userId`, and writes target the pair the caller is
actually bound to. A missing/invalid token is `401`; a valid token for a user
who isn't paired is `403`.

### `POST /upload`

Header: `Authorization: Bearer <jwt>`. Body (JSON):

```json
{ "image": "data:image/png;base64,iVBORw0KGgo..." }
```

The writer (`userId`) and stream (`pairId`) come from the token + the caller's
pairing record.

| Status | Body                                         | When                            |
|--------|----------------------------------------------|---------------------------------|
| 200    | `{"success": true, "timestamp": 1718995000}` | Stored                          |
| 400    | `{"error": "Missing required fields"}`       | Missing/invalid image           |
| 401    | `{"error": "Unauthorized"}`                  | Missing/invalid token           |
| 403    | `{"error": "Not paired"}`                    | Caller isn't bound to a partner |
| 500    | `{"error": "Internal Server Error"}`         | S3/runtime failure (logged)     |

### `GET /sketches`

Header: `Authorization: Bearer <jwt>`. Query params: `userId` (optional — omit
for your own stream, or pass your partner's userId to read theirs; anyone else
is `403`), `limit` (optional, default 20, max 50). `pairId` is taken from the
caller's pairing record, never the request.

```json
{
  "userId": "google-oauth2_123",
  "pairId": "pair_a1b2c3d4e5f6a7b8",
  "count": 2,
  "sketches": [
    {"timestamp": 1718995000, "key": "users/google-oauth2_123/pair_a1b2c3d4e5f6a7b8/1718995000.png", "url": "https://<cdn>/..."},
    {"timestamp": 1718991200, "key": "users/google-oauth2_123/pair_a1b2c3d4e5f6a7b8/1718991200.png", "url": "https://<cdn>/..."}
  ]
}
```

`url` is built from `CDN_DOMAIN`; if that env var is unset it comes back `null` (the
`key` is always present so the client can construct its own URL).

### Pairing (couple linking)

Pairing state lives in S3 — no database:

```
{bucket}/pairing/users/{userId}.json  -> {"userId","code","pairId","partnerId","username"}
{bucket}/pairing/codes/{code}.json    -> {"userId"}   (code -> owner lookup)
```

`pairId` is derived deterministically from both user ids (order-independent), so
each partner reads/writes the same `users/{userId}/{pairId}/...` stream path.

**`GET /pair`** — lazily provisions the caller's 6-char invite code on first
call, then returns status. The caller is identified by their token. The frontend
polls this so a user flips to `paired: true` the moment their partner redeems
their code.

```json
{ "userId": "google-oauth2_123", "code": "G7QX2P", "paired": false, "pairId": null, "partnerId": null, "username": null }
```

**`POST /me/username`** — body `{ "username": ... }` (the user comes from the
token). Sets the caller's display name during onboarding (after sign-in, before
pairing). Usernames are free-form labels — **no uniqueness check**, since users
are keyed by their Auth0 identity. The value must be alphanumeric
(`[a-zA-Z0-9]`) and 1–20 characters; otherwise `400`. Returns the refreshed
pairing view (now carrying `username`); can be called again to change it.

```json
{ "userId": "google-oauth2_123", "code": "G7QX2P", "paired": false, "pairId": null, "partnerId": null, "username": "Alice99" }
```

**`POST /pair/redeem`** — body `{ "code": ... }` (the redeemer comes from the
token). Binds both users into a shared stream. Codes are case-insensitive.
Idempotent for an already-bound couple; `409` if either user is already paired
with someone else, `404` for an unknown code, `400` for redeeming your own code.

```json
{ "userId": "google-oauth2_456", "code": "K4MN9R", "paired": true, "pairId": "pair_a1b2c3d4e5f6a7b8", "partnerId": "google-oauth2_123", "username": "Bob" }
```

## Configuration

Set as Lambda environment variables (the SAM template wires them from stack
parameters):

| Variable         | Purpose                                            |
|------------------|----------------------------------------------------|
| `AUTH0_DOMAIN`   | Auth0 tenant domain (e.g. `your-tenant.us.auth0.com`) — used to fetch JWKS and check the issuer. |
| `AUTH0_AUDIENCE` | Auth0 API identifier the access tokens are issued for; verified as the token `aud`. |
| `ALLOWED_ORIGIN` | CORS `Access-Control-Allow-Origin` (`*` for dev; your https origin for prod). |
| `BUCKET_NAME`    | Private S3 bucket holding sketches + manifests.    |
| `CDN_DOMAIN`     | CloudFront domain used to build read URLs (auto-wired from the distribution). |

## Test locally

The unit tests inject a fake S3 client and stub token verification, so no AWS
credentials, boto3, or PyJWT install is needed:

```bash
python -m unittest test_handler -v
```

With AWS SAM you can also run the API locally (needs Docker):

```bash
sam build --use-container
sam local start-api
curl http://127.0.0.1:3000/health
```

## Deploy

Requires the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
and configured AWS credentials.

```bash
# --use-container builds `cryptography` (a native dep of PyJWT[crypto]) against
# the Lambda arm64 runtime, so it works even on Windows/macOS. Needs Docker.
sam build --use-container
sam deploy   # params come from samconfig.toml; edit Auth0Domain/Auth0Audience first
```

Set `Auth0Domain` / `Auth0Audience` (and `AllowedOrigin` for prod) in
`samconfig.toml` → `parameter_overrides`, or pass `--parameter-overrides` /
`--guided`. The `ApiBaseUrl` and `CdnDomain` stack outputs are what the frontend
points at (upload → API, read → CDN).

> **Auth0 API**: the audience must correspond to an API you create in the Auth0
> dashboard (APIs → Create API). The frontend requests tokens for that audience
> (`VITE_AUTH0_AUDIENCE`) so Auth0 issues a verifiable JWT rather than an opaque
> token.

## Next steps

- Consider a short JWKS cache TTL / pre-warm if cold-start latency on the first
  authenticated request matters.
- Rate-limit `POST /pair/redeem` to slow brute-forcing of invite codes (the
  6-char space is small); e.g. lock out a user after N bad attempts.
