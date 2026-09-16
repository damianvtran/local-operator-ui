import { useSuppressBrowserView } from "@shared/browser-view-policy";
import { FloatingAlert } from "@shared/components/common/floating-alert";
import { Button, Progress } from "@shared/components/ui";
import { withPathBreaks } from "@shared/lib/path-breaks";
import { cn } from "@shared/lib/utils";
import {
	UpdateType,
	useDeferredUpdatesStore,
} from "@shared/store/deferred-updates-store";
import { unwrapIpcErrorMessage } from "@shared/utils/ipc-error-message";
import {
	updateErrorMessage,
	updateMessageFate,
} from "@shared/utils/update-error-copy";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import parse from "html-react-parser";
import { AlertTriangle, Check, Copy } from "lucide-react";
import {
	type HTMLAttributes,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { stripErrorPrefixes } from "../../../../../shared/transport-failure";
import { UpdateErrorAlert } from "./update-error-alert";
import {
	type ManualUpdateExpectation,
	atLeastVersion,
	manualPanelClearedByAvailable,
	manualPanelClearedByCheck,
} from "./update-manual-state";

/**
 * What the panel says when the server update failed and named no reason.
 *
 * `update-backend` RESOLVES false rather than rejecting, so an attempt that ends
 * false with no event is a real outcome to report - not a silent clear. It should
 * be unreachable: every failing branch in `UpdateService.updateBackend` sends
 * `backend-update-error` first. It is the backstop that means the panel can never
 * hang on a main process that answered without saying why.
 *
 * It names the release the app was updating to, because that is the fact the
 * reader can check against what is running, and it deliberately does NOT send
 * them to "the update service log": the renderer has no affordance that opens it
 * (the only `showItemInFolder` call site is the attachment menu, and nothing here
 * names `LogFileType.UPDATE_SERVICE`), so naming it is not a next step. And the
 * panel that carries this sentence points at NO durable record, because for a
 * server update there is none to point at: the Settings card's only failure
 * record is written by the APP-install paths (`writePendingInstallMarker`), and
 * `updateBackend` writes nothing there. The install-failure panel one screen up
 * says "also recorded in Settings" and is true there; this sentence used to copy
 * that promise, and the copy was false (design D3, D10; UX U5).
 */
const serverUpdateFailedMessage = (targetVersion: string | null | undefined) =>
	targetVersion
		? `The server update to ${targetVersion} did not complete.`
		: "The server update did not complete.";

type BackendUpdateInfo = {
	currentVersion: string;
	latestVersion: string;
	updateCommand: string;
	canManageUpdate?: boolean;
	startupMode?: string;
	/** Sentence introducing the manual command, chosen by how the server is installed. */
	remedy?: string;
	/** How the install was classified, and where it resolved to. */
	detail?: string;
	/** True when the install follows a source tree on this machine. */
	sourceBuild?: boolean;
	/**
	 * True when this event answers a check the user asked for.
	 *
	 * The by-hand panel's own copy says to run a command and check again, so the
	 * answer to a check the USER ran is what ends it - while the periodic check
	 * must not dismiss a panel out from under the reader (review U12).
	 */
	manual?: boolean;
};

/** A remedy the main process can spell out in the user's own terms. */
type UpdateRemedy = {
	text: string;
	url?: string;
	command?: string;
};

/**
 * An install the app refused to start.
 *
 * Deliberately its own state rather than an entry in `error`: the app is still
 * running and nothing has failed yet, and the refusal needs the remedy on
 * screen next to it - the operator's report was an install that vanished with
 * no message at all.
 */
type InstallBlockedInfo = {
	code: string;
	version: string | null;
	message: string;
	remedy: UpdateRemedy;
	detail?: string;
	/**
	 * The heading and dismiss label the main process chose for this refusal.
	 *
	 * The map below is keyed by `code`, and one code covers two situations that
	 * are not the same news - an update that was refused, and a copy that is
	 * damaged with no update in play. These carry the copy that knows which it is,
	 * and fall back to the map so a caller that sets neither is unchanged
	 * (design D2, D3).
	 */
	heading?: string | null;
	dismissLabel?: string | null;
};

/** A previous install Squirrel never completed, reported on the next start. */
type InstallFailedInfo = {
	targetVersion: string;
	message: string;
	remedy: UpdateRemedy;
	detail?: string;
	/** How many times this target has failed on this machine. */
	attempts?: number;
	/**
	 * True when opening the app while the install was running is what cancelled
	 * it. It is the one cause the main process can attest to rather than infer,
	 * and it changes the heading because "the last update didn't finish" reads as
	 * a mystery while "it was cancelled because you opened the app" is a thing the
	 * user can act on.
	 */
	cancelledByRelaunch?: boolean;
};

/**
 * An install that is running right now, found when the app started.
 *
 * Its own state rather than a failure: nothing has failed, and the install can
 * still finish - but only while the app is closed, so the panel's purpose is to
 * say that and offer the quit. The sentence comes from the main process, which
 * knows which version is installing.
 */
type InstallInFlightInfo = {
	targetVersion: string;
	message: string;
	detail?: string;
};

/** The by-hand server state: what to run, and what installation it was read from. */
type ManualUpdateInfo = {
	message: string;
	command: string;
	detail?: string;
	/**
	 * The version this panel is waiting for, and what is running now.
	 *
	 * Both travel from the main process, which is the side that knows how the
	 * install was classified and what the server last reported: the panel used to
	 * reconstruct the target from whatever offer happened to precede the event,
	 * and said no version at all in its copy (reviews U12, U17).
	 */
	latestVersion?: string | null;
	currentVersion?: string | null;
	/** True when the install follows a source tree on this machine. */
	sourceBuild?: boolean;
};

/** Headings for the refusal states, sentence case, one line each. */
const INSTALL_BLOCK_HEADINGS: Record<string, string> = {
	"installed-bundle-not-sealed": "This app can't update itself",
	"download-verification-failed": "The update couldn't be verified",
	"artifact-metadata-missing": "The update couldn't be verified",
	"insufficient-disk-space": "Not enough disk space to update",
};

/**
 * The notification panel itself.
 *
 * It leaves the flow, so it takes `elevated` plus the one shadow rather than a
 * border. The `[&_a]` rule is the only descendant selector kept from the MUI
 * version: release notes arrive as HTML from GitHub, so their anchors cannot be
 * given a class at the call site.
 *
 * `tone` is what assistive technology is told, and it is the same split
 * `FloatingAlert` uses: these panels are the ones a user most needs to notice -
 * an update was refused, an install failed - and they were announced to nobody
 * while every transient message in this file went out as a live region
 * (review U6).
 *
 * `role` overrides that default for a panel whose deadline is the point: a
 * polite live region waits for a pause in the reader's own output, and the
 * in-flight install panel is the one state where the pause is the cost, so it
 * asks to be announced assertively without borrowing the failure marker it is
 * deliberately not carrying (review D3).
 */
export const UpdateContainer = ({
	className,
	tone = "notice",
	role,
	...props
}: HTMLAttributes<HTMLDivElement> & {
	tone?: "notice" | "failed";
	role?: "status" | "alert";
}) => {
	/*
	 * This card is `fixed top-4 right-4`, so it paints over the top-right of the
	 * content area — which over the browser route is the native view, and a native
	 * view paints above all DOM (design 11.3). Registering here rather than at each
	 * caller is the same funnel argument as `BaseDialog`'s: mounting this wrapper IS
	 * being visible, so a caller cannot forget.
	 */
	useSuppressBrowserView(true, "update-notice");
	return (
		<div
			role={role ?? (tone === "failed" ? "alert" : "status")}
			className={cn(
				"fixed top-4 right-4 z-50 w-100 max-w-[calc(100vw-2rem)]",
				"rounded-lg bg-elevated p-4 shadow-overlay",
				"[&_a]:text-accent [&_a]:underline-offset-4 [&_a]:hover:underline",
				className,
			)}
			{...props}
		/>
	);
};

/**
 * A panel heading, with the marker that says this one failed.
 *
 * Why an icon and not `text-danger` on the words: the two failure states were
 * typographically identical to the informational one - same 16px `text-ink`
 * heading, same body, same right-aligned buttons - so a user who had learned
 * "top-right panel = an update is available" read a broken install as one more
 * notice (review D1). `danger` as TEXT on `elevated` measures 3.76:1 in monokai
 * and 3.81:1 in dracula, under the 4.5:1 text floor `check-themes` asserts for
 * every theme, while the same ink as a graphical mark clears the 3:1 non-text
 * floor everywhere. So the colour is spent on the glyph and the distinction is
 * carried by the glyph's shape plus the words themselves.
 */
export const UpdateHeading = ({
	children,
	tone = "notice",
}: {
	children: ReactNode;
	tone?: "notice" | "failed";
}) => (
	<h2 className={cn("mb-3 flex items-center gap-2 text-heading text-ink")}>
		{tone === "failed" && (
			<AlertTriangle
				className="size-4 shrink-0 text-danger"
				aria-hidden={true}
			/>
		)}
		{children}
	</h2>
);

/**
 * Machine voice at the bottom of a panel, labelled and copyable.
 *
 * It used to sit directly above the buttons, unlabelled and at 12px mono, so the
 * last thing the eye crossed before the primary action was an OSStatus code -
 * and the only way to get that code into a support report was to hand-select a
 * wrapped path (reviews D2, D6, U11). It is below the actions now, it says what
 * it is, and one click copies it, which is the affordance the rest of the app
 * already has for the same job.
 */
export const PanelDetails = ({ detail }: { detail: string }) => {
	const [copied, setCopied] = useState(false);
	return (
		<div className="mt-4 flex items-start gap-2">
			<span className="shrink-0 text-meta text-ink-dim">Details:</span>
			{/* `font-mono` and not only `text-mono-sm`: the latter is a SIZE token
			    (0.75rem), so the value rendered in the body face and a path or an
			    OSStatus constant lost the distinction between l/I/1 and 0/O that
			    monospace exists for here, while the evidence README claimed the
			    machine voice (review D10). The label stays sans: it is a word. */}
			<span className="min-w-0 flex-1 break-words font-mono text-mono-sm text-ink-dim">
				{withPathBreaks(detail)}
			</span>
			{/* Named, not a bare "Copy": both by-hand panels carry a copy button
			    beside the command well as well as this one, and only position said
			    which copied what (review D12). */}
			<Button
				variant="ghost"
				size="sm"
				onClick={() => {
					void navigator.clipboard
						.writeText(detail)
						.then(() => setCopied(true))
						.catch(() => undefined);
				}}
			>
				{copied ? <Check /> : <Copy />}
				{copied ? "Copied" : "Copy details"}
			</Button>
		</div>
	);
};

/**
 * A command the user has to run themselves, with a way to take it with them.
 *
 * The app already had this pattern (MCP setup prompts, provider details), and a
 * bare `<code>` block floating over the app made the user hand-select a command
 * out of a panel (review U7).
 */
export const CommandBlock = ({ command }: { command: string }) => {
	const [copied, setCopied] = useState(false);
	return (
		<div className="mt-2 flex items-start gap-2">
			<code className="min-w-0 flex-1 rounded-sm bg-sunken p-2 text-mono-sm break-all text-ink">
				{command}
			</code>
			<Button
				variant="outline"
				size="sm"
				onClick={() => {
					void navigator.clipboard
						.writeText(command)
						.then(() => setCopied(true))
						.catch(() => undefined);
				}}
			>
				{copied ? <Check /> : <Copy />}
				{copied ? "Copied" : "Copy command"}
			</Button>
		</div>
	);
};

/**
 * Prose semantics for the one place in the app that injects third-party HTML.
 *
 * Preflight resets `h1-h6` to inherited size and weight and strips list
 * markers, indent and margins, so a GitHub release note - headings and bullet
 * lists essentially always - rendered as a wall of identical lines. The
 * markdown editor carries the same set for the same reason.
 *
 * Exported because the Storybook story draws its own copy of this panel, and
 * a fixture that has drifted from the component is how a defect stays
 * invisible in a set of 420 pictures.
 */
export const RELEASE_NOTES_PROSE = [
	"[&_:is(h1,h2,h3,h4,h5,h6)]:mt-3 [&_:is(h1,h2,h3,h4,h5,h6)]:mb-1 [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:text-ink",
	"[&_h1]:text-heading [&_h2]:text-heading [&_h3]:text-body [&_h4]:text-body [&_h5]:text-body-sm [&_h6]:text-body-sm",
	"[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
	"[&_:is(ul,ol)]:my-1.5 [&_:is(ul,ol)]:pl-5 [&_ul_li]:list-disc [&_ol_li]:list-decimal [&_li]:my-0.5",
	/* No link rule here: `UpdateContainer` above already carries
	   `[&_a]:hover:underline`, and the copy that lived here was written
	   `hover:[&_a]:underline` - which compiles to `.cls:hover a`, so hovering
	   anywhere in the body underlined every link in the panel at once. */
	"[&_code]:rounded-xs [&_code]:bg-sunken [&_code]:px-1 [&_code]:font-mono [&_code]:text-mono-sm",
].join(" ");

/**
 * The sentence that closes a by-hand panel: what to do about the command above,
 * and what the versions mean afterwards.
 *
 * One component for both producers, because the same state has to read the same
 * from either door: the producer a plain version check reaches rendered neither
 * this sentence nor the details line, so the state a user actually walks into
 * was the thinner one (review U15). The source-build wording exists because a uv
 * tool rebuilt by `lop-update` and a checkout both report the CHECKOUT's version
 * afterwards, which may never equal the version the app offered - promising "the
 * new server version" there asks for something the install cannot deliver, on
 * the one surface that told the user to go and do work (review U12).
 */
const ManualRemedyNote = ({
	command,
	sourceBuild,
}: {
	/** Whether a command well was rendered above this note. */
	command: boolean;
	sourceBuild: boolean;
}) => {
	if (sourceBuild && !command) {
		return (
			<p className="mt-2 text-body text-ink">
				This server follows this machine's checkout, so there is no command to
				run here.
			</p>
		);
	}
	return (
		<p className="mt-2 text-body text-ink">
			{sourceBuild
				? "Run this in a terminal. It rebuilds the server from this machine's checkout, so the version it reports afterwards is your checkout's rather than the published release."
				: command
					? "Run this in a terminal, then check for updates again to pick up the new server version."
					: "Then check for updates again to pick up the new server version."}
		</p>
	);
};

/**
 * The version a by-hand panel is waiting for, in the same shape the offer uses.
 *
 * The panel that asks the user to go and do work was the only one that said no
 * version at all, so there was nothing to work towards and - with the clear rule
 * above - nothing to tell them whether they had arrived (review U17).
 */
const ManualUpdateVersions = ({
	latestVersion,
	currentVersion,
	className,
}: {
	latestVersion?: string | null;
	currentVersion?: string | null;
	/** Spacing the caller owns when this line does not follow its usual sibling. */
	className?: string;
}) => {
	if (!latestVersion) return null;
	return (
		<p className={cn("mb-2 text-body text-ink-muted", className)}>
			{`Server version ${latestVersion} is available.`}
			{currentVersion
				? ` You are currently using version ${currentVersion}.`
				: ""}
		</p>
	);
};

export const UpdateActions = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	/*
	 * The action row is the widest thing in a panel, and the failure panel's three
	 * buttons do not fit the content box at 1280: measured 378px of buttons inside
	 * 368px, which put the first button's left border 8px outside every other
	 * element's 16px inset and its right border 1px past the content edge (review
	 * D11). `flex-wrap` lets the row take a second line instead of overhanging.
	 *
	 * It also fixes the narrow case the same round measured - the first button
	 * running 28px outside the window at 380px, its label clipped to "date later"
	 * - which is NOT reachable in the shipped desktop window (minWidth is 800 in
	 * `src/main/index.ts`), so it is fixed by the same change rather than being
	 * the reason for it. The by-hand panels (two 112px buttons) and the blocked
	 * panel (two buttons, 240px) fit on one line and are unaffected: wrapping only
	 * engages when something would have overflowed.
	 */
	<div
		className={cn("mt-6 flex flex-wrap justify-end gap-3", className)}
		{...props}
	/>
);

export const ProgressContainer = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("mt-4 mb-2", className)} {...props} />
);

type UpdateNotificationProps = {
	/** Whether to automatically check for updates on mount */
	autoCheck?: boolean;
};

/**
 * Component that handles application update notifications
 */
export const UpdateNotification = ({
	autoCheck = true,
}: UpdateNotificationProps) => {
	// State for frontend update status
	const [checking, setChecking] = useState(false);
	const [updatingBackend, setUpdatingBackend] = useState(false);
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
	const [downloading, setDownloading] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState<ProgressInfo | null>(
		null,
	);
	const [updateDownloaded, setUpdateDownloaded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [snackbarOpen, setSnackbarOpen] = useState(false);
	const [appVersion, setAppVersion] = useState<string>("unknown");

	// State for backend update status
	/**
	 * A server update that failed, holding the main process's own reason.
	 *
	 * Deliberately its own state rather than an entry in `error`, for the reason
	 * the install refusals above are: a failure the user has to act on belongs in
	 * the panel slot. In `error` it was a 6-second toast in the opposite corner
	 * whose only control was Dismiss - and, because `error` was an early return
	 * above the offer panel, it also took **Update server** off the screen for the
	 * rest of the session (design D1, UX U1).
	 */
	const [backendUpdateFailure, setBackendUpdateFailure] = useState<
		string | null
	>(null);
	const [backendUpdateAvailable, setBackendUpdateAvailable] = useState(false);
	const [backendUpdateInfo, setBackendUpdateInfo] =
		useState<BackendUpdateInfo | null>(null);
	const [backendUpdateCompleted, setBackendUpdateCompleted] = useState(false);
	const [manualUpdateRequired, setManualUpdateRequired] = useState(false);
	const [manualUpdateInfo, setManualUpdateInfo] =
		useState<ManualUpdateInfo | null>(null);
	/**
	 * What the by-hand panel is waiting for, and whether that install can reach it.
	 *
	 * Held so the panel can clear itself when the server stops being behind the
	 * version it named: the panel's own copy says to run the command and check
	 * again, and it used to stay up afterwards until the user pressed Dismiss
	 * (review U2). Both facts travel in the manual-required event now - it used to
	 * carry neither, so the target was reconstructed from whatever offer happened
	 * to precede it (reviews U12, U17) - but the clear decision is made inside a
	 * listener registered once, so they are kept in a ref as well as in state.
	 */
	const manualUpdateExpectationRef = useRef<ManualUpdateExpectation>({
		target: null,
		sourceBuild: false,
	});
	/**
	 * Whether THIS server-update attempt has already been answered by an event, and
	 * whether one is running at all.
	 *
	 * A failed `update-backend` is reported twice over: once on
	 * `backend-update-error`, and once by the invoke resolving `false`. Both are
	 * true statements about one failure, so the attempt records that a terminal
	 * event arrived - completed, error, or the by-hand panel replacing the panel -
	 * and the resolved value is only read when nothing did. The ref is per attempt
	 * (rewritten when the button is pressed) so a late event from an earlier
	 * attempt cannot silence, or double-report, the one in flight.
	 *
	 * `inFlight` no longer decides WHICH surface a report lands on - the phase on the
	 * report does that (see the listener below) - but it still gates the failure
	 * panel, because a report about an attempt this panel did not start belongs to
	 * the surface that did. What the flag keeps honest is the ENDING: only an event
	 * that answers this panel's own attempt may clear the in-flight flags or claim
	 * the attempt is over, so a check's failure can no longer end "Checking for
	 * updates" early or mark an idle attempt terminal (review R1-2). A check-time
	 * message still reaches the user: it takes the toast.
	 */
	const backendUpdateAttemptRef = useRef<{
		terminal: boolean;
		inFlight: boolean;
	}>({ terminal: false, inFlight: false });

	/** True while `Install now` has been pressed and the pre-flight is running. */
	const [installing, setInstalling] = useState(false);

	// Install refusals, an install that never completed, and an install that is
	// still running. Kept apart from each other because only one of them is a
	// failure, and only one of them has an install still to save.
	const [installBlocked, setInstallBlocked] =
		useState<InstallBlockedInfo | null>(null);
	const [installFailed, setInstallFailed] = useState<InstallFailedInfo | null>(
		null,
	);
	const [installInFlight, setInstallInFlight] =
		useState<InstallInFlightInfo | null>(null);

	// Access the deferred updates store
	const { shouldShowUpdate, deferUpdate } = useDeferredUpdatesStore();

	// Keep a ref to the latest backendUpdateInfo for use in event handlers
	const backendUpdateInfoRef = useRef<BackendUpdateInfo | null>(null);
	useEffect(() => {
		backendUpdateInfoRef.current = backendUpdateInfo;
	}, [backendUpdateInfo]);

	useEffect(() => {
		window.api.systemInfo
			.getAppVersion()
			.then((version) => setAppVersion(version))
			.catch(() => setAppVersion("unknown"));
	}, []);

	/**
	 * One verdict for one update-path message, on whichever channel it arrived.
	 *
	 * WHY ONE FUNCTION. The same failure reaches this component twice - as the
	 * `update-error` event and as the rejection of the invoke the check was made
	 * through, because electron-updater emits on the updater AND rethrows - and
	 * the two producers used to decide its fate with DIFFERENT rules in the same
	 * state slot: the event path routed the legacy "manually" wording to the
	 * by-hand panel and showed everything else, while the invoke path silenced a
	 * missing release artifact and prefixed everything else with its own spelling
	 * of the failure. Which text the reader got was therefore a race between two
	 * channels carrying one failure, and a failure silenced on one channel could
	 * be painted by the other. Both callers ask this function now, so a message
	 * has ONE fate (`updateMessageFate`) and one spelling.
	 *
	 * Returns true when the message was SHOWN, so a caller can clear the flags
	 * that describe a check it was waiting on.
	 */
	const reportUpdateMessage = useCallback((message: string): boolean => {
		switch (updateMessageFate(message)) {
			case "by-hand":
				// Legacy wording from a main process that named pip for every
				// unmanaged server. No command is offered here any more: the app
				// cannot tell which installer owns an environment from a string it
				// was handed, and naming the wrong one is the defect this whole change
				// exists to fix (reviews U4, D4).
				setManualUpdateRequired(true);
				setManualUpdateInfo({
					message:
						"The server is installed outside the app, so use the tool you installed it with - uv, pipx or pip.",
					command: "",
				});
				setSnackbarOpen(true);
				return false;
			case "muted":
				/*
				 * A release with no artifact for this build is a known non-failure, so
				 * it is logged rather than painted - the same silence on both channels
				 * now, instead of on whichever one the renderer happened to observe.
				 */
				console.warn(
					`Update check reported no artifact for this build: ${message}`,
				);
				return false;
			default:
				setError(message);
				setSnackbarOpen(true);
				return true;
		}
	}, []);

	/**
	 * Check for updates.
	 *
	 * `manual` marks a check the user asked for. It travels to the main process so
	 * an explicit check can re-offer a release whose artifact failed verification:
	 * two of the refusal panels tell the user to free space or re-download and
	 * then check again, and with the suppression applied to every check that
	 * remedy was inert for the rest of the session (reviews R3, U3).
	 */
	const checkForUpdates = useCallback(
		async (options?: { manual?: boolean }) => {
			try {
				setChecking(true);
				setError(null);
				await window.api.updater.checkForUpdates(options);
			} catch (err) {
				/*
				 * The SAME verdict as the `update-error` event path above, on the same
				 * string: this rejection and that event are two reports of one failure
				 * (electron-updater emits and rethrows), so the rules that decide
				 * whether the reader is told - and what they are told - are one rule.
				 * The artifact wording used to be silenced here ALONE, while the same
				 * failure arriving as an event painted the alert, which is the race
				 * this closes.
				 *
				 * The invoke envelope is unwrapped first: Electron wraps a rejection as
				 * `Error invoking remote method '<channel>': <error>`, which is wire
				 * framing rather than a message, and it used to reach the reader with
				 * its `Error: ` inside it.
				 */
				const errorMessage = stripErrorPrefixes(unwrapIpcErrorMessage(err));
				if (updateMessageFate(errorMessage) === "muted") {
					setUpdateAvailable(false);
					setUpdateInfo(null);
				}
				reportUpdateMessage(errorMessage);
			} finally {
				setChecking(false);
			}
		},
		[reportUpdateMessage],
	);

	/**
	 * Re-check the *server*, for the panel whose copy says to.
	 *
	 * That panel's button used to call the UI-only check, so the action it named
	 * could not observe the thing it was about, and after the user did upgrade the
	 * server the panel stayed up anyway (review U2).
	 */
	const checkForAllUpdates = useCallback(async () => {
		try {
			setChecking(true);
			setError(null);
			await window.api.updater.checkForAllUpdates({ manual: true });
		} catch (err) {
			// The same verdict as every other check producer (see
			// `reportUpdateMessage`), on the unwrapped invoke message.
			reportUpdateMessage(stripErrorPrefixes(unwrapIpcErrorMessage(err)));
		} finally {
			setChecking(false);
		}
	}, [reportUpdateMessage]);

	// Download the update
	const downloadUpdate = useCallback(async () => {
		try {
			setDownloading(true);
			setError(null);
			await window.api.updater.downloadUpdate();
		} catch (err) {
			setError(
				`Error downloading update: ${stripErrorPrefixes(unwrapIpcErrorMessage(err))}`,
			);
			setDownloading(false);
			setSnackbarOpen(true);
		}
	}, []);

	/**
	 * Install the update.
	 *
	 * The pre-flight behind this call can run `codesign` over a 1 GiB bundle and
	 * hash a 350 MB artifact, and the panel used to look untouched with its
	 * primary button still live for those seconds - so the natural response to
	 * "nothing happened" was a second click, which re-entered the pre-flight and
	 * could spawn a second watchdog (review U5). The panel now shows a pending
	 * state, and the main process holds the concurrency guard.
	 */
	const installUpdate = useCallback(async () => {
		setInstalling(true);
		setError(null);
		try {
			const started = await window.api.updater.quitAndInstall();
			if (!started) {
				// Refused or already in flight: the refusal panel is the messenger, and
				// the app is still here to show it.
				setInstalling(false);
			}
		} catch (err) {
			setInstalling(false);
			setError(
				`Error starting the update: ${stripErrorPrefixes(unwrapIpcErrorMessage(err))}`,
			);
			setSnackbarOpen(true);
		}
	}, []);

	/**
	 * Quit so an install that is already running can finish.
	 *
	 * What the in-flight panel's primary action calls, and it is a plain quit
	 * rather than `Install now`: the install is already under way, and Squirrel
	 * abandons it while an instance of the app is running. Nothing is set here
	 * first, because the app is on its way out and a state update for a window
	 * that is closing is a lie about what the user will see.
	 */
	const quitForInFlightInstall = useCallback(async () => {
		try {
			await window.api.updater.quitForUpdateInstall();
		} catch (err) {
			setError(
				`Error quitting for the update: ${stripErrorPrefixes(unwrapIpcErrorMessage(err))}`,
			);
			setSnackbarOpen(true);
		}
	}, []);

	/** Open a remedy's page in the user's browser. */
	const openRemedyUrl = useCallback((url: string | undefined) => {
		if (!url) return;
		void window.api.openExternal(url);
	}, []);

	/**
	 * Answer the attempt in flight, if there is one.
	 *
	 * Every terminal event for a server update goes through here, so the two facts
	 * the ref carries - the attempt is over, and nothing is running now - are set in
	 * one place. Without the second, a check that failed minutes after an update
	 * completed would still look like an in-flight attempt and would paint a failure
	 * panel over the success notice.
	 */
	const answerBackendUpdateAttempt = useCallback(() => {
		const attempt = backendUpdateAttemptRef.current;
		if (!attempt.inFlight) return false;
		attempt.terminal = true;
		attempt.inFlight = false;
		return true;
	}, []);

	// Update the backend
	const updateBackend = useCallback(async () => {
		backendUpdateAttemptRef.current = { terminal: false, inFlight: true };
		try {
			setChecking(true);
			setUpdatingBackend(true);
			setError(null);
			/*
			 * A new attempt clears the last failure: the panel is about to be replaced by
			 * the in-flight state, and leaving the notice set would repaint it over the
			 * attempt the user just started. Nothing about a failed update is sticky.
			 */
			setBackendUpdateFailure(null);
			// The target version travels with the request so the main process can
			// confirm the restarted server actually reports it.
			const targetVersion = backendUpdateInfoRef.current?.latestVersion;
			const result = await window.api.updater.updateBackend(targetVersion);
			/*
			 * `false` is a failure, not a quiet no-op: this invoke resolves false on
			 * every failing branch, so reading only its rejection - which is what this
			 * component used to do - left "Updating server" up forever because the
			 * `catch` never ran (operator report, 2026-09-15). An event that already
			 * reported the same failure wins, so one failure is one message.
			 */
			if (result === false && !backendUpdateAttemptRef.current.terminal) {
				setBackendUpdateFailure(serverUpdateFailedMessage(targetVersion));
			}
		} catch (err) {
			if (!backendUpdateAttemptRef.current.terminal) {
				setBackendUpdateFailure(
					`The server update could not be started: ${updateErrorMessage(
						unwrapIpcErrorMessage(err),
					)}`,
				);
			}
		} finally {
			// Unconditional, and deliberately not per-branch: no path through
			// `update-backend` may leave the in-flight panel up. The error event's own
			// listener clears these too, but a main process that answered without one
			// still has to hand the panel back to the user.
			backendUpdateAttemptRef.current.inFlight = false;
			setChecking(false);
			setUpdatingBackend(false);
		}
	}, []);

	/**
	 * Close the pinned box, and forget whatever it was carrying.
	 *
	 * Closing has to clear the error as well as hide it, because the error is the
	 * half that WINS that box (see `withErrorToast`): an error left set after its
	 * message was closed would paint again the next time this component said
	 * anything, so a reader would be shown something they had already read instead
	 * of the news they had not.
	 *
	 * ONE closer for every path that closes the box, not one per path (review
	 * R3-1). The defer controls below close it as part of leaving their panel, and
	 * the first version of this cleared the error only on the toast's own
	 * dismissal - so "Update later" left a set-but-invisible error behind a closed
	 * box, with `FloatingAlert`'s auto-hide timer already cancelled alongside it.
	 * Nothing else was going to clear that state, so the next notice to raise the
	 * box (the update-completed sentence, whose toast is its only carrier) painted
	 * the superseded error in its place. An invariant enforced at one of three
	 * closers is not an invariant, so all of them go through here.
	 */
	const closeSnackbar = useCallback(() => {
		setSnackbarOpen(false);
		setError(null);
	}, []);

	// Handle deferring a backend update
	const handleDeferBackendUpdate = useCallback(() => {
		if (backendUpdateInfo) {
			deferUpdate(UpdateType.BACKEND, backendUpdateInfo.latestVersion);
			setBackendUpdateAvailable(false);
			setBackendUpdateInfo(null);
		}
		/*
		 * The box goes with the panel, and the error goes with the box - through the
		 * same closer the toast's own dismissal uses. Unconditional rather than inside
		 * the guard: the failure panel's "Update later" reaches here with no offer
		 * details set, and it is still a dismissal (review R3-1).
		 */
		closeSnackbar();
	}, [closeSnackbar, deferUpdate, backendUpdateInfo]);

	/**
	 * Dismiss a failed server update.
	 *
	 * The deferral is the same one the offer's own "Update later" performs, so a
	 * dismissal also stops the periodic checks re-offering the release the user just
	 * said not to install; without it the panel would come straight back and the
	 * button would read as broken.
	 */
	const handleDismissBackendUpdateFailure = useCallback(() => {
		setBackendUpdateFailure(null);
		handleDeferBackendUpdate();
	}, [handleDeferBackendUpdate]);

	// Handle deferring an update
	const handleDeferUpdate = useCallback(() => {
		if (updateInfo) {
			deferUpdate(UpdateType.UI, updateInfo.version);
			setUpdateAvailable(false);
			setUpdateDownloaded(false);
		}
		// Same reason as the backend deferral above: the box closes with the panel,
		// and an error cannot outlive it (review R3-1).
		closeSnackbar();
	}, [closeSnackbar, deferUpdate, updateInfo]);

	// Set up event listeners for update events
	useEffect(() => {
		// Frontend update available
		const removeUpdateAvailableListener = window.api.updater.onUpdateAvailable(
			(info) => {
				if (shouldShowUpdate(UpdateType.UI, info.version)) {
					// The offer supersedes the failure notice: the panel that explains an
					// install that did not finish would otherwise sit over the update it is
					// asking for. The durable record survives in Settings -> App updates.
					setInstallFailed(null);
					setUpdateAvailable(true);
					setUpdateInfo(info);
					setSnackbarOpen(true);
				}
			},
		);

		// Frontend update not available
		const removeUpdateNotAvailableListener =
			window.api.updater.onUpdateNotAvailable(() => {
				setUpdateAvailable(false);
				setUpdateInfo(null);
			});

		// Frontend update downloaded
		const removeUpdateDownloadedListener =
			window.api.updater.onUpdateDownloaded((info) => {
				setDownloading(false);
				if (shouldShowUpdate(UpdateType.UI, info.version)) {
					setInstallFailed(null);
					setUpdateDownloaded(true);
					setUpdateInfo(info);
					setSnackbarOpen(true);
				}
			});

		// Frontend update error - also handle manual update requirements
		const removeUpdateErrorListener = window.api.updater.onUpdateError(
			(errorMessage) => {
				/*
				 * `stripErrorPrefixes` at the boundary as well as at the paint: the state
				 * is also read by paths that do not go through `UpdateErrorAlert`, and a
				 * failure should not change its text depending on which surface it
				 * reached.
				 */
				const message = stripErrorPrefixes(errorMessage);
				if (reportUpdateMessage(message)) {
					setChecking(false);
					setDownloading(false);
				}
			},
		);

		// Backend update requires a manual command (a server the app does not own)
		const removeBackendManualRequiredListener =
			window.api.updater.onBackendUpdateManualRequired((info) => {
				// The by-hand panel replaces this one, so the attempt is answered and the
				// resolved `false` behind it must not add a second message. Answering it
				// here also clears `inFlight`, so a check that fails behind the by-hand
				// panel cannot be read as this attempt's failure.
				answerBackendUpdateAttempt();
				// The panel has to know which version it is waiting for, so it can name it
				// and clear itself once the server reaches it. The producer sends it; the
				// offer that preceded the attempt is the fallback for a producer that
				// could not name one.
				manualUpdateExpectationRef.current = {
					target:
						info.latestVersion ??
						backendUpdateInfoRef.current?.latestVersion ??
						null,
					sourceBuild: info.sourceBuild === true,
				};
				setManualUpdateRequired(true);
				setManualUpdateInfo(info);
				setChecking(false);
				setUpdatingBackend(false);
				setBackendUpdateAvailable(false);
				setBackendUpdateInfo(null);
			});

		// The app refused to start an install, or a previous one never finished
		const removeInstallBlockedListener =
			window.api.updater.onUpdateInstallBlocked((info) => {
				setInstallBlocked(info);
				setChecking(false);
				setUpdatingBackend(false);
				setDownloading(false);
			});
		const removeInstallFailedListener =
			window.api.updater.onUpdateInstallFailed((info) => {
				setInstallFailed(info);
				// The two are alternatives, never both: an install that was still
				// running when the panel went up and has now been decided is no longer
				// in flight, and leaving that panel above the failure would hide the
				// outcome the user is waiting for.
				setInstallInFlight(null);
				/*
				 * The notice explains why the app came back on the old version, and it used
				 * to be queued behind this component's own start-up check: a user watching
				 * their app reappear saw "Checking for updates..." for the whole check and
				 * nothing at all if the check never settled (review U8). The failure is not
				 * a function of the check, so it takes the panel and the check steps aside.
				 */
				setChecking(false);
			});

		// An install that is running right now: the app came back mid-install, and
		// nothing has failed yet. Same reason as the failure notice for taking the
		// panel ahead of the start-up check - the user's next move depends on it.
		const removeInstallInFlightListener =
			window.api.updater.onUpdateInstallInFlight((info) => {
				setInstallInFlight(info);
				setInstallFailed(null);
				setChecking(false);
			});

		// Frontend update progress
		const removeUpdateProgressListener = window.api.updater.onUpdateProgress(
			(progressObj) => {
				setDownloadProgress(progressObj);
			},
		);

		// Backend update available
		const removeBackendUpdateAvailableListener =
			window.api.updater.onBackendUpdateAvailable((info) => {
				/*
				 * The by-hand panel's instruction ends where its own check's answer
				 * arrives, not only where that answer is "nothing newer". This is the
				 * event a source build actually reaches: a checkout that trails the
				 * published release reports an update as available, so the panel used
				 * to stay up telling the user to run the command they had just run,
				 * behind a button that visibly did nothing (review U12, round 3).
				 *
				 * `info.manual` is the producer saying the check was the user's own,
				 * and the rule itself lives in `update-manual-state` - where tests
				 * drive it, since every wrong version of it was wrong in the rule
				 * rather than in the rendering.
				 */
				if (
					manualPanelClearedByAvailable({
						manual: info.manual,
						currentVersion: info.currentVersion,
						expectation: manualUpdateExpectationRef.current,
					})
				) {
					setManualUpdateRequired(false);
					setManualUpdateInfo(null);
					manualUpdateExpectationRef.current = {
						target: null,
						sourceBuild: false,
					};
				}
				if (shouldShowUpdate(UpdateType.BACKEND, info.latestVersion)) {
					const enhancedInfo: BackendUpdateInfo = {
						...info,
						// Trust the flag the main process sent: it is the side that
						// knows how the server was installed (a uv tool and a pipx
						// install cannot be updated from here at all). The old
						// substring test guessed from the word "manually" in a
						// legacy string, which reads `uv tool upgrade
						// local-operator` - a command we deliberately never run -
						// as one we do, and offers a button that always fails.
						canManageUpdate:
							info.canManageUpdate ?? !info.updateCommand.includes("manually"),
					};
					setBackendUpdateAvailable(true);
					setBackendUpdateInfo(enhancedInfo);
					/*
					 * A new offer SUPERSEDES the failure notice, exactly as it supersedes
					 * `installFailed` above: the check that just ran found the release again,
					 * so "this update failed" is no longer the newest thing known and the
					 * panel that carries **Update server** takes the slot back. Without
					 * this, one failed attempt hid the offer for the rest of the session -
					 * including a fresh check's own offer, which painted nothing (UX U1).
					 * The failure itself is not lost: the main process wrote it, with pip's
					 * output, to the update service log. It is NOT kept anywhere a renderer
					 * surface can read back - which is why the failure panel names no record
					 * rather than pointing at one that does not exist (UX U5).
					 */
					setBackendUpdateFailure(null);
					setSnackbarOpen(true);
				}
			});

		// Backend update not available
		const removeBackendUpdateNotAvailableListener =
			window.api.updater.onBackendUpdateNotAvailable((info) => {
				const currentInfo = backendUpdateInfoRef.current;
				setBackendUpdateAvailable((prev) => {
					// At or beyond the offer, not equal to it: a release that moved on
					// between the offer and the check is a server the app no longer needs
					// to nag about, and an exact match left the offer up in that window
					// (review U12).
					if (
						currentInfo &&
						atLeastVersion(info.version, currentInfo.latestVersion)
					) {
						setBackendUpdateInfo(null);
						return false;
					}
					return prev;
				});
				/*
				 * The by-hand panel's own instruction is "run this, then check again", so a
				 * check the user asked for is what ends it (review U2, U12). Only a
				 * user-initiated check sends this event at all - the periodic one is
				 * filtered to a silent check in the main process - so a background check
				 * can never clear the panel out from under the user, and the rule for what
				 * the answer has to say is in `update-manual-state`.
				 */
				const expectation = manualUpdateExpectationRef.current;
				if (
					expectation.target == null ||
					manualPanelClearedByCheck({
						reported: info.version,
						expectation,
					})
				) {
					setManualUpdateRequired(false);
					setManualUpdateInfo(null);
					manualUpdateExpectationRef.current = {
						target: null,
						sourceBuild: false,
					};
				}
			});

		// Backend update completed
		const removeBackendUpdateCompletedListener =
			window.api.updater.onBackendUpdateCompleted(() => {
				// The attempt this answers is over, and `terminal` keeps the resolved
				// `true`/`false` behind this event from reporting it a second time.
				answerBackendUpdateAttempt();
				setBackendUpdateAvailable(false);
				setBackendUpdateInfo(null);
				setChecking(false);
				setUpdatingBackend(false);
				setBackendUpdateCompleted(true);
				setSnackbarOpen(true);

				setTimeout(() => {
					setBackendUpdateCompleted(false);
				}, 6000);
			});

		/**
		 * A server update that failed, with the main process's own reason.
		 *
		 * The channel carries two different things, and they belong on two different
		 * surfaces. The failing branches of `UpdateService.updateBackend` report here -
		 * pip's output, the unreadable venv and the "version did not change" verdict all
		 * used to be written to a channel with no reader, and the in-flight panel had no
		 * way to learn the update was over. So do the failing branches of
		 * `checkForBackendUpdates` ("Unable to determine backend version."), which is
		 * the CHECK the user may have pressed: those are not update outcomes, and
		 * treating them as ones ended "Checking for updates" early and marked an idle
		 * attempt terminal (review R1-2).
		 *
		 * So the attempt in flight decides the surface: an attempt this panel started
		 * gets the standing failure panel and its flags cleared, and anything else is
		 * the check the user asked for and takes the toast it has always taken.
		 *
		 * The PRODUCER decides that, not the timing: the report carries the phase it
		 * was written in, so a check the user pressed on another surface - which can
		 * fail minutes into a server update, both surfaces being live - can no longer
		 * paint itself as the attempt's reason while the attempt's own sentence
		 * arrived as a toast that dismissed itself six seconds later (review R2-1,
		 * QA Q2). The attempt flag still gates the panel, because a report about an
		 * attempt this panel did not start belongs to whichever surface did.
		 */
		const removeBackendUpdateErrorListener =
			window.api.updater.onBackendUpdateError((report) => {
				if (report.phase === "update" && answerBackendUpdateAttempt()) {
					/*
					 * This channel's real strings are Node errno forms - the operator's
					 * log shows `getaddrinfo ENOTFOUND pypi.org` on the version read
					 * during a check - so it goes through the same copy as the app
					 * channel rather than being painted as the machine wrote it.
					 */
					setBackendUpdateFailure(updateErrorMessage(report.message));
					setChecking(false);
					setUpdatingBackend(false);
					return;
				}
				setError(stripErrorPrefixes(report.message));
				setSnackbarOpen(true);
			});

		// Check for updates on mount if autoCheck is true
		if (autoCheck) {
			checkForUpdates();
		}

		// Clean up event listeners
		return () => {
			removeUpdateAvailableListener();
			removeUpdateNotAvailableListener();
			removeUpdateDownloadedListener();
			removeUpdateErrorListener();
			removeUpdateProgressListener();
			removeBackendUpdateAvailableListener();
			removeBackendUpdateNotAvailableListener();
			removeBackendUpdateCompletedListener();
			removeBackendUpdateErrorListener();
			removeBackendManualRequiredListener();
			removeInstallBlockedListener();
			removeInstallFailedListener();
			removeInstallInFlightListener();
		};
	}, [
		answerBackendUpdateAttempt,
		autoCheck,
		checkForUpdates,
		reportUpdateMessage,
		shouldShowUpdate,
	]);

	/**
	 * The state's panel, with this component's error toast beside it.
	 *
	 * The toast used to BE the branch for `error`: an early return in a component
	 * whose other branches are all panels. So any error at all - a refused check, a
	 * failed download, a rejected quit - replaced the panel instead of joining it,
	 * and for the failure this control reports it removed the very surface carrying
	 * **Update server**, leaving a toast in the opposite corner whose only button was
	 * Dismiss (design D1). It is also why a fresh offer painted nothing: the offer was
	 * set, and the standing error kept it off the screen (UX U1).
	 *
	 * Every branch below renders through here, so no panel can be hidden by a toast
	 * again - which is the property, not the particular error that exposed it. The
	 * panel leads in the DOM and the toast is announced independently, so the order
	 * is an implementation detail rather than a reading order.
	 *
	 * ONE MESSAGE IN THE BOX, and the error is the one that takes it. A branch whose
	 * panel carries its own notice passes it here rather than rendering it beside
	 * this toast: `FloatingAlert` is pinned to `right-4 bottom-4 z-50`, so two of
	 * them at once is one painted over the other, and which wins is DOM order
	 * (UX U6). The notice is the half that yields because it is the half the panel
	 * already says - and because the thing that must never be hidden is the
	 * failure, which is why every panel branch was routed through here in the first
	 * place. `closeSnackbar` clears the error, so the box is free again the
	 * moment the reader has dismissed it.
	 */
	const withErrorToast = (panel: ReactNode, notice?: ReactNode) => (
		<>
			{panel}
			{error !== null ? (
				<UpdateErrorAlert
					open={snackbarOpen}
					autoHideDuration={6000}
					message={error}
					onClose={closeSnackbar}
				/>
			) : (
				notice
			)}
		</>
	);

	/*
	 * The failure notice comes before the check's own progress panel.
	 *
	 * It explains why the app came back on the old version, and it used to be
	 * queued behind this component's start-up check - so a user watching their app
	 * reappear saw "Checking for updates..." for the whole check, and nothing at
	 * all if the check never settled, because this path has no timeout (review
	 * U8). The failure is not a function of the check.
	 */
	if (installFailed) {
		return withErrorToast(
			<UpdateContainer tone="failed">
				<UpdateHeading tone="failed">
					{installFailed.cancelledByRelaunch
						? "The update was cancelled"
						: "The last update didn't finish"}
				</UpdateHeading>
				<p className="mb-2 text-body text-ink-muted">{installFailed.message}</p>
				{/* The actionable sentence at the panel's reading weight: it was set one
				    step below the explanation, so the thing to DO lost to the thing that
				    happened (review D2). */}
				<p className="mt-2 text-body text-ink">{installFailed.remedy.text}</p>
				{(installFailed.attempts ?? 1) > 1 && (
					/* The count is the new information; the sentence that used to follow it
					   repeated the remedy four lines below the remedy (review D13). */
					<p className="mt-1 text-body-sm text-ink-muted">
						Version {installFailed.targetVersion} has failed to install{" "}
						{installFailed.attempts} times on this machine.
					</p>
				)}
				{/* What survives the dismiss, and where to find it: the record is written
				    to disk and rendered in Settings, but this panel never said so, so the
				    only way to see the failure again was to already know (review U13). */}
				<p className="mt-1 text-body-sm text-ink-muted">
					This is also recorded in Settings, under Application updates.
				</p>
				<UpdateActions>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setInstallFailed(null)}
					>
						Update later
					</Button>
					{/* One click at the retry the copy names, and it has to be a check the
					    main process can tell apart from its own periodic one, or the
					    suppression keeps the release away (reviews D3, R3). */}
					<Button
						variant="outline"
						size="sm"
						onClick={() => void checkForUpdates({ manual: true })}
						disabled={checking}
					>
						{checking ? "Checking..." : "Check for updates"}
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() => openRemedyUrl(installFailed.remedy.url)}
					>
						Open download page
					</Button>
				</UpdateActions>
				{installFailed.detail && <PanelDetails detail={installFailed.detail} />}
			</UpdateContainer>,
		);
	}

	/*
	 * An install that is still running, found because this app was opened while
	 * the update was installing.
	 *
	 * Ahead of the start-up check for the same reason the failure notice is: it is
	 * the thing the user has to act on, and the action is time-sensitive - quitting
	 * is what lets Squirrel's install finish, and every second the app stays open
	 * is another second it may be cancelled. Squirrel asks once whether an instance
	 * is running and abandons the install when one is, so the secondary action is a
	 * real choice that FORFEITS the install - someone who needs the app now can keep
	 * it, at the cost of this update - and both the sentence above it and the label
	 * itself say so. The panel is announced assertively for the same reason: it is
	 * the one panel whose window closes while the user reads it (reviews D1, D3).
	 */
	if (installInFlight) {
		return withErrorToast(
			<UpdateContainer role="alert">
				<UpdateHeading>The update is still installing</UpdateHeading>
				<p className="mb-2 text-body text-ink-muted">
					{installInFlight.message}
				</p>
				<UpdateActions>
					{/* The cost is on the label, not only in the paragraph: this
					    button's chrome is the same as the ordinary notice a user has
					    learned to dismiss at a glance, and reflex-clicking a benign
					    label over a forfeited install is how the incident recurs
					    (review D1). */}
					<Button
						variant="outline"
						size="sm"
						onClick={() => setInstallInFlight(null)}
					>
						Keep using Local Operator (cancels the install)
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() => void quitForInFlightInstall()}
					>
						Quit and let the update finish
					</Button>
				</UpdateActions>
				{installInFlight.detail && (
					<PanelDetails detail={installInFlight.detail} />
				)}
			</UpdateContainer>,
		);
	}

	// If checking for updates or updating backend, show a loading indicator
	if (checking) {
		return withErrorToast(
			<UpdateContainer>
				<h2 className="mb-3 text-heading text-ink">
					{updatingBackend ? "Updating server" : "Checking for updates"}
				</h2>
				{/* No cancel control, and the panel has to say so: the copy half of
				    UX U2, whose other half - a real cancel - is deferred, because
				    stopping a live pip install and guaranteeing the server comes back
				    up is its own change. Without this a mis-press reads as a dead end. */}
				<p className="mb-2 text-body text-ink-muted">
					{updatingBackend
						? "Please wait while the server is being updated. The server will temporarily go offline while it restarts to apply the update. The update can't be interrupted once it has started."
						: "Please wait while we check for available updates..."}
				</p>
				<ProgressContainer>
					<Progress />
				</ProgressContainer>
			</UpdateContainer>,
		);
	}

	// An install the app refused to start. A panel rather than a toast: the app is
	// still running, the update is still staged, and the remedy is the point.
	if (installBlocked) {
		return withErrorToast(
			<UpdateContainer tone="failed">
				<UpdateHeading tone="failed">
					{installBlocked.heading ??
						INSTALL_BLOCK_HEADINGS[installBlocked.code] ??
						"The update wasn't installed"}
				</UpdateHeading>
				<p className="mb-2 text-body text-ink-muted">
					{installBlocked.message}
				</p>
				<p className="mt-2 text-body text-ink">{installBlocked.remedy.text}</p>
				{installBlocked.remedy.command && (
					<CommandBlock command={installBlocked.remedy.command} />
				)}
				<UpdateActions>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setInstallBlocked(null)}
					>
						{installBlocked.dismissLabel ?? "Update later"}
					</Button>
					{installBlocked.remedy.url ? (
						<Button
							variant="primary"
							size="sm"
							onClick={() => openRemedyUrl(installBlocked.remedy.url)}
						>
							Open download page
						</Button>
					) : (
						<Button
							variant="primary"
							size="sm"
							onClick={() => void checkForUpdates({ manual: true })}
							disabled={checking}
						>
							{checking ? "Checking..." : "Check for updates"}
						</Button>
					)}
				</UpdateActions>
				{installBlocked.detail && (
					<PanelDetails detail={installBlocked.detail} />
				)}
			</UpdateContainer>,
		);
	}

	// A manual backend update: a server the app does not own, so the command is
	// the whole answer and it has to stay on screen long enough to be read.
	if (manualUpdateRequired && manualUpdateInfo) {
		return withErrorToast(
			<UpdateContainer>
				<UpdateHeading>The server needs updating by hand</UpdateHeading>
				{/* Same emphasis as the other producer of this state
				    (`backend-update-non-managed`, which used a warning hue): one sentence,
				    the same weight, and the words carry which one needs the user
				    (review D5). */}
				<p className="mb-2 text-body text-ink">{manualUpdateInfo.message}</p>
				{/*
				 * The offer line follows the caveat that qualifies it. On a source
				 * build the version sentence cannot name a target the install reaches -
				 * the closing paragraph of this very panel says the version it reports
				 * afterwards is the checkout's - so reading "Server version X is
				 * available" above that paragraph promises an outcome the next line
				 * withdraws (reviews R16, D15). The qualified branch therefore puts the
				 * command and its note first and the availability line last; the branch
				 * whose offer is reachable keeps its shape, and so does the copy.
				 */}
				{manualUpdateInfo.sourceBuild === true ? (
					<>
						{manualUpdateInfo.command ? (
							<CommandBlock command={manualUpdateInfo.command} />
						) : null}
						<ManualRemedyNote
							command={Boolean(manualUpdateInfo.command)}
							sourceBuild
						/>
						{/* Its own gap, because it follows the caveat rather than the command
						    well here: without it, the offer line reads as the last sentence
						    of the paragraph above. */}
						<ManualUpdateVersions
							className="mt-2"
							latestVersion={manualUpdateInfo.latestVersion}
							currentVersion={manualUpdateInfo.currentVersion}
						/>
					</>
				) : (
					<>
						<ManualUpdateVersions
							latestVersion={manualUpdateInfo.latestVersion}
							currentVersion={manualUpdateInfo.currentVersion}
						/>
						{manualUpdateInfo.command ? (
							<CommandBlock command={manualUpdateInfo.command} />
						) : null}
						<ManualRemedyNote
							command={Boolean(manualUpdateInfo.command)}
							sourceBuild={false}
						/>
					</>
				)}
				<UpdateActions>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							setManualUpdateRequired(false);
							setManualUpdateInfo(null);
						}}
					>
						Update later
					</Button>
					{/* This button's own copy says "check again to pick up the new server
					    version", so it has to re-read the SERVER: it used to call the
					    UI-only check, which could not observe the thing the panel is about
					    (review U2). */}
					<Button
						variant="primary"
						size="sm"
						onClick={() => void checkForAllUpdates()}
						disabled={checking}
					>
						{checking ? "Checking..." : "Check for updates"}
					</Button>
				</UpdateActions>
				{manualUpdateInfo.detail && (
					<PanelDetails detail={manualUpdateInfo.detail} />
				)}
			</UpdateContainer>,
		);
	}

	// If an update is available but not downloaded yet
	if (updateAvailable && !updateDownloaded && updateInfo) {
		return withErrorToast(
			<UpdateContainer>
				<h2 className="mb-3 text-heading text-ink">Update available</h2>
				<p className="mb-2 text-body text-ink-muted">
					Version {updateInfo.version} is available. You are currently using
					version {appVersion}.
				</p>
				{updateInfo.releaseNotes && (
					// A div rather than a paragraph: GitHub's release notes arrive as
					// HTML and routinely contain block elements, which a <p> cannot
					// legally hold.
					//
					// The prose utilities are not decoration. Preflight resets
					// h1-h6 to inherited size and weight and strips list markers,
					// indent and margins, and this is the one place in the app
					// that injects third-party HTML - so without them a release
					// note, which is headings and bullets essentially always,
					// renders as a wall of identical lines. The markdown editor
					// carries the same set for the same reason.
					<div
						className={cn("mt-2 text-body text-ink-muted", RELEASE_NOTES_PROSE)}
					>
						Release notes:{" "}
						{typeof updateInfo.releaseNotes === "string" ? (
							<>
								{parse(truncateText(updateInfo.releaseNotes, 400))}
								{updateInfo.releaseNotes.length > 400 && (
									<a
										href={getReleaseUrl(updateInfo)}
										target="_blank"
										rel="noopener noreferrer"
										className="ml-2"
									>
										View full release notes
									</a>
								)}
							</>
						) : (
							<a
								href={getReleaseUrl(updateInfo)}
								target="_blank"
								rel="noopener noreferrer"
							>
								See release notes on GitHub
							</a>
						)}
					</div>
				)}

				{downloading && downloadProgress && (
					<ProgressContainer>
						<p className="text-body-sm text-ink-muted">
							Downloading: {Math.round(downloadProgress.percent)}%
						</p>
						<Progress value={downloadProgress.percent} className="mt-2" />
						<p className="mt-1 text-mono-sm text-ink-dim">
							{Math.round(downloadProgress.transferred / 1024)} KB of{" "}
							{Math.round(downloadProgress.total / 1024)} KB
						</p>
					</ProgressContainer>
				)}

				<UpdateActions>
					{!downloading && (
						<>
							{/* Dismiss first, commit last - the order every other
								    footer in the release uses, and the one a user's
								    hand learns. This component put the committing
								    button first in all three of its footers. */}
							<Button
								variant="outline"
								size="sm"
								onClick={handleDeferUpdate}
								disabled={downloading}
							>
								Update later
							</Button>
							<Button
								variant="primary"
								size="sm"
								onClick={downloadUpdate}
								disabled={downloading}
							>
								Download update
							</Button>
						</>
					)}
				</UpdateActions>
			</UpdateContainer>,
			/*
			 * The offer's own notice, in the wrapper's notice slot rather than beside
			 * the error toast: the two share one pinned box, and the wrapper is where
			 * that box is decided (UX U6).
			 */
			<FloatingAlert
				open={snackbarOpen}
				autoHideDuration={6000}
				onClose={closeSnackbar}
				variant="info"
			>
				A new update is available: v{updateInfo.version}
			</FloatingAlert>,
		);
	}

	// If an update has been downloaded
	if (updateDownloaded && updateInfo) {
		return withErrorToast(
			<UpdateContainer>
				<h2 className="mb-3 text-heading text-ink">Update ready to install</h2>
				{/* "has been downloaded", not "is available": this is the state
					    AFTER the download, and reusing the available state's
					    sentence told the user nothing had happened. The version
					    they are on stays, because that is the comparison the
					    heading does not make. */}
				<p className="mb-2 text-body text-ink-muted">
					Version {updateInfo.version} has been downloaded. You are currently
					using version {appVersion}.
				</p>
				{/* `text-body`, not a step down: this sentence is the whole
					    user-facing mitigation for the cancelled install, and it was the
					    least prominent text in the panel - a footnote under a line
					    carrying less consequence (review D2). Three sentences, not one
					    run-on whose payload trails a spliced clause (review D5). */}
				<p className="mt-2 text-body text-ink-muted">
					Installing closes the app for a few minutes while the update is
					verified and put in place. Don't reopen it until it starts by itself.
					Opening it while the update is installing cancels the install.
				</p>

				<UpdateActions>
					<Button
						variant="outline"
						size="sm"
						onClick={handleDeferUpdate}
						disabled={installing}
					>
						Update later
					</Button>
					{/* One click, then a panel that says it heard: the pre-flight behind this
						    button can take seconds over a 1 GiB bundle. */}
					<Button
						variant="primary"
						size="sm"
						onClick={() => void installUpdate()}
						disabled={installing}
					>
						{installing ? "Preparing to install..." : "Install now"}
					</Button>
				</UpdateActions>
			</UpdateContainer>,
			/* The download's own confirmation, in the wrapper's notice slot (UX U6). */
			<FloatingAlert
				open={snackbarOpen}
				autoHideDuration={6000}
				onClose={closeSnackbar}
				variant="success"
			>
				Update downloaded and ready to install
			</FloatingAlert>,
		);
	}

	/*
	 * A server update that failed, as a standing panel in the panel slot.
	 *
	 * It is the same surface `installFailed` above uses, for the same reason: the app
	 * is still on the old version, the user asked for the new one, and the next step
	 * is theirs - so the notice has to stay long enough to be read and carry the
	 * action. As a toast it was gone in six seconds, sat 625px below the panel the
	 * user was watching, and offered only Dismiss while its own copy said "then try
	 * again" with no way to (design D1, UX U1).
	 *
	 * It sits ABOVE the offer branch because it is the newer fact of the two when
	 * both are set - the offer is still available and the failure explains why it is
	 * still worth taking. A check that finds the release again clears the failure, so
	 * the offer takes the slot back rather than being hidden for the session.
	 *
	 * WHAT IT DELIBERATELY DOES NOT SAY: it names no durable record of the failure,
	 * because for a server update there is none. The Settings card's only failure
	 * record comes from `get-last-install-attempt` -> `readLastInstallAttempt`, which
	 * is written by the APP-install paths - `writePendingInstallMarker` inside the
	 * `quit-and-install` handler and the marker-recovery path - and `updateBackend`
	 * writes nothing there. The sentence this panel used to carry ("This is also
	 * recorded in Settings, under Application updates.") was true on the install
	 * panel above and false here, so following it landed the reader on an empty card
	 * - the exact nothing-to-go-on this panel exists to end (UX U5). The other
	 * pointer it could offer, the update service log, is a file no renderer surface
	 * can open (design D3/D6). A pointer is worth adding when a record exists to
	 * point at, and that is its own change.
	 */
	if (backendUpdateFailure) {
		return withErrorToast(
			<UpdateContainer tone="failed">
				<UpdateHeading tone="failed">
					The server update didn't finish
				</UpdateHeading>
				<p className="mb-2 text-body text-ink-muted">{backendUpdateFailure}</p>
				<UpdateActions>
					<Button
						variant="outline"
						size="sm"
						onClick={handleDismissBackendUpdateFailure}
					>
						Update later
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() => void updateBackend()}
					>
						Try again
					</Button>
				</UpdateActions>
			</UpdateContainer>,
		);
	}

	// If a backend update is available
	if (backendUpdateAvailable && backendUpdateInfo) {
		return withErrorToast(
			<UpdateContainer>
				<h2 className="mb-3 text-heading text-ink">Server update available</h2>
				<p className="mb-2 text-body text-ink-muted">
					Server version {backendUpdateInfo.latestVersion} is available. You are
					currently using version {backendUpdateInfo.currentVersion}.
				</p>
				<p className="mt-2 text-body-sm text-ink-muted">
					Updating the server will improve AI functionality, improve security,
					and fix bugs.
				</p>

				{backendUpdateInfo.canManageUpdate ? (
					<UpdateActions>
						<Button
							variant="outline"
							size="sm"
							onClick={handleDeferBackendUpdate}
							disabled={checking}
						>
							Update later
						</Button>
						<Button
							variant="primary"
							size="sm"
							onClick={updateBackend}
							disabled={checking}
						>
							{checking ? "Updating..." : "Update server"}
						</Button>
					</UpdateActions>
				) : (
					<>
						{/* The same treatment as the manual-required panel's sentence - one
							    weight, no hue swap. It used to be `text-warning` here and 13px
							    `text-ink-muted` there, for the same sentence, so the only thing
							    marking "this one needs you" was a colour (review D5). */}
						<p className="mt-4 text-body text-ink">
							{backendUpdateInfo.remedy ??
								"The server is installed outside the app, so use the tool you installed it with - uv, pipx or pip:"}
						</p>
						{backendUpdateInfo.updateCommand && (
							<CommandBlock command={backendUpdateInfo.updateCommand} />
						)}
						{/* The same closing sentence and the same details line as the other
							    producer of this state: a user who reached it from a version check
							    used to get the command with no explanation of what was classified,
							    and no hint that the button below re-reads the server (review U15). */}
						<ManualRemedyNote
							command={Boolean(backendUpdateInfo.updateCommand)}
							sourceBuild={backendUpdateInfo.sourceBuild === true}
						/>
						<UpdateActions>
							<Button
								variant="outline"
								size="sm"
								onClick={handleDeferBackendUpdate}
								disabled={checking}
							>
								Update later
							</Button>
							<Button
								variant="primary"
								size="sm"
								onClick={() => void checkForAllUpdates()}
								disabled={checking}
							>
								{checking ? "Checking..." : "Check for updates"}
							</Button>
						</UpdateActions>
						{backendUpdateInfo.detail && (
							<PanelDetails detail={backendUpdateInfo.detail} />
						)}
					</>
				)}
			</UpdateContainer>,
			/*
			 * The panel IS the notification here, so the toast that used to sit in the
			 * opposite corner saying the same sentence is gone - and it is gone for the
			 * state that never raised one, rather than being raised twice or not at
			 * all depending on the branch (review D8).
			 *
			 * It is the wrapper's notice slot rather than a sibling of the error toast,
			 * because the two share one pinned box (UX U6).
			 */
			backendUpdateInfo.canManageUpdate && (
				<FloatingAlert
					open={snackbarOpen}
					autoHideDuration={6000}
					onClose={closeSnackbar}
					variant="info"
				>
					A new server update is available: v{backendUpdateInfo.latestVersion}
				</FloatingAlert>
			),
		);
	}

	// If a backend update has been completed
	if (backendUpdateCompleted) {
		return withErrorToast(
			null,
			/*
			 * A completion is the one branch with no panel to carry it, so it takes the
			 * notice slot: it is a notice, and the box holds one message - the error's,
			 * if there is one (UX U6).
			 */
			<FloatingAlert
				open={true}
				autoHideDuration={6000}
				onClose={() => setBackendUpdateCompleted(false)}
				variant="success"
			>
				Server update completed successfully
			</FloatingAlert>,
		);
	}

	/*
	 * Nothing to offer: no update in play, no failure to report, no check running.
	 *
	 * The toast still renders through the wrapper, and this is the branch that
	 * carries it. Before the toast had a wrapper it was an early return of its own,
	 * so it appeared here; folding it into the panels without this last call would
	 * have dropped every message that is NOT about a panel state - a check that
	 * failed, a download that was rejected - which is a worse version of the defect
	 * being fixed (design D1, UX U1).
	 */
	return withErrorToast(null);
};

/**
 * Truncates text to a specified length and adds an ellipsis if needed
 */
const truncateText = (text: string, maxLength: number): string => {
	if (text.length <= maxLength) return text;
	return `${text.substring(0, maxLength)}...`;
};

/**
 * Gets the URL to the release notes
 */
const getReleaseUrl = (updateInfo: UpdateInfo): string => {
	if (updateInfo.releaseNotes && typeof updateInfo.releaseNotes !== "string") {
		const releaseNotesObj = updateInfo.releaseNotes as { path?: string };
		const defaultUrl = `https://github.com/damianvtran/local-operator-ui/releases/tag/v${updateInfo.version}`;
		return releaseNotesObj.path || defaultUrl;
	}

	return `https://github.com/damianvtran/local-operator-ui/releases/tag/v${updateInfo.version}`;
};
