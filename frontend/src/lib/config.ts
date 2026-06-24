// Runtime configuration, sourced from Vite env vars (see `.env.example`).
// Vite only exposes vars prefixed with `VITE_`, and inlines them at build time.

export const config = {
    auth0Domain: import.meta.env.VITE_AUTH0_DOMAIN ?? "",
    auth0ClientId: import.meta.env.VITE_AUTH0_CLIENT_ID ?? "",
    /**
     * Auth0 API identifier (audience). REQUIRED: without it Auth0 issues an
     * opaque access token instead of a JWT, and the Lambda can't verify it.
     */
    auth0Audience: import.meta.env.VITE_AUTH0_AUDIENCE ?? "",
    /** Base URL of the deployed HTTP API, e.g. https://abc123.execute-api.us-east-2.amazonaws.com */
    apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, ""),
    /** Optional explicit Auth0 redirect URI. Defaults to the current origin. */
    auth0RedirectUri: (import.meta.env.VITE_AUTH0_REDIRECT_URI ?? "").replace(
        /\/$/,
        "",
    ),
    /**
     * VAPID public key (base64url) used to subscribe to Web Push. Must match the
     * private key the backend signs with (VapidPrivateKey). When empty, the app
     * hides the notifications UI — push is simply unavailable.
     */
    vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "",
};

/** True only when the Auth0 fields needed to start a login are present. */
export const isAuth0Configured = Boolean(
    config.auth0Domain && config.auth0ClientId,
);
