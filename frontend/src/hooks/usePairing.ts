import { useCallback, useEffect, useState } from "react";
import { ApiError, getPairing, type Pairing } from "../lib/api";

interface UsePairing {
    pairing: Pairing | null;
    loading: boolean;
    error: string | null;
    /**
     * True when the load failed because the session is no longer valid (401).
     * A silent retry can't recover from this — the gate must re-authenticate
     * interactively instead.
     */
    sessionExpired: boolean;
    refresh: () => Promise<void>;
}

/**
 * Loads the signed-in user's pairing record and, while still unpaired, polls it
 * every few seconds — so the moment a partner redeems this user's code, the UI
 * advances into the app on its own. The user is identified by their access
 * token, so no userId argument is needed.
 */
export function usePairing(): UsePairing {
    const [pairing, setPairing] = useState<Pairing | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sessionExpired, setSessionExpired] = useState(false);

    const load = useCallback(async () => {
        try {
            const next = await getPairing();
            setPairing(next);
            setError(null);
            setSessionExpired(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Something went wrong.");
            setSessionExpired(e instanceof ApiError && e.status === 401);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Initial fetch on mount. The setState happens after the awaited request
        // (in a microtask), not synchronously — this is deliberate data loading.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    useEffect(() => {
        if (pairing?.paired) return;
        const id = setInterval(() => void load(), 4000);
        return () => clearInterval(id);
    }, [pairing?.paired, load]);

    return { pairing, loading, error, sessionExpired, refresh: load };
}
