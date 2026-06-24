# Sketchable — Deployment Runbook

Two environments, branch-driven:

| Branch    | Environment | Web app                          | API                              |
|-----------|-------------|----------------------------------|----------------------------------|
| `main`    | production  | `https://sketchable.jorio.dev`   | `https://api.sketchable.jorio.dev`     |
| `develop` | staging     | `https://staging.sketchable.jorio.dev` | `https://api-staging.sketchable.jorio.dev` |

DNS is on **Cloudflare** (`jorio.dev`). The web app is a Vite SPA on **S3 + CloudFront**;
the API is the existing **SAM** stack (Lambda + HTTP API, `us-east-2`). Secrets live in
**SSM Parameter Store** (SecureString). The existing `sketchable-s3` bucket + CloudFront
`E171KUDTWGKACS` keep serving sketch images and are not touched by web hosting.

> Architecture decisions are recorded in this repo's plan; this file is the
> step-by-step. Do the one-time setup once per environment, then deploys are just
> pushes to `main` / `develop` (or the manual scripts).

---

## 0. Prerequisites (local)

- AWS CLI v2, SAM CLI, Node 22, Python 3.12, git-bash (for the `scripts/*.sh`).
- AWS creds with rights to CloudFormation, S3, CloudFront, ACM, Lambda, API GW, SSM, IAM.

---

## 1. TLS certificates (ACM)

You need **two certs per environment** (different regions):

| Cert covers                         | Region      | Used by               |
|-------------------------------------|-------------|-----------------------|
| `sketchable.jorio.dev`              | **us-east-1** | CloudFront (web app)  |
| `api.sketchable.jorio.dev`          | **us-east-2** | API Gateway custom domain |

(Staging: `staging.sketchable.jorio.dev` / `api-staging.sketchable.jorio.dev`.)

For each: ACM → Request public cert → DNS validation → ACM shows a CNAME
(`_xxx.sketchable.jorio.dev` → `_yyy.acm-validations.aws`). Add that CNAME in
Cloudflare **DNS-only (grey cloud)**. Wait for "Issued". Note the ARNs.

---

## 2. Cloudflare DNS records

Create these (all **DNS-only / grey cloud** — do NOT proxy CloudFront/API GW):

| Type  | Name                    | Target                                   |
|-------|-------------------------|------------------------------------------|
| CNAME | `sketchable`            | `<web CloudFront domain>` (stack output `DistributionDomainName`) |
| CNAME | `api.sketchable`        | `<API RegionalDomainName>` (stack output `ApiCustomDomainTarget`) |
| CNAME | `staging.sketchable`    | `<staging web CloudFront domain>`        |
| CNAME | `api-staging.sketchable`| `<staging API RegionalDomainName>`       |
| CNAME | (ACM validation CNAMEs from step 1) | as given by ACM             |

> Cloudflare proxy (orange) in front of CloudFront causes double-CDN + SSL
> handshake issues. Keep these grey. Cloudflare SSL mode "Full (strict)" is fine
> for any records you later choose to proxy.

---

## 3. SSM secrets (per environment)

Create as **SecureString**. Generate values first:

```bash
openssl rand -hex 32                       # ScriptTokenSecret
pip install py-vapid && vapid --gen        # VAPID keypair (private here, public -> frontend)
```

```bash
ENV=prod   # or staging
aws ssm put-parameter --type SecureString --region us-east-2 \
  --name "/sketchable/$ENV/script-token-secret"      --value "<openssl-hex-32>"
aws ssm put-parameter --type SecureString --region us-east-2 \
  --name "/sketchable/$ENV/auth0-mgmt-client-secret" --value "<auth0-m2m-secret>"
aws ssm put-parameter --type SecureString --region us-east-2 \
  --name "/sketchable/$ENV/vapid-private-key"        --value "<vapid-private-key>"
```

The VAPID **public** key goes into the frontend env (`VITE_VAPID_PUBLIC_KEY`).

---

## 4. Auth0 (production readiness)

1. **Dedicated prod SPA application** (separate from dev). Settings:
   - Allowed Callback URLs: `https://sketchable.jorio.dev`
   - Allowed Logout URLs:   `https://sketchable.jorio.dev`
   - Allowed Web Origins:   `https://sketchable.jorio.dev`
   - (Staging app: the `staging.` equivalents.)
2. **Your own Google OAuth client** — Auth0's default Google connection uses
   Auth0 *development keys* that fail for real users. In Google Cloud: create an
   OAuth client + consent screen, then paste the client id/secret into Auth0 →
   Authentication → Social → Google.
3. **API/audience**: keep `https://api.sketchable`, signing alg RS256.
4. **M2M app** authorized for the Management API (`delete:users`) — its client id
   goes in `params/<env>.env` (`Auth0MgmtClientId`), its secret in SSM.
5. Recommended: a separate Auth0 **tenant** for prod vs staging.

---

## 5. Backend config files (local / CI)

```bash
cd backend/lambda
cp samconfig.toml.example samconfig.toml
cp params/prod.env.example    params/prod.env       # fill in (cert ARN, Auth0, etc.)
cp params/staging.env.example params/staging.env
```

`params/*.env` are non-secret and gitignored; secrets are pulled from SSM by the
deploy script. (`ApiCertificateArn` here is the **us-east-2** cert from step 1.)

---

## 6. Provision web hosting (once per env)

```bash
# PROD
WEB_BUCKET=sketchable-web \
WEB_ALIASES=sketchable.jorio.dev \
WEB_CERT_ARN=<us-east-1-cert-arn> \
  bash scripts/deploy-web-infra.sh prod

# STAGING
WEB_BUCKET=sketchable-web-staging \
WEB_ALIASES=staging.sketchable.jorio.dev \
WEB_CERT_ARN=<us-east-1-cert-arn-staging> \
  bash scripts/deploy-web-infra.sh staging
```

Record the outputs (`BucketName`, `DistributionId`, `DistributionDomainName`) —
the domain feeds Cloudflare (step 2), the bucket+id feed frontend deploys.

---

## 7. Frontend env

```bash
cd frontend
cp .env.production.example .env.production   # fill in prod Auth0 + VITE_VAPID_PUBLIC_KEY
cp .env.staging.example    .env.staging
```

---

## 8. First deploy (manual)

```bash
# Backend (creates the API stack + custom domain mapping)
bash scripts/deploy-backend.sh prod

# Frontend (build -> S3 -> CloudFront invalidation)
WEB_BUCKET=sketchable-web DISTRIBUTION_ID=<prod-dist-id> \
  bash scripts/deploy-frontend.sh prod
```

After the backend deploy, grab the `ApiCustomDomainTarget` output and finish the
Cloudflare `api.sketchable` CNAME (step 2).

---

## 9. CI/CD (GitHub Actions) — automated deploys

`.github/workflows/deploy.yml` ships on push: `main`→prod, `develop`→staging.

**AWS OIDC role**: create an IAM role trusting GitHub's OIDC provider
(`token.actions.githubusercontent.com`), scoped to this repo, with permissions for
CloudFormation/S3/CloudFront/Lambda/API GW/SSM(get)/IAM as needed.

Create two **GitHub Environments** (`production`, `staging`), each with these
**Variables**:

| Variable           | Example / contents                                            |
|--------------------|--------------------------------------------------------------|
| `AWS_OIDC_ROLE_ARN`| `arn:aws:iam::<acct>:role/sketchable-deploy`                  |
| `WEB_BUCKET`       | `sketchable-web` (`sketchable-web-staging`)                   |
| `DISTRIBUTION_ID`  | from the web-infra stack output                              |
| `BACKEND_PARAMS`   | full contents of `params/<env>.env`                          |
| `FRONTEND_ENV`     | full contents of `.env.production` / `.env.staging`          |

(`FRONTEND_ENV` values are public — they're inlined into the bundle. Secrets stay
in SSM and are fetched by the deploy role.)

---

## 10. Go-live checklist

- [ ] `https://sketchable.jorio.dev` loads over HTTPS, no cert warning.
- [ ] Deep link (e.g. refresh on a sub-route) returns the app, not 403/404.
- [ ] Google sign-in works (own OAuth client, not Auth0 dev keys).
- [ ] Pairing: share code / redeem code binds both users.
- [ ] Sketch upload + history render (CDN images load).
- [ ] Web push: subscribe + receive on new sketch (needs HTTPS + prod VAPID).
- [ ] iOS: Add to Home Screen shows the real icon (not the "S").
- [ ] API CORS rejects other origins (`AllowedOrigin` is locked, not `*`).
