// Thin client for the Sketchable HTTP API. Every protected call carries the
// user's Auth0 access token as `Authorization: Bearer <jwt>`. The backend
// verifies it and derives the userId from the token — the client never asserts
// its own identity, so userId/pairId are no longer sent for writes.
import { config } from "./config";

export interface Pairing {
    userId: string;
    /** The user's own 6-char invite code to share with a partner. */
    code: string;
    paired: boolean;
    /** Shared stream id once paired; null while unpaired. */
    pairId: string | null;
    /** The partner's userId once paired; null while unpaired. */
    partnerId: string | null;
    /** Chosen display name; null until the user sets one during onboarding. */
    username: string | null;
    /** The partner's display name; null while unpaired or if they haven't set one. */
    partnerUsername: string | null;
}

export interface SketchEntry {
    timestamp: number;
    key: string;
    url: string | null;
}

/** Raised for any non-2xx API response, carrying the parsed server message. */
export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

// The app registers a token provider (Auth0's getAccessTokenSilently) once the
// user is authenticated; see App.tsx. Kept module-level so the API functions
// stay call-site simple instead of threading a token through every caller.
let tokenProvider: (() => Promise<string>) | null = null;

export function setTokenProvider(fn: () => Promise<string>): void {
    tokenProvider = fn;
}

async function authHeader(): Promise<string> {
    if (!tokenProvider) {
        throw new ApiError(401, "Not signed in.");
    }
    try {
        return `Bearer ${await tokenProvider()}`;
    } catch {
        throw new ApiError(401, "Your session expired. Please sign in again.");
    }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!config.apiBaseUrl) {
        throw new ApiError(0, "API base URL is not configured (set VITE_API_BASE_URL).");
    }

    const authorization = await authHeader();

    let resp: Response;
    try {
        resp = await fetch(`${config.apiBaseUrl}${path}`, {
            ...init,
            headers: {
                "Content-Type": "application/json",
                authorization,
                ...init.headers,
            },
        });
    } catch {
        throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.");
    }

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        const message =
            (data as { error?: string }).error ?? `Request failed (${resp.status}).`;
        throw new ApiError(resp.status, message);
    }
    return data as T;
}

/** Fetch (lazily creating) the signed-in user's invite code and pairing status. */
export function getPairing(): Promise<Pairing> {
    return request<Pairing>("/pair");
}

/**
 * Set (or change) the signed-in user's display username. Must be alphanumeric;
 * there's no uniqueness check since users are keyed by their Auth0 identity.
 * Returns the refreshed pairing record (now carrying the username).
 */
export function setUsername(username: string): Promise<Pairing> {
    return request<Pairing>("/me/username", {
        method: "POST",
        body: JSON.stringify({ username }),
    });
}

/**
 * Mint a long-lived, read-only token for the user's Scriptable widget. The app
 * bakes this into the generated widget script (see lib/scriptableScript.ts) so
 * it can poll the API without an interactive login. `expiresAt` is unix seconds.
 */
export function issueScriptToken(): Promise<{ token: string; expiresAt: number }> {
    return request("/me/script-token", { method: "POST" });
}

/** Redeem a partner's code, binding both users into a shared stream. */
export function redeemCode(code: string): Promise<Pairing> {
    return request<Pairing>("/pair/redeem", {
        method: "POST",
        body: JSON.stringify({ code }),
    });
}

/**
 * Permanently delete the signed-in user's account: all their sketches, their
 * pairing record (which also unbinds their partner), and their Auth0 identity.
 * `auth0Deleted` is false if the backend isn't configured to remove the Auth0
 * user — the local data is gone regardless. Sign the user out after this.
 */
export function deleteAccount(): Promise<{ deleted: boolean; auth0Deleted: boolean }> {
    return request("/me", { method: "DELETE" });
}

/**
 * Register a Web Push subscription so the user gets notified when their partner
 * sends a sketch. `subscription` is the object from `PushSubscription.toJSON()`
 * (endpoint + keys). Overwrites any previous subscription for this user.
 */
export function subscribePush(subscription: unknown): Promise<{ success: boolean }> {
    return request("/push/subscribe", {
        method: "POST",
        body: JSON.stringify(subscription),
    });
}

/** Remove the user's Web Push subscription (they turned notifications off). */
export function unsubscribePush(): Promise<{ success: boolean }> {
    return request("/push/subscribe", { method: "DELETE" });
}

/** Upload a sketch (PNG data URL). The stream is derived from the token server-side. */
export function uploadSketch(
    image: string,
): Promise<{ success: boolean; timestamp: number }> {
    return request("/upload", {
        method: "POST",
        body: JSON.stringify({ image }),
    });
}

/**
 * List a stream's sketch history (newest first). Omit `targetUserId` for your
 * own stream, or pass your partner's userId to read theirs.
 */
export function listSketches(
    targetUserId?: string,
    limit = 20,
): Promise<{ userId: string; pairId: string; count: number; sketches: SketchEntry[] }> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (targetUserId) params.set("userId", targetUserId);
    return request(`/sketches?${params.toString()}`);
}
