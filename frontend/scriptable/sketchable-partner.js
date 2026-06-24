// Sketchable Scriptable sketch by Jorio

// CREDENTIALS
const API_TOKEN = "__API_TOKEN__"; // read-only token from POST /me/script-token
const API_BASE_URL = "__API_BASE_URL__"; // e.g. https://xxxx.execute-api.us-east-2.amazonaws.com
// Optional. Only needed if the API returns sketch entries with `url: null`
// (i.e. the CDN isn't configured server-side); then we build the image URL from
// the returned S3 key. Leave "" when the API already returns full https urls.
const CDN_DOMAIN = "__CDN_DOMAIN__";

// Local cache
const CACHE_DIR = "sketchable-cache";
const CACHE_IMAGE = "partner-latest.png";
const CACHE_META = "partner-latest.json"; // { timestamp, partnerId, fetchedAt }

// HTTP helpers
function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

/** Authenticated GET against the Sketchable API. Returns parsed JSON or throws. */
async function apiGet(path) {
    if (!API_BASE_URL || API_BASE_URL.startsWith("__")) {
        throw new Error(
            "This script isn't configured — copy it from the Sketchable app.",
        );
    }
    const req = new Request(`${API_BASE_URL}${path}`);
    req.headers = {
        Authorization: `Bearer ${API_TOKEN}`,
        Accept: "application/json",
    };
    const text = await req.loadString();
    const status = req.response ? req.response.statusCode : 0;
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = {};
        }
    }
    if (status === 401 || status === 403) {
        throw new AuthError(
            data.error ||
                "Access was rejected — re-copy the script from the app.",
        );
    }
    if (status < 200 || status >= 300) {
        throw new Error(data.error || `Request failed (${status}).`);
    }
    return data;
}

/** A rejected/expired token, distinct from transient failures, for the UI. */
class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = "AuthError";
    }
}

/** Resolve the image URL for a sketch entry, building from key+CDN if needed. */
function sketchImageUrl(entry) {
    if (entry.url) return entry.url;
    if (CDN_DOMAIN && !CDN_DOMAIN.startsWith("__") && entry.key) {
        return `https://${CDN_DOMAIN}/${entry.key}`;
    }
    return null;
}

/**
 * Fetch the partner's latest sketch. Returns
 *   { image, timestamp, partnerId } | { empty: "unpaired" | "no-sketches" }
 */
async function fetchLatestPartnerSketch() {
    const pairing = await apiGet("/pair");
    if (!pairing.paired || !pairing.partnerId) return { empty: "unpaired" };

    const list = await apiGet(
        `/sketches?userId=${encodeURIComponent(pairing.partnerId)}&limit=1`,
    );
    const latest = (list.sketches || [])[0];
    if (!latest) return { empty: "no-sketches" };

    const url = sketchImageUrl(latest);
    if (!url) throw new Error("Image URL unavailable — set CDN_DOMAIN.");

    const image = await new Request(url).loadImage();
    return { image, timestamp: latest.timestamp, partnerId: pairing.partnerId };
}

// Cache
function cachePaths() {
    const fm = FileManager.local();
    const dir = fm.joinPath(fm.documentsDirectory(), CACHE_DIR);
    if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
    return {
        fm,
        image: fm.joinPath(dir, CACHE_IMAGE),
        meta: fm.joinPath(dir, CACHE_META),
    };
}

function saveToCache(image, meta) {
    const { fm, image: imagePath, meta: metaPath } = cachePaths();
    fm.writeImage(imagePath, image);
    fm.writeString(
        metaPath,
        JSON.stringify({ ...meta, fetchedAt: nowSeconds() }),
    );
}

function loadFromCache() {
    const { fm, image: imagePath, meta: metaPath } = cachePaths();
    if (!fm.fileExists(imagePath) || !fm.fileExists(metaPath)) return null;
    try {
        const meta = JSON.parse(fm.readString(metaPath));
        return { image: fm.readImage(imagePath), ...meta };
    } catch {
        return null;
    }
}

// Presentation
function messageFor(reason) {
    switch (reason) {
        case "unconfigured":
            return "Copy this script from the Sketchable app.";
        case "auth":
            return "Re-copy the script from the app.";
        case "unpaired":
            return "Pair with your partner in the app first.";
        case "no-sketches":
            return "No sketches from your partner yet.";
        default:
            return reason || "Something went wrong.";
    }
}

/** Build the home-screen widget from a display state. */
function buildWidget(state) {
    const w = new ListWidget();
    w.backgroundColor = new Color("#1c1c1e");
    w.setPadding(0, 0, 0, 0);
    w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);

    if (state.image) {
        const img = w.addImage(state.image);
        img.applyFillingContentMode();
        img.centerAlignImage();
    } else {
        w.setPadding(16, 16, 16, 16);
        w.addSpacer();
        const title = w.addText("Sketchable");
        title.font = Font.semiboldSystemFont(15);
        title.textColor = Color.white();
        w.addSpacer(6);
        const msg = w.addText(state.message || "Nothing to show yet.");
        msg.font = Font.systemFont(12);
        msg.textColor = new Color("#aeaeb2");
        w.addSpacer();
    }
    w.url = URLScheme.forRunningScript(); // tap opens this script
    return w;
}

/**
 * Resolve what to display: try the network, fall back to the cached sketch, and
 * translate failures into a user-facing message. Never throws.
 */
async function getDisplayState() {
    if (!API_TOKEN || API_TOKEN.startsWith("__")) {
        return { message: messageFor("unconfigured") };
    }
    try {
        const result = await fetchLatestPartnerSketch();
        if (result.empty) return { message: messageFor(result.empty) };
        saveToCache(result.image, {
            timestamp: result.timestamp,
            partnerId: result.partnerId,
        });
        return { image: result.image, timestamp: result.timestamp };
    } catch (err) {
        // Prefer showing the last good sketch over an error message.
        const cached = loadFromCache();
        if (cached && cached.image) {
            return { image: cached.image, timestamp: cached.timestamp };
        }
        if (err instanceof AuthError) return { message: messageFor("auth") };
        return { message: err.message };
    }
}

// Entry point
async function main() {
    const state = await getDisplayState();
    const widget = buildWidget(state);
    if (config.runsInWidget) {
        Script.setWidget(widget);
    } else {
    }
    Script.complete();
}

await main();
