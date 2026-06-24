import { useCallback, useEffect, useRef, useState } from "react";
import { listSketches, type SketchEntry } from "../lib/api";

/** A sketch tagged with whose stream it came from, for the combined feed. */
export interface FeedSketch extends SketchEntry {
    from: "me" | "partner";
}

interface UseSketchFeed {
    sketches: FeedSketch[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

const feedCache = new Map<string, FeedSketch[]>();

/**
 * Loads both streams — your own and your partner's — and merges them into one
 * feed sorted newest first, each entry tagged with `from`. Polls so freshly
 * shared sketches (either side) show up without a manual refresh. The caller's
 * identity comes from their access token; `partnerId` selects the partner
 * stream (the backend only permits reading your own or your partner's).
 */
export function useSketchFeed(partnerId: string): UseSketchFeed {
    const cachedSketches = feedCache.get(partnerId) ?? [];
    const [sketches, setSketches] = useState<FeedSketch[]>(cachedSketches);
    const [loading, setLoading] = useState(cachedSketches.length === 0);
    const [error, setError] = useState<string | null>(null);
    const isMountedRef = useRef(true);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const load = useCallback(
        async (background = false) => {
            try {
                const [mine, theirs] = await Promise.all([
                    listSketches(), // own stream (no target id)
                    listSketches(partnerId),
                ]);
                const merged: FeedSketch[] = [
                    ...mine.sketches.map((s) => ({
                        ...s,
                        from: "me" as const,
                    })),
                    ...theirs.sketches.map((s) => ({
                        ...s,
                        from: "partner" as const,
                    })),
                ].sort((a, b) => b.timestamp - a.timestamp);
                feedCache.set(partnerId, merged);
                setSketches(merged);
                setError(null);
            } catch (e) {
                if (!background || cachedSketches.length === 0) {
                    setError(
                        e instanceof Error
                            ? e.message
                            : "Something went wrong.",
                    );
                }
            } finally {
                if (isMountedRef.current) {
                    setLoading(false);
                }
            }
        },
        [partnerId],
    );

    useEffect(() => {
        // Initial fetch on mount. If we already have cached data, keep it on
        // screen and refresh in the background instead of flashing the empty
        // loading state again.
        if (cachedSketches.length === 0) {
            void load(false);
        } else {
            void load(true);
        }
    }, [load]);

    useEffect(() => {
        const id = setInterval(() => void load(true), 8000);
        return () => clearInterval(id);
    }, [load]);

    return { sketches, loading, error, refresh: load };
}
