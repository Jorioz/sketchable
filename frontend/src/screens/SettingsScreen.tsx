import { useAuth0 } from "@auth0/auth0-react";
import { useState } from "react";
import {
    IoCheckmark,
    IoClose,
    IoCreateOutline,
    IoLogOutOutline,
    IoNotificationsOffOutline,
    IoNotificationsOutline,
    IoPersonCircleOutline,
    IoTrashOutline,
} from "react-icons/io5";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import Layout from "../components/Layout";
import { useSession } from "../context/SessionContext";
import { useWebPush } from "../hooks/useWebPush";
import {
    ApiError,
    deleteAccount,
    issueScriptToken,
    setUsername as apiSetUsername,
} from "../lib/api";
import { buildScriptableScript } from "../lib/scriptableScript";
import type { NavState } from "../navigation";

const MAX_USERNAME_LENGTH = 20;

export default function SettingsScreen(nav: NavState) {
    const { user, logout } = useAuth0();
    const { code, partnerId, username, updateUsername } = useSession();
    const push = useWebPush();

    // Inline username editing. The field is kept alphanumeric (matching the
    // backend's rule) and persisted via the API; on success we update the
    // session so the new name shows everywhere immediately.
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState(username);
    const [savingName, setSavingName] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);

    function startEditName() {
        setNameDraft(username);
        setNameError(null);
        setEditingName(true);
    }

    async function saveName(e: React.FormEvent) {
        e.preventDefault();
        const next = nameDraft.trim();
        if (!next || savingName) return;
        if (next === username) {
            setEditingName(false);
            return;
        }
        setSavingName(true);
        setNameError(null);
        try {
            await apiSetUsername(next);
            updateUsername(next);
            setEditingName(false);
        } catch (err) {
            setNameError(
                err instanceof ApiError
                    ? err.message
                    : "Couldn't save your name. Please try again.",
            );
        } finally {
            setSavingName(false);
        }
    }

    // Account-deletion flow: keep the confirm dialog open while the request is
    // in flight so the user can't double-submit, and surface any failure inline.
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // Sign-out uses a lighter confirmation dialog since it is reversible, but
    // we still keep the action explicit so the user does not leave by mistake.
    const [signOutOpen, setSignOutOpen] = useState(false);

    const [copyingScript, setCopyingScript] = useState(false);
    const [scriptCopied, setScriptCopied] = useState(false);
    const [scriptCopyError, setScriptCopyError] = useState<string | null>(null);

    async function handleDelete() {
        setDeleting(true);
        setDeleteError(null);
        try {
            await deleteAccount();
            // Data is gone — end the session. logout navigates away, so there's
            // no need to reset local state afterwards.
            logout({ logoutParams: { returnTo: window.location.origin } });
        } catch (err) {
            setDeleting(false);
            setDeleteError(
                err instanceof ApiError
                    ? err.message
                    : "Couldn't delete your account. Please try again.",
            );
        }
    }

    async function copyScript() {
        setCopyingScript(true);
        setScriptCopyError(null);
        setScriptCopied(false);
        try {
            const { token } = await issueScriptToken();
            const script = buildScriptableScript({ apiToken: token });
            await navigator.clipboard.writeText(script);
            setScriptCopied(true);
            setTimeout(() => setScriptCopied(false), 1500);
        } catch (err) {
            setScriptCopyError(
                err instanceof Error
                    ? err.message
                    : "Couldn't copy the script. Please try again.",
            );
        } finally {
            setCopyingScript(false);
        }
    }

    return (
        <Layout screen="settings" {...nav}>
            <div className="flex-1 flex flex-col gap-6 px-6 py-4">
                {/* Account */}
                <section className="flex items-center gap-3">
                    {user?.picture ? (
                        <img
                            src={user.picture}
                            alt=""
                            className="size-12 rounded-full object-cover"
                        />
                    ) : (
                        <IoPersonCircleOutline className="size-12 text-white/60" />
                    )}
                    <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-white">
                            {user?.name ?? "Signed in"}
                        </p>
                        {user?.email && (
                            <p className="truncate text-sm text-white/50">
                                {user.email}
                            </p>
                        )}
                    </div>
                </section>

                {/* Username */}
                <section className="space-y-2">
                    <div className="rounded-2xl bg-white/5 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-white/40">
                            Username
                        </p>
                        {editingName ? (
                            <form
                                onSubmit={saveName}
                                className="mt-2 flex items-center gap-2"
                            >
                                <input
                                    value={nameDraft}
                                    onChange={(e) =>
                                        setNameDraft(
                                            e.target.value
                                                .replace(/[^a-zA-Z0-9]/g, "")
                                                .slice(0, MAX_USERNAME_LENGTH),
                                        )
                                    }
                                    autoFocus
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    maxLength={MAX_USERNAME_LENGTH}
                                    className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-base text-white outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <button
                                    type="submit"
                                    disabled={!nameDraft.trim() || savingName}
                                    aria-label="Save username"
                                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white transition-transform active:scale-90 disabled:opacity-40"
                                >
                                    <IoCheckmark className="size-5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEditingName(false)}
                                    disabled={savingName}
                                    aria-label="Cancel"
                                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-transform active:scale-90"
                                >
                                    <IoClose className="size-5" />
                                </button>
                            </form>
                        ) : (
                            <div className="mt-1 flex items-center justify-between gap-3">
                                <span className="truncate text-base font-semibold text-white">
                                    {username}
                                </span>
                                <button
                                    type="button"
                                    onClick={startEditName}
                                    className="flex shrink-0 items-center gap-1 text-sm font-semibold text-blue-300 transition-transform active:scale-95"
                                >
                                    <IoCreateOutline className="size-4" />
                                    Edit
                                </button>
                            </div>
                        )}
                    </div>
                    {nameError && (
                        <p className="px-1 text-sm text-red-400">{nameError}</p>
                    )}
                </section>

                {/* Pairing info */}
                <section className="space-y-3">
                    <div className="rounded-2xl bg-white/5 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-white/40">
                            Your invite code
                        </p>
                        <p className="mt-1 font-mono text-xl tracking-[0.3em] text-white">
                            {code}
                        </p>
                    </div>
                    <p className="px-1 text-sm text-white/60">
                        {partnerId ? "Paired ✓" : "Not paired yet."}
                    </p>
                </section>

                <section className="space-y-2">
                    <button
                        type="button"
                        onClick={copyScript}
                        disabled={copyingScript}
                        className="flex w-full items-center justify-center gap-2 rounded-full bg-white/10 px-5 py-3 text-base font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
                    >
                        <IoCreateOutline className="size-5" />
                        {copyingScript
                            ? "Copying script…"
                            : scriptCopied
                              ? "Script copied"
                              : "Re-copy Scriptable script"}
                    </button>
                    <p className="px-1 text-sm text-white/60">
                        Paste this into Scriptable again if you need to
                        reinstall or refresh the widget.
                    </p>
                    {scriptCopyError && (
                        <p className="px-1 text-sm text-red-400">
                            {scriptCopyError}
                        </p>
                    )}
                </section>

                {/* Notifications — sub/unsub toggle. Hidden entirely when push
                    isn't available (no VAPID key, or unsupported browser). */}
                {push.supported && (
                    <section className="space-y-2">
                        {push.subscribed ? (
                            <button
                                type="button"
                                onClick={() => void push.disable()}
                                disabled={push.busy}
                                className="flex w-full items-center justify-center gap-2 rounded-full bg-white/10 px-5 py-3 text-base font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
                            >
                                <IoNotificationsOffOutline className="size-5" />
                                {push.busy
                                    ? "Turning off…"
                                    : "Turn off notifications"}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => void push.enable()}
                                disabled={!push.standalone || push.busy}
                                className="flex w-full items-center justify-center gap-2 rounded-full bg-white/10 px-5 py-3 text-base font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
                            >
                                <IoNotificationsOutline className="size-5" />
                                {push.busy
                                    ? "Turning on…"
                                    : "Turn on notifications"}
                            </button>
                        )}
                        <p className="px-1 text-sm text-white/60">
                            {push.subscribed
                                ? "You'll be notified when your partner sends a sketch."
                                : !push.standalone
                                  ? "Add Sketchable to your Home Screen to enable notifications."
                                  : "Get notified when your partner sends a sketch."}
                        </p>
                        {push.error && (
                            <p className="px-1 text-sm text-red-400">
                                {push.error}
                            </p>
                        )}
                    </section>
                )}

                <div className="flex-1" />

                {/* Sign out */}
                <AlertDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
                    <AlertDialogTrigger
                        render={
                            <button
                                type="button"
                                className="flex items-center justify-center gap-2 rounded-full bg-white/10 px-5 py-3 text-base font-semibold text-white transition-transform active:scale-[0.98]"
                            >
                                <IoLogOutOutline className="size-5" />
                                Sign out
                            </button>
                        }
                    />
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Sign out?</AlertDialogTitle>
                            <AlertDialogDescription>
                                You’ll be taken back to the sign-in screen.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() =>
                                    logout({
                                        logoutParams: {
                                            returnTo: window.location.origin,
                                        },
                                    })
                                }
                            >
                                Sign out
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* Delete account */}
                <AlertDialog
                    open={confirmOpen}
                    onOpenChange={(open) => {
                        // Don't let a click-away dismiss the dialog mid-delete.
                        if (deleting) return;
                        setConfirmOpen(open);
                        if (!open) setDeleteError(null);
                    }}
                >
                    <AlertDialogTrigger
                        render={
                            <button
                                type="button"
                                className="flex items-center justify-center gap-2 rounded-full bg-red-500/15 px-5 py-3 text-base font-semibold text-red-300 transition-transform active:scale-[0.98]"
                            >
                                <IoTrashOutline className="size-5" />
                                Delete account
                            </button>
                        }
                    />
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                Delete your account?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                This permanently deletes your sketches and
                                unpairs you from your partner. This can't be
                                undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {deleteError && (
                            <p className="text-sm text-destructive">
                                {deleteError}
                            </p>
                        )}
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={deleting}>
                                Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                                variant="destructive"
                                disabled={deleting}
                                onClick={handleDelete}
                            >
                                {deleting ? "Deleting…" : "Delete account"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </Layout>
    );
}
