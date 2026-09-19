import { useSuppressBrowserView } from "@shared/browser-view-policy";
import { FloatingAlert } from "@shared/components/common/floating-alert";
import { Button, Progress } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	UpdateType,
	useDeferredUpdatesStore,
} from "@shared/store/deferred-updates-store";
import {
	serverUpdateFailureReason,
	updateMessageFate,
	updateMessageOf,
} from "@shared/utils/update-error-copy";
import {
	installPhaseCopy,
	installSucceededCopy,
} from "@shared/utils/update-install-copy";
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
import { PanelDetails } from "./panel-details";
import { UpdateErrorAlert } from "./update-error-alert";
import {
	type ManualUpdateExpectation,
	atLeastVersion,
	manualPanelClearedByAvailable,
	manualPanelClearedByCheck,
} from "./update-manual-state";

/**
 * The identity of a skew reading, for the "the user has already read this" rule.
 *
 * Two readings make the key: announcing the same pair again would re-open a panel
 * the user dismissed for a fact that has not changed, while a NEW pair (a restart
 * that moved the daemon, a second install) still speaks.
 */
const skewKey = (notice: {
	installVersion: string | null;
	runningVersion: string | null;
}): string => `${notice.installVersion ?? "?"}|${notice.runningVersion ?? "?"}`;
/*
 * DELIBERATELY THE READING PAIR AND NOTHING ELSE, including whether the release was
 * read: the fact the reader dismisses is that THIS SERVER TRAILS THIS INSTALL, and a
 * later check that must not call the install current (QA round 3, Q3-1) states the
 * same fact about the same two readings. Keying on the phrasing instead would re-open
 * a panel they have already answered with the other wording.
 */

/**
 * WHAT THE RESTART PRESS COSTS, stated BEFORE the press (design D3).
 *
 * The panel that offers the restart is the one commit control in this component
 * without a cost line above it, and the rule it was breaking is this file's own:
 * `managedCostSentence` is rendered as a paragraph above `Update server` under the
 * comment "WHAT THE CLICK COSTS, before the click" (review U3). The cost is not
 * speculative here - the press runs `backend.restart()`, which is a stop and a
 * start, and the in-flight copy already says so once the press has landed and can
 * no longer be withdrawn: "the server is offline while it comes back ... and
 * anything in flight is dropped".
 *
 * THAT LAST CLAUSE IS NO LONGER TRUE AND NO LONGER SAID. A restart now waits for
 * the fleet to drain first, so what a reader gives up is TIME rather than work in
 * flight; the sentence here says the wait, and the in-flight copy says the wait
 * again in its own phase.
 *
 * ONE LEAF, TWO STATES, AND THE DIFFERENCE IS THE CLAUSE RATHER THAN A SECOND
 * SENTENCE (design D13). Two sentences would drift, so what the two arms SHARE is
 * the bound - `RESTART_OUTAGE_BOUND` - and each arm states its own half around it.
 * That split exists because the shared sentence billed a cost already paid on one
 * of the arms: the panel whose own heading is "The server did not come back after
 * the restart" was pricing the outage and the wait for a server that is already
 * offline. Spelled once is still achieved - twice, not twice stated.
 */
const RESTART_OUTAGE_BOUND = "usually a few seconds, up to half a minute";

/**
 * The cost of the restart for a server that is UP and behind the install: this
 * press is what takes it offline, and the wait is what it costs.
 *
 * IT NO LONGER PRICES DROPPED WORK. The press drains the fleet first
 * (`backend/fleet-drain.ts`), so what a reader gives up is the time the running
 * turns take to finish - stated, because a panel that promises a prompt restart
 * and then holds the button for minutes is the silence this component keeps
 * removing - and nothing in flight is cut off.
 *
 * AND IT NOW STATES THE BOUND THE PRESS IMPOSES (design D3). The offer used to
 * price the wait without saying how long it could be, so the ten-minute wait -
 * and the refusal that can follow it - appeared only AFTER the press, one batch
 * later, when neither could be withdrawn. `RESTART_DRAIN_BOUND` is the same
 * sentence fragment the draining phase carries, so the promise before the press
 * and the promise during it cannot drift into two numbers.
 *
 * AND THE SUBJECT IS NAMED (design D4). "It waits for the turns..." followed
 * three clauses about the server and read as the SERVER waiting; "The restart
 * waits" is the actor the press actually starts.
 */
const RESTART_DRAIN_BOUND =
	"The app waits up to ten minutes for the turns running on this machine to finish, then stops rather than cutting a turn short, so nothing in flight is cut off";
const RESTART_COST_SENTENCE = `Restarting puts the server offline while it comes back - ${RESTART_OUTAGE_BOUND}. ${RESTART_DRAIN_BOUND}.`;

/**
 * The cost of the SAME press on a server that is not running (design D13): the
 * outage is already a fact, so the only thing left to price is the wait for it to
 * come back - which is the half the two arms share.
 *
 * IT DOES NOT CLAIM DROPPED WORK. It used to, and the claim is not available any
 * more: the press drains the fleet before it restarts anything, so a server in this
 * state went offline over an idle machine.
 */
const RESTART_COST_SENTENCE_SERVER_DOWN = `The server is already offline, so the only cost left is the wait for it to come back - ${RESTART_OUTAGE_BOUND}.`;

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
 *
 * UPDATED for the two surfaces that now exist. The pointer sentence is only as
 * honest as the affordance under it, so both facts above are now supplied by the
 * main process rather than assumed away: every failure report carries
 * `logPath` (the log the failing branch wrote, composed where the path is
 * actually known), and the failure panel offers a button that hands it to
 * `showItemInFolder` - while a server update started before a quit now leaves the
 * marker `pending-server-update.json`, which the next launch reports once. The
 * backstop below still promises neither, because it is reached exactly when the
 * main process said NOTHING, and that is the case where the app has nothing to
 * point at (reviews QA U5, UX U6).
 */
const serverUpdateFailedMessage = (targetVersion: string | null | undefined) =>
	targetVersion
		? `The server update to ${targetVersion} did not complete.`
		: "The server update did not complete.";

/**
 * How long the press has been waiting for the fleet, in words.
 *
 * THE READING IS THE POINT, not its typography (design D3): the draining phase can
 * run to ten minutes with no other pixel on the frame moving, and the number the
 * main process already logs (`waitedMs` on the progress event) is what tells a
 * reader the app is working rather than wedged.
 *
 * WORDS RATHER THAN `12s` / `2m 10s` (design round 2, N1). The abbreviation was the
 * only one on a panel whose every other duration is spelled out - "up to ten
 * minutes" in the sentence directly above it, "a few seconds, up to half a minute"
 * in the family's restarting arm - so the one line a person reads under a wait was
 * speaking the log's shorthand beside copy that does not. The log keeps the short
 * spelling: this is the reader's line, that is the machine's.
 */
const waitElapsedLabel = (waitedMs: number): string => {
	const seconds = Math.max(1, Math.round(waitedMs / 1000));
	const unit = (value: number, name: string) =>
		`${value} ${name}${value === 1 ? "" : "s"}`;
	if (seconds < 60) return `Waiting ${unit(seconds, "second")} so far`;
	const rest = seconds % 60;
	const minutes = Math.floor(seconds / 60);
	return rest === 0
		? `Waiting ${unit(minutes, "minute")} so far`
		: `Waiting ${unit(minutes, "minute")} ${unit(rest, "second")} so far`;
};

type BackendUpdateInfo = {
	currentVersion: string;
	latestVersion: string;
	updateCommand: string;
	canManageUpdate?: boolean;
	/**
	 * Whether the install IS one of the app's own.
	 *
	 * The manual panel's closing sentence and the offer card's are chosen by this
	 * rather than by the absence of a command, because an absent command also means
	 * "the app could not tell how this was installed" - an arm where the reader does
	 * have a next step (review round 1, UX U1).
	 */
	appOwned?: boolean;
	startupMode?: string;
	/** Sentence introducing the manual command, chosen by how the server is installed. */
	remedy?: string;
	/**
	 * How the install was classified, and where it resolved to.
	 *
	 * Classification evidence only: the install/running skew that used to be
	 * appended here is now its own field, because this line renders in the Details
	 * blob while the skew belongs in the sentence above the buttons (review D3).
	 */
	detail?: string;
	/** True when the install follows a source tree on this machine. */
	sourceBuild?: boolean;
	/**
	 * The build the server SERVING this app reports, when it was readable.
	 *
	 * `currentVersion` is the install on disk - the thing an update moves - so the
	 * two differ between a landed install and the restart, and on every daemon the
	 * app did not start. The panel names both when they differ (reviews R1-2, D3).
	 */
	runningVersion?: string | null;
	/**
	 * Whether the app may restart the daemon serving this app.
	 *
	 * The reading every sentence on this panel that promises a restart is
	 * decided by (UX U9, U13): the offer's consequence and the install phase's
	 * own sentence both used to be chosen by the INSTALL's layout, which cannot
	 * know who started the server. Absent means an older main process, which
	 * takes the app-owned answer - see `serverRestartsWithInstall`.
	 */
	restartable?: boolean;
	/**
	 * Whether the press behind this offer restarts the server (see the main process's
	 * own field of the same name). Distinct from `restartable`, which answers whether
	 * the app STARTED the daemon: on a generation install the press installs beside
	 * the running build and does not bounce anything, so the sentences that promise a
	 * restart ask this one.
	 */
	restartsServer?: boolean;
	/**
	 * Whether the environment `update-backend` would move is the app's OWN one.
	 *
	 * The second ownership reading (design D5), and the one the skew panel's control
	 * needs: `restartable` says the daemon serving this app is the app's to bounce,
	 * which is also true in GLOBAL_INSTALL mode, while this says the press behind the
	 * action runs the app's own publish-and-restart rather than an install's updater.
	 * Absent is NOT a yes - see the skew panel's notice.
	 */
	appOwnedEnvironment?: boolean;
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
	/**
	 * The version the INSTALL on disk reports, when it is not the running one.
	 *
	 * `currentVersion` is the daemon serving the conversation on this payload, so
	 * when the two differ the panel names both rather than presenting the install's
	 * version as the one the reader is using (review D3).
	 */
	installVersion?: string | null;
	/** True when the install follows a source tree on this machine. */
	sourceBuild?: boolean;
	/**
	 * Whether this install is one of the app's own - see `BackendUpdateInfo`.
	 *
	 * The manual-required event is the second door into the same state, and the
	 * closing line is a property of the STATE rather than of the door: both
	 * producers of an app-owned install have to suppress it (review round 1, UX U1).
	 */
	appOwned?: boolean;
};

/** Headings for the refusal states, sentence case, one line each. */
const INSTALL_BLOCK_HEADINGS: Record<string, string> = {
	"installed-bundle-not-sealed": "This app can't update itself",
	"download-verification-failed": "The update couldn't be verified",
	"artifact-metadata-missing": "The update couldn't be verified",
	"insufficient-disk-space": "Not enough disk space to update",
	// The refusal for an artifact macOS would not launch (the 0.29.6 class: a
	// restricted entitlement with no provisioning profile behind it). It is
	// deliberately in the user's terms rather than the OS's — the detail line
	// carries the entitlement and the profile path for whoever reads the log.
	//
	// This heading is the map's entry for the arm that ESTABLISHED the refusal. The
	// other arm of the same code — the signature could not be read at all, so macOS
	// was never shown to refuse anything — carries its own `heading` from its
	// producer, because "the update can't be launched" is the one thing that arm
	// does not know (design round 1, D3).
	"artifact-cannot-launch": "The update can't be launched",
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
	 *
	 * AND IT IS BOUNDED TO THE VIEWPORT, which `fixed` alone does not do. Every
	 * panel here was as tall as its content with `overflow-y: visible`, so any
	 * state taller than the window had its tail painted below the fold with no
	 * scroll container anywhere that could reach it (design round 1, D1: the
	 * app-owned offer card measured 609px against a 572px minimum-window viewport,
	 * and the line naming the install the check judged was unreachable and
	 * uncopyable on a window the app itself permits). The cap is one margin down
	 * from the viewport - the same `top-4` the card is pinned by, so the card's own
	 * bottom edge lands 16px above the window edge instead of past it - and it
	 * applies to every panel rather than to the one that was measured, because the
	 * class is a property of a fixed card and not of this state.
	 *
	 * `p-4` is what keeps the focus outlines off the scroll edge: `overflow-y: auto`
	 * makes the cross axis compute to `auto` too, and a ring drawn AT the card's
	 * padding box would be clipped by it - 16px of padding is wider than the ring.
	 */
	useSuppressBrowserView(true, "update-notice");
	return (
		<div
			role={role ?? (tone === "failed" ? "alert" : "status")}
			className={cn(
				"fixed top-4 right-4 z-50 w-100 max-w-[calc(100vw-2rem)]",
				"max-h-[calc(100vh-2rem)] overflow-y-auto",
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
 * The installer's own output, quoted under the sentence that summarises it.
 *
 * WHY IT IS NOT ONE PARAGRAPH: the producer hands over the sentence and the tail
 * separated by a blank line, with the tail's lines holding uv's own two-space
 * `  Caused by:` nesting - which is the only thing in the block that tells a
 * reader whether they hit a network problem or a disk problem. Rendered into a
 * single `<p>` the blank line vanished and the sentence swallowed the machine
 * voice, so the whole point of carrying the tail was lost (reviews D1, U5).
 * `whitespace-pre-wrap` preserves both the break and the indentation, which
 * `pre-line` would keep the first of and drop the second.
 */
export const InstallerOutput = ({ output }: { output: string }) => {
	const [copied, setCopied] = useState(false);
	return (
		<div className="mt-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-meta text-ink-dim">Installer output:</span>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						void navigator.clipboard
							.writeText(output)
							.then(() => setCopied(true))
							.catch(() => undefined);
					}}
				>
					{copied ? <Check /> : <Copy />}
					{copied ? "Copied" : "Copy output"}
				</Button>
			</div>
			<pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-sunken p-2 font-mono text-mono-sm text-ink-dim">
				{output}
			</pre>
		</div>
	);
};

/**
 * Split a failure report into its sentence and the installer's output.
 *
 * The producer writes them as `sentence\n\ntail`, and the contract is one blank
 * line: everything after the first one is machine voice. Absent a blank line the
 * whole message is the sentence, which is the shape every report without a tail
 * already has.
 */
export const splitInstallerOutput = (
	message: string,
): { sentence: string; output: string | null } => {
	const index = message.indexOf("\n\n");
	if (index === -1) return { sentence: message, output: null };
	const output = message.slice(index + 2).trim();
	return {
		sentence: message.slice(0, index),
		output: output.length > 0 ? output : null,
	};
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
	appOwned = false,
}: {
	/** Whether a command well was rendered above this note. */
	command: boolean;
	sourceBuild: boolean;
	/**
	 * Whether the command-less install is one the APP owns.
	 *
	 * The third arm, and the reason it is a field rather than a reading of
	 * `!command`: an empty command has two producers with opposite next steps. The
	 * unclassifiable install kept the closing line below, which is honest there -
	 * the reader has the tool they installed it with, and a re-check observes the
	 * change. An install under the app's own managed tree has no such step: the
	 * sentence above it now names the one route that exists (let the app start the
	 * server itself), and this component used to append the manual panel's
	 * "then check for updates again to pick up the new server version" under it -
	 * an instruction whose antecedent had gone and whose action could not move the
	 * environment, which four presses of either control proved by producing a
	 * byte-identical screen (review round 1, UX U1; R5). So on this arm: nothing,
	 * deliberately, rather than a sentence that asks for a press that cannot help.
	 */
	appOwned?: boolean;
}) => {
	if (appOwned) return null;
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
				? /*
					 * WHAT THE NAMED COMMAND DOES TO THIS INSTALL, which is the one thing this
					 * note has to get right: the sentence here used to say `lop update`
					 * "rebuilds the server from this machine's checkout", which was true of the
					 * remedy the panel then named (`lop-update`, the release owner's script)
					 * and false of the one it names now. A source-build user following it
					 * silently lost the checkout they were following, while the same panel's own
					 * Details line said the opposite (review D2, UX U2). The harness settles it:
					 * `git_snapshot_notice()` prints "this runtime was built from git; lop update
					 * will replace it with the PyPI wheel".
					 */
					"Run this in a terminal. This install was built from this machine's checkout, so `lop update` installs the published release over it - and if this machine has `lop-update`, the script that rebuilds this install from the checkout, run that afterwards to keep following it."
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
/**
 * A version reading, when it is one a reader can be shown.
 *
 * Both version fields arrive from the main process as `string | null`, and the
 * old-server branch of the `/health` read answers the literal `"Unknown"` - so a
 * sentence built on either has to refuse that rather than print it. Mirrors
 * `isReadableVersion` on the main side; the renderer cannot import it (that
 * module is main-only) and duplicating the GRAMMAR would be a second answer to
 * "is this a version" - what is duplicated here is only the guard, and it is
 * deliberately loose: these strings are displayed, never compared.
 */
const READABLE_VERSION = /^\d+\.\d+/;

const readableVersion = (value: string | null | undefined): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return READABLE_VERSION.test(trimmed) ? trimmed : null;
};

/**
 * The version sentence, which names BOTH readings when they disagree.
 *
 * `installVersion` is the install on disk - what an update would move - and it
 * used to be rendered alone as "the version you are currently using"
 * (`update-service.ts` used to send the install reading as `currentVersion`),
 * which is false for every state this change creates: an install that has moved
 * ahead of the daemon still serving the conversation. Settings reads that daemon,
 * so the sentence the user could check was wrong by exactly the difference the
 * update path exists to publish, and the correction lived in the mono Details
 * blob (review D3, UX U1).
 *
 * When the two readings agree the sentence does not grow: an ordinary offer reads
 * exactly as it always did.
 */
/**
 * WHETHER THIS MACHINE'S SERVER MOVES WITH THE INSTALL (UX U9, U13).
 *
 * `restartable` is the app's answer to "is the daemon serving this app one the app
 * started?", and it is the only thing that decides whether a restart is coming.
 * The plan cannot answer it - it classifies the INSTALL - and the managed arm is
 * chosen by the install's LAYOUT, so every sentence that promised a restart was
 * true only on the layout the app happens to spawn on. Two rounds of copy fixes
 * each fixed one surface and left the next one promising the same thing (the
 * offer, then the in-flight install panel), so the reading lives here and every
 * sentence that used to assume a restart asks this instead.
 *
 * `undefined` - an older main process sends no reading - takes the app-owned
 * answer: the app spawns the daemon it attaches to whenever it can, and that is
 * the state this copy was written for.
 */
const serverRestartsWithInstall = (
	info:
		| {
				restartable?: boolean;
				restartsServer?: boolean;
		  }
		| null
		| undefined,
): boolean => info?.restartsServer ?? info?.restartable !== false;

/**
 * WHAT THE CLICK COSTS, chosen by who would actually be restarted (UX U9).
 *
 * The sentence the plan carries is the app-owned one, and the plan cannot know
 * ownership: it classifies the INSTALL. On a machine where discovery adopted a
 * server, the offer therefore promised a restart and its cost - a cost that cannot
 * be incurred there, and one the app's own completion notice denies four minutes
 * later ("Local Operator does not restart a server it did not start"). So the arm
 * reads the ownership flag the event carries (`restartable`, and the press's own
 * `restartsServer` beside it) and says what happens to the server the reader is
 * talking to:
 *
 * - app-owned: the wait and the restart, before the press (review U3).
 * - adopted: the install moves, the server keeps serving the old build until it
 *   restarts on its own, and nothing in flight is dropped.
 * - unstated (an older main process sends no reading): see
 *   `serverRestartsWithInstall`, which owns that rule for every surface.
 */
const managedCostSentence = (info: {
	restartable?: boolean;
	remedy?: string;
}): string => {
	if (!serverRestartsWithInstall(info)) {
		return "The app updates this install itself. The server you are using was started outside Local Operator, so it keeps running the old build until it restarts, and nothing in flight is dropped.";
	}
	return (
		info.remedy ??
		"The app updates this install, waits for the turns running on this machine to finish, and then restarts the server it started, so nothing in flight is cut off."
	);
};

const backendVersionSentence = ({
	latestVersion,
	installVersion,
	runningVersion,
}: {
	latestVersion: string;
	/** Null when the caller has no install reading. */
	installVersion?: string | null;
	/** Null when the daemon could not be read, or does not answer versions. */
	runningVersion?: string | null;
}): string => {
	const install = readableVersion(installVersion);
	const running = readableVersion(runningVersion);
	if (install && running && install !== running) {
		return `Server version ${latestVersion} is available. The install on this machine is at ${install}, and the server you are using is running ${running} until it restarts.`;
	}
	/*
	 * With nothing to distinguish, the sentence names the reading the panel has
	 * always named - what the reader is using, which is the daemon when both are
	 * known and either one when only one is. `latestVersion` is not interpolated
	 * unchecked: it is the published version the offer is built around.
	 */
	const shown = running ?? install;
	return shown
		? `Server version ${latestVersion} is available. You are currently using version ${shown}.`
		: `Server version ${latestVersion} is available.`;
};

const ManualUpdateVersions = ({
	latestVersion,
	runningVersion,
	installVersion,
	className,
}: {
	latestVersion?: string | null;
	/** The build the server serving this app is on, when it is readable. */
	runningVersion?: string | null;
	/** The version the INSTALL on disk reports, when the caller knows it. */
	installVersion?: string | null;
	/** Spacing the caller owns when this line does not follow its usual sibling. */
	className?: string;
}) => {
	if (!latestVersion) return null;
	return (
		<p className={cn("mb-2 text-body text-ink-muted", className)}>
			{backendVersionSentence({
				latestVersion,
				installVersion,
				runningVersion,
			})}
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
	const [rebuildInFlight, setRebuildInFlight] = useState(false);
	const [backendUpdateFailure, setBackendUpdateFailure] = useState<{
		/** The main process's own sentence. */
		message: string;
		/** The installer's own lines, when the failing branch had any to send. */
		installerOutput?: string;
		/**
		 * The update service log the failing branch wrote, when it named one.
		 *
		 * The panel's sentence points at that log, so the pointer is only honest if
		 * the surface can open it: the path is composed in the main process (the
		 * platform's user-data location, or the launch's own override) and a renderer
		 * that derived it would name the operator's file during a scratch run
		 * (review U5).
		 */
		logPath?: string;
		/**
		 * Set when this is a REFUSAL rather than a failure (design D1): the fleet did
		 * not drain and the app chose not to touch the server. The two land on the
		 * same panel and are different events, so the producer says which it sent
		 * rather than a renderer guessing it from the wording.
		 */
		refusal?: {
			because: "busy" | "unknown";
			/**
			 * How long the PRESS waited before it stopped - the same number the reading
			 * showed while it waited, not the leg's own share of it (design round 2, D9).
			 */
			waitedMs: number;
			command: string | null;
			credentialsRefused: boolean;
			/**
			 * Whether the install had already landed when the refusal was composed.
			 *
			 * The restart-leg refusals happen after the build is on disk and only the
			 * bounce was held back, so the heading keys on this rather than claiming the
			 * update never started (design round 2, D6). Optional, so an older producer's
			 * report still renders - as the install-less arm, which is the arm whose
			 * sentence an absent field has always accompanied.
			 */
			installLanded?: boolean;
		};
	} | null>(null);
	const [backendUpdateAvailable, setBackendUpdateAvailable] = useState(false);
	const [backendUpdateInfo, setBackendUpdateInfo] =
		useState<BackendUpdateInfo | null>(null);
	const [backendUpdateCompleted, setBackendUpdateCompleted] = useState(false);
	/**
	 * The two readings a finished - or refused - update left behind.
	 *
	 * Standing state rather than a toast, because both facts it carries are about a
	 * server that is still SERVING and still OLD: an install that moved onto a daemon
	 * this app adopted and deliberately did not bounce (`restarted: false`), or an
	 * attempt that landed after the app was gone (`unattended`). The completion toast
	 * said "completed successfully" over both, and the install being latest means no
	 * later check ever re-offers the update, so nothing else on any surface corrects
	 * it (reviews R1-3, UX U1/U6, QA Q-1/Q-2).
	 */
	const [backendSkewNotice, setBackendSkewNotice] = useState<{
		/** The install on disk, and the build the server is actually on. */
		installVersion: string | null;
		runningVersion: string | null;
		/** The install moved but nothing restarted the daemon serving this app. */
		notRestarted: boolean;
		/** The attempt landed while no app was watching it (UX U6). */
		unattended: boolean;
		/**
		 * Whether the check that raised this notice READ the published release.
		 *
		 * False is the offline path (QA round 3, Q3-1): the pair is measured locally, so
		 * an offline machine can still be told its daemon is a build behind, but nothing
		 * on that pass compared the install against a release - so the sentence may not
		 * call the install current. Defaults to true: a producer that does not say read
		 * it, which is every other arrival here.
		 */
		releaseRead: boolean;
		/**
		 * Whether the app may restart the daemon that is behind.
		 *
		 * It decides the "what to do" line, and the two cases are opposite: an owned
		 * daemon is the app's to bounce (so the reader has an action), while an adopted
		 * one is not (so the sentence is a fact about what to expect). Defaults to true
		 * - a producer that does not say is the app's own daemon.
		 */
		restartable: boolean;
		/**
		 * Whether the environment this app's update path moves is its OWN managed one.
		 *
		 * The SECOND ownership reading, and it is not the same question as
		 * `restartable`: that one asks who started the DAEMON (true on a global install
		 * the app spawned a daemon from), while this one asks whose INSTALL the press
		 * would move. The panel's control is a publish-and-restart that only the
		 * app-owned arm performs, so the control takes both (design D5). Absent is NOT
		 * a yes here, unlike `restartable`: an action needs a stated reason to exist.
		 */
		appOwnedEnvironment: boolean;
		/**
		 * Which fact the panel is stating, which decides its heading and its first
		 * paragraph: a landed update onto a daemon that did not move (`landed`), an
		 * install already current whose daemon trails it (`up-to-date`), or the app's
		 * own restart that left the server with no reading at all (`restart-failed`,
		 * UX U1).
		 */
		kind: "landed" | "up-to-date" | "restart-failed";
	} | null>(null);
	/**
	 * The skew the user has already waved away, by reading.
	 *
	 * A daemon this app did not start keeps trailing the install, so every non-silent
	 * check re-reports the same pair; without this the panel would re-open on a state
	 * the user has read and dismissed, which is the nagging shape the offer's own
	 * defer rule exists to avoid. Keyed by the two readings, so a NEW skew still
	 * speaks.
	 */
	const dismissedSkewRef = useRef<string | null>(null);
	/** Which phase the running update is in, announced as it changes (UX U4). */
	const [backendUpdatePhase, setBackendUpdatePhase] = useState<
		"draining" | "installing" | "restarting" | null
	>(null);
	/**
	 * How long the press has been waiting for the fleet, in milliseconds.
	 *
	 * THE ONE THING THAT MOVES ON A DRAINING FRAME (design D3). The wait can run to
	 * ten minutes while the panel is otherwise byte-identical from the first second
	 * to the last - same heading, same rule, same ink - so a reader cannot tell a
	 * working wait from a hung app. The main process logs this number already; the
	 * panel had none of it. Null when no wait has been reported (every other phase,
	 * and an older producer).
	 */
	const [backendUpdateWaitedMs, setBackendUpdateWaitedMs] = useState<
		number | null
	>(null);
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

	/**
	 * Which step the pressed install is on, and what just landed.
	 *
	 * The pre-quit work is the longest wait this surface ever shows (a `codesign`
	 * over the installed bundle, a full extraction and a seal probe), so this line -
	 * not the button - is what says which of those is happening (UX U5, U8). The
	 * affirmation is the other half of the same change: a fast install's window is
	 * seconds, so the app coming back no longer tells the user their update went in
	 * (UX U4).
	 *
	 * Reset at the start of every attempt (see `installUpdate`): this state outlives
	 * a refused attempt, and a second press that rendered the previous attempt's
	 * last step until the first event arrived would be naming a step nobody asked
	 * about - the same rule the copy module states for an unknown phase.
	 */
	const [installPhase, setInstallPhase] = useState<
		"verifying" | "staging" | "starting" | null
	>(null);
	const [installSucceeded, setInstallSucceeded] = useState<string | null>(null);

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
		async (options?: { manual?: boolean; keepFailure?: boolean }) => {
			try {
				setChecking(true);
				/*
				 * A CHECK THE FAILURE CARD ITSELF STARTED DOES NOT BLANK THE CARD: it stays
				 * up with its own button in the in-progress state while the app's 1 s + 3 s
				 * retry ladder runs, because clearing `error` first unmounted it for those
				 * four seconds with nothing else on screen saying a check was running - so a
				 * person could not tell "it is working" from "it is fixed" (UX round 2, U7).
				 * A check that SUCCEEDS clears it below; every other caller still starts from
				 * a clean box.
				 */
				if (options?.keepFailure !== true) setError(null);
				await window.api.updater.checkForUpdates(
					/*
					 * The reporting fact is forwarded as it always was, and NOTHING ELSE:
					 * `keepFailure` is this component's own bookkeeping, and a payload that
					 * carries it would be a second thing for main to read and ignore.
					 */
					options?.manual === undefined
						? undefined
						: { manual: options.manual },
				);
				if (options?.keepFailure === true) setError(null);
			} catch (err) {
				/*
				 * ONLY A CHECK THE USER ASKED FOR REPORTS (the operator's rule of
				 * 2026-09-16). This callback serves two callers: the mount effect, which
				 * is the app's own start-up check, and the panels' buttons. A start-up
				 * check's failure is logged by main and shown nowhere - and the defer
				 * listeners above mean the mount check still gets its events, so nothing
				 * about stale state changes here.
				 */
				if (options?.manual !== true) return;
				/*
				 * The SAME verdict as the `update-error` event path above, on the same
				 * string: this rejection and that event are two reports of one failure
				 * (electron-updater emits and rethrows), so the rules that decide
				 * whether the reader is told - and what they are told - are one rule.
				 * The artifact wording used to be silenced here ALONE, while the same
				 * failure arriving as an event painted the alert, which is the race
				 * this closes.
				 *
				 * The invoke envelope and the nested `Error: ` prefixes come off in one
				 * call (`updateMessageOf`): Electron wraps a rejection as `Error invoking
				 * remote method '<channel>': <error>`, which is wire framing rather
				 * than a message, and it used to reach the reader with its `Error: `
				 * inside it.
				 */
				const errorMessage = updateMessageOf(err);
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
			// `reportUpdateMessage`), on the message `updateMessageOf` unwraps.
			reportUpdateMessage(updateMessageOf(err));
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
			setError(`Error downloading update: ${updateMessageOf(err)}`);
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
		// The previous attempt's last step, if it had one: a phase is a fact about ONE
		// attempt, and this state survives a refusal (UX U8).
		setInstallPhase(null);
		try {
			const started = await window.api.updater.quitAndInstall();
			if (!started) {
				// Refused or already in flight: the refusal panel is the messenger, and
				// the app is still here to show it.
				setInstalling(false);
			}
		} catch (err) {
			setInstalling(false);
			setError(`Error starting the update: ${updateMessageOf(err)}`);
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
			setError(`Error quitting for the update: ${updateMessageOf(err)}`);
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

	/**
	 * Put an install/running skew on screen, unless the user has already read it.
	 *
	 * THE ONE PLACE the skew is rendered, for three arrivals: a landed update onto a
	 * daemon the app adopted (R1-3, U1), a check whose install is current while its
	 * daemon is not (Q-1), and an attempt that landed after the app was gone (U6).
	 * All three are the same fact - the install on disk is not the build serving this
	 * conversation - and the same consequence: only a restart of that process closes
	 * the gap, and the app deliberately does not restart a daemon it did not start.
	 * A FOURTH arrival rides it and is a different fact on the same surface: the
	 * app's own restart finished and the server did not come back, which has a
	 * consequence of its own (no reading is obtainable until it is running) and its
	 * own heading, and which must not degrade into the success toast (UX U1).
	 *
	 * DEDUPED BY READING: a daemon nobody restarts keeps trailing the install, so
	 * every non-silent check re-reports the identical pair. Re-opening a panel the
	 * user has dismissed for a fact they have already read is the nagging shape the
	 * offer's own defer rule exists to avoid, while a NEW reading still speaks.
	 */
	const announceBackendSkew = useCallback(
		(notice: {
			installVersion: string | null;
			runningVersion: string | null;
			notRestarted: boolean;
			unattended: boolean;
			restartable: boolean;
			releaseRead: boolean;
			appOwnedEnvironment: boolean;
			kind: "landed" | "up-to-date" | "restart-failed";
		}): boolean => {
			const install = readableVersion(notice.installVersion);
			const running = readableVersion(notice.runningVersion);
			/*
			 * SILENT UNLESS THERE ARE TWO READINGS THAT DIFFER, which is the rule the skew
			 * sentence itself was built on when it lived in the main process: a clause
			 * about a daemon built on a missing reading invents a disagreement, and one
			 * built on two EQUAL readings is a false alarm - the panel would head a
			 * machine where install and daemon are both 0.56.2 with "The server is on an
			 * older build than the install". This rig produced exactly that (a check that
			 * follows an already-current install carries `runningVersion` equal to
			 * `version`), which is why the guard is here rather than at each caller: the
			 * three arrivals are one sentence, and the sentence is silent unless it has
			 * something to say.
			 *
			 * NO ARRIVAL IS EXEMPT, and the unattended one is why that is now stated
			 * rather than assumed (UX U14). It used to be: its running reading travelled
			 * as null BY CONSTRUCTION, so the guard would have muted the one news the
			 * event carried. The producer reads the serving daemon now, so the exemption
			 * has the opposite effect - on the ordinary graceful-quit path the app comes
			 * back and starts its daemon from the landed install, both readings agree,
			 * and the exemption was the only thing painting "The server is on an older
			 * build than the install" over a machine whose Settings row read the new
			 * version one second later. A reading that cannot be taken is silence for
			 * the same reason: this panel may not claim a skew it cannot see.
			 *
			 * ONE KIND IS THE EXCEPTION, and it is not really one (UX U1). "The app's own
			 * restart finished and the server did not answer" is a fact the app
			 * established by performing the restart ITSELF - `start()` failed, or the
			 * health probe after it never came back - so the reading is missing BECAUSE of
			 * the news rather than for want of one: the truth of this arm is that nothing
			 * is serving the conversation. Declining here sent the completion to its
			 * fall-through success toast ("Server update completed successfully") about a
			 * server that is not running, which is the one sentence the whole line of work
			 * exists to remove. So the arm states its own fact and needs no comparison;
			 * a readable reading that also DIFFERS is still the ordinary skew, and one
			 * that AGREES with the install is still silence, because then the server did
			 * answer onto the new build and nothing is wrong.
			 *
			 * AND ONLY WHEN THE SERVER IS THE OLDER SIDE (review round 2, T1's back half).
			 * The producer now sends the PROCESS's own reading rather than `/health`'s, so
			 * this funnel can be handed a pair where the daemon is AHEAD of the install -
			 * a build newer than what is on disk (a downgrade, or a leftover record from a
			 * newer build), which `backend-version-drift.ts` refuses to act on for exactly
			 * the same reason (`running-ahead`: "restarting there would replace a newer
			 * serving process with an older install"). Inequality alone is not a skew:
			 * every sentence below this heading is about a server BEHIND the install, so
			 * the same falsity the equal-pair guard removes would come back one-sided.
			 *
			 * The two rules meet in the ONE arm that has no reading to compare, and this
			 * is where they are reconciled: the restart-failed arm is exempt from the
			 * missing-reading guard above because its missing reading IS its news (UX U1),
			 * so the order test cannot be asked of it - there is no version to order. It is
			 * therefore asked only of a reading that exists, and a daemon that answered
			 * AHEAD of the install is still refused exactly as the paragraph above states.
			 */
			const restartFailed = notice.kind === "restart-failed";
			if (
				!install ||
				(!running && !restartFailed) ||
				(running !== null && install === running)
			) {
				return false;
			}
			if (running !== null && atLeastVersion(running, install)) return false;
			const key = skewKey(notice);
			if (dismissedSkewRef.current === key) return false;
			setBackendSkewNotice(notice);
			/*
			 * WHETHER IT SPOKE, because one caller must not be left mute by a
			 * decline (review R2-3). The completion path used to `return` past its
			 * toast whenever this funnel was reached, so a successful install over an
			 * adopted daemon whose `/health` read failed - declined here, correctly,
			 * for want of a reading - ended with no toast, no notice and no error: the
			 * panel simply went idle. Silence on success is the one outcome this panel
			 * must not produce, so the caller asks.
			 */
			return true;
		},
		[],
	);

	/**
	 * Run a server update attempt, optionally at a release the caller names.
	 *
	 * The override exists for the one press that has no OFFER behind it: the skew
	 * notice renders on the state where the install is already the published release
	 * and only the daemon serving this app is behind, so there is no
	 * `backendUpdateInfo` to read a target from - and the target is the install's own
	 * version, which is what the restart has to land on (UX U2).
	 */
	const updateBackend = useCallback(async (targetOverride?: string | null) => {
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
			const targetVersion =
				targetOverride ??
				backendUpdateInfoRef.current?.latestVersion ??
				undefined;
			const result = await window.api.updater.updateBackend(targetVersion);
			/*
			 * `false` is a failure, not a quiet no-op: this invoke resolves false on
			 * every failing branch, so reading only its rejection - which is what this
			 * component used to do - left "Updating server" up forever because the
			 * `catch` never ran (operator report, 2026-09-15). An event that already
			 * reported the same failure wins, so one failure is one message.
			 */
			if (result === false && !backendUpdateAttemptRef.current.terminal) {
				setBackendUpdateFailure({
					message: serverUpdateFailedMessage(targetVersion),
				});
			}
		} catch (err) {
			if (!backendUpdateAttemptRef.current.terminal) {
				setBackendUpdateFailure({
					/*
					 * The app's own sentence leads and the machine's words are its
					 * tail: this string is a panel heading, and running the caught
					 * value through `updateErrorMessage` here would weld a SECOND
					 * sentence - about the check - onto a sentence about the update
					 * that was pressed.
					 */
					message: `The server update could not be started: ${updateMessageOf(err)}`,
				});
			}
		} finally {
			// Unconditional, and deliberately not per-branch: no path through
			// `update-backend` may leave the in-flight panel up. The error event's own
			// listener clears these too, but a main process that answered without one
			// still has to hand the panel back to the user.
			backendUpdateAttemptRef.current.inFlight = false;
			setChecking(false);
			setUpdatingBackend(false);
			/*
			 * The phase is part of the in-flight panel, so it is cleared here with the
			 * flags that put it up (review R2-5). It used to be reset only by the two
			 * listeners that carry one - the completed event and an update-phase error
			 * report - so an attempt answered through the manual-required or
			 * not-available surface left `"installing"`/`"restarting"` set, and the
			 * NEXT attempt's panel opened on the previous attempt's sentence until its
			 * own first progress event arrived.
			 */
			setBackendUpdatePhase(null);
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
				const message = updateMessageOf(errorMessage);
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

		// The step the install the user just started is on, and the install that
		// landed. Neither is a state of the update CHECK, so neither touches
		// `checking`: one describes work the user asked for and is watching, the
		// other is the outcome of the previous one.
		const removeInstallProgressListener =
			window.api.updater.onUpdateInstallProgress((info) => {
				setInstallPhase(info.phase);
			});
		const removeInstallSucceededListener =
			window.api.updater.onUpdateInstallSucceeded((info) => {
				setInstallSucceeded(info.version);
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
				/*
				 * QA Q-1: with the install already current there is no offer to carry the
				 * skew, so this is the ONLY state that can - and it carried nothing, which
				 * left a user whose runtime lags the install told nothing at all, with no
				 * later check able to re-offer, because the install itself is up to date.
				 * The producer now sends the daemon's reading on this event too.
				 */
				if (readableVersion(info.runningVersion)) {
					announceBackendSkew({
						installVersion: info.version,
						runningVersion: info.runningVersion ?? null,
						notRestarted: true,
						unattended: false,
						restartable: info.restartable !== false,
						/*
						 * The offline check sends this event with the pair it measured locally and
						 * nothing to compare the install against, so it says so (QA round 3, Q3-1).
						 * Absent means read, which is every other producer of this event.
						 *
						 * Stated, not assumed (design D5): the press this panel may offer runs
						 * `update-backend`, which on a global install is the install's own updater
						 * rather than a restart, so the control needs this arm's own yes.
						 */
						releaseRead: info.releaseRead !== false,
						appOwnedEnvironment: info.appOwnedEnvironment === true,
						kind: "up-to-date",
					});
				}
			});

		// Backend update completed
		const removeBackendUpdateCompletedListener =
			window.api.updater.onBackendUpdateCompleted((completion) => {
				// The attempt this answers is over, and `terminal` keeps the resolved
				// `true`/`false` behind this event from reporting it a second time.
				answerBackendUpdateAttempt();
				setBackendUpdateAvailable(false);
				setBackendUpdateInfo(null);
				setChecking(false);
				setUpdatingBackend(false);
				setBackendUpdatePhase(null);

				/*
				 * A completion is only good news for the server when the thing serving the
				 * conversation moved with the install. It does not when the app is attached
				 * to a daemon it did not start (`restarted: false` - the app deliberately
				 * leaves it alone), or when the attempt landed after the app was gone
				 * (`unattended`). Those two say both readings on the standing notice instead
				 * of the success toast, because the toast is a claim about the server and
				 * the server is still on the old build - while the install being latest
				 * means no later check ever offers the update again (reviews R1-3, UX
				 * U1/U6, QA Q-2).
				 *
				 * AND ONLY WHEN THE NOTICE ACTUALLY SPEAKS: the funnel declines for an
				 * adopted daemon whose running reading is missing or already equals the
				 * landed install, and an early return there would leave the press
				 * unanswered (review R2-3). Falling through to the toast keeps "the
				 * update was not a restart" out of the copy while still telling the user
				 * their press worked.
				 *
				 * ONE MISSING READING IS NOT THAT CASE (UX U1). When the app performed the
				 * restart onto its own environment and the server did not answer afterwards,
				 * the missing reading IS the news - and the toast this branch fell through to
				 * said "Server update completed successfully" about a server that is not
				 * running, which is the class of claim this panel exists to remove. The
				 * producer states it (`serverDidNotComeBack`), the notice gets its own kind,
				 * and the arm keeps the reading out of the claim the way every other one
				 * does.
				 */
				const serverDidNotComeBack =
					completion?.serverDidNotComeBack === true &&
					!readableVersion(completion.runningVersion);
				if (
					completion &&
					(!completion.restarted || completion.unattended === true) &&
					announceBackendSkew({
						installVersion: completion.installVersion,
						runningVersion: completion.runningVersion,
						notRestarted: !completion.restarted,
						unattended: completion.unattended === true,
						restartable: completion.restartable !== false,
						/*
						 * A completion is a landed install, so its own sentence makes no claim about
						 * the release having been read: the install it names is the one the attempt
						 * just landed.
						 */
						releaseRead: true,
						/*
						 * And what that attempt acted on is the app's own environment, which is the
						 * reading the panel's control takes (design D5).
						 */
						appOwnedEnvironment: completion.appOwnedEnvironment === true,
						kind: serverDidNotComeBack ? "restart-failed" : "landed",
					})
				) {
					return;
				}

				setBackendUpdateCompleted(true);
				setSnackbarOpen(true);

				setTimeout(() => {
					setBackendUpdateCompleted(false);
				}, 6000);
			});

		/**
		 * Which phase the update is in, announced by the main process as it changes.
		 *
		 * The install and the restart are one panel otherwise: ~47 s and ~15 s of it on
		 * a cold cache, distinguishable only by the bar's motion (UX U4).
		 */
		const removeBackendUpdateProgressListener =
			window.api.updater.onBackendUpdateProgress(
				({ phase, sourceRebuild, waitedMs }) => {
					setBackendUpdatePhase(phase);
					/*
					 * The elapsed reading travels with the phase (design D3), and it is
					 * cleared on every phase that does not carry one: a `restarting` frame
					 * still showing "waiting 6m 12s" would be the previous phase's number
					 * left standing, which is the drift this panel keeps removing.
					 */
					setBackendUpdateWaitedMs(
						phase === "draining" && typeof waitedMs === "number"
							? waitedMs
							: null,
					);
					/*
					 * WHICH ROUTE IS RUNNING, not only which phase (review round 3, D2 = U3). The
					 * release path's reassurance is false for a checkout rebuild: that run rewrites the
					 * install in place, which is exactly what can interrupt a session here. The event
					 * carries it because the offer that named the cost unmounted the moment the press
					 * landed - this is the only place left that can say it.
					 */
					setRebuildInFlight(sourceRebuild === true);
				},
			);

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
					setBackendUpdateFailure({
						/*
						 * VERBATIM, not classified: an attempt's report is the app's own composed
						 * sentence, and the classifier's length rule reads a long one as a machine dump
						 * and deletes it - which is how the installer's diagnosis was lost on this
						 * surface (review round 5, M1). `serverUpdateFailureReason` is the one place
						 * that phase rule lives, shared with the run panel and the banner.
						 */
						message: serverUpdateFailureReason(report),
						// The installer's own lines travel with the report (the producer's own field),
						// rather than being re-derived from the sentence here (review round 5, M1).
						installerOutput: report.installerOutput,
						logPath: report.logPath,
						/*
						 * AND WHETHER THIS WAS A REFUSAL RATHER THAN A FAILURE (design round 1,
						 * D1). The producer says which it sent, so the panel does not have to
						 * guess it from the wording of a sentence it does not own.
						 */
						refusal: report.refusal,
					});
					setBackendUpdatePhase(null);
					setChecking(false);
					setUpdatingBackend(false);
					return;
				}
				setError(updateMessageOf(report.message));
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
			removeBackendUpdateProgressListener();
			removeBackendUpdateErrorListener();
			removeBackendManualRequiredListener();
			removeInstallBlockedListener();
			removeInstallFailedListener();
			removeInstallInFlightListener();
			removeInstallProgressListener();
			removeInstallSucceededListener();
		};
	}, [
		announceBackendSkew,
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
	/*
	 * NO SELF-DISMISS TIMER ON THE FAILURE ALERT (design D2, UX U1/U3). It had
	 * six seconds, which was written for a one-line machine string; the alert now
	 * carries a sentence that has to be read and acted on, and `closeSnackbar`
	 * clears the `error` with the box - so the timer firing was the whole record of
	 * a failure the user had asked for, gone. Worse, the action the copy names had
	 * no owner: the app's own retries had already run, and the only control was
	 * the X. It is held until dismissed and its sentence's "then try again" is the
	 * button beside it, which is the affordance `FloatingAlert` already supports
	 * (the connectivity banner's own Retry).
	 */
	const withErrorToast = (panel: ReactNode, notice?: ReactNode) => (
		<>
			{panel}
			{/* The update that just landed sits beside whichever surface is up, and
			    independent of the error slot: an install is not a state of the update
			    check, and this arrives on a launch where there may be nothing to offer
			    at all (UX U4). */}
			{installSucceeded !== null ? (
				<FloatingAlert
					open
					autoHideDuration={8000}
					onClose={() => setInstallSucceeded(null)}
					variant="success"
				>
					{installSucceededCopy(installSucceeded)}
				</FloatingAlert>
			) : null}
			{error !== null ? (
				<UpdateErrorAlert
					open={snackbarOpen}
					message={error}
					onClose={closeSnackbar}
					onRetry={() =>
						void checkForUpdates({ manual: true, keepFailure: true })
					}
					retrying={checking}
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
				    up is its own change. Without this a mis-press reads as a dead end.
				    UX U4 RE-PRICED THE DEFERRAL rather than re-opening it: the trade was
				    made against the global arm's measured ~47 s install, and the
				    app-owned arm's install measured ~85 s on the same box plus the
				    smoke boot, so the dead end this trade buys is about twice as long
				    as the arm it was priced against. The trade still stands - a cancel
				    has to guarantee the server comes back while killing a live pip -
				    and the price is recorded here so the next round re-prices it
				    instead of rediscovering it. */}
				<p className="mb-2 text-body text-ink-muted">
					{updatingBackend
						? backendUpdatePhase === "installing"
							? rebuildInFlight
								? /* THE REBUILD'S OWN SENTENCE - the release path's reassurance is false here. */
									/*
										The WAIT is named because it is the app's own answer to the one hazard
										this route has: a rebuild rewrites a tree a live runtime is reading,
										so the app drains the fleet before it starts. The residue - a turn
										STARTED while the rebuild runs - is real and is not dressed up; it is
										what the second half of the sentence still warns about.
									*/
									`Rebuilding the server from this machine's checkout. The app waited for the turns running on this machine to finish first, and the rebuild reinstalls this install in place - so a turn started while it runs can still be interrupted - and it can take several minutes (up to half an hour). It can't be interrupted once it has started.`
								: /*
									 * THE INSTALL PHASE of a global update (UX U4). It is the long one -
									 * ~47 s cold, against ~15 s for the restart - and the old single
									 * sentence described only the restart, so a user watching the panel
									 * for a minute could not tell this phase from a hang, nor from the
									 * phase that had not started. The server really is still serving here:
									 * under generations nothing running is rewritten.
									 */
									`Installing the new server build. The server you are using keeps serving while this runs${
										/*
										 * THE CLAUSE IS THE PROMISE (UX U13). It is true when the app will
										 * bounce the daemon the reader is talking to, and false on a machine
										 * where discovery adopted one - where the offer two seconds earlier
										 * already said so, and where the app's own completion notice says it
										 * again ("Local Operator does not restart a server it did not
										 * start"). The sentence keeps every other fact either way.
										 */
										serverRestartsWithInstall(backendUpdateInfo)
											? ", and it restarts once the install lands"
											: ""
									}. This can take a minute or two on a normal connection, and longer on a slow one, and the update can't be interrupted once it has started.`
							: backendUpdatePhase === "restarting"
								? /*
									 * THE SENTENCE COVERS THE WHOLE restarting PHASE, WHICH IS LONGER THAN
									 * THE BOUNCE (review round 2, R2-m3 = the copy half of round 1's n1).
									 * This phase is on screen across the re-engage too - the app waits
									 * for the pre-swap runtimes to retire and then starts a runtime for
									 * each session they left behind, one at a time - so a promise of
									 * "a few seconds" was the frame's own claim, contradicted by a wait
									 * of up to a minute that the frame itself was in. The bounce keeps
									 * its number; the repair says it is running, which is what the reader
									 * watching a static panel needs to know.
									 */
									"The new build has landed. Nothing in flight was cut off - the app waited for the turns running on this machine to finish first - and the server is restarting onto the new build now, so it is offline while it comes back: usually a few seconds, up to half a minute. After that the app starts a runtime again for any session the restart left without one, which can take up to a minute."
								: backendUpdatePhase === "draining"
									? /*
										 * WHO DECIDES AND WHAT THEY CHOSE (design D4). The sentence used to read
										 * "it is refused rather than cutting a turn short" - passive, no actor, and a
										 * double negative in one clause. It also dropped the interruption clause its
										 * two siblings carry (design D3), so the one phase whose length the reader
										 * cannot see was the only one that did not say whether it could be stopped.
										 */
										"Waiting for the turns running on this machine to finish. The app waits up to ten minutes for them, then stops rather than cutting a turn short, so nothing in flight is cut off - and the update can't be interrupted while it waits."
									: serverRestartsWithInstall(backendUpdateInfo)
										? "Please wait while the server is being updated. The server will temporarily go offline while it restarts to apply the update. The update can't be interrupted once it has started."
										: "Please wait while the server is being updated. The update can't be interrupted once it has started."
						: "Please wait while we check for available updates..."}
				</p>
				{/*
				 * THE ELAPSED READING (design D3). The wait can run to ten minutes and the
				 * rest of this frame does not move: without this line a working wait and a
				 * hung app are the same pixels, and the main process has the number already
				 * (it logs it). Rendered only for the phase that carries one - a `restarting`
				 * frame showing a stale count is the drift this panel keeps removing.
				 *
				 * AT `text-ink-muted`, level with the sentence it qualifies (design round 2,
				 * N2). It was `text-ink-dim`, the dimmest ink on the card - legible, and the
				 * wrong hierarchy for the one element that proves a ten-minute wait is alive:
				 * D3's whole argument is that a working wait must not look like a hung app.
				 */}
				{backendUpdatePhase === "draining" &&
					backendUpdateWaitedMs !== null && (
						<p className="mt-1 text-body-sm text-ink-muted tabular-nums">
							{waitElapsedLabel(backendUpdateWaitedMs)}
						</p>
					)}
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
				{/*
				 * THE HEADING FOLLOWS THE ARM. On the app-owned arm the body names a restart the
				 * user performs by relaunching - there is no hand action and no command - so
				 * "needs updating by hand" described an action that is not on this screen
				 * (review round 5, UX U5).
				 */}
				<UpdateHeading>
					{manualUpdateInfo.appOwned
						? "The app cannot update this server"
						: "The server needs updating by hand"}
				</UpdateHeading>
				{/* Same emphasis as the other producer of this state
				    (`backend-update-non-managed`, which used a warning hue): one sentence,
				    the same weight, and the words carry which one needs the user
				    (review D5). */}
				<p className="mb-2 text-body text-ink">{manualUpdateInfo.message}</p>
				{/*
				 * ONE ORDER FOR BOTH INSTALL SHAPES, because the reason the source-build
				 * branch reordered this panel is gone. It used to read "Server version X is
				 * available" above a closing paragraph that withdrew the outcome ("the
				 * version it reports afterwards is your checkout's"), so the offer line was
				 * moved below the caveat (reviews R16, D15). The note no longer withdraws
				 * anything - `lop update` replaces a checkout install with the published
				 * release, which is what `git_snapshot_notice()` prints and what the panel's
				 * own Details line already said - so the version line keeps its usual place
				 * and both shapes read the same way (review D2).
				 */}
				<ManualUpdateVersions
					latestVersion={manualUpdateInfo.latestVersion}
					runningVersion={manualUpdateInfo.currentVersion}
					installVersion={manualUpdateInfo.installVersion}
				/>
				{manualUpdateInfo.command ? (
					<CommandBlock command={manualUpdateInfo.command} />
				) : null}
				<ManualRemedyNote
					command={Boolean(manualUpdateInfo.command)}
					sourceBuild={manualUpdateInfo.sourceBuild === true}
					appOwned={manualUpdateInfo.appOwned === true}
				/>
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
					Installing closes the app while the update is verified and put in
					place — usually a few seconds, occasionally a few minutes. Don't
					reopen it until it starts by itself. Opening it while the update is
					installing cancels the install.
				</p>
				{/* The one line that says what is happening, from the main process's own
				    phases rather than from a timer guessing at them (UX U5). It is the ONLY
				    carrier of that state: the button below keeps its own label while it is
				    disabled, so the person reads one sentence naming the current step
				    instead of that sentence beside a second, generic copy of it (UX U8). */}
				{installing ? (
					/* `<output>` rather than a `<p role="status">`: it is the element the
					   platform already treats as a live region for the result of an
					   action, which is exactly what this is (a11y/useSemanticElements). */
					<output className="mt-2 block text-body text-ink-muted">
						{installPhaseCopy(installPhase)}
					</output>
				) : null}

				<UpdateActions>
					<Button
						variant="outline"
						size="sm"
						onClick={handleDeferUpdate}
						disabled={installing}
					>
						Update later
					</Button>
					{/* One click, then the line above says it heard: the pre-flight behind this
					    button can take seconds over a 1 GiB bundle. The label does not change
					    while it runs - the status line is what reports progress, and a button
					    that renamed itself would say the same generic thing twice (UX U8) and
					    widen at the instant of the press (UX U12). */}
					<Button
						variant="primary"
						size="sm"
						onClick={() => void installUpdate()}
						disabled={installing}
					>
						Install now
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
		/*
		 * THE FIELD FIRST, the split only as a fallback (review round 5, M1). The producer sends
		 * the installer's output as `installerOutput`, and a surface that re-derives it from the
		 * sentence is a second way to get the same fact - which drifts the moment the sentence
		 * changes. Reports written before that field existed still arrive as one string, so the
		 * split stays for them and nothing else.
		 */
		const failure = backendUpdateFailure.installerOutput
			? {
					sentence: backendUpdateFailure.message,
					output: backendUpdateFailure.installerOutput,
				}
			: splitInstallerOutput(backendUpdateFailure.message);
		/*
		 * A REFUSAL IS NOT A FAILURE (design round 1, D1).
		 *
		 * The fleet did not drain, so the app declined to touch the server - a
		 * deliberate, bounded choice whose copy already said so ("the app waited ten
		 * minutes rather than cut off work in flight") - and the frame it landed on
		 * said the opposite: a red triangle, the failure heading, and `Try again` as
		 * the emphasized control, which re-enters the same ten-minute wait. Nothing on
		 * it said the server was untouched or that the wait was the price of that.
		 *
		 * WHAT THIS ARM CHANGES, and why it is a branch rather than a reworded
		 * sentence: an update that FAILED and an update that was HELD BACK are two
		 * different events on one surface, so the heading, the announcement (this is
		 * `status`, not `alert`), the ink and the control order all differ. The one
		 * thing that must NOT differ is the repetition it makes easy: `Update later`
		 * is the emphasized action, because the app will offer this update again by
		 * itself - and the repeating action is the one that must not be the primary.
		 */
		const refusal = backendUpdateFailure.refusal;
		if (refusal) {
			return withErrorToast(
				<UpdateContainer>
					{/*
					 * THE HEADING SAYS WHICH REFUSAL THIS IS (design round 2, D6). Two of the
					 * three refusal sites happen AFTER the build landed - the restart was held
					 * back, the install was not - and the sentence under this heading says so in
					 * its own words, so a fixed "The update did not start" made the frame
					 * contradict itself in one paragraph. The producer knows which arm it is and
					 * travels the fact as a field rather than leaving the renderer to infer it.
					 */}
					<UpdateHeading>
						{refusal.installLanded
							? "The update did not finish restarting"
							: "The update did not start"}
					</UpdateHeading>
					{/*
					 * THE LEAD LINE IS THE ACTIONABLE FACT (design D5): how many sessions are
					 * still working, and which. It used to sit in parentheses halfway down a
					 * muted five-line paragraph while the waiting panel spoke in full ink, so the
					 * panel asking for a decision was the quieter of the two. It is rendered at
					 * `text-ink`; the explanation below it stays muted, because it is context
					 * rather than something a reader can act on.
					 */}
					<p className="mb-2 text-body text-ink">{failure.sentence}</p>
					{failure.output && (
						<p className="text-body-sm text-ink-muted">{failure.output}</p>
					)}
					{/*
					 * THE REMEDY IS A COMMAND, SO IT RENDERS AS ONE (design D2). It used to
					 * be a clause inside the sentence, printed with literal backticks and no
					 * way to copy it, one panel away from `backend-update-non-managed` doing
					 * exactly this with the app's own `CommandBlock`. The label is copy the
					 * renderer owns; the COMMAND is the plan's and arrives as a field, so an
					 * install the app could not classify still names none.
					 */}
					{refusal.command && (
						<div className="mt-2">
							<p className="text-body-sm text-ink-muted">
								To update now, run this yourself in a terminal:
							</p>
							<CommandBlock command={refusal.command} />
						</div>
					)}
					{backendUpdateFailure.logPath && (
						<div className="mt-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									void window.api.showItemInFolder(
										backendUpdateFailure.logPath as string,
									);
								}}
							>
								Reveal update log
							</Button>
						</div>
					)}
					{/*
					 * DISMISS FIRST, COMMIT LAST - the order every other footer in this release
					 * uses, and the slot a hand learns as the committing one (design round 2,
					 * D7). Round 1 asked for the FILL to move to `Update later`; this commit
					 * moved the fill and the position, which put the only control that costs
					 * anything (`Try again` re-enters the ten-minute wait) in the slot that reads
					 * as "go". Both signals now agree on the safe action: the outline demoted to
					 * the left, the fill on the right.
					 */}
					<UpdateActions>
						<Button
							variant="outline"
							size="sm"
							onClick={() => void updateBackend()}
						>
							Try again
						</Button>
						<Button
							variant="primary"
							size="sm"
							onClick={handleDismissBackendUpdateFailure}
						>
							Update later
						</Button>
					</UpdateActions>
				</UpdateContainer>,
			);
		}
		return withErrorToast(
			<UpdateContainer tone="failed">
				<UpdateHeading tone="failed">
					The server update didn't finish
				</UpdateHeading>
				<p className="mb-2 text-body text-ink-muted">{failure.sentence}</p>
				{/*
				 * The installer's own words as their own block, not welded onto the
				 * sentence above: the producer separates them with a blank line and the
				 * tail carries uv's nested `Caused by:` lines, which is the only part
				 * that says whether this was the network or the disk (reviews D1, U5).
				 */}
				{failure.output && <InstallerOutput output={failure.output} />}
				{/*
				 * The sentence above points at the update service log, and this is what
				 * makes that pointer a next step rather than a dead end: the renderer
				 * cannot derive the path (it is composed in the main process from the
				 * platform's user-data location or the launch's own override), so the
				 * report carries it and this hands it to the shell (review U5).
				 */}
				{backendUpdateFailure.logPath && (
					<div className="mt-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								void window.api.showItemInFolder(
									backendUpdateFailure.logPath as string,
								);
							}}
						>
							Reveal update log
						</Button>
					</div>
				)}
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
				{/*
				 * BOTH READINGS IN THE SENTENCE, when there are two. `currentVersion` is
				 * the install on disk - the thing the button moves - while the build
				 * serving this conversation can be an older one (a daemon this app
				 * adopted, or the restart that has not happened yet). The panel used to
				 * present the install's version as the one the reader "is currently
				 * using", which is false in exactly the states this change creates, and
				 * the correction was buried four mono lines down in Details (review D3,
				 * UX U1). Settings reads the daemon, so that sentence was the one the user
				 * could check.
				 */}
				<p className="mb-2 text-body text-ink-muted">
					{backendVersionSentence({
						latestVersion: backendUpdateInfo.latestVersion,
						installVersion: backendUpdateInfo.currentVersion,
						runningVersion: backendUpdateInfo.runningVersion,
					})}
				</p>
				{/*
				 * NOT ON THE APP-OWNED ARM. "Updating the server will improve AI
				 * functionality, improve security, and fix bugs" is a benefit claim rather
				 * than a fact, and this file's own defect was a surface asserting what the
				 * check had not established (review D5). It is also incoherent on a card
				 * whose remedy says nothing on this screen moves the environment: it
				 * promises the reader the upside of an update this panel cannot perform.
				 * It stays on the arms where the reader (or the button) does perform it, and
				 * dropping it here is what shortens the tallest state the section has
				 * (review D1).
				 */}
				{!backendUpdateInfo.appOwned && (
					<p className="mt-2 text-body-sm text-ink-muted">
						Updating the server will improve AI functionality, improve security,
						and fix bugs.
					</p>
				)}

				{backendUpdateInfo.canManageUpdate ? (
					<>
						{/*
						 * WHAT THE CLICK COSTS, before the click (review U3). This is the one
						 * update path where the app knows it will restart something, and the
						 * fact - the app's own daemon is bounced, dropping a turn in flight -
						 * first appeared AFTER the press, in the in-flight panel. It is the
						 * plan's own sentence for a daemon the app started, and the ownership
						 * reading decides whether that is the sentence this machine gets
						 * (reviews D7, U7; UX U9) - see `managedCostSentence`.
						 */}
						<p className="mt-4 text-body text-ink">
							{managedCostSentence(backendUpdateInfo)}
						</p>
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
								onClick={() => void updateBackend()}
								disabled={checking}
							>
								{checking ? "Updating..." : "Update server"}
							</Button>
						</UpdateActions>
						{/*
						 * The classification evidence renders on THIS branch too. It used to
						 * exist only in the by-hand branch, which is where a global install
						 * always landed before this change made the app-driven arm
						 * reachable - so the provenance sentence and the classification left
						 * the screen at the moment the app started acting (review R1-2).
						 */}
						{backendUpdateInfo.detail && (
							<PanelDetails detail={backendUpdateInfo.detail} />
						)}
					</>
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
							    and no hint that the button below re-reads the server (review U15).
						    On the APP-OWNED arm the component renders nothing at all - see its
							   own note on `appOwned`, which is where the reason lives so both doors
							   into this state carry it. */}
						<ManualRemedyNote
							command={Boolean(backendUpdateInfo.updateCommand)}
							sourceBuild={backendUpdateInfo.sourceBuild === true}
							appOwned={backendUpdateInfo.appOwned === true}
						/>
						<UpdateActions>
							<Button
								variant="outline"
								size="sm"
								onClick={handleDeferBackendUpdate}
								disabled={checking}
							>
								{/*
								 * "UNDERSTOOD" RATHER THAN "UPDATE LATER" ON THE APP-OWNED ARM (review
								 * round 1, U3). There is nothing here to defer: the app will not perform
								 * this update at all, so "later" promises an update that never arrives
								 * while the reader is shown no residue of it. The dismissal still
								 * records a deferral - a fact the reader cannot act on from here must not
								 * be re-raised by every five-minute check - but the label no longer
								 * promises a future the app cannot reach.
								 */}
								{backendUpdateInfo.appOwned ? "Understood" : "Update later"}
							</Button>
							{/*
							 * AND ONE CHECK CONTROL, NOT TWO (review round 1, U5). Both this button
							 * and the pane's own "Check for updates" run the same check and produce
							 * the same panel, so a reader could reasonably believe one checked the
							 * app and the other the server. On the command arm the button is what
							 * the closing sentence tells the reader to press - it stays, and it stays
							 * where that sentence is. On the app-owned arm the closing sentence is
							 * gone (U1) and the route is a restart, which re-runs the check anyway, so
							 * the panel keeps the dismiss and leaves the check to the pane.
							 */}
							{!backendUpdateInfo.appOwned && (
								<Button
									variant="primary"
									size="sm"
									onClick={() => void checkForAllUpdates()}
									disabled={checking}
								>
									{checking ? "Checking..." : "Check for updates"}
								</Button>
							)}
						</UpdateActions>
						{backendUpdateInfo.detail && (
							<PanelDetails detail={backendUpdateInfo.detail} />
						)}
					</>
				)}
			</UpdateContainer>,
			/*
			 * NO NOTICE ON THIS BRANCH (review D6). The panel top-right already says
			 * "Server version X is available", so the toast in the opposite corner was
			 * the same news twice in two spellings - "v0.56.0" and "0.56.0" - and it
			 * only ever appeared for the arm that manages the update, i.e. the arm whose
			 * panel the user is looking at. The notice slot stays for the branches whose
			 * news the panel does NOT carry: the failure toast and the completion.
			 */
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
	 * The install on disk and the server SERVING this app are on different builds.
	 *
	 * A panel rather than the completion toast, because the toast is a claim about
	 * the server and the server has not moved: the app is attached to a daemon it did
	 * not start, or an attempt landed while no app was watching. On those two arms
	 * the app deliberately does not bounce that process - nor may it - and the panel's
	 * sentence names the reader's own step. On the arm where the app STARTED the
	 * daemon (`restartable`, carried by the producer) the panel offers the restart as
	 * an action instead of only describing it (UX U2), because a stated fact with
	 * nothing to press is the same defect one panel further along. The truth is
	 * also self-concealing: the install is now latest, so no later check re-offers
	 * anything and nothing else on any surface says the two readings differ
	 * (reviews R1-3, D3, UX U1/U6, QA Q-1/Q-2). It renders only when no offer or
	 * status panel is up, because those already name both readings themselves.
	 *
	 * A THIRD STATE rides it, and its first paragraph is the whole fix for UX U1: the
	 * app's own restart onto its own environment finished and the server did not
	 * answer afterwards (`kind: "restart-failed"`). Its readings cannot be compared,
	 * because one of them does not exist any more - and the missing one is the news.
	 */
	if (backendSkewNotice) {
		const {
			installVersion,
			runningVersion,
			unattended,
			restartable,
			releaseRead,
			appOwnedEnvironment,
			kind,
		} = backendSkewNotice;
		/*
		 * WHETHER THE PRESS THIS PANEL OFFERS IS THE ACTION ITS LABEL NAMES, and it
		 * takes BOTH ownership readings (design D5). `restartable` answers who started
		 * the DAEMON, which is true in GLOBAL_INSTALL mode too; `appOwnedEnvironment`
		 * answers whose INSTALL `update-backend` would move. Only on the app-owned arm
		 * does the press run the publish-and-restart this label promises; on a global
		 * install the same press runs the install's own updater (an install) or lands on
		 * the by-hand panel, which is the "action that cannot act" class this whole line
		 * of work exists to remove. So the control needs both, while the SENTENCE may
		 * still describe what the daemon's owner can do.
		 */
		const actionRestartsTheServer = restartable && appOwnedEnvironment;
		const serverDidNotComeBack = kind === "restart-failed";
		return withErrorToast(
			<UpdateContainer>
				<UpdateHeading>
					{serverDidNotComeBack
						? "The server did not come back after the restart"
						: "The server is on an older build than the install"}
				</UpdateHeading>
				<p className="mb-2 text-body text-ink-muted">
					{kind === "up-to-date"
						? releaseRead
							? `This machine's install is up to date${installVersion ? ` (${installVersion})` : ""}, and the server serving this app is still running ${runningVersion ?? "an older build"}.`
							: `This machine's install is ${installVersion ?? "a newer build"}, and the server serving this app is still running ${runningVersion ?? "an older build"}.`
						: kind === "restart-failed"
							? `The install is now at ${installVersion ?? "the new version"}, and the server serving this app did not answer after it was restarted.`
							: unattended
								? `An update you started before quitting finished while Local Operator was closed, so the install is now at ${installVersion ?? "a newer version"}. Nothing restarted the server that was serving you${runningVersion ? `, which still reports ${runningVersion}` : ""}.`
								: /*
									 * THE RESTART THAT DID NOT TAKE IS NOT A DAEMON STARTED ELSEWHERE
									 * (design D1). This clause used to be the `!unattended` fall-through, so on
									 * a machine where the app had just tried and failed to restart its OWN
									 * daemon the panel said that daemon "was started outside Local Operator" -
									 * beside the next paragraph's "This app started that server". Two
									 * sentences, one panel, opposite claims, and the first one false. When the
									 * app owns the daemon the only honest statement is the two readings it
									 * has: the install is at X and the server is still on Y.
									 */
									restartable
									? /*
										 * THE RESTART THAT DID NOT TAKE (design D12). `kind: "landed"` is
										 * reachable only from a COMPLETION - the app published nothing, moved
										 * its own daemon onto the install and read the daemon afterwards
										 * (`update-notification.tsx`'s completion listener; the sibling
										 * `up-to-date` kind is the check's arm and its paragraph is above) - so
										 * inside this branch the missing restart IS the fact, and naming it is
										 * the difference between an outcome and a paragraph the reader can only
										 * tell apart from the one they pressed by memory. The arm exists
										 * because the app's own restart did not take, the only control offered
										 * is the one just pressed, and pressing it again costs a second outage and
										 * another wait for the fleet to drain. Its sibling arm - the restart that left
										 * NOTHING answering - got a heading of its own for the same reason; this
										 * is the clause that closes the asymmetry, and it needs no new guard:
										 * `landed` plus this branch's non-unattended, `restartable` reading is
										 * exactly the press that failed (a guard on `notRestarted` here would be
										 * always-true, the unreachable shape this file removes).
										 */
										`The install is now at ${installVersion ?? "the new version"}, but the server serving this app is still running ${runningVersion ?? "the build it loaded"}. That restart did not take.`
									: `The install is now at ${installVersion ?? "the new version"}, but the server serving this app was started outside Local Operator, so it was left running${runningVersion ? ` on ${runningVersion}` : ""}.`}
				</p>
				<p className="mb-2 text-body text-ink-muted">
					{/*
					 * WHO CAN MOVE IT, on the arm where nobody here can (review round 1, UX
					 * U2). This sentence used to be a fact with no actor and no exit -
					 * "It moves onto the new build when it restarts - Local Operator does
					 * not restart a server it did not start", where the trigger it named was
					 * taken away by its own second clause. The reader's two actions both
					 * reproduced the panel: restarting the app re-adopts the same daemon and
					 * a re-check re-raises the same reading pair, so the notice was a nag
					 * with no exit for a state they could not clear. It names the route now
					 * - the outside process is the thing to restart, and the app starting
					 * its OWN server is the other half of the same move. Both are real: the
					 * daemon that comes back reads the environment an update already moved.
					 *
					 * AND WHAT THE PRESS COSTS, BEFORE THE PRESS (design D3). This panel used
					 * to be the one commit control in this component with no cost line above it:
					 * the price - the server going down, and the wait for the turns already
					 * running to finish - was stated only in the in-flight panel, one batch later,
					 * when it could no longer be withdrawn. The same press is offered in two states - the server
					 * behind the install, and the server that did not come back - and each has
					 * its own sentence over the bound they share (`RESTART_COST_SENTENCE`,
					 * `RESTART_COST_SENTENCE_SERVER_DOWN` and `RESTART_OUTAGE_BOUND` above,
					 * which design D13 split when it found the single leaf billing the
					 * server-down arm for an outage it had already paid). It applies to the
					 * arm this change gives the control to (`actionRestartsTheServer`), which
					 * is why the two sentences below it are still main's own.
					 */}
					{serverDidNotComeBack
						? actionRestartsTheServer
							? `This app started that server, so it can restart it. ${RESTART_COST_SENTENCE_SERVER_DOWN}`
							: /*
								 * Reachable, and review round 2's ordering is why it is worth saying:
								 * design D14 filed this string as copy no producer could paint, because the
								 * only producer of `serverDidNotComeBack` sent `restartable: true` by
								 * construction. That reading was the R8 defect one level down - the arm
								 * now carries `backendIsAppOwned()`, so on an ADOPTED daemon whose restart
								 * did not take the app is honest about not being able to bounce it, and
								 * this is the sentence such a launch reads. Do not remove it as unused.
								 */
								"Nothing is serving this conversation until that server is running again."
						: actionRestartsTheServer
							? `This app started that server, so it can restart it onto the new build now. ${RESTART_COST_SENTENCE}`
							: restartable
								? "Restart Local Operator and the server comes back on the new build."
								: "The server serving this app was started outside Local Operator, which does not restart a server it did not start: stop it and start Local Operator again, or restart whatever started it, and it comes back on the new build."}
				</p>
				{/*
				 * DISMISS FIRST, COMMIT LAST (design D4), which is this component's own rule -
				 * "the order every other footer in the release uses, and the one a user's hand
				 * learns". The row used to put the committing control first and `Understood`
				 * last, and the cost of the inversion was not cosmetic: dismissing records the
				 * reading in `dismissedSkewRef`, so a habit-trained press on the rightmost
				 * button buried the only surface that states the skew for that pair.
				 *
				 * THE ACTION THE SENTENCE USED TO ONLY DESCRIBE (UX U2). "Restart Local
				 * Operator and the server comes back on the new build" was a true fact with
				 * nothing to press: this panel's only control was "Understood", so a reader
				 * who wanted the new build had to work out for themselves that quitting and
				 * relaunching was the step. It is reachable now, and the app performs it:
				 * `update-backend` on this install publishes nothing - the install is already
				 * the published release - and restarts the daemon onto it, which is exactly
				 * what the sentence promises.
				 *
				 * NO IN-FLIGHT LABEL, because there is no in-flight state to label (design
				 * D6): the press clears this notice and raises `checking` in the same batch,
				 * and the `checking` branch returns earlier in the component, so the whole
				 * panel is replaced - the in-flight panel IS the affordance, and a
				 * `checking ? "Restarting..." : ...` here was dead code that read, in the diff,
				 * as coverage it never had.
				 *
				 * The panel is cleared on the press WITHOUT recording it as dismissed, so a
				 * restart that does not close the gap lets the same reading speak again
				 * rather than burying a skew the user just tried to fix.
				 */}
				<UpdateActions>
					<Button
						variant={actionRestartsTheServer ? "outline" : "primary"}
						size="sm"
						onClick={() => {
							dismissedSkewRef.current = skewKey(backendSkewNotice);
							setBackendSkewNotice(null);
						}}
					>
						Understood
					</Button>
					{actionRestartsTheServer && (
						<Button
							variant="primary"
							size="sm"
							onClick={() => {
								setBackendSkewNotice(null);
								void updateBackend(installVersion);
							}}
						>
							Restart the server
						</Button>
					)}
				</UpdateActions>
			</UpdateContainer>,
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
