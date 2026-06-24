import { createContext, useContext, useState, type ReactNode } from "react";
import type { Pairing } from "../lib/api";

// The authenticated + paired session, available to every screen inside the
// main app. The gate in App.tsx only renders the provider once both the Auth0
// login and the pairing have succeeded, so these values are always present here.
interface Session {
    /** Auth0-derived, path-safe user id. */
    userId: string;
    /** Shared stream id for this couple. */
    pairId: string;
    /** The partner's userId (for reading their sketch stream). */
    partnerId: string;
    /** The user's own invite code. */
    code: string;
    /** The user's chosen display name. */
    username: string;
    /** The partner's display name (falls back to "Partner" if they've set none). */
    partnerUsername: string;
    /** Update the local display name after a successful rename, so the UI reflects
     * it everywhere without re-fetching the pairing record. */
    updateUsername: (name: string) => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
    userId,
    pairing,
    children,
}: {
    userId: string;
    pairing: Pairing;
    children: ReactNode;
}) {
    // Held in state so a rename from Settings updates the whole app immediately.
    // Seeded from the gate-provided pairing, which is guaranteed paired + named.
    const [username, setUsername] = useState(pairing.username!);

    const value: Session = {
        userId,
        pairId: pairing.pairId!,
        partnerId: pairing.partnerId!,
        code: pairing.code,
        username,
        partnerUsername: pairing.partnerUsername ?? "Partner",
        updateUsername: setUsername,
    };
    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
    const ctx = useContext(SessionContext);
    if (!ctx) {
        throw new Error("useSession must be used within a SessionProvider");
    }
    return ctx;
}
