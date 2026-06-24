import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import "./index.css";
import App from "./App";
import { config, isAuth0Configured } from "./lib/config";

const root = createRoot(document.getElementById("root")!);

// When Auth0 isn't configured, render App directly — it shows a setup notice
// without ever touching the Auth0 hooks (which require this provider).
root.render(
    <StrictMode>
        {isAuth0Configured ? (
            <Auth0Provider
                domain={config.auth0Domain}
                clientId={config.auth0ClientId}
                authorizationParams={{
                    redirect_uri:
                        config.auth0RedirectUri || window.location.origin,
                    ...(config.auth0Audience
                        ? { audience: config.auth0Audience }
                        : {}),
                }}
                // After the Google redirect, strip Auth0's ?code=&state= from
                // the URL so a reload doesn't re-trigger callback handling (and
                // keeps the address bar clean). Replaces, not pushes, so Back
                // doesn't return to the dirty URL.
                onRedirectCallback={() => {
                    window.history.replaceState(
                        {},
                        document.title,
                        window.location.pathname,
                    );
                }}
                // localStorage + refresh tokens keep the user signed in across reloads
                // and devices, so they don't re-authenticate every visit.
                cacheLocation="localstorage"
                useRefreshTokens
            >
                <App />
            </Auth0Provider>
        ) : (
            <App />
        )}
    </StrictMode>,
);

// Register the service worker that delivers Web Push notifications. Idempotent
// and best-effort: it keeps an already-subscribed user receiving pushes across
// reloads, and the subscribe flow re-registers on demand if this hasn't run.
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {
            // Non-fatal — the app works without push; failures surface when the
            // user actively tries to enable notifications.
        });
    });
}
