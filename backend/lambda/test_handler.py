"""Unit tests for the Sketchable API Lambda.

These run with no AWS access and without boto3 or PyJWT installed: a fake
in-memory S3 client is injected, and token verification is stubbed so a bearer
token is treated as the caller's `sub` directly (no real JWTs needed).
"""

import base64
import json
import unittest

import handler


class _NoSuchKey(Exception):
    """Stand-in for boto3's s3.exceptions.NoSuchKey."""


class _Exceptions:
    NoSuchKey = _NoSuchKey


class FakeS3:
    """Minimal in-memory S3 client implementing the calls the handler uses."""

    def __init__(self):
        self.store: dict[str, dict] = {}
        self.exceptions = _Exceptions()

    def put_object(self, Bucket, Key, Body, ContentType, CacheControl):
        self.store[(Bucket, Key)] = {
            "Body": Body,
            "ContentType": ContentType,
            "CacheControl": CacheControl,
        }

    def get_object(self, Bucket, Key):
        if (Bucket, Key) not in self.store:
            raise self.exceptions.NoSuchKey()
        body = self.store[(Bucket, Key)]["Body"]
        return {"Body": _Streamable(body)}

    def delete_object(self, Bucket, Key):
        self.store.pop((Bucket, Key), None)

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        # Single-page listing is enough for tests; IsTruncated stays falsy.
        contents = [
            {"Key": key}
            for (bucket, key) in self.store
            if bucket == Bucket and key.startswith(Prefix)
        ]
        return {"Contents": contents}

    def delete_objects(self, Bucket, Delete):
        for obj in Delete["Objects"]:
            self.store.pop((Bucket, obj["Key"]), None)


class _Streamable:
    def __init__(self, data):
        self._data = data if isinstance(data, (bytes, str)) else json.dumps(data)

    def read(self):
        return self._data


# A tiny valid 1x1 PNG, base64-encoded, as a data URL.
PNG_DATA_URL = (
    "data:image/png;base64,"
    + base64.b64encode(b"\x89PNG\r\n\x1a\n-fake-png-bytes").decode()
)


def _fake_verify(token):
    """Stub for handler._verify_token: token IS the sub; 'bad' fails."""
    if not token or token == "bad":
        raise ValueError("invalid token")
    return {"sub": token}


def _event(method, path, body=None, user=None, query=None):
    """Build an API Gateway v2 event. `user` becomes a Bearer token == its sub."""
    headers = {}
    if user is not None:
        headers["authorization"] = f"Bearer {user}"
    return {
        "requestContext": {"http": {"method": method, "path": path}},
        "headers": headers,
        "body": json.dumps(body) if body is not None else None,
        "queryStringParameters": query,
    }


def _seed_pairing(fake, user_id, pair_id, partner_id, code="AAA111"):
    fake.store[("test-bucket", handler._pairing_user_key(user_id))] = {
        "Body": json.dumps(
            {"userId": user_id, "code": code, "pairId": pair_id, "partnerId": partner_id}
        ),
        "ContentType": "application/json",
        "CacheControl": "no-cache",
    }


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeS3()
        handler._S3_CLIENT = self.fake
        handler.BUCKET_NAME = "test-bucket"
        handler._verify_token = _fake_verify
        # alice is paired with bob on pair_ab.
        _seed_pairing(self.fake, "alice", "pair_ab", "bob")

    def tearDown(self):
        handler._S3_CLIENT = None

    def _good_body(self):
        return {"image": PNG_DATA_URL}

    # --- happy path --------------------------------------------------------
    def test_upload_stores_image_and_creates_manifest(self):
        resp = handler.lambda_handler(
            _event("POST", "/upload", self._good_body(), user="alice"), None
        )
        self.assertEqual(resp["statusCode"], 200)
        ts = json.loads(resp["body"])["timestamp"]

        img = self.fake.store[("test-bucket", f"users/alice/pair_ab/{ts}.png")]
        self.assertEqual(img["ContentType"], "image/png")
        self.assertEqual(img["CacheControl"], "no-cache")

        manifest = json.loads(
            self.fake.store[("test-bucket", "users/alice/pair_ab/index.json")]["Body"]
        )
        self.assertEqual(manifest, [ts])

    def test_upload_prepends_to_existing_manifest(self):
        self.fake.store[("test-bucket", "users/alice/pair_ab/index.json")] = {
            "Body": json.dumps([100, 99, 98]),
            "ContentType": "application/json",
            "CacheControl": "no-cache",
        }
        resp = handler.lambda_handler(
            _event("POST", "/upload", self._good_body(), user="alice"), None
        )
        ts = json.loads(resp["body"])["timestamp"]
        manifest = json.loads(
            self.fake.store[("test-bucket", "users/alice/pair_ab/index.json")]["Body"]
        )
        self.assertEqual(manifest, [ts, 100, 99, 98])

    def test_manifest_is_capped(self):
        big = list(range(handler.MAX_MANIFEST_ENTRIES + 10))
        self.fake.store[("test-bucket", "users/alice/pair_ab/index.json")] = {
            "Body": json.dumps(big),
            "ContentType": "application/json",
            "CacheControl": "no-cache",
        }
        handler.lambda_handler(_event("POST", "/upload", self._good_body(), user="alice"), None)
        manifest = json.loads(
            self.fake.store[("test-bucket", "users/alice/pair_ab/index.json")]["Body"]
        )
        self.assertEqual(len(manifest), handler.MAX_MANIFEST_ENTRIES)

    # --- auth --------------------------------------------------------------
    def test_missing_token_is_401(self):
        resp = handler.lambda_handler(_event("POST", "/upload", self._good_body()), None)
        self.assertEqual(resp["statusCode"], 401)
        self.assertEqual(json.loads(resp["body"]), {"error": "Unauthorized"})

    def test_invalid_token_is_401(self):
        resp = handler.lambda_handler(
            _event("POST", "/upload", self._good_body(), user="bad"), None
        )
        self.assertEqual(resp["statusCode"], 401)

    def test_unpaired_user_is_403(self):
        resp = handler.lambda_handler(
            _event("POST", "/upload", self._good_body(), user="loner"), None
        )
        self.assertEqual(resp["statusCode"], 403)
        self.assertEqual(json.loads(resp["body"]), {"error": "Not paired"})

    # --- validation --------------------------------------------------------
    def test_missing_image_is_400(self):
        resp = handler.lambda_handler(_event("POST", "/upload", {}, user="alice"), None)
        self.assertEqual(resp["statusCode"], 400)
        self.assertEqual(json.loads(resp["body"]), {"error": "Missing required fields"})

    def test_bad_json_is_400(self):
        ev = _event("POST", "/upload", user="alice")
        ev["body"] = "{not json"
        resp = handler.lambda_handler(ev, None)
        self.assertEqual(resp["statusCode"], 400)

    def test_invalid_base64_is_400(self):
        body = {"image": "data:image/png;base64,!!!notbase64!!!"}
        resp = handler.lambda_handler(_event("POST", "/upload", body, user="alice"), None)
        self.assertEqual(resp["statusCode"], 400)

    # --- routing & errors --------------------------------------------------
    def test_health(self):
        resp = handler.lambda_handler(_event("GET", "/health"), None)
        self.assertEqual(resp["statusCode"], 200)
        self.assertEqual(json.loads(resp["body"])["status"], "ok")

    def test_unknown_route_is_404(self):
        resp = handler.lambda_handler(_event("GET", "/nope"), None)
        self.assertEqual(resp["statusCode"], 404)

    def test_options_preflight(self):
        resp = handler.lambda_handler(_event("OPTIONS", "/upload"), None)
        self.assertEqual(resp["statusCode"], 204)

    def test_s3_failure_is_500(self):
        def boom(**kwargs):
            raise RuntimeError("S3 is down")

        self.fake.put_object = boom
        resp = handler.lambda_handler(
            _event("POST", "/upload", self._good_body(), user="alice"), None
        )
        self.assertEqual(resp["statusCode"], 500)
        self.assertEqual(json.loads(resp["body"]), {"error": "Internal Server Error"})


class ListSketchesTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeS3()
        handler._S3_CLIENT = self.fake
        handler.BUCKET_NAME = "test-bucket"
        handler.CDN_DOMAIN = "cdn.example.net"
        handler._verify_token = _fake_verify
        _seed_pairing(self.fake, "alice", "pair_ab", "bob")

    def tearDown(self):
        handler._S3_CLIENT = None
        handler.CDN_DOMAIN = ""

    def _seed_manifest(self, user_id, timestamps):
        self.fake.store[("test-bucket", f"users/{user_id}/pair_ab/index.json")] = {
            "Body": json.dumps(timestamps),
            "ContentType": "application/json",
            "CacheControl": "no-cache",
        }

    def _query(self, user="alice", **kw):
        return handler.lambda_handler(_event("GET", "/sketches", user=user, query=kw), None)

    def test_own_stream_newest_first_with_urls(self):
        self._seed_manifest("alice", [300, 200, 100])
        resp = self._query()  # no userId → own stream
        self.assertEqual(resp["statusCode"], 200)
        body = json.loads(resp["body"])
        self.assertEqual(body["userId"], "alice")
        self.assertEqual([s["timestamp"] for s in body["sketches"]], [300, 200, 100])
        self.assertEqual(
            body["sketches"][0]["url"], "https://cdn.example.net/users/alice/pair_ab/300.png"
        )

    def test_can_read_partner_stream(self):
        self._seed_manifest("bob", [42])
        body = json.loads(self._query(userId="bob")["body"])
        self.assertEqual(body["userId"], "bob")
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["sketches"][0]["key"], "users/bob/pair_ab/42.png")

    def test_reading_a_stranger_is_403(self):
        resp = self._query(userId="carol")
        self.assertEqual(resp["statusCode"], 403)
        self.assertEqual(json.loads(resp["body"]), {"error": "Forbidden"})

    def test_unpaired_caller_is_403(self):
        resp = self._query(user="loner")
        self.assertEqual(resp["statusCode"], 403)
        self.assertEqual(json.loads(resp["body"]), {"error": "Not paired"})

    def test_empty_when_no_manifest(self):
        body = json.loads(self._query()["body"])
        self.assertEqual(body["count"], 0)
        self.assertEqual(body["sketches"], [])

    def test_limit_is_applied_and_clamped(self):
        self._seed_manifest("alice", list(range(100, 0, -1)))
        self.assertEqual(json.loads(self._query(limit="5")["body"])["count"], 5)
        self.assertEqual(
            json.loads(self._query(limit="999")["body"])["count"], handler.MAX_LIST_LIMIT
        )
        self.assertEqual(
            json.loads(self._query(limit="abc")["body"])["count"], handler.DEFAULT_LIST_LIMIT
        )

    def test_url_is_none_without_cdn(self):
        handler.CDN_DOMAIN = ""
        self._seed_manifest("alice", [300])
        body = json.loads(self._query()["body"])
        self.assertIsNone(body["sketches"][0]["url"])
        self.assertEqual(body["sketches"][0]["key"], "users/alice/pair_ab/300.png")

    def test_missing_token_is_401(self):
        resp = handler.lambda_handler(_event("GET", "/sketches"), None)
        self.assertEqual(resp["statusCode"], 401)


class PairingTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeS3()
        handler._S3_CLIENT = self.fake
        handler.BUCKET_NAME = "test-bucket"
        handler._verify_token = _fake_verify

    def tearDown(self):
        handler._S3_CLIENT = None

    def _get_pair(self, user):
        return handler.lambda_handler(_event("GET", "/pair", user=user), None)

    def _redeem(self, user, code):
        return handler.lambda_handler(
            _event("POST", "/pair/redeem", body={"code": code}, user=user), None
        )

    # --- provisioning / status --------------------------------------------
    def test_get_pair_provisions_code_and_is_unpaired(self):
        resp = self._get_pair("alice")
        self.assertEqual(resp["statusCode"], 200)
        body = json.loads(resp["body"])
        self.assertEqual(body["userId"], "alice")
        self.assertFalse(body["paired"])
        self.assertEqual(len(body["code"]), handler.PAIR_CODE_LENGTH)
        owner = handler._get_json("test-bucket", handler._pairing_code_key(body["code"]))
        self.assertEqual(owner, {"userId": "alice"})

    def test_get_pair_is_stable_across_calls(self):
        first = json.loads(self._get_pair("alice")["body"])["code"]
        second = json.loads(self._get_pair("alice")["body"])["code"]
        self.assertEqual(first, second)

    def test_get_pair_requires_auth(self):
        self.assertEqual(handler.lambda_handler(_event("GET", "/pair"), None)["statusCode"], 401)

    # --- redeem: happy path ------------------------------------------------
    def test_redeem_binds_both_users_to_same_pair(self):
        alice_code = json.loads(self._get_pair("alice")["body"])["code"]

        resp = self._redeem("bob", alice_code)
        self.assertEqual(resp["statusCode"], 200)
        bob = json.loads(resp["body"])
        self.assertTrue(bob["paired"])
        self.assertEqual(bob["partnerId"], "alice")

        alice = json.loads(self._get_pair("alice")["body"])
        self.assertTrue(alice["paired"])
        self.assertEqual(alice["partnerId"], "bob")
        self.assertEqual(alice["pairId"], bob["pairId"])

    def test_redeem_is_case_insensitive(self):
        alice_code = json.loads(self._get_pair("alice")["body"])["code"]
        self.assertEqual(self._redeem("bob", alice_code.lower())["statusCode"], 200)

    def test_redeem_is_idempotent_for_same_couple(self):
        alice_code = json.loads(self._get_pair("alice")["body"])["code"]
        self._redeem("bob", alice_code)
        resp = self._redeem("bob", alice_code)
        self.assertEqual(resp["statusCode"], 200)
        self.assertTrue(json.loads(resp["body"])["paired"])

    # --- redeem: errors ----------------------------------------------------
    def test_redeem_own_code_is_400(self):
        alice_code = json.loads(self._get_pair("alice")["body"])["code"]
        self.assertEqual(self._redeem("alice", alice_code)["statusCode"], 400)

    def test_redeem_invalid_code_is_404(self):
        resp = self._redeem("bob", "ZZZZZZ")
        self.assertEqual(resp["statusCode"], 404)
        self.assertEqual(json.loads(resp["body"]), {"error": "Invalid code"})

    def test_redeem_when_already_paired_elsewhere_is_409(self):
        alice_code = json.loads(self._get_pair("alice")["body"])["code"]
        carol_code = json.loads(self._get_pair("carol")["body"])["code"]
        self._redeem("bob", alice_code)
        self.assertEqual(self._redeem("bob", carol_code)["statusCode"], 409)

    def test_redeem_requires_auth(self):
        ev = _event("POST", "/pair/redeem", body={"code": "ABCDEF"})
        self.assertEqual(handler.lambda_handler(ev, None)["statusCode"], 401)

    def test_redeem_missing_code_is_400(self):
        ev = _event("POST", "/pair/redeem", body={}, user="bob")
        self.assertEqual(handler.lambda_handler(ev, None)["statusCode"], 400)

    # --- username ----------------------------------------------------------
    def test_new_user_has_null_username(self):
        body = json.loads(self._get_pair("alice")["body"])
        self.assertIsNone(body["username"])

    def _set_username(self, user, username):
        return handler.lambda_handler(
            _event("POST", "/me/username", body={"username": username}, user=user), None
        )

    def test_set_username_persists_and_is_returned(self):
        resp = self._set_username("alice", "Alice99")
        self.assertEqual(resp["statusCode"], 200)
        self.assertEqual(json.loads(resp["body"])["username"], "Alice99")
        # And it survives a fresh read of the pairing record.
        self.assertEqual(json.loads(self._get_pair("alice")["body"])["username"], "Alice99")

    def test_set_username_can_be_changed(self):
        self._set_username("alice", "First")
        self._set_username("alice", "Second")
        self.assertEqual(json.loads(self._get_pair("alice")["body"])["username"], "Second")

    def test_set_username_preserves_code(self):
        code = json.loads(self._get_pair("alice")["body"])["code"]
        self._set_username("alice", "Alice")
        self.assertEqual(json.loads(self._get_pair("alice")["body"])["code"], code)

    def test_set_username_rejects_non_alphanumeric(self):
        for bad in ("has space", "no-dash", "emoji😀", "semi;colon"):
            self.assertEqual(self._set_username("alice", bad)["statusCode"], 400)

    def test_set_username_rejects_empty(self):
        self.assertEqual(self._set_username("alice", "")["statusCode"], 400)
        self.assertEqual(self._set_username("alice", "   ")["statusCode"], 400)

    def test_set_username_rejects_too_long(self):
        too_long = "a" * (handler.MAX_USERNAME_LENGTH + 1)
        self.assertEqual(self._set_username("alice", too_long)["statusCode"], 400)

    def test_set_username_requires_auth(self):
        ev = _event("POST", "/me/username", body={"username": "Alice"})
        self.assertEqual(handler.lambda_handler(ev, None)["statusCode"], 401)

    # --- partner username (exposed on the pairing view) --------------------
    def test_pairing_view_includes_partner_username(self):
        self._set_username("alice", "Alice99")
        alice_code = json.loads(self._get_pair("alice")["body"])["code"]
        self._redeem("bob", alice_code)
        self._set_username("bob", "Bobby")

        bob = json.loads(self._get_pair("bob")["body"])
        self.assertEqual(bob["partnerUsername"], "Alice99")
        alice = json.loads(self._get_pair("alice")["body"])
        self.assertEqual(alice["partnerUsername"], "Bobby")

    def test_partner_username_null_when_unpaired(self):
        self._set_username("alice", "Alice99")
        self.assertIsNone(json.loads(self._get_pair("alice")["body"])["partnerUsername"])


class ScriptTokenTests(unittest.TestCase):
    """Issuing + using the long-lived, read-only Scriptable widget tokens.

    PyJWT isn't installed for the test run, so we stub the two helpers that touch
    it (`_issue_script_token`, `_decode_script_token`) with simple fakes: a script
    token is the literal string "script:<userId>".
    """

    def setUp(self):
        self.fake = FakeS3()
        handler._S3_CLIENT = self.fake
        handler.BUCKET_NAME = "test-bucket"
        handler.SCRIPT_TOKEN_SECRET = "test-secret"  # enables the feature
        handler._verify_token = _fake_verify
        # alice <-> bob, paired, so read endpoints have something to resolve.
        _seed_pairing(self.fake, "alice", "pair_ab", "bob")

        # Fake mint/decode: "script:<uid>" is a valid script token for <uid>.
        handler._issue_script_token = lambda user_id: (f"script:{user_id}", 9999999999)
        handler._decode_script_token = (
            lambda token: {"uid": token[len("script:") :], "type": "script"}
            if isinstance(token, str) and token.startswith("script:")
            else None
        )

    def tearDown(self):
        handler._S3_CLIENT = None
        handler.SCRIPT_TOKEN_SECRET = ""

    # --- issuing -----------------------------------------------------------
    def test_issue_returns_token_for_authed_user(self):
        resp = handler.lambda_handler(_event("POST", "/me/script-token", user="alice"), None)
        self.assertEqual(resp["statusCode"], 200)
        body = json.loads(resp["body"])
        self.assertEqual(body["token"], "script:alice")
        self.assertEqual(body["expiresAt"], 9999999999)

    def test_issue_requires_auth(self):
        resp = handler.lambda_handler(_event("POST", "/me/script-token"), None)
        self.assertEqual(resp["statusCode"], 401)

    def test_issue_disabled_without_secret(self):
        handler.SCRIPT_TOKEN_SECRET = ""
        resp = handler.lambda_handler(_event("POST", "/me/script-token", user="alice"), None)
        self.assertEqual(resp["statusCode"], 503)

    def test_script_token_cannot_mint_another(self):
        # A script token has no Auth0 sub, so it can't reach the minting handler.
        ev = _event("POST", "/me/script-token")
        ev["headers"]["authorization"] = "Bearer script:alice"
        resp = handler.lambda_handler(ev, None)
        self.assertEqual(resp["statusCode"], 403)  # blocked as read-only first

    # --- using a script token ----------------------------------------------
    def _with_script_token(self, method, path, uid="alice", query=None, body=None):
        ev = _event(method, path, body=body, query=query)
        ev["headers"]["authorization"] = f"Bearer script:{uid}"
        return handler.lambda_handler(ev, None)

    def test_script_token_can_read_pairing(self):
        resp = self._with_script_token("GET", "/pair")
        self.assertEqual(resp["statusCode"], 200)
        self.assertEqual(json.loads(resp["body"])["userId"], "alice")

    def test_script_token_can_read_partner_sketches(self):
        self.fake.store[("test-bucket", "users/bob/pair_ab/index.json")] = {
            "Body": json.dumps([7]),
            "ContentType": "application/json",
            "CacheControl": "no-cache",
        }
        resp = self._with_script_token("GET", "/sketches", query={"userId": "bob"})
        self.assertEqual(resp["statusCode"], 200)
        self.assertEqual(json.loads(resp["body"])["sketches"][0]["timestamp"], 7)

    def test_script_token_cannot_upload(self):
        resp = self._with_script_token(
            "POST", "/upload", body={"image": PNG_DATA_URL}
        )
        self.assertEqual(resp["statusCode"], 403)
        self.assertEqual(json.loads(resp["body"]), {"error": "This token is read-only"})

    def test_script_token_cannot_delete_account(self):
        resp = self._with_script_token("DELETE", "/me")
        self.assertEqual(resp["statusCode"], 403)
        self.assertEqual(json.loads(resp["body"]), {"error": "This token is read-only"})

    def test_script_token_cannot_redeem(self):
        resp = self._with_script_token("POST", "/pair/redeem", body={"code": "ABCDEF"})
        self.assertEqual(resp["statusCode"], 403)


class DeleteAccountTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeS3()
        handler._S3_CLIENT = self.fake
        handler.BUCKET_NAME = "test-bucket"
        handler._verify_token = _fake_verify
        # alice <-> bob, paired on pair_ab.
        _seed_pairing(self.fake, "alice", "pair_ab", "bob", code="ALICE1")
        _seed_pairing(self.fake, "bob", "pair_ab", "alice", code="BOB222")
        # alice's invite-code lookup + a couple of her sketches.
        self.fake.store[("test-bucket", handler._pairing_code_key("ALICE1"))] = {
            "Body": json.dumps({"userId": "alice"}),
            "ContentType": "application/json",
            "CacheControl": "no-cache",
        }
        for ts in (100, 200):
            self.fake.store[("test-bucket", f"users/alice/pair_ab/{ts}.png")] = {
                "Body": b"png",
                "ContentType": "image/png",
                "CacheControl": "no-cache",
            }
        self.fake.store[("test-bucket", "users/alice/pair_ab/index.json")] = {
            "Body": json.dumps([200, 100]),
            "ContentType": "application/json",
            "CacheControl": "no-cache",
        }
        # Auth0 deletion is exercised separately; default to a no-op here.
        handler._delete_auth0_user = lambda sub: False

    def tearDown(self):
        handler._S3_CLIENT = None

    def _delete(self, user="alice"):
        return handler.lambda_handler(_event("DELETE", "/me", user=user), None)

    def test_delete_wipes_sketches_record_and_code(self):
        resp = self._delete()
        self.assertEqual(resp["statusCode"], 200)
        self.assertTrue(json.loads(resp["body"])["deleted"])

        remaining = [k for (b, k) in self.fake.store if k.startswith("users/alice/")]
        self.assertEqual(remaining, [])
        self.assertNotIn(
            ("test-bucket", handler._pairing_user_key("alice")), self.fake.store
        )
        self.assertNotIn(
            ("test-bucket", handler._pairing_code_key("ALICE1")), self.fake.store
        )

    def test_delete_unbinds_the_partner(self):
        self._delete()
        bob = handler._get_json("test-bucket", handler._pairing_user_key("bob"))
        self.assertIsNotNone(bob)  # bob's record survives...
        self.assertIsNone(bob["pairId"])  # ...but no longer points at a ghost
        self.assertIsNone(bob["partnerId"])

    def test_delete_keeps_partner_own_sketches(self):
        self.fake.store[("test-bucket", "users/bob/pair_ab/55.png")] = {
            "Body": b"png",
            "ContentType": "image/png",
            "CacheControl": "no-cache",
        }
        self._delete()
        self.assertIn(("test-bucket", "users/bob/pair_ab/55.png"), self.fake.store)

    def test_delete_unpaired_user_succeeds(self):
        resp = self._delete(user="loner")
        self.assertEqual(resp["statusCode"], 200)
        self.assertTrue(json.loads(resp["body"])["deleted"])

    def test_delete_reports_auth0_result(self):
        handler._delete_auth0_user = lambda sub: True
        body = json.loads(self._delete()["body"])
        self.assertTrue(body["auth0Deleted"])

    def test_delete_uses_raw_sub_for_auth0(self):
        captured = {}
        handler._delete_auth0_user = lambda sub: captured.setdefault("sub", sub) or True
        # The token's sub has a "|" that the path-safe userId replaces with "_".
        handler.lambda_handler(_event("DELETE", "/me", user="google-oauth2|9"), None)
        self.assertEqual(captured["sub"], "google-oauth2|9")

    def test_delete_requires_auth(self):
        self.assertEqual(handler.lambda_handler(_event("DELETE", "/me"), None)["statusCode"], 401)


class PushTests(unittest.TestCase):
    """Web Push subscribe/unsubscribe + the best-effort notify-on-upload hook."""

    def setUp(self):
        self.fake = FakeS3()
        handler._S3_CLIENT = self.fake
        handler.BUCKET_NAME = "test-bucket"
        handler._verify_token = _fake_verify
        # Script tokens disabled → _decode_script_token short-circuits to None
        # without importing PyJWT (absent in the test environment).
        handler.SCRIPT_TOKEN_SECRET = ""
        # No VAPID key configured by default → notify is a no-op (and never tries
        # to import pywebpush, which isn't installed in the test environment).
        handler.VAPID_PRIVATE_KEY = ""
        # alice ↔ bob, with alice carrying a display name for the push body.
        _seed_pairing(self.fake, "alice", "pair_ab", "bob")
        self.fake.store[("test-bucket", handler._pairing_user_key("alice"))]["Body"] = (
            json.dumps(
                {
                    "userId": "alice",
                    "code": "AAA111",
                    "pairId": "pair_ab",
                    "partnerId": "bob",
                    "username": "Alice",
                }
            )
        )

    def tearDown(self):
        handler._S3_CLIENT = None
        handler.VAPID_PRIVATE_KEY = ""

    _VALID_SUB = {
        "endpoint": "https://push.example.com/abc",
        "keys": {"p256dh": "BPubKey", "auth": "AuthSecret"},
    }

    def _subscribe(self, body, user="bob"):
        return handler.lambda_handler(
            _event("POST", "/push/subscribe", body=body, user=user), None
        )

    # --- subscribe ---------------------------------------------------------
    def test_subscribe_stores_subscription(self):
        resp = self._subscribe(self._VALID_SUB)
        self.assertEqual(resp["statusCode"], 200)
        self.assertTrue(json.loads(resp["body"])["success"])
        stored = json.loads(
            self.fake.store[("test-bucket", handler._push_key("bob"))]["Body"]
        )
        self.assertEqual(stored, self._VALID_SUB)

    def test_subscribe_requires_auth(self):
        resp = handler.lambda_handler(
            _event("POST", "/push/subscribe", body=self._VALID_SUB), None
        )
        self.assertEqual(resp["statusCode"], 401)

    def test_subscribe_rejects_missing_endpoint(self):
        resp = self._subscribe({"keys": {"p256dh": "x", "auth": "y"}})
        self.assertEqual(resp["statusCode"], 400)

    def test_subscribe_rejects_missing_keys(self):
        resp = self._subscribe({"endpoint": "https://push.example.com/abc"})
        self.assertEqual(resp["statusCode"], 400)

    def test_subscribe_overwrites_previous(self):
        self._subscribe(self._VALID_SUB)
        newer = {
            "endpoint": "https://push.example.com/xyz",
            "keys": {"p256dh": "P2", "auth": "A2"},
        }
        self._subscribe(newer)
        stored = json.loads(
            self.fake.store[("test-bucket", handler._push_key("bob"))]["Body"]
        )
        self.assertEqual(stored, newer)

    def test_script_token_cannot_subscribe(self):
        # /push/subscribe isn't in SCRIPT_TOKEN_ROUTES, so a read-only widget
        # token must be rejected before reaching the handler.
        handler.SCRIPT_TOKEN_SECRET = "test-secret"
        handler._decode_script_token = (
            lambda tok: {"uid": "bob", "type": "script"} if tok == "scripttoken" else None
        )
        resp = handler.lambda_handler(
            {
                "requestContext": {"http": {"method": "POST", "path": "/push/subscribe"}},
                "headers": {"authorization": "Bearer scripttoken"},
                "body": json.dumps(self._VALID_SUB),
                "queryStringParameters": None,
            },
            None,
        )
        self.assertEqual(resp["statusCode"], 403)

    # --- unsubscribe -------------------------------------------------------
    def test_unsubscribe_removes_subscription(self):
        self._subscribe(self._VALID_SUB)
        resp = handler.lambda_handler(
            _event("DELETE", "/push/subscribe", user="bob"), None
        )
        self.assertEqual(resp["statusCode"], 200)
        self.assertNotIn(("test-bucket", handler._push_key("bob")), self.fake.store)

    def test_unsubscribe_is_idempotent(self):
        resp = handler.lambda_handler(
            _event("DELETE", "/push/subscribe", user="bob"), None
        )
        self.assertEqual(resp["statusCode"], 200)

    # --- notify-on-upload --------------------------------------------------
    def test_upload_still_succeeds_without_vapid_or_subscription(self):
        # The whole point of best-effort: an upload works even though push is
        # unconfigured and the partner has no subscription stored.
        resp = handler.lambda_handler(
            _event("POST", "/upload", {"image": PNG_DATA_URL}, user="alice"), None
        )
        self.assertEqual(resp["statusCode"], 200)

    def test_upload_notifies_partner_when_configured(self):
        handler.VAPID_PRIVATE_KEY = "test-private-key"
        self.fake.store[("test-bucket", handler._push_key("bob"))] = {
            "Body": json.dumps(self._VALID_SUB),
            "ContentType": "application/json",
            "CacheControl": "no-cache",
        }
        sent = {}

        def fake_webpush(**kwargs):
            sent.update(kwargs)

        # Inject a fake pywebpush module so the lazy import inside
        # _notify_partner resolves without the real dependency.
        import sys
        import types

        module = types.ModuleType("pywebpush")
        module.webpush = fake_webpush
        module.WebPushException = type("WebPushException", (Exception,), {})
        sys.modules["pywebpush"] = module
        try:
            resp = handler.lambda_handler(
                _event("POST", "/upload", {"image": PNG_DATA_URL}, user="alice"), None
            )
        finally:
            del sys.modules["pywebpush"]

        self.assertEqual(resp["statusCode"], 200)
        self.assertEqual(sent["subscription_info"], self._VALID_SUB)
        self.assertEqual(sent["vapid_private_key"], "test-private-key")
        payload = json.loads(sent["data"])
        self.assertIn("Alice", payload["body"])

    def test_dead_subscription_is_pruned(self):
        handler.VAPID_PRIVATE_KEY = "test-private-key"
        self.fake.store[("test-bucket", handler._push_key("bob"))] = {
            "Body": json.dumps(self._VALID_SUB),
            "ContentType": "application/json",
            "CacheControl": "no-cache",
        }

        import sys
        import types

        module = types.ModuleType("pywebpush")
        exc_type = type("WebPushException", (Exception,), {})

        class _Resp:
            status_code = 410

        def fake_webpush(**kwargs):
            err = exc_type("gone")
            err.response = _Resp()
            raise err

        module.webpush = fake_webpush
        module.WebPushException = exc_type
        sys.modules["pywebpush"] = module
        try:
            resp = handler.lambda_handler(
                _event("POST", "/upload", {"image": PNG_DATA_URL}, user="alice"), None
            )
        finally:
            del sys.modules["pywebpush"]

        # Upload still succeeds, and the dead subscription is dropped.
        self.assertEqual(resp["statusCode"], 200)
        self.assertNotIn(("test-bucket", handler._push_key("bob")), self.fake.store)

    def test_delete_account_removes_push_subscription(self):
        self.fake.store[("test-bucket", handler._push_key("alice"))] = {
            "Body": json.dumps(self._VALID_SUB),
            "ContentType": "application/json",
            "CacheControl": "no-cache",
        }
        handler._delete_auth0_user = lambda sub: True
        handler.lambda_handler(_event("DELETE", "/me", user="alice"), None)
        self.assertNotIn(("test-bucket", handler._push_key("alice")), self.fake.store)


if __name__ == "__main__":
    unittest.main()
