import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge, ipcRenderer } from "electron";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type {
	BackendUpdateCompletion,
	BackendUpdateErrorReport,
	BackendUpdateInfo,
} from "../main/update-service";
import {
	BACKEND_RECONNECT_CHANNEL,
	BACKEND_STATUS_CHANNEL,
	BACKEND_STATUS_EVENT,
	type DaemonStatusSnapshot,
} from "../shared/backend-status";
import type {
	DesktopMediaRequest,
	DesktopRequest,
	DesktopStreamEvent,
	FileActionOutcome,
} from "../shared/desktop-contract";
import type { DesktopFeedFrame } from "../shared/desktop-session-contract";
import { DESKTOP_STREAM_DETAIL } from "../shared/desktop-stream-notice";
import { readLaunchTarget, readOpenSessionArgv } from "../shared/open-session";
import { installDevDriverBridge } from "./dev-driver";

// Custom APIs for renderer
const api = {
	desktop: {
		request: (request: DesktopRequest) =>
			ipcRenderer.invoke("desktop-request", request),
		openAuthorization: (operationId: string, reopen = false) =>
			ipcRenderer.invoke("desktop-open-authorization", operationId, reopen),
		media: (request: DesktopMediaRequest, bytes: Uint8Array | null) =>
			ipcRenderer.invoke("desktop-media", request, bytes),
		watchHeartbeat: (args: {
			sessionId: string;
			subscriptionId: string;
			visible: boolean;
			focused: boolean;
		}) => ipcRenderer.invoke("desktop-watch-heartbeat", args),
		/**
		 * Tell main this pane has STOPPED displaying `sessionId` (review round 2,
		 * R2-4).
		 *
		 * Fired from the watch lease's cleanup, so navigating away from a
		 * conversation withdraws the machine-wide claim that it is on screen. Without
		 * it the last heartbeat stood until the window closed, and the backend —
		 * which treats fresh presence as authoritative — suppressed that
		 * conversation's banner while no pane displayed it.
		 *
		 * Fire-and-forget: the teardown of an effect cannot await, and a withdrawal
		 * that is lost costs the same as the absence of this call, which is the
		 * behaviour it is replacing.
		 */
		releaseWatchHeartbeat: (args: { sessionId: string }) =>
			ipcRenderer.invoke("desktop-watch-release", args),
		closeWindow: () => ipcRenderer.invoke("desktop-close-window"),
		/**
		 * The conversation main launched this window to show, read from THIS
		 * process's argv (`webPreferences.additionalArguments`, set only when the
		 * window was created for a click).
		 *
		 * A synchronous value rather than an event, and that is the whole point
		 * (B3): the renderer rehydrates its persisted active conversation and paints
		 * it in the first frame, so an id that arrives after the load shows the user
		 * the wrong conversation and then swaps it. `null` on an ordinary launch.
		 */
		initialSession: readOpenSessionArgv(process.argv),
		/**
		 * Whether main created this window to open the CATALOGUE, read from the same
		 * argv as `initialSession` and for the same reason (review round 2, R2-1).
		 *
		 * A second field rather than an overloaded `initialSession`, because the two
		 * intents are no longer the same value: `initialSession: null` on an ordinary
		 * launch means "restore what you had open", and that is exactly the wrong
		 * answer for a click on a burst digest. Resolved through
		 * `readLaunchTarget`, so the precedence lives in one place.
		 */
		initialCatalogue: readLaunchTarget(process.argv).kind === "catalogue",
		feed: {
			subscribe: (onFrame: (frame: DesktopFeedFrame) => void) => {
				const handler = (_event: unknown, frame: DesktopFeedFrame) =>
					onFrame(frame);
				ipcRenderer.on("desktop-feed-frame", handler);
				return () => {
					ipcRenderer.removeListener("desktop-feed-frame", handler);
				};
			},
			watchState: (onState: (state: { connected: boolean }) => void) => {
				const handler = (_event: unknown, state: { connected: boolean }) =>
					onState(state);
				ipcRenderer.on("desktop-feed-state", handler);
				// Ask for the CURRENT state as well as every transition: a subscriber
				// that mounts after a reconnect would otherwise render "disconnected"
				// until the next transition, which may never come on a healthy feed.
				ipcRenderer.send("desktop-feed-watch");
				return () => {
					ipcRenderer.removeListener("desktop-feed-state", handler);
				};
			},
		},
		onOpenConversation: (callback: (sessionId: string | null) => void) => {
			/*
			 * `null` is a TARGET, not a malformed payload: a burst digest's click
			 * names several conversations and opens the catalogue, which the store
			 * models as "no active session". Dropping it here would turn that click
			 * back into the silent no-op this path exists to remove, so the filter
			 * admits an explicit null and refuses only a value that is neither.
			 */
			const handler = (_event: unknown, payload: { sessionId?: unknown }) => {
				if (typeof payload?.sessionId === "string") callback(payload.sessionId);
				else if (payload?.sessionId === null) callback(null);
			};
			ipcRenderer.on("desktop-open-conversation", handler);
			return () => {
				ipcRenderer.removeListener("desktop-open-conversation", handler);
			};
		},
		stream: {
			subscribe: (
				args: { sessionId: string; epoch?: string; afterSeq?: number },
				// The contract's own type rather than a fourth transcription of the
				// frame: a local copy is where a new field (here `status`, which
				// carries a 404) gets dropped silently between main and the renderer.
				onEvent: (event: DesktopStreamEvent) => void,
			): { streamId: Promise<string>; dispose: () => void } => {
				/*
				 * `settled` is the ONLY handle anything here waits on, and the reason
				 * is that a bare rejection is invisible: `streamId` is returned to
				 * the renderer but nothing awaits it before `dispose`, and the frame
				 * handler below is the only thing that would ever have read the
				 * error. A refused subscription therefore left the consumer at
				 * "connecting" forever - no `open` frame, no error, no retry - which
				 * is what turned a refused stream into an apparently empty
				 * conversation.
				 *
				 * So the rejection is converted into the contract's own error frame,
				 * on the same callback the consumer already handles, and `null` is
				 * the "no stream to scope frames to" sentinel for the two paths
				 * below. Main emits its own refusal frames for the cases it can name
				 * (see `DesktopStreamRelay.subscribe`); this is the backstop for
				 * everything else an invoke can reject with, and its copy is generic
				 * for the same reason the relay's is fixed - an arbitrary exception
				 * string can carry a URL.
				 */
				const settled = ipcRenderer
					.invoke("desktop-stream-subscribe", args)
					.then((handle: { streamId: string }) => handle.streamId)
					.catch(() => {
						onEvent({
							streamId: "",
							kind: "error",
							detail: DESKTOP_STREAM_DETAIL.openFailed,
						});
						return null;
					});
				const handler = (_event: unknown, frame: DesktopStreamEvent) => {
					// Frames are scoped to their own subscription: a late frame from
					// a dead stream must not land on a new one's consumer.
					void settled.then((streamId) => {
						if (streamId !== null && frame.streamId === streamId)
							onEvent(frame);
					});
				};
				ipcRenderer.on("desktop-stream-event", handler);
				return {
					streamId: settled.then((streamId) => streamId ?? ""),
					dispose: () => {
						ipcRenderer.removeListener("desktop-stream-event", handler);
						void settled.then((streamId) => {
							if (streamId !== null)
								ipcRenderer.invoke("desktop-stream-unsubscribe", streamId);
						});
					},
				};
			},
		},
	},
	// Add methods to open files and URLs
	openFile: (filePath: string): Promise<FileActionOutcome> =>
		ipcRenderer.invoke("open-file", filePath),
	readFile: (filePath: string, encoding?: BufferEncoding) =>
		ipcRenderer.invoke("read-file", filePath, encoding),
	/**
	 * Bytes for the in-app viewers. No encoding: a PDF is not text, and base64
	 * would inflate it by a third on both sides of the boundary.
	 */
	readFileBytes: (filePath: string, maxBytes?: number) =>
		ipcRenderer.invoke("read-file-bytes", filePath, maxBytes),
	/**
	 * Resolve-and-stat a batch of paths. The answer carries the resolved path,
	 * which is the Files panel's identity for a file.
	 */
	probeFiles: (paths: string[], cwd?: string) =>
		ipcRenderer.invoke("probe-files", paths, cwd),
	/**
	 * One directory's listable entries, for a picker that offers rows from the
	 * filesystem. One level per call; deepening is the caller asking again for the
	 * directory the user typed a `/` into.
	 */
	listDirectory: (dir: string, cwd?: string) =>
		ipcRenderer.invoke("list-directory", dir, cwd),

	openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
	showItemInFolder: (filePath: string): Promise<FileActionOutcome> =>
		ipcRenderer.invoke("show-item-in-folder", filePath),

	// System information
	systemInfo: {
		getAppVersion: () => ipcRenderer.invoke("get-app-version"),
		getPlatformInfo: () => ipcRenderer.invoke("get-platform-info"),
	},

	/**
	 * The server-status signal, answered by the MAIN process.
	 *
	 * The renderer used to read `/health` from its own document; from the
	 * packaged app that is a `file://` origin, so a CORS decision (and, on a
	 * claimed daemon, the origin allowlist) decided whether a live server looked
	 * online. Main sends no Origin and holds the bearer, so it answers the
	 * question the renderer actually has - and it is the only process that knows
	 * whether the daemon it attached to is still the daemon it attached to.
	 *
	 * `getStatus` is the pull, `onStatusChange` the push; both carry the same
	 * snapshot, so a window that opens between transitions is never stale.
	 *
	 * `reconnect` is the third verb, and it is the difference between a control
	 * that retries and one that only re-reads: main owns the re-discovery timer,
	 * so only main can be asked to try NOW.
	 */
	backend: {
		getStatus: (): Promise<DaemonStatusSnapshot> =>
			ipcRenderer.invoke(BACKEND_STATUS_CHANNEL),
		reconnect: (): Promise<DaemonStatusSnapshot> =>
			ipcRenderer.invoke(BACKEND_RECONNECT_CHANNEL),
		onStatusChange: (callback: (snapshot: DaemonStatusSnapshot) => void) => {
			const handler = (_event: unknown, snapshot: DaemonStatusSnapshot) =>
				callback(snapshot);
			ipcRenderer.on(BACKEND_STATUS_EVENT, handler);
			return () => {
				ipcRenderer.removeListener(BACKEND_STATUS_EVENT, handler);
			};
		},
	},

	// Add methods for auto-updater
	updater: {
		/**
		 * Check for a UI update.
		 *
		 * `manual` marks a check the user asked for, which the main process lets
		 * re-offer a release whose artifact failed verification - the refusal
		 * panels tell the user to make space or re-download and then check again.
		 */
		checkForUpdates: (options?: { manual?: boolean }) =>
			ipcRenderer.invoke("check-for-updates", options),
		checkForBackendUpdates: () =>
			ipcRenderer.invoke("check-for-backend-updates"),
		/**
		 * Check the app channel and the server channel, and resolve what the whole
		 * check found out.
		 *
		 * The affirmation is read from the RESULT rather than from the updater's
		 * `*-not-available` events, because a sentence about the user's whole
		 * installation cannot be assembled from one channel's event: offering a
		 * server update and affirming "you are up to date" in the same turn is the
		 * defect this return value removes.
		 *
		 * `silent` suppresses this check's own per-channel `*-not-available`
		 * events; it is the caller's own flag rather than something the main
		 * process infers, so a caller that passes `manual` for the re-offer rule
		 * says nothing about notifications by omission.
		 */
		checkForAllUpdates: (options?: { manual?: boolean; silent?: boolean }) =>
			ipcRenderer.invoke("check-for-all-updates", options),
		/** The last install that did not complete, for Settings -> App updates. */
		getLastInstallAttempt: () => ipcRenderer.invoke("get-last-install-attempt"),
		updateBackend: (targetVersion?: string) =>
			ipcRenderer.invoke("update-backend", targetVersion),
		downloadUpdate: () => ipcRenderer.invoke("download-update"),
		quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),
		/**
		 * Quit so an install that is already running can finish.
		 *
		 * Separate from `quitAndInstall`, which runs the pre-flight and starts a new
		 * install: this one only gets the app out of the way of the install already
		 * in flight, because Squirrel cancels that install while an instance of the
		 * app is running.
		 */
		quitForUpdateInstall: () => ipcRenderer.invoke("quit-for-update-install"),
		onUpdateAvailable: (callback: (info: UpdateInfo) => void) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-available", handler);
			return () => {
				ipcRenderer.removeListener("update-available", handler);
			};
		},
		onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-not-available", handler);
			return () => {
				ipcRenderer.removeListener("update-not-available", handler);
			};
		},
		onUpdateDevMode: (callback: (message: string) => void) => {
			const handler = (_event, message) => callback(message);
			ipcRenderer.on("update-dev-mode", handler);
			return () => {
				ipcRenderer.removeListener("update-dev-mode", handler);
			};
		},
		onUpdateNpxAvailable: (callback: (info: BackendUpdateInfo) => void) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-npx-available", handler);
			return () => {
				ipcRenderer.removeListener("update-npx-available", handler);
			};
		},
		onBackendUpdateAvailable: (callback: (info: BackendUpdateInfo) => void) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("backend-update-available", handler);
			return () => {
				ipcRenderer.removeListener("backend-update-available", handler);
			};
		},
		onBackendUpdateDevMode: (callback: (message: string) => void) => {
			const handler = (_event, message) => callback(message);
			ipcRenderer.on("backend-update-dev-mode", handler);
			return () => {
				ipcRenderer.removeListener("backend-update-dev-mode", handler);
			};
		},
		onBackendUpdateNotAvailable: (
			callback: (info: {
				version: string;
				runningVersion?: string | null;
				restartable?: boolean;
				/**
				 * False when the check that sent this pair never READ the published release, so
				 * the notice may state the two readings without calling the install current.
				 * Absent means the release was read. Only the network-unavailable pass sends
				 * false (QA round 3, Q3-1).
				 */
				releaseRead?: boolean;
				/**
				 * Whether the INSTALL this check read is the app's own environment.
				 *
				 * The second ownership reading, and the one the skew panel's control needs:
				 * `restartable` is true on a global install too, where the press behind that
				 * control runs the install's own updater rather than a restart (design D5).
				 */
				appOwnedEnvironment?: boolean;
			}) => void,
		) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("backend-update-not-available", handler);
			return () => {
				ipcRenderer.removeListener("backend-update-not-available", handler);
			};
		},
		onBackendUpdateCompleted: (
			callback: (completion: BackendUpdateCompletion | null) => void,
		) => {
			/*
			 * The payload is passed through, not discarded, and it is allowed to be
			 * null: a plain successful update still sends null, while the two cases
			 * where the server serving the conversation did NOT move (a daemon this
			 * app adopted, an attempt that landed unattended) send both readings
			 * (reviews R1-3, UX U1/U6).
			 */
			const handler = (_event, completion) => callback(completion ?? null);
			ipcRenderer.on("backend-update-completed", handler);
			return () => {
				ipcRenderer.removeListener("backend-update-completed", handler);
			};
		},
		onBackendUpdateProgress: (
			callback: (progress: {
				phase: "installing" | "restarting";
				/**
				 * True when the running attempt is the checkout REBUILD rather than the
				 * release path. The two promise different things while they run - the
				 * release path installs under generations, a rebuild rewrites the install
				 * in place - so the panel cannot write one sentence for both (review
				 * round 3, U3). It rides the phase rather than a second channel because
				 * it is a property of the run the phase describes, and it must not be
				 * guessed from the offer, which has been dismissed by the time the run is
				 * minutes old.
				 */
				sourceRebuild?: boolean;
			}) => void,
		) => {
			const handler = (_event, progress) => callback(progress);
			ipcRenderer.on("backend-update-progress", handler);
			return () => {
				ipcRenderer.removeListener("backend-update-progress", handler);
			};
		},
		/**
		 * A server update that failed, with the reason the main process wrote.
		 *
		 * The main process has always sent this - it is how a failed pip run, an
		 * unreadable venv or a server that did not come back up is reported - and
		 * nothing subscribed to it. The channel was therefore dead, and the panel the
		 * renderer keeps up while an update is in flight had only the invoke's own
		 * rejection to leave on: `update-backend` RESOLVES false on failure, so the
		 * panel stayed on "Updating server" forever while the message that explains
		 * why was dropped (operator report, 2026-09-15).
		 *
		 * The payload carries the phase that wrote it (`check` or `update`), so the
		 * renderer shows an attempt's reason on the attempt's own panel rather than
		 * inferring which report this is from whether an attempt happens to be
		 * running (review R2-1).
		 */
		onBackendUpdateError: (
			callback: (report: BackendUpdateErrorReport) => void,
		) => {
			const handler = (_event, report) => callback(report);
			ipcRenderer.on("backend-update-error", handler);
			return () => {
				ipcRenderer.removeListener("backend-update-error", handler);
			};
		},
		/**
		 * A server the app cannot update itself, with the command that can.
		 *
		 * The main process has always sent this; nothing subscribed to it, so the
		 * renderer guessed the command from the word "manually" in an error
		 * string instead.
		 */
		onBackendUpdateManualRequired: (
			callback: (info: {
				message: string;
				command: string;
				detail?: string;
				latestVersion?: string | null;
				currentVersion?: string | null;
				/** The version the INSTALL reports, when it is not the running one. */
				installVersion?: string | null;
				runningVersion?: string | null;
				sourceBuild?: boolean;
				/** Whether the install is one of the app's own - see the panel's copy. */
				appOwned?: boolean;
			}) => void,
		) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("backend-update-manual-required", handler);
			return () => {
				ipcRenderer.removeListener("backend-update-manual-required", handler);
			};
		},
		onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-downloaded", handler);
			return () => {
				ipcRenderer.removeListener("update-downloaded", handler);
			};
		},
		onUpdateError: (callback: (error: string) => void) => {
			const handler = (_event, error) => callback(error);
			ipcRenderer.on("update-error", handler);
			return () => {
				ipcRenderer.removeListener("update-error", handler);
			};
		},
		/**
		 * An install the app refused to start, with the reason and the remedy.
		 *
		 * Separate from `onUpdateError`: these are deliberate refusals (the
		 * installed bundle's seal, the artifact's checksum, free disk space), not
		 * failures of a check that already happened.
		 */
		onUpdateInstallBlocked: (
			callback: (info: {
				code: string;
				version: string | null;
				message: string;
				remedy: { text: string; url?: string; command?: string };
				detail?: string;
			}) => void,
		) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-install-blocked", handler);
			return () => {
				ipcRenderer.removeListener("update-install-blocked", handler);
			};
		},
		/**
		 * A previous install that Squirrel never completed, reported on the next
		 * start because a failed install produces no error the app can observe.
		 */
		onUpdateInstallFailed: (
			callback: (info: {
				targetVersion: string;
				message: string;
				remedy: { text: string; url?: string; command?: string };
				detail: string;
				/** How many times this target has failed on this machine. */
				attempts?: number;
			}) => void,
		) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-install-failed", handler);
			return () => {
				ipcRenderer.removeListener("update-install-failed", handler);
			};
		},
		onUpdateProgress: (callback: (progressObj: ProgressInfo) => void) => {
			const handler = (_event, progressObj) => callback(progressObj);
			ipcRenderer.on("update-progress", handler);
			return () => {
				ipcRenderer.removeListener("update-progress", handler);
			};
		},
		/**
		 * An install that is running right now, found when the app started.
		 *
		 * Its own event rather than an error: nothing has failed. The app came back
		 * while Squirrel was still installing, and the panel it feeds exists to say
		 * so and to offer the one action that can still let the install finish.
		 */
		onUpdateInstallInFlight: (
			callback: (info: {
				targetVersion: string;
				message: string;
				detail: string;
			}) => void,
		) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-install-in-flight", handler);
			return () => {
				ipcRenderer.removeListener("update-install-in-flight", handler);
			};
		},
		onBeforeQuitForUpdate: (callback: () => void) => {
			const handler = () => callback();
			ipcRenderer.on("before-quit-for-update", handler);
			return () => {
				ipcRenderer.removeListener("before-quit-for-update", handler);
			};
		},
	},

	/**
	 * The browser feature's chrome controls.
	 *
	 * A namespace of its own rather than more operations on `desktop`, because
	 * `desktop`'s vocabulary maps to BACKEND HTTP paths: routing a browser
	 * operation through that allowlist would give the renderer a way to name
	 * browser commands through a channel designed for something else. Every
	 * handler behind these channels checks the sender in main.
	 *
	 * None of these carries a surface token, and that is deliberate: the
	 * capability to drive a tab belongs to a lop session, not to the app's own
	 * page. The renderer addresses tabs by `tabId`, and the one place authority
	 * moves to a session (the hand-over) mints a nonce main never sends back here.
	 */
	browser: {
		state: (): Promise<unknown> => ipcRenderer.invoke("browser-state"),
		/** `sessionId` attributes the tab to the conversation it was opened from
		 * (design R1); `null` is a tab that belongs to no conversation, which is what
		 * the route and a draft pane open. Main validates it rather than trusting it. */
		newTab: (sessionId?: string | null): Promise<unknown> =>
			ipcRenderer.invoke("browser-new-tab", sessionId ?? null),
		closeTab: (tabId: number): Promise<unknown> =>
			ipcRenderer.invoke("browser-close-tab", tabId),
		/** A bulk close: `{ mode: "ids", tabIds }` for tabs the user could see, or
		 * `{ mode: "conversation", sessionId }` which MAIN resolves at execution time
		 * (design R5 — a list computed in the renderer would miss a tab an agent opened
		 * while the band was open). Main validates the shape rather than trusting it. */
		closeTabs: (intent: unknown): Promise<unknown> =>
			ipcRenderer.invoke("browser-close-tabs", intent),
		activateTab: (tabId: number): Promise<unknown> =>
			ipcRenderer.invoke("browser-activate-tab", tabId),
		navigate: (url: string): Promise<unknown> =>
			ipcRenderer.invoke("browser-navigate", url),
		reload: (): Promise<unknown> => ipcRenderer.invoke("browser-reload"),
		stop: (): Promise<unknown> => ipcRenderer.invoke("browser-stop"),
		history: (direction: "back" | "forward"): Promise<unknown> =>
			ipcRenderer.invoke("browser-history", direction),
		setContentRect: (
			rect: { x: number; y: number; width: number; height: number } | null,
		): Promise<unknown> => ipcRenderer.invoke("browser-set-content-rect", rect),
		setViewVisible: (visible: boolean): Promise<unknown> =>
			ipcRenderer.invoke("browser-set-visible", visible),
		handOver: (tabId: number, sessionId: string): Promise<unknown> =>
			ipcRenderer.invoke("browser-hand-over", tabId, sessionId),
		revokeHandOver: (tabId: number): Promise<unknown> =>
			ipcRenderer.invoke("browser-revoke-hand-over", tabId),
		respondToConsent: (
			entryId: string,
			decision: "once" | "session" | "site" | "domain" | "deny",
		): Promise<unknown> =>
			ipcRenderer.invoke("browser-consent-respond", entryId, decision),
		revokeApproval: (origin: string): Promise<unknown> =>
			ipcRenderer.invoke("browser-revoke-approval", origin),
		revokeAllApprovals: (): Promise<unknown> =>
			ipcRenderer.invoke("browser-revoke-all-approvals"),
		forgetSite: (origin: string): Promise<unknown> =>
			ipcRenderer.invoke("browser-forget-site", origin),
		clearData: (what: "cookies" | "cache" | "everything"): Promise<unknown> =>
			ipcRenderer.invoke("browser-clear-data", what),
		/**
		 * Answer a surfaced passkey chooser.
		 *
		 * `credentialId` is one of the ids MAIN offered, echoed back, or `null` for a
		 * dismissal. Main validates membership and rejects the echo of an unknown
		 * request id, so this carries no authority of its own — it is the user's
		 * choice travelling one way.
		 */
		respondToWebauthn: (
			requestId: string,
			credentialId: string | null,
		): Promise<unknown> =>
			ipcRenderer.invoke("browser-webauthn-respond", requestId, credentialId),
		/** A `navigator.credentials.get()` matched more than one passkey, and the
		 * user has to be asked which one to use. Shapes are validated here the way
		 * every other inbound payload is: main is trusted, but a malformed payload
		 * must not reach the renderer as a dialog with no accounts to show. */
		onWebauthnRequest: (
			callback: (payload: {
				requestId: string;
				relyingPartyId: string;
				accounts: Array<{
					credentialId: string;
					name: string | null;
					displayName: string | null;
				}>;
			}) => void,
		): (() => void) => {
			const handler = (
				_event: unknown,
				payload: {
					requestId?: unknown;
					relyingPartyId?: unknown;
					accounts?: unknown;
				},
			) => {
				if (typeof payload?.requestId !== "string" || !payload.requestId)
					return;
				if (!Array.isArray(payload.accounts)) return;
				const accounts = payload.accounts
					.filter(
						(account): account is Record<string, unknown> =>
							typeof account === "object" && account !== null,
					)
					.map((account) => ({
						credentialId:
							typeof account.credentialId === "string"
								? account.credentialId
								: "",
						name: typeof account.name === "string" ? account.name : null,
						displayName:
							typeof account.displayName === "string"
								? account.displayName
								: null,
					}))
					.filter((account) => account.credentialId !== "");
				if (accounts.length === 0) return;
				callback({
					requestId: payload.requestId,
					relyingPartyId:
						typeof payload.relyingPartyId === "string"
							? payload.relyingPartyId
							: "",
					accounts,
				});
			};
			ipcRenderer.on("browser-webauthn-request", handler);
			return () => {
				ipcRenderer.removeListener("browser-webauthn-request", handler);
			};
		},
		onStateChanged: (callback: () => void): (() => void) => {
			const handler = () => callback();
			ipcRenderer.on("browser-state-changed", handler);
			return () => {
				ipcRenderer.removeListener("browser-state-changed", handler);
			};
		},
		onConsentChanged: (callback: () => void): (() => void) => {
			const handler = () => callback();
			ipcRenderer.on("browser-consent-changed", handler);
			return () => {
				ipcRenderer.removeListener("browser-consent-changed", handler);
			};
		},
		/** A consent banner was clicked. Navigation only — it never raises the
		 * window, because `window-raise.ts` is the only module that may. */
		onConsentAttention: (
			callback: (payload: { entryId: string }) => void,
		): (() => void) => {
			const handler = (_event: unknown, payload: { entryId?: unknown }) => {
				if (typeof payload?.entryId === "string") {
					callback({ entryId: payload.entryId });
				}
			};
			ipcRenderer.on("browser-consent-attention", handler);
			return () => {
				ipcRenderer.removeListener("browser-consent-attention", handler);
			};
		},
		onPopupBlocked: (
			callback: (payload: { tabId: number; url: string }) => void,
		): (() => void) => {
			const handler = (
				_event: unknown,
				payload: { tabId?: unknown; url?: unknown },
			) => {
				if (
					typeof payload?.url === "string" &&
					typeof payload.tabId === "number"
				) {
					callback({ tabId: payload.tabId, url: payload.url });
				}
			};
			ipcRenderer.on("browser-popup-blocked", handler);
			return () => {
				ipcRenderer.removeListener("browser-popup-blocked", handler);
			};
		},
	},

	/** Opens a native dialog to select a directory */
	selectDirectory: (): Promise<string | undefined> =>
		ipcRenderer.invoke("select-directory"),

	/** Opens a native dialog to select a file and returns its path and content */
	selectFile: (): Promise<{ path: string; content: string } | undefined> =>
		ipcRenderer.invoke("select-file"),

	/** Gets the user's home directory path */
	getHomeDirectory: (): Promise<string> =>
		ipcRenderer.invoke("get-home-directory"),

	/** Saves a file to the specified path */
	saveFile: (
		filePath: string,
		content: string,
		encoding?: BufferEncoding,
	): Promise<void> =>
		ipcRenderer.invoke("save-file", filePath, content, encoding),

	/** Checks if a file exists at the specified path */
	fileExists: (filePath: string): Promise<boolean> =>
		ipcRenderer.invoke("file-exists", filePath),

	/**
	 * Checks that a path exists AND is a directory. `fileExists` cannot answer
	 * this: it says yes for a regular file, so a working directory of
	 * `/etc/hosts` passed validation and failed at session creation instead.
	 */
	directoryExists: (dirPath: string): Promise<boolean> =>
		ipcRenderer.invoke("directory-exists", dirPath),

	// Add methods for installer
	ipcRenderer: {
		send: (channel: string, ...args: unknown[]) => {
			const validChannels = ["cancel-installation"];
			if (validChannels.includes(channel)) {
				ipcRenderer.send(channel, ...args);
			}
		},
		on: (channel: string, func: (...args: unknown[]) => void) => {
			const validChannels = ["installation-progress"];
			if (validChannels.includes(channel)) {
				// Remove existing listeners to avoid duplicates
				ipcRenderer.removeAllListeners(channel);
				// Add the new listener
				ipcRenderer.on(channel, (_, ...args) => func(...args));
				return () => {
					ipcRenderer.removeAllListeners(channel);
				};
			}
			return undefined;
		},
	},
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
	try {
		contextBridge.exposeInMainWorld("electron", electronAPI);
		contextBridge.exposeInMainWorld("api", api);
	} catch (error) {
		console.error(error);
	}
} else {
	// @ts-ignore (define in dts)
	window.electron = electronAPI;
	// @ts-ignore (define in dts)
	window.api = api;
}

/*
 * The renderer dev driver, exposed only in an armed launch.
 *
 * Asked AFTER the app's own namespaces: it is a test surface, and a failure in
 * it must never be able to take the real bridge down with it (the calls above
 * are the app's; this one is a harness's). `installDevDriverBridge` answers
 * false — and exposes nothing at all — when main was not asked for the driver,
 * which is every normal launch. The decision lives in `src/main/dev-driver.ts`
 * and is measured on a real boot by `node scripts/renderer-driver.mjs
 * --gate-check`.
 */
installDevDriverBridge();
