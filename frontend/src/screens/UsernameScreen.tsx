import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { IoPersonOutline } from "react-icons/io5";
import FullScreen from "../components/FullScreen";
import { setUsername, ApiError } from "../lib/api";

const MAX_USERNAME_LENGTH = 20;

// Shown after sign-in, before pairing: the user picks a display name. Names are
// just labels (users are keyed by their Google identity), so there's no
// availability check — only that the value is alphanumeric. On success the
// parent re-fetches pairing, which now carries the username, advancing the gate.
export default function UsernameScreen({ onRefresh }: { onRefresh: () => Promise<void> }) {
    const { logout } = useAuth0();
    const [name, setName] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Strip anything non-alphanumeric as the user types so the field only ever
    // holds a value the backend will accept.
    function onChange(value: string) {
        setName(value.replace(/[^a-zA-Z0-9]/g, "").slice(0, MAX_USERNAME_LENGTH));
    }

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        const username = name.trim();
        if (!username || submitting) return;

        setSubmitting(true);
        setError(null);
        try {
            await setUsername(username);
            // Re-fetch authoritative status; with a username set, the gate moves
            // this user on to pairing.
            await onRefresh();
        } catch (e) {
            setError(
                e instanceof ApiError ? e.message : "Couldn't save your name. Please try again.",
            );
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <FullScreen>
            <div className="flex flex-1 flex-col justify-center gap-7 py-2">
                <header className="space-y-2 text-center">
                    <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-blue-500/20">
                        <IoPersonOutline className="size-7 text-blue-300" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">Pick a username</h1>
                    <p className="text-sm text-white/60">
                        This is the name your partner will see. You can use letters and numbers.
                    </p>
                </header>

                <form onSubmit={submit} className="space-y-3">
                    <input
                        value={name}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="yourname"
                        autoFocus
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        maxLength={MAX_USERNAME_LENGTH}
                        inputMode="text"
                        className="w-full rounded-2xl bg-white/5 px-5 py-4 text-center text-2xl text-white placeholder:text-white/20 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {error && <p className="text-center text-sm text-red-400">{error}</p>}
                    <button
                        type="submit"
                        disabled={!name.trim() || submitting}
                        className="w-full rounded-full bg-blue-500 px-5 py-3.5 text-base font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
                    >
                        {submitting ? "Saving…" : "Continue"}
                    </button>
                </form>

                <button
                    type="button"
                    onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
                    className="mx-auto text-xs text-white/40 underline-offset-4 hover:underline"
                >
                    Sign out
                </button>
            </div>
        </FullScreen>
    );
}
