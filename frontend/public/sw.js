/*
 * Sketchable service worker.
 *
 * Its only job is Web Push: receive a push from the backend (sent when the
 * user's partner uploads a sketch) and surface it as a notification, even when
 * the PWA is closed. On iOS this file MUST be served from the site root and the
 * app must be installed to the Home Screen for push to work at all.
 *
 * Deliberately no `fetch` handler / precaching — the app is served normally by
 * Vite/CloudFront and we don't want a stale cache layer here.
 */

// Take control immediately on install/activate so a freshly-registered worker
// can receive pushes without waiting for all tabs to close.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
    event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
    // The backend sends a JSON body { title, body }. Fall back gracefully if a
    // push arrives without a parseable payload.
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = {};
    }

    const title = payload.title || "Sketchable";
    const options = {
        body: payload.body || "You have a new sketch.",
        icon: "/favicon.png",
        badge: "/favicon.png",
        // Coalesce repeated notifications so a burst of sketches doesn't stack.
        tag: "sketchable-new-sketch",
        renotify: true,
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    // Focus an existing window if the PWA is already open; otherwise open it.
    event.waitUntil(
        self.clients
            .matchAll({ type: "window", includeUncontrolled: true })
            .then((clientList) => {
                for (const client of clientList) {
                    if ("focus" in client) return client.focus();
                }
                if (self.clients.openWindow) {
                    return self.clients.openWindow("/");
                }
                return undefined;
            }),
    );
});
