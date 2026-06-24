import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import {
    IoCopyOutline,
    IoCheckmark,
    IoShareOutline,
    IoHeartOutline,
} from "react-icons/io5";
import FullScreen from "../components/FullScreen";
import { redeemCode, ApiError, type Pairing } from "../lib/api";

// Shown after sign-in, before the app unlocks. Two ways to bind a couple:
//   1. Share your own code with your partner, or
//   2. Enter the code your partner shared with you.
// Either one binds BOTH users — the parent polls pairing status (usePairing),
// so when a partner redeems your code this screen advances on its own.
export default function PairingScreen({
    pairing,
    onRefresh,
}: {
    pairing: Pairing;
    onRefresh: () => Promise<void>;
}) {
    const { logout } = useAuth0();
    const [entered, setEntered] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const canShare = typeof navigator !== "undefined" && !!navigator.share;

    async function copyCode() {
        try {
            await navigator.clipboard.writeText(pairing.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard blocked — the code is on screen to read anyway */
        }
    }

    async function shareCode() {
        try {
            await navigator.share({
                title: "Sketchable",
                text: `Pair with me on Sketchable — my code is ${pairing.code}`,
            });
        } catch {
            /* user dismissed the share sheet */
        }
    }

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        const code = entered.trim().toUpperCase();
        if (!code || submitting) return;

        setSubmitting(true);
        setError(null);
        try {
            await redeemCode(code);
            // Re-fetch authoritative status; if paired, the gate swaps this
            // screen for the app.
            await onRefresh();
        } catch (e) {
            setError(
                e instanceof ApiError
                    ? e.message
                    : "Couldn't pair. Please try again.",
            );
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <FullScreen>
            <div className="flex flex-col gap-7 py-2">
                <header className="space-y-2 text-center">
                    <h1 className="text-2xl font-bold text-white">Pairing</h1>
                    <p className="text-sm text-white/60">
                        Share or enter a code. Once pair is complete, you will
                        be redirected.
                    </p>
                </header>

                {/* Your code */}
                <section className="space-y-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">
                        Your code
                    </h2>
                    <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-5 py-4">
                        <span className="font-mono text-3xl font-bold tracking-[0.3em] text-white">
                            {pairing.code}
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={copyCode}
                                aria-label="Copy code"
                                className="flex size-10 items-center justify-center rounded-full text-white/80 transition-transform active:scale-90"
                            >
                                {copied ? (
                                    <IoCheckmark className="size-5 text-green-400" />
                                ) : (
                                    <IoCopyOutline className="size-5" />
                                )}
                            </button>
                            {canShare && (
                                <button
                                    type="button"
                                    onClick={shareCode}
                                    aria-label="Share code"
                                    className="flex size-10 items-center justify-center rounded-full text-white/80 transition-transform active:scale-90"
                                >
                                    <IoShareOutline className="size-5" />
                                </button>
                            )}
                        </div>
                    </div>
                    <p className="flex items-center gap-2 text-xs text-white/40">
                        <span className="inline-block size-1.5 animate-pulse rounded-full bg-blue-400" />
                        Waiting to pair...
                    </p>
                </section>

                {/* Divider */}
                <div className="flex items-center gap-3 text-xs font-medium text-white/30">
                    <span className="h-px flex-1 bg-white/10" />
                    OR
                    <span className="h-px flex-1 bg-white/10" />
                </div>

                {/* Enter partner's code */}
                <form onSubmit={submit} className="space-y-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">
                        Enter a code
                    </h2>
                    <input
                        value={entered}
                        onChange={(e) =>
                            setEntered(e.target.value.toUpperCase())
                        }
                        placeholder="ABC123"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        maxLength={6}
                        inputMode="text"
                        className="w-full rounded-2xl bg-white/5 px-5 py-4 text-center font-mono text-2xl tracking-[0.3em] text-white placeholder:text-white/20 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {error && (
                        <p className="text-center text-sm text-red-400">
                            {error}
                        </p>
                    )}
                    <button
                        type="submit"
                        disabled={!entered.trim() || submitting}
                        className="w-full rounded-full bg-blue-500 px-5 py-3.5 text-base font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
                    >
                        {submitting ? "Pairing…" : "Pair"}
                    </button>
                </form>

                <button
                    type="button"
                    onClick={() =>
                        logout({
                            logoutParams: { returnTo: window.location.origin },
                        })
                    }
                    className="mx-auto text-xs text-white/40 underline-offset-4 hover:underline"
                >
                    Sign out
                </button>
            </div>
        </FullScreen>
    );
}
