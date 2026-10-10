/**
 * The quick-send frame: the mini view's whole document, now a host of the
 * SHARED composer.
 *
 * WHAT CHANGED AND WHY. This surface used to BE a bespoke one-off send box
 * (its own textarea, its own microphone, its own dictation stack, its own send
 * state machine). The operator's directive: the mini view must be a mini
 * VERSION OF THE APP - same tokens, same controls, same behaviours - and the
 * chat's composer is now a shared component (`@shared/components/composer`,
 * slice 1 of this workstream). So this file shrank to what a FRAME owns and
 * nothing else:
 *
 * - the SEAT: capability gate -> `aida.status` -> (open if needed). The
 *   display NAME rides the same read (`DesktopAidaState.name`, whose backend
 *   author is `aida.naming.display_name`) - every seat sentence renders it, so
 *   a rename lands with no code change (operator directive, 2026-09-29).
 * - the WINDOW's relationship to the composer: summon focus, Esc dismissal,
 *   the dialog-latch on blur, the "Sent" flash that precedes the hide.
 * - the SEAT SNAPSHOT, read one-shot with `sessions.get` (the route answers a
 *   `SessionSnapshot` whose `payload.frontend` is the same sync the chat's
 *   stream paints) and handed to the composer's readings strip, its chips and
 *   the send's steer decision.
 * - the compact MODEL/EFFORT sheets the chips open (`mini-sheet.tsx`).
 * - the MEASURED RESIZE (design R2): the frame measures its own content and
 *   asks main for the height (see `MINI_VIEW_RESIZE`).
 *
 * WHY THE COMPOSER OWNS THE SEND. `onSendMessage` below is the same binding
 * the chat page has: the composer keeps the draft, the attachments, the paste
 * path, the credential capture and the provenance stamp, and calls back with
 * the payload frozen at the press. The mini resolves the seat, encodes images
 * exactly as the chat's send does (one lifted pipeline, see
 * `attachment-encode.ts`), and admits through `admitChatDraft` - `steer` when
 * the seat is mid-turn, `prompt` otherwise (the chat page's own rule).
 *
 * WHAT DOES NOT LIVE HERE. No transcript, no feed, no router, no QueryClient
 * (the shared composer mounts without one; the sheets read imperatively), no
 * second dictation stack - the composer's registration with the shared speech
 * manager is the one stack, PTT (`push-to-talk`) included.
 */

import { AIDA_DISABLED_SENTENCE } from "@features/aida/aida-control";
import { gateIsSecret } from "@features/chat/ask-answer";
import { formatContextTokens } from "@features/chat/pickers/panels/formatters";
import { encodeImageAttachments } from "@features/chat/utils/attachment-encode";
import {
	imageOverflowRefusal,
	unreadableAttachmentRefusal,
} from "@features/chat/utils/attachment-read";
import { canvasDocumentForPath } from "@features/chat/utils/canvas-document";
import { messageBudgetRefusal } from "@features/chat/utils/message-budget";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { desktopFeatureEnabled } from "@shared/api/local-operator/desktop-hooks";
import { radientProxy } from "@shared/api/radient/proxy";
import type { UserInfoResult } from "@shared/api/radient/types";
import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import {
	type ComposerSendError,
	MessageInput,
	type MessageInputHandle,
	type MessageInputProps,
} from "@shared/components/composer";
import { apiConfig } from "@shared/config";
import {
	type RadientAccountRead,
	classifyRadientAccountFailure,
} from "@shared/hooks/use-radient-user-query";
import { useSessionSnapshot } from "@shared/hooks/use-session-snapshot";
import {
	type RadientSpeechBlock,
	radientSpeechBlock,
} from "@shared/lib/speech-gate";
import { cn } from "@shared/lib/utils";
import {
	SEND_FAILURE_COPY,
	UNREADABLE_ATTACHMENT_CODE,
	admitChatDraft,
	isRefusedBeforeAdmission,
	paneDraftKey,
	sendFailureCopy,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { applyThemeToDocument } from "@shared/themes";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { isServerReachable } from "../../../shared/backend-status";
import type { DesktopCapabilities } from "../../../shared/desktop-contract";
import type {
	DesktopAidaControlResult,
	DesktopAidaState,
} from "../../../shared/desktop-control-contract";
import {
	DEFAULT_QUICK_SEND_VALUE,
	type MiniViewDismissReason,
	type MiniViewPlatform,
	type MiniViewRegistrationState,
	formatQuickSendTokens,
} from "../../../shared/mini-view";
import { MINI_COPY, resolveSeatName } from "./mini-copy";
import { MiniSheet, type MiniSheetMode } from "./mini-sheet";
import { MINI_FRAME_INITIAL, miniFrameTransitions } from "./mini-state";
import { rendererPlatform } from "./renderer-platform";

/** How long the "Sent" flash stays up before the window hides (§E.4). */
export const SENT_FLASH_MS = 600;

/** The AIDA-disabled refusal code, as the transport carries it. */
const AIDA_DISABLED_CODE = "aida_disabled";

/** The composer's `messages` slot for a host that has no transcript. */
const EMPTY_MESSAGES: MessageInputProps["messages"] = [];

export function MiniComposer() {
	const [frame, setFrame] = useState(MINI_FRAME_INITIAL);
	const frameRef = useRef(frame);
	useEffect(() => {
		frameRef.current = frame;
	}, [frame]);

	const [seatId, setSeatId] = useState<string | null>(null);
	/*
	 * THE UNSEATED BOX'S OWN CONVERSATION KEY. The shared composer owns the draft
	 * through `useMessageInput` keyed by a conversation id, and its submit REFUSES
	 * without one - so a quick-send box that passed `undefined` until a seat
	 * resolved would have a Send that silently did nothing on the first press.
	 * The key is therefore always present; when the seat resolves, whatever was
	 * typed under this one is MIGRATED into the seat's key (see the effect below),
	 * because the operator's rule is that the seat conversation's draft is one
	 * draft - the same text whether it is read in the chat pane or the popup.
	 */
	const UNSEATED_DRAFT_KEY = "mini-view:unseated";
	const draftKey = seatId ?? UNSEATED_DRAFT_KEY;
	const seatRef = useRef<string | null>(null);
	const seatPromiseRef = useRef<Promise<string | null> | null>(null);
	/*
	 * The seat's display name, resolved from `aida.status` with the app's own
	 * fallback (`resolveSeatName`). The initial value is the fallback because
	 * the first paint precedes any read; every summon re-reads the status, and
	 * a rename is live on the backend side, so the popup showing the fresh
	 * answer on every open is the whole refresh story (no subscription exists;
	 * see the PR note).
	 */
	const [seatName, setSeatName] = useState(() => resolveSeatName(null));
	const seatNameRef = useRef(seatName);
	useEffect(() => {
		seatNameRef.current = seatName;
	}, [seatName]);

	/*
	 * THE SEAT'S READINGS, one-shot at this frame's own cadence (summon, after a
	 * send, after a pick) rather than per frame — the shared shape the project
	 * strip's quick-send box reads with the same call (`useSessionSnapshot`, which
	 * this code was carved into so the two cannot drift apart).
	 */
	const {
		frontend,
		effortEntities,
		refresh: refreshSeatReads,
	} = useSessionSnapshot();
	const frontendRef = useRef(frontend);
	useEffect(() => {
		frontendRef.current = frontend;
	}, [frontend]);
	const [recordingProbe, setRecordingProbe] = useState<{
		canUseRadientSpeech: boolean;
		speechBlock: RadientSpeechBlock;
	}>({ canUseRadientSpeech: false, speechBlock: "could-not-check" });
	const [sendError, setSendError] = useState<ComposerSendError | undefined>(
		undefined,
	);
	const [sheet, setSheet] = useState<MiniSheetMode | null>(null);
	const [dictating, setDictating] = useState(false);
	const [shortcut, setShortcut] = useState(DEFAULT_QUICK_SEND_VALUE);
	const [platform] = useState<MiniViewPlatform>(rendererPlatform);

	const capabilitiesRef = useRef<DesktopCapabilities | null>(null);
	const inputRef = useRef<MessageInputHandle | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const sentTimerRef = useRef<number | null>(null);
	const settleReadRef = useRef<number | null>(null);
	const dictationActiveRef = useRef(false);
	const dialogOpenRef = useRef(false);

	const update = useCallback(
		(
			step: (current: typeof MINI_FRAME_INITIAL) => typeof MINI_FRAME_INITIAL,
		) => {
			setFrame((current) => {
				const next = step(current);
				frameRef.current = next;
				return next;
			});
		},
		[],
	);

	const dismiss = useCallback((reason: MiniViewDismissReason): void => {
		try {
			void window.api?.miniView?.dismiss?.(reason)?.catch?.(() => {});
		} catch {
			/* A window with no bridge (a story, a rig without handlers) hides
			   nothing, which is the quiet direction. */
		}
	}, []);

	/* -- the seat's reads --------------------------------------------------- */

	/**
	 * The seat's readings — snapshot and effort rungs — come from the shared
	 * one-shot read (`useSessionSnapshot`), called where this frame knows they
	 * change: the summon, the settle after a send, and a pick. The chat's pane
	 * subscribes its session to the canonical stream; that machinery drags the
	 * transcript stack this document exists to avoid, and `sessions.get` answers
	 * the SAME snapshot the stream's bootstrap frame carries. The recorder's own
	 * probe is read below.
	 */

	/**
	 * The recording probe, read the way `useRadientCredentialProbe` reads it
	 * without mounting react-query: the server's reachability, the capabilities
	 * negotiation, the Radient session, and the legacy `RADIENT_API_KEY` question,
	 * composed into the shared capability and the disabled control's block
	 * (`@shared/lib/speech-gate`).
	 *
	 * THE SAME SESSION-FIRST SEMANTICS AS THE CHAT'S PROBE (issue #674): a live
	 * Radient account read enables speech first, the file key second, and the
	 * local server gates both. One deliberate difference: these reads are
	 * ONE-SHOT per summon rather than react-query's cache - the same decision the
	 * seat's other reads make (see `refreshSeatReads`) and safe for the same
	 * reason: the popup mounts fresh per summon, so a read on mount is fresh at
	 * every open, and no window stays open across a sign-in to go stale. It is
	 * also why there is no refetch-on-session-flip here: a summon re-reads.
	 * Fail-closed: an unanswered read leaves the capability false, and the class
	 * it reports is `could-not-check` - the same neutral default the shared
	 * composer carries for a host with no probe.
	 */
	const refreshProbe = useCallback(async () => {
		/*
		 * The server's reachability, asked of the MAIN process the way the
		 * connectivity gate asks it: it is the only process that knows whether the
		 * daemon it attached to is still there (see `use-connectivity-status`). A
		 * window whose bridge cannot answer is the offline direction.
		 */
		let serverOnline = false;
		const bridge = window.api?.backend;
		if (bridge) {
			try {
				serverOnline = isServerReachable((await bridge.getStatus()).state);
			} catch {
				/* The ask itself failed: no server this surface can use. */
			}
		}
		/*
		 * The capabilities negotiation's own state, because the account read is
		 * disabled until it answers (design round 2, D6): its silence must not
		 * classify as an answer class.
		 */
		let capabilitiesState: "pending" | "error" | "answered" = "pending";
		let accountUnavailable = false;
		try {
			const capabilities = await desktopResult<DesktopCapabilities>({
				op: "capabilities",
			});
			capabilitiesState = "answered";
			accountUnavailable = !desktopFeatureEnabled(capabilities, "radient");
		} catch {
			capabilitiesState = "error";
		}
		/*
		 * The session tier: the same proxy call the chat's account read makes, one
		 * attempt. Skipped when it could not mean anything (no server, a failed
		 * negotiation, or a backend that cannot serve Radient - on those the read
		 * never asked in the chat either).
		 */
		let accountRead: RadientAccountRead = "checking";
		if (
			serverOnline &&
			capabilitiesState === "answered" &&
			!accountUnavailable
		) {
			try {
				const account = await radientProxy<UserInfoResult>({
					operation: "account",
				});
				accountRead = account ? "ready" : "signed-out";
			} catch (error) {
				accountRead = classifyRadientAccountFailure(error);
			}
		}
		/* The legacy tier: the credentials file lists a Radient key. */
		let hasRadientApiKey = false;
		let keyUnreadable = false;
		try {
			const client = createLocalOperatorClient(apiConfig.baseUrl);
			const response = await client.credentials.listCredentials();
			if (response.status >= 400) throw new Error("credentials read failed");
			const keys = (response.result as { keys?: string[] } | null)?.keys;
			hasRadientApiKey = Array.isArray(keys)
				? keys.includes("RADIENT_API_KEY")
				: false;
		} catch {
			keyUnreadable = true;
		}
		setRecordingProbe({
			canUseRadientSpeech:
				serverOnline &&
				(accountRead === "ready" || (hasRadientApiKey && !keyUnreadable)),
			speechBlock: radientSpeechBlock({
				serverOnline,
				accountRead,
				accountUnavailable,
				capabilitiesState,
			}),
		});
	}, []);

	/**
	 * The seat resolution: capability gate, status read, open-if-needed.
	 *
	 * The gate is asked FIRST and nothing else runs when it is closed (the
	 * canonical fail-closed rule): a route must not be called by a build that
	 * does not advertise it. The status read is where the DISPLAY NAME comes
	 * from - the same `aida.status.name` the sidebar's own row renders, whose
	 * backend author is `naming.display_name` - so naming and opening are one
	 * read apart rather than two sources that can disagree.
	 */
	const resolveSeat = useCallback(async (): Promise<string | null> => {
		let capabilities: DesktopCapabilities | null = null;
		try {
			capabilities = await desktopResult<DesktopCapabilities>({
				op: "capabilities",
			});
		} catch {
			capabilities = null;
		}
		if (capabilities === null) {
			capabilitiesRef.current = null;
			seatRef.current = null;
			update((current) =>
				miniFrameTransitions.noted(
					current,
					MINI_COPY.seatUnreachable(seatNameRef.current),
				),
			);
			return null;
		}
		capabilitiesRef.current = capabilities;
		if (!desktopFeatureEnabled(capabilities, "aida", 1)) {
			seatRef.current = null;
			update((current) =>
				miniFrameTransitions.noted(
					current,
					MINI_COPY.seatMissing(seatNameRef.current),
				),
			);
			return null;
		}
		try {
			const read = await desktopResult<DesktopAidaState>({ op: "aida.status" });
			/*
			 * THE NAME IS TAKEN EVEN WHEN THE SEAT IS REFUSED, because the
			 * refusal SENTENCES render it ("Couldn't reach Aida."): an error
			 * path that skipped the read would speak the fallback while the
			 * rest of the app says the operator's chosen name.
			 */
			const name = resolveSeatName(read.name);
			setSeatName(name);
			seatNameRef.current = name;
			if (!read.enabled) {
				seatRef.current = null;
				update((current) =>
					miniFrameTransitions.noted(current, AIDA_DISABLED_SENTENCE),
				);
				return null;
			}
			let sessionId = read.session_id;
			if (!sessionId) {
				/* `open` is idempotent server-side (the single-session rule is the
				   backend's), so a stale null costs one POST and can never create a
				   second conversation. */
				const opened = await desktopResult<DesktopAidaControlResult>({
					op: "aida.control",
					action: "open",
				});
				sessionId = opened.session_id;
			}
			if (!sessionId) {
				seatRef.current = null;
				update((current) =>
					miniFrameTransitions.noted(
						current,
						MINI_COPY.seatOpenFailed(seatNameRef.current),
					),
				);
				return null;
			}
			seatRef.current = sessionId;
			setSeatId(sessionId);
			return sessionId;
		} catch (error) {
			seatRef.current = null;
			const code =
				error !== null && typeof error === "object" && "code" in error
					? String((error as { code?: unknown }).code)
					: "";
			const sentence =
				code === AIDA_DISABLED_CODE
					? AIDA_DISABLED_SENTENCE
					: MINI_COPY.seatUnreachable(seatNameRef.current);
			update((current) => miniFrameTransitions.noted(current, sentence));
			return null;
		}
	}, [update]);

	const ensureSeat = useCallback((): Promise<string | null> => {
		if (seatRef.current !== null) return Promise.resolve(seatRef.current);
		if (seatPromiseRef.current !== null) return seatPromiseRef.current;
		const pending = resolveSeat().finally(() => {
			seatPromiseRef.current = null;
		});
		seatPromiseRef.current = pending;
		return pending;
	}, [resolveSeat]);

	/**
	 * The light status read a WARM summon makes: the name (and a session id
	 * that changed under us, which a rebuilt conversation produces) refresh
	 * without the open flow, so a rename since the last summon is on screen
	 * with one cheap read.
	 */
	const refreshIdentity = useCallback(async (): Promise<string | null> => {
		try {
			const read = await desktopResult<DesktopAidaState>({ op: "aida.status" });
			const name = resolveSeatName(read.name);
			setSeatName(name);
			seatNameRef.current = name;
			if (read.session_id && read.session_id !== seatRef.current) {
				seatRef.current = read.session_id;
				setSeatId(read.session_id);
			}
		} catch {
			/* Keep the last name; the next summon tries again. */
		}
		return seatRef.current;
	}, []);

	/** The arrival-order guard for the delayed re-read after a pick or send. */
	const scheduleSettleRead = useCallback(
		(sessionId: string) => {
			if (settleReadRef.current !== null) {
				window.clearTimeout(settleReadRef.current);
			}
			/* A model or effort switch (and a steering turn starting) settles
			   in the owner within a couple of seconds; one delayed re-read
			   catches the confirmed reading without polling. */
			settleReadRef.current = window.setTimeout(() => {
				settleReadRef.current = null;
				void refreshSeatReads(sessionId);
			}, 2000);
		},
		[refreshSeatReads],
	);

	/* -- the send ----------------------------------------------------------- */

	/**
	 * The composer's send binding: the mini's half of `onSendMessage`.
	 *
	 * Mirrors the chat page's order of operations for the parts a quick send
	 * has: encode the attachments (images only - the one lifted pipeline), take
	 * the two pre-admission refusals (an unreadable file, a payload over the
	 * transport budget) while the draft is still editable, then admit against
	 * the seat. `mode` is the chat's own rule: a mid-turn seat gets `steer`, so
	 * the message joins the running turn instead of queueing behind it.
	 */
	const onSendMessage = useCallback(
		async (
			content: string,
			attachments: string[],
			onEchoPainted?: () => void,
			_typed?: string,
			beforeAdmission?: (sessionId: string) => Promise<string | undefined>,
			inputMode?: "typed" | "dictated" | "mixed",
		) => {
			const { images, unreadable, overflow } = await encodeImageAttachments(
				attachments,
				content,
			);
			const unreadableRefusal = unreadableAttachmentRefusal(unreadable);
			if (unreadableRefusal) {
				setSendError({
					message: unreadableRefusal,
					code: UNREADABLE_ATTACHMENT_CODE,
					retry: false,
				});
				return false;
			}
			const overflowRefusal = imageOverflowRefusal(overflow);
			if (overflowRefusal) {
				setSendError({ message: overflowRefusal, retry: false });
				return false;
			}
			const budgetRefusal = messageBudgetRefusal(content, images);
			if (budgetRefusal) {
				setSendError({ message: budgetRefusal, retry: false });
				return false;
			}
			const target = seatRef.current ?? (await ensureSeat());
			if (target === null) {
				/* The resolution refused and put ITS sentence up (every blocked
				   arm writes one); the send reads it so the reader sees the
				   seat's reason rather than a generic one, and Retry is offered
				   because the next press re-resolves. */
				setSendError({
					message:
						frameRef.current.notice?.text ??
						MINI_COPY.seatUnreachable(seatNameRef.current),
					retry: true,
					onRetry: () => {
						inputRef.current?.submitNow();
						inputRef.current?.focusInput();
					},
					onDismiss: () => {
						setSendError(undefined);
						inputRef.current?.focusInput();
					},
				});
				return false;
			}
			const key =
				paneDraftKey(
					null,
					target,
					useCanonicalSessionsStore.getState().drafts,
				) ?? `send:${target}`;
			const inputModeEnabled = desktopFeatureEnabled(
				capabilitiesRef.current,
				"input_mode",
			);
			try {
				const admitted = await admitChatDraft(
					key,
					{
						text: content,
						attachments,
						images,
						mode: frontendRef.current?.streaming ? "steer" : "prompt",
						cwd: frontendRef.current?.cwd ?? "",
						inputMode: inputModeEnabled ? inputMode : undefined,
					},
					target,
					onEchoPainted,
					beforeAdmission,
				);
				if (admitted === null) {
					/* The send lock: the same send is already in flight, or the
					   payload was unchanged. The store's own sentence says so;
					   the draft is still here and pressing again is safe. */
					setSendError({
						message: `${SEND_FAILURE_COPY.sendLock} ${MINI_COPY.keepText}`,
						muted: true,
						polite: true,
						onDismiss: () => setSendError(undefined),
					});
					return false;
				}
				setSendError(undefined);
				/*
				 * THE FILES PANEL GETS WHAT WAS SENT WITH IT (QA Q3). The composer's attachments
				 * are not on the wire - a canonical content block is text or an image - so
				 * without this write the mini's new attach control could accept a file, admit the
				 * message, and leave the file existing nowhere (observed: the daemon's history
				 * carried the text alone). This is the chat page's own carriage, ported rather
				 * than reinvented: both keys, because a draft is keyed by its draft key while the
				 * admitted session is keyed by its id, and writing only one would orphan the file
				 * at the moment the user looks for it. A pasted image (`data:`) is skipped: it has
				 * no path to open, and the image itself already rode the wire.
				 */
				const sentFiles = attachments
					.filter((attachment) => !attachment.startsWith("data:"))
					.map((attachment) => canvasDocumentForPath(attachment));
				if (sentFiles.length > 0) {
					const canvas = useCanvasStore.getState();
					canvas.addMentionedFilesBatch(key, sentFiles);
					canvas.addMentionedFilesBatch(target, sentFiles);
				}
				update((current) => miniFrameTransitions.sentUp(current));
				if (sentTimerRef.current !== null) {
					window.clearTimeout(sentTimerRef.current);
				}
				sentTimerRef.current = window.setTimeout(() => {
					sentTimerRef.current = null;
					/* Belt for the invariant the composer also enforces: no send
					   path may hide the window while a recording is live. */
					if (dictationActiveRef.current) return;
					dismiss("sent");
				}, SENT_FLASH_MS);
				void refreshSeatReads(target);
				scheduleSettleRead(target);
				return true;
			} catch (error) {
				// A failed send invalidates the resolved seat: the conversation
				// may be gone, so the next press re-resolves and `open` can heal it.
				seatRef.current = null;
				if (isRefusedBeforeAdmission(error)) {
					const classified = sendFailureCopy(error);
					setSendError({
						message: `${classified.message} ${MINI_COPY.keepText}`,
						retry: classified.retry,
						onRetry: () => {
							inputRef.current?.submitNow();
							inputRef.current?.focusInput();
						},
						onDismiss: () => {
							setSendError(undefined);
							inputRef.current?.focusInput();
						},
					});
				} else {
					setSendError({
						message: MINI_COPY.postAdmission(seatNameRef.current),
						retry: false,
						onDismiss: () => setSendError(undefined),
					});
				}
				return false;
			}
		},
		[dismiss, ensureSeat, refreshSeatReads, scheduleSettleRead, update],
	);

	/* -- the frame's own events --------------------------------------------- */

	/**
	 * THE SHEET'S ONE EXIT (UX round 2, U3's residual).
	 *
	 * Every way out of the sheet - Escape through the frame's ladder, the sheet's own
	 * close control, or a pick - comes through here. The restore used to live on the
	 * `onClose` prop alone and the LADDER did not reach it: measured after an Escape,
	 * `document.activeElement` was `<body>` and the next Escape produced no hide at
	 * all (the event's target sits outside the React root, so the frame never saw
	 * it). A pick was already correct - which is what a second, unreached copy of
	 * one rule looks like.
	 */
	const closeSheet = useCallback((): void => {
		setSheet(null);
		inputRef.current?.focusInput();
	}, []);

	/**
	 * The summon: keyboard to the composer, palette re-read, flash reset, seat
	 * re-read (name + identity, then the readings), and a sheet closed - a
	 * picker left open from the last summon lists a stale world.
	 */
	useEffect(() => {
		return window.api?.miniView?.onSummoned?.(() => {
			applyThemeToDocument(useUiPreferencesStore.getState().themeName);
			update((current) => miniFrameTransitions.summoned(current));
			closeSheet();
			/*
			 * THE HEIGHT RETURNS TO REST WITH THE SUMMON (reviewer M1): a sheet or a
			 * long draft grown on the last summon is closed here, and the observer
			 * then asks for the smaller height - the request is driven by content,
			 * so it shrinks as well as grows.
			 */
			window.setTimeout(() => inputRef.current?.focusInput(), 0);
			void (async () => {
				const id = seatRef.current
					? await refreshIdentity()
					: await ensureSeat();
				if (id) void refreshSeatReads(id);
				void refreshProbe();
			})();
		});
	}, [
		closeSheet,
		ensureSeat,
		refreshIdentity,
		refreshProbe,
		refreshSeatReads,
		update,
	]);

	useEffect(() => {
		/* The registration state feeds the header's keycap. A window whose
		   process has no handler yet keeps the shipped default - the header
		   must never render nothing where the chord belongs. */
		const apply = (registration: MiniViewRegistrationState): void => {
			if (
				typeof registration?.value === "string" &&
				registration.value !== ""
			) {
				setShortcut(registration.value);
			}
		};
		const unsubscribe = window.api?.miniView?.onRegistration?.(apply);
		void window.api?.miniView
			?.getRegistration?.()
			?.then?.(apply)
			?.catch?.(() => {});
		return unsubscribe;
	}, []);

	/**
	 * THE DRAFT FOLLOWS THE SEAT (see `UNSEATED_DRAFT_KEY`).
	 *
	 * What was typed - and what was attached - before the seat resolved lives under
	 * the placeholder key; the moment the seat exists the whole ROW moves onto its
	 * conversation, so the popup's draft is the same draft the chat pane would show
	 * for that conversation. One draft per conversation is the operator's rule, and
	 * the composer's own re-seed on the id change then paints it without a second
	 * write.
	 *
	 * THE CHIPS MOVE WITH THE TEXT (reviewer m1). `clearComposer` empties the whole
	 * row, attachments included, so a migration that carried only `currentInput`
	 * either wiped a file the user had attached before the seat answered or - with
	 * no text to carry - returned early and stranded it invisibly under a key
	 * nothing renders. Both are silent losses of exactly the kind the encoder's own
	 * comment rejects, so the row is moved whole.
	 *
	 * THE ORDER IS THE STORE'S, NOT THIS EFFECT'S (reviewer N1): the effect runs
	 * after the render that follows `seatId` changing, so the box is first re-seeded
	 * from the seat's (still empty) row and the migrated text arrives through the
	 * hook's own store-adoption effect (`use-message-input.ts`, `storedDraft !==
	 * lastPushedRef`). The outcome is right; the mechanism is that one, so a later
	 * change that assumed a pre-emptive write would be building on an invariant this
	 * code does not hold.
	 */
	useEffect(() => {
		if (seatId === null) return;
		const store = useConversationInputStore.getState();
		const pendingRow = store.inputByConversation[UNSEATED_DRAFT_KEY];
		if (pendingRow === undefined) return;
		const pendingText = pendingRow.currentInput;
		const pendingChips = pendingRow.attachments ?? [];
		if (pendingChips.length > 0) {
			for (const chip of pendingChips) store.addAttachment(seatId, chip);
		}
		if (typeof pendingText === "string" && pendingText !== "") {
			store.setCurrentInput(seatId, pendingText);
		}
		if (pendingChips.length > 0 || pendingText !== "") {
			store.clearComposer(UNSEATED_DRAFT_KEY);
		}
	}, [seatId]);

	/**
	 * THE BOOT READ (reading on mount is approved; there is no subscription).
	 *
	 * It exists so the composer mounts keyed to her conversation from the first
	 * paint on an install where she already exists - a first summon must not
	 * flip the draft key under a thumb. It NEVER opens her: `refreshIdentity`
	 * reads `aida.status` without the open flow, so app launch stays
	 * side-effect-free; a null id here is resolved by the first summon's
	 * `ensureSeat`. The capability gate is asked first, because the route must
	 * not be called by a build that does not advertise it.
	 */
	useEffect(() => {
		void (async () => {
			try {
				const capabilities = await desktopResult<DesktopCapabilities>({
					op: "capabilities",
				});
				capabilitiesRef.current = capabilities;
				if (!desktopFeatureEnabled(capabilities, "aida", 1)) return;
			} catch {
				return;
			}
			const id = await refreshIdentity();
			if (id) void refreshSeatReads(id);
		})();
		void refreshProbe();
	}, [refreshIdentity, refreshProbe, refreshSeatReads]);

	useEffect(() => {
		/* Blur hides, with two latches: a live recording keeps its surface
		   (data loss), and a native dialog the window opened keeps the window
		   (R3 - the file picker must not dismiss the window it belongs to). */
		const onBlur = (): void => {
			if (dictationActiveRef.current) return;
			if (dialogOpenRef.current) return;
			dismiss("blur");
		};
		window.addEventListener("blur", onBlur);
		return () => window.removeEventListener("blur", onBlur);
	}, [dismiss]);

	useEffect(() => {
		return window.api?.miniView?.onDialog?.((payload) => {
			dialogOpenRef.current = payload.open;
		});
	}, []);

	/**
	 * THE FIRST-COMMIT SIGNAL (see `MINI_VIEW_PAINTED`).
	 *
	 * Main presents this window only after this fires, because a frameless window
	 * shown before its document commits is a WHITE CARD on macOS - the shipped
	 * defect, where every open after a bundle swap was blank until relaunch.
	 *
	 * FROM THE COMMIT, NOT FROM A FRAME: `useLayoutEffect` runs synchronously as part
	 * of the first commit, while a window that has never been shown cannot be relied
	 * on to run `requestAnimationFrame` at all (the same property that made the
	 * rAF-coalesced resize invisible in this pass's own rig). One shot: the signal
	 * describes this document, and a reload is a new document whose own mount
	 * signals again.
	 */
	useLayoutEffect(() => {
		window.api?.miniView?.painted?.();
	}, []);

	/*
	 * THE MEASURED RESIZE (design R2). The frame's content column is measured and
	 * the height asked of main, which clamps and calls `setContentSize`.
	 *
	 * TWO DRIVERS, AND THE SECOND IS THE ONE THAT MATTERS. The measurement runs in
	 * a LAYOUT EFFECT on every render - the states that grow this frame (a draft
	 * gaining a line, the alert appearing, a chip landing, the sheet opening) are
	 * all render-driven, and a layout effect runs while the window is HIDDEN.
	 * The ResizeObserver stays for the growth that no render announces (a font
	 * landing, the browser's own auto-size after a paste) and posts directly: it
	 * already batches per frame, so the rAF this used to coalesce through was
	 * costing correctness for nothing.
	 *
	 * WHY THE rAF HAD TO GO (measured in this pass's own rig): a hidden window has
	 * Chromium's background throttling on, so `requestAnimationFrame` callbacks do
	 * not run at all - the scene's walk measured a content column of 227px while
	 * the window stayed 168 and not one resize request was posted. The window is
	 * created hidden and shown on summon, so the old shape would have kept the
	 * live surface clipped until its first painted frame, and the headless rig
	 * could never see the mechanism work.
	 */
	const postHeight = useCallback((): void => {
		const node = contentRef.current;
		if (node === null) return;
		window.api?.miniView?.resize?.(
			Math.ceil(node.getBoundingClientRect().height),
		);
	}, []);

	useLayoutEffect(() => {
		postHeight();
	});

	useEffect(() => {
		const node = contentRef.current;
		if (node === null) return;
		const observer = new ResizeObserver(postHeight);
		observer.observe(node);
		return () => {
			observer.disconnect();
		};
	}, [postHeight]);

	useEffect(() => {
		return () => {
			if (sentTimerRef.current !== null)
				window.clearTimeout(sentTimerRef.current);
			if (settleReadRef.current !== null)
				window.clearTimeout(settleReadRef.current);
		};
	}, []);

	/**
	 * The window's Escape ladder, below the composer's own claims.
	 *
	 * A press the shared manager (a hold) or the composer (a live recording)
	 * already claimed arrives with `defaultPrevented` - the claim IS the whole
	 * press (Esc cancels the take; it never also hides the window). A sheet
	 * closes first. Otherwise Esc hides, naming itself.
	 */
	const onFrameKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>): void => {
			if (event.key !== "Escape") return;
			if (event.nativeEvent.defaultPrevented) return;
			if (sheet !== null) {
				event.preventDefault();
				closeSheet();
				return;
			}
			if (dictationActiveRef.current) return;
			event.preventDefault();
			dismiss("escape");
		},
		[closeSheet, dismiss, sheet],
	);

	/* -- the readings strip's dispatcher ------------------------------------ */

	const onCommand = useCallback(
		(invocation: { name: string; args: string }): void => {
			if (invocation.name === "model" && invocation.args === "") {
				if (seatRef.current === null) {
					update((current) =>
						miniFrameTransitions.noted(
							current,
							MINI_COPY.seatUnreachable(seatNameRef.current),
						),
					);
					return;
				}
				setSheet("model");
				return;
			}
			if (invocation.name === "effort" && invocation.args === "") {
				if (seatRef.current === null) {
					update((current) =>
						miniFrameTransitions.noted(
							current,
							MINI_COPY.seatUnreachable(seatNameRef.current),
						),
					);
					return;
				}
				setSheet("effort");
				return;
			}
			if (invocation.name === "context") {
				/* A READOUT, not a control: the chip's numbers come from the
				   same snapshot the strip reads, and there is no list to draw. */
				const reading = frontendRef.current;
				const used = reading?.context_tokens ?? null;
				if (used === null) {
					update((current) =>
						miniFrameTransitions.noted(
							current,
							MINI_COPY.contextLineNoReading,
							"muted",
						),
					);
					return;
				}
				const window = reading?.context_window ?? null;
				update((current) =>
					miniFrameTransitions.noted(
						current,
						MINI_COPY.contextLine(
							formatContextTokens(used),
							window === null ? null : formatContextTokens(window),
							reading?.context_is_estimate === true,
						),
						"muted",
					),
				);
				return;
			}
			update((current) =>
				miniFrameTransitions.noted(current, MINI_COPY.controlUnavailable),
			);
		},
		[update],
	);

	const sessionStatus = frontend
		? {
				frontend,
				onCommand,
				effortEntities,
				/*
				 * The published channel spend's gate, read here for the strip: the mini
				 * view shows the same readings as the chat pane, and a mount that left
				 * this false would print the inference-only figure beside a pane showing
				 * the published total — the surface disagreement the channel ledger
				 * exists to remove.
				 */
				costChannels: desktopFeatureEnabled(capabilities, "cost_channels"),
			}
		: undefined;

	/* -- paint -------------------------------------------------------------- */

	const statusText = frame.sent
		? MINI_COPY.sent
		: dictating
			? MINI_COPY.recording
			: (frame.notice?.text ?? MINI_COPY.hint);
	const statusTone = frame.sent
		? "text-ink-muted"
		: dictating
			? "text-accent"
			: frame.notice
				? frame.notice.tone === "danger"
					? "text-danger"
					: "text-ink-muted"
				: "text-ink-dim";

	return (
		<div
			className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-ink"
			onKeyDown={onFrameKeyDown}
			data-tour-tag="mini-frame"
		>
			<div
				ref={contentRef}
				data-tour-tag="mini-frame-content"
				/*
				 * `shrink-0`, NO `min-h-full`, and both halves are load-bearing
				 * (design D1 / UX U1 / QA Q2). This node is what the ResizeObserver
				 * below measures, and `min-h-full` made its box the VIEWPORT height
				 * while the default `flex-shrink: 1` let the parent's `h-screen`
				 * column squeeze it: the observer therefore read 168 in every state
				 * and `mini-view:resize` was asked for the height the window already
				 * had, so the sheet and a long draft were painted outside the window
				 * (measured: sheet content 479 px against innerHeight 168). With the
				 * intrinsic box the observer reports real content, which is also
				 * what lets a request DROP again when the content shrinks (reviewer
				 * M1) - main clamps below at MINI_VIEW_HEIGHT.
				 */
				className="flex shrink-0 flex-col gap-2 p-3"
			>
				<div className="flex h-4 shrink-0 items-center justify-between pb-0.5">
					<span
						data-tour-tag="mini-seat"
						className="truncate text-meta text-ink-muted"
					>
						{MINI_COPY.seatLabel(seatName)}
					</span>
					<KeyboardShortcut
						shortcut={formatQuickSendTokens(shortcut, platform).join("+")}
						joined
					/>
				</div>
				<MessageInput
					ref={inputRef}
					/*
					 * THE BOX'S CONVERSATION KEY (see `UNSEATED_DRAFT_KEY`). The composer
					 * owns the draft through `useMessageInput` keyed by this id, and it
					 * REFUSES TO SUBMIT WITHOUT ONE (`handleSubmit`'s first guard), which is
					 * why the key is present from the first paint rather than only once a
					 * seat resolves - a quick-send box whose Send silently did nothing
					 * before the seat answered would be a dead control on the one press
					 * this surface exists for.
					 */
					conversationId={draftKey}
					messages={EMPTY_MESSAGES}
					isLoading={false}
					isSmallView
					/*
					 * THE FRAME IS THE GUTTER (design D2): the composer's chat inset
					 * exists to align the box with a transcript's scrollbar gutter, and
					 * a quick-send frame has neither - its own `p-3` is the edge, and
					 * inheriting the chat's 24px put the box 24px in from the header and
					 * the hint that sit at that edge.
					 */
					ownGutter
					transcriptless
					placeholderOverride={MINI_COPY.placeholder(seatName)}
					cwd={frontend?.cwd}
					cwdReadOnlyReason={MINI_COPY.cwdReadOnly}
					sessionStatus={sessionStatus}
					recordingProbe={recordingProbe}
					secretAnswer={gateIsSecret(frontend?.pending_gate)}
					onDictationStateChange={(active) => {
						dictationActiveRef.current = active;
						setDictating(active);
					}}
					onSendMessage={onSendMessage}
					sendError={sendError}
				/>
				{/*
				 * ONE ERROR SURFACE (design D3): while the composer is showing its own
				 * failure alert, this row does not repeat the same sentence below it -
				 * the composer owns "your send did not go", with its Retry, and a second
				 * copy here made the block two lines taller and the field jump under the
				 * user's caret. Every other state (the resting hint, a frame notice, the
				 * recording line, the Sent flash) still speaks here.
				 */}
				{sendError?.message ? null : (
					<p
						data-tour-tag="mini-composer-status"
						role={frame.notice !== null || dictating ? "status" : undefined}
						aria-live={frame.notice !== null ? "polite" : undefined}
						className={cn("min-h-4 shrink-0 truncate text-meta", statusTone)}
					>
						{statusText}
					</p>
				)}
				{sheet !== null && seatId !== null ? (
					<MiniSheet
						mode={sheet}
						sessionId={seatId}
						/*
						 * EVERY EXIT HANDS THE KEYBOARD BACK (UX U3): the open path
						 * focuses the sheet, and without this the closed sheet left
						 * `document.activeElement` on `<body>` - no caret, and the next
						 * Escape never reached the frame's ladder because the event's
						 * target sat outside the React root. Both exits (Escape and a
						 * pick) come through here, so the restore cannot be forgotten on
						 * one of them.
						 */
						onClose={closeSheet}
						onPicked={() => {
							closeSheet();
							inputRef.current?.focusInput();
							void refreshSeatReads(seatId);
							scheduleSettleRead(seatId);
						}}
					/>
				) : null}
			</div>
		</div>
	);
}
