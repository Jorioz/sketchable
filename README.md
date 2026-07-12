# Sketchable

A progressive web app inspired by sketch/note drawing apps such as noteit.
Tailored for iOS mobile users. Widget support included provided via [Scriptable](https://scriptable.app)

## How it works

```mermaid
flowchart LR
    A["✏️ You draw a sketch<br/>(PWA, Fabric.js canvas)"] --> B["Upload via API<br/>(Auth0-verified)"]
    B --> C["Sketch stored per pair<br/>+ history manifest"]
    C --> D["🔔 Push notification<br/>to your partner"]
    C --> E["📱 Partner's home screen widget<br/>refreshes with the new sketch"]
    C --> F["🖼️ In-app gallery<br/>of past sketches"]
```

- **Pairing** — one person generates an invite code, the other redeems it.
  From then on, all sketches are scoped to that pair.
- **No accounts to manage** — sign in with Google (via Auth0); your identity
  is your token, the client never asserts its own user id.
- **No database** — sketches are PNGs in S3, ordered history is a per-stream
  `index.json` manifest.

## Repo layout

| Path | What |
|---|---|
| [`frontend/`](frontend/) | React 19 + Vite + Tailwind v4 PWA; Fabric.js canvas with custom brushes |
| [`frontend/scriptable/`](frontend/scriptable/) | iOS home-screen widget script (handed out during onboarding) |
| [`backend/lambda/`](backend/lambda/) | Python Lambda API (SAM) — upload gatekeeper, pairing, tokens |
| [`backend/web/`](backend/web/) | SAM template for static web hosting (S3 + CloudFront) |
| [`infra/`](infra/), [`scripts/`](scripts/) | IAM policies and deploy scripts |

## Infrastructure

Everything runs serverless on AWS, deployed with SAM. Two environments,
branch-driven: `main` → production, `develop` → staging (see
[`DEPLOYMENT.md`](DEPLOYMENT.md) for the full runbook).

```mermaid
flowchart TB
    subgraph Client
        PWA["Web app (PWA)<br/>sketchable.jorio.dev"]
        Widget["Scriptable widget<br/>(read-only token)"]
    end

    subgraph Cloudflare
        DNS["DNS (grey cloud,<br/>no proxy)"]
    end

    subgraph AWS["AWS (us-east-2, CloudFront global)"]
        CFweb["CloudFront<br/>web distribution"]
        S3web["S3<br/>static site bucket"]
        APIGW["API Gateway<br/>HTTP API"]
        Lambda["Lambda<br/>handler.py"]
        S3img["S3<br/>sketch bucket (private)"]
        CFimg["CloudFront + OAC<br/>image CDN"]
        SSM["SSM Parameter Store<br/>(SecureString secrets)"]
    end

    Auth0["Auth0<br/>(Google sign-in, RS256 JWT)"]

    PWA --> DNS
    DNS --> CFweb --> S3web
    PWA -- "Bearer JWT" --> APIGW --> Lambda
    Widget -- "script token" --> APIGW
    PWA <--> Auth0
    Lambda -- "verify JWKS" --> Auth0
    Lambda --> S3img
    Lambda -.-> SSM
    CFimg --> S3img
    PWA & Widget -- "sketch images" --> CFimg
```

### Request path for an upload

```mermaid
sequenceDiagram
    participant U as PWA
    participant G as API Gateway
    participant L as Lambda
    participant S as S3

    U->>G: POST /upload (Bearer JWT, PNG)
    G->>L: proxy event
    L->>L: verify RS256 sig against Auth0 JWKS<br/>(issuer, audience, expiry)
    L->>S: put users/{userId}/{pairId}/{ts}.png
    L->>S: update index.json manifest
    L-->>U: 200 (sketch entry)
    Note over L: partner gets a Web Push<br/>(VAPID keys from SSM)
```

Key points:

- **Auth** — every protected route requires an Auth0 access token; the Lambda
  verifies the signature itself against the tenant's JWKS. The widget uses a
  separate long-lived read-only token minted by `POST /me/script-token`
  (signed with a secret held in SSM).
- **Storage** — one private S3 bucket, keyed
  `users/{userId}/{pairId}/{timestamp}.png`, served read-only through
  CloudFront with Origin Access Control. No database anywhere.
- **Secrets** — script-token secret, Auth0 management secret, and VAPID
  private key live in SSM Parameter Store as SecureStrings, per environment.
- **TLS/DNS** — ACM certs (us-east-1 for CloudFront, us-east-2 for the API
  custom domain); Cloudflare holds DNS but does not proxy.
