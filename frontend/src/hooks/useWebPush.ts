import { useCallback, useEffect, useState } from "react";
import {
    disablePush,
    enablePush,
    getExistingSubscription,
    getPermission,
    isPushSupported,
    isStandalone,
} from "../lib/push";

export interface WebPush {
    /** Web Push is usable here (SW + Push API + Notification API + VAPID key). */
    supported: boolean;
    /** Running as an installed PWA. On iOS, push requires this to be true. */
    standalone: boolean;
    /** OS-level notification permission: "default" | "granted" | "denied". */
    permission: NotificationPermission;
    /** This browser currently holds a push subscription. */
    subscribed: boolean;
    /** A subscribe/unsubscribe request is in flight. */
    busy: boolean;
    /** Last error message to surface, or null. */
    error: string | null;
    /** Turn notifications on (must run from a user gesture — e.g. a tap). */
    enable: () => Promise<void>;
    /** Turn notifications off. */
    disable: () => Promise<void>;
}

/**
 * React state for Web Push: reports support/permission/subscription status and
 * exposes enable/disable actions. Shared by the onboarding step and Settings so
 * the two stay consistent. On mount it checks for an existing subscription so a
 * returning user sees the correct on/off state.
 */
export function useWebPush(): WebPush {
    const supported = isPushSupported();
    const [standalone, setStandalone] = useState(isStandalone);
    const [permission, setPermission] = useState<NotificationPermission>(
        getPermission(),
    );
    const [subscribed, setSubscribed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reflect the actual subscription state on mount (and whenever support
    // flips, e.g. after the user installs to the Home Screen and relaunches).
    useEffect(() => {
        if (!supported) return;
        let active = true;
        void getExistingSubscription().then((sub) => {
            if (active) setSubscribed(Boolean(sub));
        });
        return () => {
            active = false;
        };
    }, [supported]);

    // The display-mode can change without a reload (rare, but cheap to track).
    useEffect(() => {
        const mql = window.matchMedia("(display-mode: standalone)");
        const onChange = () => setStandalone(isStandalone());
        mql.addEventListener?.("change", onChange);
        return () => mql.removeEventListener?.("change", onChange);
    }, []);

    const enable = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            await enablePush();
            setSubscribed(true);
            setPermission(getPermission());
        } catch (err) {
            setPermission(getPermission());
            const msg = err instanceof Error ? err.message : "Something went wrong.";
            setError(
                msg === "denied"
                    ? "Notifications are blocked. Enable them in your device settings."
                    : msg,
            );
        } finally {
            setBusy(false);
        }
    }, []);

    const disable = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            await disablePush();
            setSubscribed(false);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Couldn't turn off notifications. Try again.",
            );
        } finally {
            setBusy(false);
        }
    }, []);

    return {
        supported,
        standalone,
        permission,
        subscribed,
        busy,
        error,
        enable,
        disable,
    };
}
