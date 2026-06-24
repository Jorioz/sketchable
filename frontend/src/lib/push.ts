// Web Push (W3C Push API) client helpers: feature detection, service-worker
// registration, and subscribe/unsubscribe that keep the browser and backend in
// sync. The React-facing state lives in `hooks/useWebPush.ts`; this module is
// the imperative plumbing.
//
// iOS note: push only works when the app is installed to the Home Screen
// (running standalone) on iOS 16.4+. `Notification.requestPermission()` doesn't
// even exist in a regular iOS Safari tab — hence the gating below.
import { subscribePush, unsubscribePush } from "./api";
import { config } from "./config";

/** True when running as an installed PWA (Home Screen / standalone) rather than a tab. */
export function isStandalone(): boolean {
    return (
        window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari exposes this non-standard flag on navigator.
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
}

/**
 * Whether this browser can do Web Push at all: service workers, the Push API,
 * the Notification API, and a configured VAPID key must all be present. On iOS
 * the Push API is only exposed once installed to the Home Screen, so this also
 * returns false in a plain Safari tab there.
 */
export function isPushSupported(): boolean {
    return (
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window &&
        Boolean(config.vapidPublicKey)
    );
}

/** Current notification permission, or "default" when the API is unavailable. */
export function getPermission(): NotificationPermission {
    return "Notification" in window ? Notification.permission : "default";
}

// VAPID public keys are base64url; the Push API wants a Uint8Array. Allocate
// over an explicit ArrayBuffer so the type is BufferSource-compatible.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(normalized);
    const output = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
}

/** Register (idempotently) the service worker and resolve once it's ready. */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
    await navigator.serviceWorker.register("/sw.js");
    return navigator.serviceWorker.ready;
}

/** The active push subscription for this browser, if one exists. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
    if (!isPushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Full subscribe flow: register the SW, request permission (must be called from
 * a user gesture on iOS), create a push subscription, and hand it to the
 * backend. Returns the subscription on success.
 *
 * Throws `Error("denied")` if the user blocks notifications, or a generic error
 * if anything else fails — callers surface these to the user.
 */
export async function enablePush(): Promise<PushSubscription> {
    if (!isPushSupported()) {
        throw new Error("Push notifications aren't supported here.");
    }

    const registration = await ensureServiceWorker();

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
        throw new Error("denied");
    }

    // Reuse an existing subscription if present; otherwise create one bound to
    // our VAPID key. `userVisibleOnly` is mandatory for Web Push.
    const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
        }));

    await subscribePush(subscription.toJSON());
    return subscription;
}

/**
 * Turn notifications off: tell the backend to forget us, then drop the local
 * subscription. Backend-first so a network failure leaves us still subscribed
 * everywhere (consistent) rather than orphaning a server record.
 */
export async function disablePush(): Promise<void> {
    await unsubscribePush();
    const subscription = await getExistingSubscription();
    await subscription?.unsubscribe();
}
