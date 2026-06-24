import { useState, type ReactNode } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import {
    IoCheckmark,
    IoArrowBack,
    IoCopyOutline,
    IoLogoGoogle,
    IoNotificationsOutline,
    IoOpenOutline,
    IoShareOutline,
} from "react-icons/io5";
import FullScreen from "../components/FullScreen";
import { useWebPush } from "../hooks/useWebPush";
import { issueScriptToken } from "../lib/api";
import { buildScriptableScript } from "../lib/scriptableScript";

const SCRIPTABLE_URL = "https://apps.apple.com/app/scriptable/id1405459188";

// True when the page is running as an installed PWA (launched from the Home
// Screen) rather than inside Safari. Lets us auto-tick the first step.
function isStandalone(): boolean {
    return (
        window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari exposes this non-standard flag on navigator.
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
}

type CopyState = "idle" | "working" | "copied" | "error";

// Device-setup checklist shown after the intro and before pairing:
//   1 add to Home Screen · 2 sign in with Google · 3 get Scriptable ·
//   4 copy the personalized widget script (mints a read-only token + fills the
//     template, then writes it to the clipboard to paste into Scriptable).
// The bottom Continue unlocks once Google sign-in has succeeded.
export default function SetupScreen({
    onContinue,
    onBack,
}: {
    onContinue: () => void;
    onBack: () => void;
}) {
    const { isAuthenticated, loginWithRedirect } = useAuth0();
    const push = useWebPush();
    const [copyState, setCopyState] = useState<CopyState>("idle");
    const [copyError, setCopyError] = useState("");

    function signIn() {
        void loginWithRedirect({
            authorizationParams: { connection: "google-oauth2" },
        });
    }

    async function copyScript() {
        setCopyState("working");
        setCopyError("");
        try {
            const { token } = await issueScriptToken();
            const script = buildScriptableScript({ apiToken: token });
            await navigator.clipboard.writeText(script);
            setCopyState("copied");
        } catch (err) {
            setCopyState("error");
            setCopyError(
                err instanceof Error
                    ? err.message
                    : "Couldn't copy the script. Try again.",
            );
        }
    }

    return (
        <FullScreen>
            <div className="pb-4">
                <button
                    type="button"
                    onClick={onBack}
                    aria-label="Back"
                    className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-95"
                >
                    <IoArrowBack className="size-4" />
                    Back
                </button>
            </div>

            <div className="flex flex-col gap-7 py-2">
                <header className="space-y-2 text-center">
                    <h1 className="text-2xl font-bold text-white">
                        Set up Sketchable
                    </h1>
                    <p className="text-sm text-white/60">
                        A few quick steps to get going.
                    </p>
                </header>

                <ol className="flex flex-col gap-3">
                    <Step
                        n={1}
                        done={isStandalone()}
                        title="Add to your Home Screen"
                    >
                        <p>
                            Tap the Share button{" "}
                            <IoShareOutline className="inline size-4 -translate-y-px" />{" "}
                            in Safari, then{" "}
                            <b className="text-white/80">Add to Home Screen</b>.
                            Open Sketchable from there and come back to this
                            step.
                        </p>
                    </Step>

                    <Step
                        n={2}
                        done={isAuthenticated}
                        title="Sign in with Google"
                    >
                        {isAuthenticated ? (
                            <p>You're signed in.</p>
                        ) : (
                            <>
                                <p>
                                    We use your Google account to sync across
                                    devices.
                                </p>
                                <button
                                    type="button"
                                    onClick={signIn}
                                    className="mt-2 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition-transform active:scale-95"
                                >
                                    <IoLogoGoogle className="size-4" />
                                    Continue with Google
                                </button>
                            </>
                        )}
                    </Step>

                    <Step n={3} title="Get the Scriptable app">
                        <p>
                            Sketchable uses{" "}
                            <b className="text-white/80">Scriptable</b> to show
                            sketches on your Home Screen. Install it from the
                            App Store.
                        </p>
                        <a
                            href={SCRIPTABLE_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-95"
                        >
                            Open App Store
                            <IoOpenOutline className="size-4" />
                        </a>
                    </Step>

                    <Step
                        n={4}
                        done={copyState === "copied"}
                        title="Copy your widget script"
                    >
                        <p>
                            This copies a personal script to your clipboard. In{" "}
                            <b className="text-white/80">Scriptable</b>, tap{" "}
                            <b className="text-white/80">+</b>, paste it, and
                            run it once — then add a Scriptable widget to your
                            Home Screen.
                        </p>
                        <button
                            type="button"
                            onClick={copyScript}
                            disabled={
                                !isAuthenticated || copyState === "working"
                            }
                            className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-40 disabled:active:scale-100"
                        >
                            {copyState === "copied" ? (
                                <IoCheckmark className="size-4" />
                            ) : (
                                <IoCopyOutline className="size-4" />
                            )}
                            {copyState === "working"
                                ? "Preparing…"
                                : copyState === "copied"
                                  ? "Copied to clipboard"
                                  : "Copy script"}
                        </button>
                        {!isAuthenticated && (
                            <p className="mt-1 text-xs text-white/40">
                                Sign in first to unlock this.
                            </p>
                        )}
                        {copyState === "error" && (
                            <p className="mt-1 text-xs text-red-300">
                                {copyError}
                            </p>
                        )}
                    </Step>

                    {/* Optional: opt into push notifications. Only shown when the
                        browser supports it and a VAPID key is configured. */}
                    {push.supported && (
                        <Step
                            n={5}
                            done={push.subscribed}
                            title="Turn on notifications"
                        >
                            {push.subscribed ? (
                                <p>
                                    You're all set — we'll nudge you when your
                                    partner sends a sketch.
                                </p>
                            ) : !push.standalone ? (
                                <p>
                                    Finish step 1 first: open Sketchable from
                                    your Home Screen, then come back here to
                                    enable notifications.
                                </p>
                            ) : (
                                <>
                                    <p>
                                        Get a nudge the moment your partner
                                        sends you a sketch.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => void push.enable()}
                                        disabled={!isAuthenticated || push.busy}
                                        className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-40 disabled:active:scale-100"
                                    >
                                        <IoNotificationsOutline className="size-4" />
                                        {push.busy
                                            ? "Enabling…"
                                            : "Enable notifications"}
                                    </button>
                                    {!isAuthenticated && (
                                        <p className="mt-1 text-xs text-white/40">
                                            Sign in first to unlock this.
                                        </p>
                                    )}
                                    {push.error && (
                                        <p className="mt-1 text-xs text-red-300">
                                            {push.error}
                                        </p>
                                    )}
                                </>
                            )}
                        </Step>
                    )}
                </ol>
            </div>

            {/* Continue — only after Google sign-in has succeeded. */}
            <div className="mt-auto pt-6 pb-2">
                <button
                    type="button"
                    onClick={onContinue}
                    disabled={!isAuthenticated}
                    className="flex w-full items-center justify-center rounded-full bg-blue-500 px-5 py-3.5 text-base font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
                >
                    Continue
                </button>
            </div>
        </FullScreen>
    );
}

function Step({
    n,
    title,
    done = false,
    children,
}: {
    n: number;
    title: string;
    done?: boolean;
    children: ReactNode;
}) {
    return (
        <li className="flex gap-4 rounded-2xl bg-white/5 p-4">
            <div
                className={
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold " +
                    (done
                        ? "bg-green-500 text-white"
                        : "bg-blue-500/20 text-blue-300")
                }
            >
                {done ? <IoCheckmark className="size-4" /> : n}
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
                <h2 className="text-base font-semibold text-white">{title}</h2>
                <div className="text-sm text-white/60">{children}</div>
            </div>
        </li>
    );
}
