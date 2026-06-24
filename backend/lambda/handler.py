"""Sketchable API — AWS Lambda handler.

Secure upload gatekeeper for the Sketchable couple-sketching app. Wired for an
API Gateway HTTP API with proxy integration.

Architecture: *Individual User Streams with Pair-Scoped Pathing*. Sketches are
stored in a private S3 bucket, keyed per user and per pairing, with a per-stream
`index.json` manifest acting as the ordered history (newest first) — no database.

S3 key schema:

    {bucket}/users/{userId}/{pairId}/index.json        <- ordered timestamp array
    {bucket}/users/{userId}/{pairId}/{timestamp}.png   <- sketch image

Configure the Lambda handler as: `handler.lambda_handler`.
"""

import base64
import binascii
import hashlib
import json
import logging
import os
import re
import secrets
import time
import urllib.parse
import urllib.request

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Configuration (from environment variables set on the function)
# ---------------------------------------------------------------------------
BUCKET_NAME = os.environ.get("BUCKET_NAME", "")
# CloudFront domain that serves sketch images read-only (e.g. d2xuw2rwni8czv.cloudfront.net).
# When set, the read endpoint returns full https URLs; otherwise just S3 keys.
CDN_DOMAIN = os.environ.get("CDN_DOMAIN", "")

# --- Auth0 (request authentication) --------------------------------------
# Every protected request must carry a valid Auth0 access token as
# `Authorization: Bearer <jwt>`. We verify the token's RS256 signature against
# the tenant's JWKS and derive the userId from the verified `sub` claim — the
# client never asserts its own identity.
AUTH0_DOMAIN = os.environ.get("AUTH0_DOMAIN", "")  # e.g. your-tenant.us.auth0.com
AUTH0_AUDIENCE = os.environ.get("AUTH0_AUDIENCE", "")  # the Auth0 API identifier
# Machine-to-machine credentials authorized for the Auth0 Management API
# (scope: delete:users). Used by DELETE /me to remove the user's identity, not
# just their data. If unset, account deletion still wipes S3 but skips Auth0.
AUTH0_MGMT_CLIENT_ID = os.environ.get("AUTH0_MGMT_CLIENT_ID", "")
AUTH0_MGMT_CLIENT_SECRET = os.environ.get("AUTH0_MGMT_CLIENT_SECRET", "")

# --- Script tokens (Scriptable widget credential) ------------------------
# Long-lived tokens the app mints (POST /me/script-token) and bakes into the
# user's Scriptable widget so it can poll the API without an interactive Auth0
# login. They're our own HS256 JWTs, signed with this secret — distinct from
# Auth0's RS256 access tokens — and are read-only (see SCRIPT_TOKEN_ROUTES).
# Leave unset to disable the feature entirely (issuing returns 503).
SCRIPT_TOKEN_SECRET = os.environ.get("SCRIPT_TOKEN_SECRET", "")
SCRIPT_TOKEN_ISSUER = "sketchable-script"
# A year — long enough that the widget keeps working without re-onboarding.
SCRIPT_TOKEN_TTL_SECONDS = 365 * 24 * 3600
# The only routes a script token may call. Everything else (uploads, pairing,
# username, deletion, minting more tokens) requires a real Auth0 login, so a
# leaked widget credential can only ever *read* the couple's sketches.
SCRIPT_TOKEN_ROUTES = {("GET", "/health"), ("GET", "/pair"), ("GET", "/sketches")}
# Origin allowed by CORS. Defaults to "*" for dev; set to the real frontend
# origin (e.g. https://app.example.com) in production via the AllowedOrigin param.
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

# --- Web Push (W3C Push API / VAPID) -------------------------------------
# When a user uploads a sketch we send a Web Push notification to their partner
# (if the partner has subscribed). The partner's browser hands us a push
# subscription (endpoint + p256dh/auth keys) which we store in S3; we then sign
# pushes with our VAPID private key. The matching VAPID *public* key lives in the
# frontend (VITE_VAPID_PUBLIC_KEY). Leave VAPID_PRIVATE_KEY unset to disable push
# entirely — subscribe still stores the subscription, but no notifications are
# sent. Generate a keypair once with `vapid --gen` (py-vapid).
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
# VAPID `sub` claim — a contact URI (mailto: or https:) the push service can use
# to reach you about your pushes. Required by the spec when sending.
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "")

# Maximum number of sketch timestamps kept in a stream manifest. Older entries
# fall off the end so index.json never grows unbounded.
MAX_MANIFEST_ENTRIES = 50

# Default / max number of sketches the read endpoint returns per request.
DEFAULT_LIST_LIMIT = 20
MAX_LIST_LIMIT = 50

# CORS headers. `Access-Control-Allow-Origin` is driven by ALLOWED_ORIGIN so it
# can be locked to the real frontend origin in production (defaults to "*").
CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
}

# Lazily-created S3 client. Kept module-level so it's reused across warm
# invocations; created on first use so the module imports without boto3 present
# (e.g. in unit tests that inject a fake client).
_S3_CLIENT = None


def _s3():
    """Return a cached boto3 S3 client, creating it on first use."""
    global _S3_CLIENT
    if _S3_CLIENT is None:
        import boto3  # imported lazily — provided by the Lambda runtime

        _S3_CLIENT = boto3.client("s3")
    return _S3_CLIENT


def _response(status_code: int, body: dict) -> dict:
    """Build an API Gateway proxy-style response."""
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def _get_header(event: dict, name: str) -> str | None:
    """Case-insensitive header lookup (HTTP API lowercases keys, but be safe)."""
    headers = event.get("headers") or {}
    target = name.lower()
    for key, value in headers.items():
        if key.lower() == target:
            return value
    return None


# Lazily-created PyJWT JWKS client. Caches Auth0's signing keys across warm
# invocations and refreshes them when an unseen `kid` appears.
_JWKS_CLIENT = None


def _jwks_client():
    """Return a cached PyJWKClient for the Auth0 tenant's JWKS endpoint."""
    global _JWKS_CLIENT
    if _JWKS_CLIENT is None:
        import jwt  # PyJWT — bundled via requirements.txt, imported lazily

        _JWKS_CLIENT = jwt.PyJWKClient(f"https://{AUTH0_DOMAIN}/.well-known/jwks.json")
    return _JWKS_CLIENT


def _verify_token(token: str) -> dict:
    """Verify an Auth0 access token and return its claims.

    Raises if the signature, issuer, audience, or expiry don't check out.
    Isolated from `_authenticate` so tests can stub verification without JWTs.
    """
    import jwt  # PyJWT

    signing_key = _jwks_client().get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=AUTH0_AUDIENCE,
        issuer=f"https://{AUTH0_DOMAIN}/",
    )


def _bearer_token(event: dict) -> str | None:
    """Extract the token from an `Authorization: Bearer <token>` header."""
    header = _get_header(event, "authorization") or ""
    parts = header.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def _decode_script_token(token: str) -> dict | None:
    """Verify a backend-minted script token (HS256); None if it isn't one.

    Script tokens are signed with our symmetric SCRIPT_TOKEN_SECRET, unlike
    Auth0's RS256 access tokens, so this is a cheap local check (no JWKS/network)
    that simply returns None for Auth0 tokens — letting the caller fall through
    to Auth0 verification. Returns None (never raises) on any invalid token.
    """
    if not SCRIPT_TOKEN_SECRET:
        return None
    import jwt  # PyJWT

    try:
        claims = jwt.decode(
            token,
            SCRIPT_TOKEN_SECRET,
            algorithms=["HS256"],
            issuer=SCRIPT_TOKEN_ISSUER,
        )
    except Exception:  # noqa: BLE001 — any failure means "not a valid script token"
        return None
    # Defend against a same-secret token of a different shape sneaking through.
    if claims.get("type") != "script" or not claims.get("uid"):
        return None
    return claims


def _issue_script_token(user_id: str) -> tuple[str, int]:
    """Mint a long-lived, read-only script token bound to user_id.

    Returns (jwt, expiry-unix-seconds). The `uid` claim is the already path-safe
    userId, so verification needs no Auth0 `sub` mapping.
    """
    import jwt  # PyJWT

    now = int(time.time())
    exp = now + SCRIPT_TOKEN_TTL_SECONDS
    token = jwt.encode(
        {
            "uid": user_id,
            "type": "script",
            "iss": SCRIPT_TOKEN_ISSUER,
            "iat": now,
            "exp": exp,
            "jti": secrets.token_hex(8),
        },
        SCRIPT_TOKEN_SECRET,
        algorithm="HS256",
    )
    return token, exp


def _user_id_from_sub(sub: str) -> str:
    """Map an Auth0 `sub` (e.g. google-oauth2|123) to a path-safe userId.

    Mirrors the frontend's `userIdFromSub` so the same person resolves to the
    same S3 key prefix.
    """
    return re.sub(r"[^a-zA-Z0-9_-]", "_", sub)


def _authenticate_with_sub(event: dict) -> tuple[str | None, str | None]:
    """Verify the caller's token, returning (path-safe userId, raw Auth0 sub).

    Returns (None, None) on any auth failure. The raw `sub` is exposed for the
    rare caller that must address the Auth0 identity itself (account deletion via
    the Management API), where the path-safe userId isn't enough.
    """
    token = _bearer_token(event)
    if not token:
        return None, None
    # A backend-minted script token carries the userId directly and no Auth0
    # `sub` (the widget never logs in as the Auth0 identity). Checked first since
    # it's a cheap local verify; Auth0 tokens fall through (returns None here).
    script_claims = _decode_script_token(token)
    if script_claims is not None:
        return script_claims["uid"], None
    try:
        claims = _verify_token(token)
    except Exception:  # noqa: BLE001 — any verification failure is a 401
        logger.info("Token verification failed")
        return None, None
    sub = claims.get("sub")
    if not sub:
        return None, None
    return _user_id_from_sub(sub), sub


def _authenticate(event: dict) -> str | None:
    """Return the verified, path-safe userId, or None if auth fails.

    This is the *only* source of a caller's identity — request bodies and query
    strings never get to assert who the user is.
    """
    return _authenticate_with_sub(event)[0]


def _query_params(event: dict) -> dict:
    """Return the request's query string parameters (same key in v1 and v2 events)."""
    return event.get("queryStringParameters") or {}


def _decode_image(image_data_url: str) -> bytes:
    """Strip a data-URI prefix (if any) and decode the base64 payload to bytes."""
    # e.g. "data:image/png;base64,iVBORw0KGgo..." -> "iVBORw0KGgo..."
    if "," in image_data_url:
        image_data_url = image_data_url.split(",", 1)[1]
    return base64.b64decode(image_data_url, validate=True)


def _read_manifest(bucket: str, key: str) -> list:
    """Read and parse the history manifest, or return [] if it doesn't exist yet."""
    client = _s3()
    try:
        resp = client.get_object(Bucket=bucket, Key=key)
        return json.loads(resp["Body"].read())
    except client.exceptions.NoSuchKey:
        return []


def handle_health(event: dict) -> dict:
    """Liveness check — handy for confirming the deploy works end to end."""
    return _response(200, {"status": "ok", "service": "sketchable-api"})


def handle_upload(event: dict) -> dict:
    """Authenticate, store a sketch in S3, and update the stream history manifest."""
    # 1. Identity comes from the verified token — never from the request body.
    user_id = _authenticate(event)
    if not user_id:
        return _response(401, {"error": "Unauthorized"})

    # 2. Payload validation — only the image is client-supplied now.
    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "Missing required fields"})

    image = payload.get("image")
    if not image:
        return _response(400, {"error": "Missing required fields"})

    # 3. The stream (pairId) is server-authoritative: a user can only write to
    # the pair they're actually bound to, not one named in the request.
    record = _get_json(BUCKET_NAME, _pairing_user_key(user_id))
    pair_id = record.get("pairId") if record else None
    if not pair_id:
        return _response(403, {"error": "Not paired"})

    # 4. Image processing.
    try:
        image_bytes = _decode_image(image)
    except (binascii.Error, ValueError):
        return _response(400, {"error": "Missing required fields"})

    timestamp = int(time.time())
    prefix = f"users/{user_id}/{pair_id}"
    image_key = f"{prefix}/{timestamp}.png"
    manifest_key = f"{prefix}/index.json"

    client = _s3()

    # Store the image. no-cache so CloudFront / clients always fetch fresh sketches.
    client.put_object(
        Bucket=BUCKET_NAME,
        Key=image_key,
        Body=image_bytes,
        ContentType="image/png",
        CacheControl="no-cache",
    )

    # 4. Manifest state management — prepend newest, cap length, write back.
    manifest = _read_manifest(BUCKET_NAME, manifest_key)
    manifest.insert(0, timestamp)
    manifest = manifest[:MAX_MANIFEST_ENTRIES]
    client.put_object(
        Bucket=BUCKET_NAME,
        Key=manifest_key,
        Body=json.dumps(manifest),
        ContentType="application/json",
        CacheControl="no-cache",
    )

    # Best-effort: nudge the partner that a fresh sketch landed. Deliberately
    # last and non-fatal — a push failure must never fail the upload itself.
    _notify_partner(record.get("partnerId"), record.get("username"))

    return _response(200, {"success": True, "timestamp": timestamp})


# ---------------------------------------------------------------------------
# Web Push — subscription storage + partner notifications
# ---------------------------------------------------------------------------
def handle_subscribe_push(event: dict) -> dict:
    """Store the caller's Web Push subscription so their partner's uploads can
    notify them.

    POST /push/subscribe   body: a PushSubscription (endpoint + keys.p256dh/auth)

    Identity comes from the token; the subscription is whatever the browser's
    `pushManager.subscribe()` returned. Overwrites any previous one (a user only
    needs the most recent device subscription).
    """
    user_id = _authenticate(event)
    if not user_id:
        return _response(401, {"error": "Unauthorized"})

    try:
        subscription = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "Invalid subscription"})

    # A usable subscription must carry an endpoint and both encryption keys.
    keys = subscription.get("keys") or {}
    if (
        not isinstance(subscription, dict)
        or not subscription.get("endpoint")
        or not keys.get("p256dh")
        or not keys.get("auth")
    ):
        return _response(400, {"error": "Invalid subscription"})

    _put_json(BUCKET_NAME, _push_key(user_id), subscription)
    return _response(200, {"success": True})


def handle_unsubscribe_push(event: dict) -> dict:
    """Forget the caller's Web Push subscription (they turned notifications off).

    DELETE /push/subscribe — idempotent; succeeds even if none was stored.
    """
    user_id = _authenticate(event)
    if not user_id:
        return _response(401, {"error": "Unauthorized"})

    _delete_object(BUCKET_NAME, _push_key(user_id))
    return _response(200, {"success": True})


def _notify_partner(partner_id: str | None, sender_name: str | None) -> None:
    """Send a best-effort Web Push to `partner_id` about a new sketch.

    Never raises: callers invoke this after a successful upload, and a push
    problem must not turn a stored sketch into a failed request. Silently no-ops
    when push isn't configured (no VAPID key) or the partner hasn't subscribed.
    A dead subscription (404/410 from the push service) is pruned so we stop
    retrying it.
    """
    if not partner_id or not VAPID_PRIVATE_KEY:
        return

    subscription = _get_json(BUCKET_NAME, _push_key(partner_id))
    if not subscription:
        return

    name = sender_name or "Your partner"
    try:
        # Imported lazily (like boto3) so the module loads — and tests run —
        # without pywebpush present; it's only needed on this send path.
        from pywebpush import WebPushException, webpush

        webpush(
            subscription_info=subscription,
            data=json.dumps(
                {"title": "New sketch \U0001f3a8", "body": f"{name} sent you a sketch"}
            ),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT or "mailto:admin@sketchable"},
        )
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (404, 410):
            # Subscription is permanently gone (unsubscribed / expired) — drop it.
            _delete_object(BUCKET_NAME, _push_key(partner_id))
        else:
            logger.warning("Web push to %s failed: %s", partner_id, exc)
    except Exception:  # noqa: BLE001 — never let a push problem fail the upload
        logger.exception("Unexpected error sending web push to %s", partner_id)


def _parse_limit(raw: str | None) -> int:
    """Clamp the caller's `limit` to [1, MAX_LIST_LIMIT], defaulting on bad input."""
    try:
        limit = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_LIST_LIMIT
    return max(1, min(limit, MAX_LIST_LIMIT))


def _sketch_entry(prefix: str, timestamp) -> dict:
    """Build a history entry: timestamp, S3 key, and (if CDN configured) a URL."""
    key = f"{prefix}/{timestamp}.png"
    return {
        "timestamp": timestamp,
        "key": key,
        "url": f"https://{CDN_DOMAIN}/{key}" if CDN_DOMAIN else None,
    }


def handle_list_sketches(event: dict) -> dict:
    """Return a stream's sketch history (newest first) from its index.json manifest.

    GET /sketches?userId=...&limit=20

    The caller may read their own stream or their partner's (and nobody else's).
    `pairId` is taken from the caller's pairing record, not the request.
    """
    caller_id = _authenticate(event)
    if not caller_id:
        return _response(401, {"error": "Unauthorized"})

    record = _get_json(BUCKET_NAME, _pairing_user_key(caller_id))
    pair_id = record.get("pairId") if record else None
    if not pair_id:
        return _response(403, {"error": "Not paired"})

    # Default to the caller's own stream; allow explicitly reading the partner's.
    params = _query_params(event)
    target_id = params.get("userId") or caller_id
    if target_id not in (caller_id, record.get("partnerId")):
        return _response(403, {"error": "Forbidden"})

    limit = _parse_limit(params.get("limit"))
    prefix = f"users/{target_id}/{pair_id}"
    manifest = _read_manifest(BUCKET_NAME, f"{prefix}/index.json")
    sketches = [_sketch_entry(prefix, ts) for ts in manifest[:limit]]

    return _response(
        200,
        {
            "userId": target_id,
            "pairId": pair_id,
            "count": len(sketches),
            "sketches": sketches,
        },
    )


# ---------------------------------------------------------------------------
# Pairing (couple linking) — S3-backed, no database
# ---------------------------------------------------------------------------
# Two users share a sketch stream once one of them redeems the other's invite
# code. Pairing state lives in S3 alongside the sketches:
#
#     {bucket}/pairing/users/{userId}.json  -> {"userId","code","pairId","partnerId"}
#     {bucket}/pairing/codes/{code}.json    -> {"userId"}   (code -> owner lookup)
#
# `pairId` is derived deterministically from both user ids (order-independent),
# so each partner references the exact same stream path no matter who redeemed.

# Human-friendly invite-code alphabet — omits 0/O/1/I/L to avoid transcription
# mistakes when a partner reads the code aloud or retypes it.
PAIR_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
PAIR_CODE_LENGTH = 6

# Usernames are display-only labels, not identifiers — users are keyed by their
# Auth0 identity, so duplicates are fine and no uniqueness check is needed. We
# only enforce that the value is plain alphanumeric and a sane length.
USERNAME_RE = re.compile(r"^[a-zA-Z0-9]+$")
MAX_USERNAME_LENGTH = 20


def _pairing_user_key(user_id: str) -> str:
    return f"pairing/users/{user_id}.json"


def _pairing_code_key(code: str) -> str:
    return f"pairing/codes/{code}.json"


def _push_key(user_id: str) -> str:
    """S3 key holding a user's Web Push subscription (one device per user).

    Stored under `pairing/` (account metadata), not `users/{id}/` (the sketch
    tree served via CloudFront), so a subscription is never delivered as if it
    were sketch content.
    """
    return f"pairing/push/{user_id}.json"


def _get_json(bucket: str, key: str):
    """Read and parse a JSON object from S3, or return None if it doesn't exist."""
    client = _s3()
    try:
        resp = client.get_object(Bucket=bucket, Key=key)
        return json.loads(resp["Body"].read())
    except client.exceptions.NoSuchKey:
        return None


def _put_json(bucket: str, key: str, body: dict) -> None:
    """Write a dict as a no-cache JSON object to S3."""
    _s3().put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(body),
        ContentType="application/json",
        CacheControl="no-cache",
    )


def _delete_object(bucket: str, key: str) -> None:
    """Delete a single object. Idempotent — S3 doesn't error on a missing key."""
    _s3().delete_object(Bucket=bucket, Key=key)


def _delete_prefix(bucket: str, prefix: str) -> int:
    """Delete every object under a prefix, paging through large listings.

    Returns the number of objects removed. Used to wipe a user's whole sketch
    tree (`users/{userId}/`) in one shot.
    """
    client = _s3()
    deleted = 0
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        resp = client.list_objects_v2(**kwargs)
        objects = [{"Key": obj["Key"]} for obj in resp.get("Contents", [])]
        if objects:
            client.delete_objects(Bucket=bucket, Delete={"Objects": objects})
            deleted += len(objects)
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")
    return deleted


def _compute_pair_id(user_a: str, user_b: str) -> str:
    """Deterministic, order-independent pair id shared by both partners."""
    low, high = sorted([user_a, user_b])
    digest = hashlib.sha256(f"{low}|{high}".encode()).hexdigest()
    return f"pair_{digest[:16]}"


def _generate_code() -> str:
    return "".join(secrets.choice(PAIR_CODE_ALPHABET) for _ in range(PAIR_CODE_LENGTH))


def _provision_user(bucket: str, user_id: str) -> dict:
    """Return a user's pairing record, creating it with a fresh unique code if new."""
    record = _get_json(bucket, _pairing_user_key(user_id))
    if record is not None:
        return record

    # Allocate a code that isn't already taken (retry on the rare collision).
    code = _generate_code()
    for _ in range(5):
        if _get_json(bucket, _pairing_code_key(code)) is None:
            break
        code = _generate_code()

    record = {
        "userId": user_id,
        "code": code,
        "pairId": None,
        "partnerId": None,
        "username": None,
    }
    _put_json(bucket, _pairing_user_key(user_id), record)
    _put_json(bucket, _pairing_code_key(code), {"userId": user_id})
    return record


def _pairing_view(record: dict) -> dict:
    """Client-facing shape of a pairing record.

    Includes the partner's display name — read from *their* record — so the app
    can label the partner's sketches by name without a second round trip.
    """
    partner_id = record.get("partnerId")
    partner_username = None
    if partner_id:
        partner = _get_json(BUCKET_NAME, _pairing_user_key(partner_id))
        if partner:
            partner_username = partner.get("username")
    return {
        "userId": record["userId"],
        "code": record["code"],
        "paired": record.get("pairId") is not None,
        "pairId": record.get("pairId"),
        "partnerId": record.get("partnerId"),
        # null until the user picks one during onboarding (older records predate it).
        "username": record.get("username"),
        # the partner's chosen name, if paired and they've set one; else null.
        "partnerUsername": partner_username,
    }


def handle_get_pairing(event: dict) -> dict:
    """Return (creating if needed) a user's pairing status and invite code.

    GET /pair

    The user is identified by their token; the frontend polls this so a user
    flips to `paired: true` the moment their partner redeems their code.
    """
    user_id = _authenticate(event)
    if not user_id:
        return _response(401, {"error": "Unauthorized"})

    record = _provision_user(BUCKET_NAME, user_id)
    return _response(200, _pairing_view(record))


def handle_set_username(event: dict) -> dict:
    """Set (or change) the signed-in user's display username.

    POST /me/username  body: {"username": ...}

    Usernames are free-form display labels — no uniqueness check, since the user
    is identified by their Auth0 token, not their name. We only require plain
    alphanumeric text within a length cap. Returns the updated pairing view.
    """
    user_id = _authenticate(event)
    if not user_id:
        return _response(401, {"error": "Unauthorized"})

    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "Missing required fields"})

    username = (payload.get("username") or "").strip()
    if not username or len(username) > MAX_USERNAME_LENGTH or not USERNAME_RE.match(username):
        return _response(
            400,
            {"error": f"Username must be 1–{MAX_USERNAME_LENGTH} letters or numbers"},
        )

    record = _provision_user(BUCKET_NAME, user_id)
    record["username"] = username
    _put_json(BUCKET_NAME, _pairing_user_key(user_id), record)
    return _response(200, _pairing_view(record))


def handle_issue_script_token(event: dict) -> dict:
    """Mint a long-lived, read-only token for the user's Scriptable widget.

    POST /me/script-token  ->  {"token": ..., "expiresAt": <unix-seconds>}

    Requires a real Auth0 login: we key off the raw `sub`, which only Auth0
    tokens carry (script tokens return None), so a leaked widget credential
    can't be used to mint fresh ones.
    """
    user_id, sub = _authenticate_with_sub(event)
    if not user_id or not sub:
        return _response(401, {"error": "Unauthorized"})
    if not SCRIPT_TOKEN_SECRET:
        return _response(503, {"error": "Script tokens are not enabled"})

    token, expires_at = _issue_script_token(user_id)
    return _response(200, {"token": token, "expiresAt": expires_at})


def handle_redeem_code(event: dict) -> dict:
    """Bind two users into a shared stream by redeeming a partner's invite code.

    POST /pair/redeem  body: {"code": ...}

    The redeemer is identified by their token. Idempotent: redeeming the code
    you're already paired through returns the existing pairing instead of erroring.
    """
    user_id = _authenticate(event)
    if not user_id:
        return _response(401, {"error": "Unauthorized"})

    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "Missing required fields"})

    code = (payload.get("code") or "").strip().upper()
    if not code:
        return _response(400, {"error": "Missing required fields"})

    owner_ref = _get_json(BUCKET_NAME, _pairing_code_key(code))
    if owner_ref is None:
        return _response(404, {"error": "Invalid code"})
    owner_id = owner_ref["userId"]

    if owner_id == user_id:
        return _response(400, {"error": "You can't pair with your own code"})

    me = _provision_user(BUCKET_NAME, user_id)
    owner = _provision_user(BUCKET_NAME, owner_id)
    pair_id = _compute_pair_id(user_id, owner_id)

    # Conflict handling: a user already bound to someone else can't re-pair.
    # Matching pair_id means this exact couple is already linked → idempotent.
    if me.get("pairId") is not None and me["pairId"] != pair_id:
        return _response(409, {"error": "You're already paired"})
    if owner.get("pairId") is not None and owner["pairId"] != pair_id:
        return _response(409, {"error": "That code is already paired"})

    # Bind both directions and persist.
    me.update({"pairId": pair_id, "partnerId": owner_id})
    owner.update({"pairId": pair_id, "partnerId": user_id})
    _put_json(BUCKET_NAME, _pairing_user_key(user_id), me)
    _put_json(BUCKET_NAME, _pairing_user_key(owner_id), owner)

    return _response(200, _pairing_view(me))


# ---------------------------------------------------------------------------
# Account deletion — wipe S3 data, unbind the partner, remove the Auth0 identity
# ---------------------------------------------------------------------------


def _auth0_mgmt_token() -> str:
    """Fetch a Management API access token via the client-credentials grant."""
    payload = json.dumps(
        {
            "grant_type": "client_credentials",
            "client_id": AUTH0_MGMT_CLIENT_ID,
            "client_secret": AUTH0_MGMT_CLIENT_SECRET,
            "audience": f"https://{AUTH0_DOMAIN}/api/v2/",
        }
    ).encode()
    req = urllib.request.Request(
        f"https://{AUTH0_DOMAIN}/oauth/token",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:  # noqa: S310 — fixed https host
        return json.loads(resp.read())["access_token"]


def _delete_auth0_user(sub: str) -> bool:
    """Best-effort deletion of the Auth0 identity for `sub`.

    Returns True on success. Returns False (without raising) if the Management
    API isn't configured or the call fails — the caller's S3 data is already
    gone by this point, so a failure here shouldn't 500 the whole request; it's
    surfaced in the response so it can be retried/cleaned up out of band.
    """
    if not (AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET):
        logger.info("Auth0 Management API not configured; skipping identity deletion")
        return False
    try:
        token = _auth0_mgmt_token()
        url = f"https://{AUTH0_DOMAIN}/api/v2/users/{urllib.parse.quote(sub, safe='')}"
        req = urllib.request.Request(
            url, method="DELETE", headers={"Authorization": f"Bearer {token}"}
        )
        urllib.request.urlopen(req, timeout=5)  # noqa: S310 — fixed https host
        return True
    except Exception:  # noqa: BLE001 — never let an Auth0 hiccup fail the request
        logger.exception("Auth0 user deletion failed for sub=%s", sub)
        return False


def handle_delete_account(event: dict) -> dict:
    """Delete the caller's account: S3 data, pairing record, invite code, and
    (best-effort) their Auth0 identity. Unbinds the partner so nobody is left
    paired with a ghost.

    DELETE /me
    """
    user_id, sub = _authenticate_with_sub(event)
    if not user_id:
        return _response(401, {"error": "Unauthorized"})

    record = _get_json(BUCKET_NAME, _pairing_user_key(user_id))

    # 1. Unbind the partner first so they aren't stuck "paired" with a deleted
    # user. Guard on the back-reference: only clear it if they still point at us.
    if record and record.get("partnerId"):
        partner_id = record["partnerId"]
        partner = _get_json(BUCKET_NAME, _pairing_user_key(partner_id))
        if partner and partner.get("partnerId") == user_id:
            partner["pairId"] = None
            partner["partnerId"] = None
            _put_json(BUCKET_NAME, _pairing_user_key(partner_id), partner)

    # 2. Wipe every sketch + manifest the user owns across all pairings.
    _delete_prefix(BUCKET_NAME, f"users/{user_id}/")

    # 3. Drop the pairing record and the invite-code lookup it owns. (The
    # partner keeps their own sketches under users/{partnerId}/ — those are
    # theirs, not ours to delete.)
    if record:
        if record.get("code"):
            _delete_object(BUCKET_NAME, _pairing_code_key(record["code"]))
        _delete_object(BUCKET_NAME, _pairing_user_key(user_id))

    # 3b. Forget any Web Push subscription (stored outside the users/ tree).
    _delete_object(BUCKET_NAME, _push_key(user_id))

    # 4. Finally remove the identity itself so re-login can't re-provision them.
    auth0_deleted = _delete_auth0_user(sub)

    return _response(200, {"deleted": True, "auth0Deleted": auth0_deleted})


# (method, path) -> handler. Paths match what API Gateway passes in the event.
ROUTES = {
    ("GET", "/health"): handle_health,
    ("POST", "/upload"): handle_upload,
    ("GET", "/sketches"): handle_list_sketches,
    ("GET", "/pair"): handle_get_pairing,
    ("POST", "/me/username"): handle_set_username,
    ("POST", "/me/script-token"): handle_issue_script_token,
    ("POST", "/pair/redeem"): handle_redeem_code,
    ("DELETE", "/me"): handle_delete_account,
    ("POST", "/push/subscribe"): handle_subscribe_push,
    ("DELETE", "/push/subscribe"): handle_unsubscribe_push,
}


def _route_key(event: dict) -> tuple[str, str]:
    """Extract (METHOD, PATH) from either HTTP API (v2) or REST (v1) events."""
    ctx = event.get("requestContext", {})
    http = ctx.get("http")
    if http:  # API Gateway HTTP API (payload format v2.0)
        return http.get("method", ""), http.get("path", "")
    # REST API / older proxy integration (payload format v1.0)
    return event.get("httpMethod", ""), event.get("path", "")


def lambda_handler(event: dict, context) -> dict:
    """Entry point. Configure this as the Lambda handler: `handler.lambda_handler`."""
    method, path = _route_key(event)
    logger.info("Request: %s %s", method, path)

    # Answer CORS preflight requests directly.
    if method == "OPTIONS":
        return _response(204, {})

    handler = ROUTES.get((method, path))
    if handler is None:
        return _response(404, {"error": f"No route for {method} {path}"})

    # Script tokens are read-only. Reject mutating routes up front so a leaked
    # widget credential can't upload, re-pair, rename, delete, or mint tokens —
    # regardless of what each handler's own auth would allow.
    token = _bearer_token(event)
    if (
        token
        and (method, path) not in SCRIPT_TOKEN_ROUTES
        and _decode_script_token(token) is not None
    ):
        return _response(403, {"error": "This token is read-only"})

    try:
        return handler(event)
    except Exception:  # noqa: BLE001 — last-resort guard so Lambda returns clean JSON
        # Logs an error + stack trace to CloudWatch for tracking.
        logger.exception("Unhandled error while processing %s %s", method, path)
        return _response(500, {"error": "Internal Server Error"})
