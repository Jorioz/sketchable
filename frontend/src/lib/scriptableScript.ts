// Generates the personalized Scriptable widget script handed to the user during
// onboarding. The template is the real, standalone script in frontend/scriptable
// (single source of truth), imported here as a raw string; we only substitute
// the credential placeholders so the widget logic never drifts between the two.
import widgetTemplate from "../../scriptable/sketchable-partner.js?raw";
import { config } from "./config";

export interface ScriptCredentials {
    /** Read-only token from POST /me/script-token. */
    apiToken: string;
    /** API base URL; defaults to the app's configured one. */
    apiBaseUrl?: string;
    /** Optional CloudFront domain; usually unset since the API returns urls. */
    cdnDomain?: string;
}

/**
 * Fill the widget template with the user's credentials. Returns the full script
 * text, ready to paste into Scriptable.
 *
 * Placeholders in the template (`__API_TOKEN__`, etc.) are replaced literally.
 * We use function replacers so a `$` in a value can't be interpreted as a
 * replacement pattern (Auth0 JWTs are URL-safe base64 + dots, but be safe).
 */
export function buildScriptableScript({
    apiToken,
    apiBaseUrl = config.apiBaseUrl,
    cdnDomain = "",
}: ScriptCredentials): string {
    return widgetTemplate
        .replace("__API_TOKEN__", () => apiToken)
        .replace("__API_BASE_URL__", () => apiBaseUrl)
        .replace("__CDN_DOMAIN__", () => cdnDomain);
}
