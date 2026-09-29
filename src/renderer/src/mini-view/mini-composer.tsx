/**
 * The quick-send composer: the whole mini view.
 *
 * WHAT IT IS. A one-off send surface for the chief-of-staff seat: resolve the
 * seat, admit one message through the app's own send path, paint "Sent", get
 * out of the way (design §C, §E). It holds no transcript, no attachments, no
 * steer mode — a quick composer must not interrupt a running turn.
 *
 * WHAT IT DELIBERATELY DOES NOT IMPORT. Nothing from `message-input.tsx` (the
 * speech-to-text stream owns that file; the mini's dictation seam is
 * `mini-dictation.ts`), none of the app's shell (no router, no feed, no
 * sidebar — the console capture's lesson, §D.1), and no React Query provider:
 * the two reads it needs are imperative `desktopResult` calls, replicated from
 * the canonical flow (`use-aida-target.ts`) rather than re-invented. The store
 * it sends through is its own copy in this renderer process, which is the
 * intended shape: admission is receipt-keyed server-side, and the main window
 * reconciles the new message the way it reconciles any other producer (§E.2).
 *
 * FAILURE POLICY, one line: the window never closes itself on an error. It
 * keeps the draft, states the sentence, and — for pre-admission refusals only
 * — offers Retry. A post-admission failure may already be in the conversation,
 * so it points at the conversation instead (§E.5).
 */

import { AIDA_DISABLED_SENTENCE } from "@features/aida/aida-control";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { desktopFeatureEnabled } from "@shared/api/local-operator/desktop-hooks";
import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	SEND_FAILURE_COPY,
	admitChatDraft,
	isRefusedBeforeAdmission,
	paneDraftKey,
	sendFailureCopy,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { applyThemeToDocument } from "@shared/themes";
import { Mic, Square } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
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
import { MINI_COPY } from "./mini-copy";
import {
	type MiniDictationController,
	type MiniDictationState,
	createMiniDictation,
} from "./mini-dictation";
import {
	MINI_INITIAL_STATE,
	type MiniViewState,
	canSend,
	isEditable,
	miniTransitions,
} from "./mini-state";
import { rendererPlatform } from "./renderer-platform";

/** How long the "Sent" flash stays up before the window hides (§E.4). */
export const SENT_FLASH_MS = 600;

/**
 * The reject code the seat's route answers once the install's switch is off
 * (`desktop_aida.py`'s contract, §E.1 step 4): a 409 whose detail carries this
 * word. Matched by value because no constant crosses the wire for it.
 */
const AIDA_DISABLED_CODE = "aida_disabled";

export function MiniComposer() {
	const [text, setText] = useState("");
	const [state, setState] = useState<MiniViewState>(MINI_INITIAL_STATE);
	const [dictation, setDictation] = useState<MiniDictationState>("idle");
	const [dictationNotice, setDictationNotice] = useState<string | null>(null);
	const [shortcut, setShortcut] = useState(DEFAULT_QUICK_SEND_VALUE);
	const [platform] = useState<MiniViewPlatform>(rendererPlatform);

	/*
	 * Mirrors for the async paths. `beginSend` awaits a seat resolution and a
	 * store call, so it must read the CURRENT state when it resumes rather than
	 * the values its closure captured at the press — the classic stale-closure
	 * double-send.
	 */
	const stateRef = useRef(state);
	const textRef = useRef(text);
	useEffect(() => {
		stateRef.current = state;
	}, [state]);
	useEffect(() => {
		textRef.current = text;
	}, [text]);

	const seatRef = useRef<string | null>(null);
	const seatPromiseRef = useRef<Promise<string | null> | null>(null);
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	const dictationRef = useRef<MiniDictationController | null>(null);
	const dictationPhaseRef = useRef<MiniDictationState>("idle");
	const sentTimerRef = useRef<number | null>(null);

	const update = useCallback(
		(step: (current: MiniViewState) => MiniViewState): void => {
			setState((current) => {
				const next = step(current);
				stateRef.current = next;
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

	/**
	 * Resolve the seat: capability gate, read, open-if-needed (§E.1).
	 *
	 * The gate is asked FIRST and nothing else runs when it is closed — the
	 * canonical fail-closed rule (§ 3.4): a route must not be called by a build
	 * that does not advertise it.
	 */
	const resolveSeat = useCallback(async (): Promise<string | null> => {
		let capabilities: DesktopCapabilities | null = null;
		try {
			capabilities = await desktopResult<DesktopCapabilities>({
				op: "capabilities",
			});
		} catch {
			// The transport could not answer: the seat cannot be confirmed, and
			// the gate's fail-closed default applies.
			capabilities = null;
		}
		if (capabilities === null) {
			/*
			 * A FAILED read is not an absent feature (review round 1, U3): the
			 * transport could not answer, so the sentence is the unreachable one.
			 * The "doesn't have a seat" sentence below belongs to an ANSWERED
			 * capability that lacks `aida` and to nothing else (§E.5) — a
			 * headless or offline machine must not read as a build without the
			 * seat, which is the different fact a user would act on differently.
			 */
			seatRef.current = null;
			update((current) =>
				miniTransitions.seatBlocked(current, MINI_COPY.seatUnreachable),
			);
			return null;
		}
		if (!desktopFeatureEnabled(capabilities, "aida", 1)) {
			seatRef.current = null;
			update((current) =>
				miniTransitions.seatBlocked(current, MINI_COPY.seatMissing),
			);
			return null;
		}
		try {
			const read = await desktopResult<DesktopAidaState>({ op: "aida.status" });
			if (!read.enabled) {
				seatRef.current = null;
				update((current) =>
					miniTransitions.seatBlocked(current, AIDA_DISABLED_SENTENCE),
				);
				return null;
			}
			let sessionId = read.session_id;
			if (!sessionId) {
				/*
				 * `open` is idempotent server-side (the single-session rule is the
				 * backend's), so a stale null costs one POST and can never create a
				 * second conversation. The mini calls the op directly rather than
				 * through `useAidaResolver`: that hook needs a QueryClient this
				 * document deliberately does not mount.
				 */
				const opened = await desktopResult<DesktopAidaControlResult>({
					op: "aida.control",
					action: "open",
				});
				sessionId = opened.session_id;
			}
			if (!sessionId) {
				seatRef.current = null;
				update((current) =>
					miniTransitions.seatBlocked(current, MINI_COPY.seatOpenFailed),
				);
				return null;
			}
			seatRef.current = sessionId;
			update((current) => miniTransitions.seatReady(current));
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
					: MINI_COPY.seatUnreachable;
			update((current) => miniTransitions.seatBlocked(current, sentence));
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
	 * Admit the draft — the composer's own send path, verbatim (§E.2).
	 *
	 * `mode: "prompt"` always (never steer); no attachments; `cwd` is unused for
	 * an existing session; no navigation afterwards, because the point is not to
	 * leave where the operator is.
	 */
	const beginSend = useCallback(async (): Promise<void> => {
		const draft = textRef.current.trim();
		if (!canSend(stateRef.current, draft)) return;
		if (dictationPhaseRef.current === "recording") {
			/*
			 * NO SEND PATH FIRES MID-RECORDING (review round 1, U2). Enter confirms
			 * a recording rather than sending (the keydown handler owns that), the
			 * disabled controls keep the pointer out, and this guard is the belt
			 * for every remaining caller (a stale closure, a programmatic press):
			 * a send here would file the message without the spoken words, and its
			 * "Sent" dismissal could hide the window while the mic is still live —
			 * the data loss §C.1 forbids.
			 */
			return;
		}
		if (sentTimerRef.current !== null) {
			window.clearTimeout(sentTimerRef.current);
			sentTimerRef.current = null;
		}
		update((current) => miniTransitions.sendStarted(current));
		try {
			const target = seatRef.current ?? (await ensureSeat());
			if (target === null) {
				/*
				 * The resolution refused and put ITS sentence up (every blocked arm
				 * writes one). The send reads that sentence before replacing the
				 * notice, so what the reader sees is the seat's reason rather than a
				 * generic one. Retry is offered: a refusal can be a moment rather
				 * than a verdict, and re-resolving is one read.
				 */
				const sentence = stateRef.current.notice ?? MINI_COPY.seatUnreachable;
				update((current) =>
					miniTransitions.sendFailed(current, sentence, true),
				);
				return;
			}
			const key =
				paneDraftKey(
					null,
					target,
					useCanonicalSessionsStore.getState().drafts,
				) ?? `send:${target}`;
			const admitted = await admitChatDraft(
				key,
				{
					text: draft,
					attachments: [],
					images: [],
					mode: "prompt",
					cwd: "",
				},
				target,
			);
			if (admitted === null) {
				/*
				 * The send lock: the same send is already in flight, or the
				 * payload was unchanged. The store's own sentence says so; the
				 * draft is still here and pressing again is safe.
				 */
				update((current) =>
					miniTransitions.sendFailed(
						current,
						`${SEND_FAILURE_COPY.sendLock} ${MINI_COPY.keepText}`,
						true,
					),
				);
				return;
			}
			setText("");
			textRef.current = "";
			update((current) => miniTransitions.sendSucceeded(current));
			sentTimerRef.current = window.setTimeout(() => {
				sentTimerRef.current = null;
				/*
				 * Belt for the same invariant (review round 1, U2): no send path
				 * may hide the window while a recording is live. Unreachable today
				 * (Send and the mic are mutually disabled during each other's
				 * phase), but a hide here would be the data loss §C.1 forbids, so
				 * the flash simply stays until the next dismissal.
				 */
				if (dictationPhaseRef.current === "recording") return;
				dismiss("sent");
			}, SENT_FLASH_MS);
		} catch (error) {
			// A failed send invalidates the resolved seat: the conversation may be
			// gone, so the next press re-resolves and `open` can heal it.
			seatRef.current = null;
			if (isRefusedBeforeAdmission(error)) {
				const classified = sendFailureCopy(error);
				const sentence = `${classified.message} ${MINI_COPY.keepText}`;
				update((current) =>
					miniTransitions.sendFailed(current, sentence, classified.retry),
				);
			} else {
				update((current) =>
					miniTransitions.sendFailed(current, MINI_COPY.postAdmission, false),
				);
			}
		}
	}, [dismiss, ensureSeat, update]);

	/* -- dictation --------------------------------------------------------- */

	useEffect(() => {
		const controller = createMiniDictation({
			onState: (next) => {
				dictationPhaseRef.current = next;
				setDictation(next);
			},
			onResult: (transcript) => {
				/*
				 * The §F silent-dictation flag arrives as this callback's second
				 * argument when the shared speech layer lands; until then the
				 * mini sends without it — the seam is this call site and the
				 * `admitChatDraft` argument object beside it.
				 */
				setText((current) => {
					const next =
						current.length === 0
							? transcript
							: `${current}${current.endsWith(" ") ? "" : " "}${transcript}`;
					textRef.current = next;
					return next;
				});
			},
			onError: (sentence) => {
				setDictationNotice(sentence);
			},
		});
		dictationRef.current = controller;
		return () => {
			controller.dispose();
			dictationRef.current = null;
		};
	}, []);

	const toggleDictation = useCallback((): void => {
		const controller = dictationRef.current;
		if (controller === null) return;
		if (dictationPhaseRef.current === "recording") {
			controller.stop();
			return;
		}
		if (dictationPhaseRef.current === "transcribing") return;
		setDictationNotice(null);
		void controller.start();
	}, []);

	/* -- the hotkey's own events ------------------------------------------- */

	useEffect(() => {
		/*
		 * The summon: the keyboard goes to the composer, the palette is re-read
		 * (the main window may have changed the theme since the last summon),
		 * the "Sent" flash resets, and a seat that was never resolved — or was
		 * cleared by a failure — re-resolves in the background.
		 */
		return window.api?.miniView?.onSummoned?.(() => {
			/*
			 * The theme is re-read per summon, not watched: the preference lives in
			 * localStorage and this window is usually hidden, so applying it at the
			 * moment the composer comes up is both cheaper and more current than a
			 * subscription that fires while nobody is looking. See `main.tsx` for
			 * why the NAME goes straight in rather than through `getTheme`.
			 */
			applyThemeToDocument(useUiPreferencesStore.getState().themeName);
			update((current) => miniTransitions.summoned(current));
			window.setTimeout(() => inputRef.current?.focus(), 0);
			if (seatRef.current === null) void ensureSeat();
		});
	}, [ensureSeat, update]);

	useEffect(() => {
		/*
		 * The registration state feeds the header's keycap. A window whose
		 * process has no handler yet (or no registration at all, as in an
		 * evidence run) keeps the shipped default — the header must never
		 * render nothing where the chord belongs.
		 */
		const apply = (registration: MiniViewRegistrationState): void => {
			/*
			 * AN EMPTY VALUE IS "no value", not a value: a rig-shaped launch answers
			 * `unavailable` with value "" (there is no stored chord to report), and
			 * the header must keep the shipped default rather than render an empty
			 * keycap — the promise the effect's comment makes.
			 */
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

	useEffect(() => {
		/*
		 * Blur hides, with the recording guard (§C.1): losing the window
		 * mid-recording is data loss, so the mic session keeps its surface
		 * until the user stops it. `dictationPhaseRef` rather than the state
		 * value because this listener must not re-subscribe per phase.
		 */
		const onBlur = (): void => {
			if (dictationPhaseRef.current === "recording") return;
			dismiss("blur");
		};
		window.addEventListener("blur", onBlur);
		return () => window.removeEventListener("blur", onBlur);
	}, [dismiss]);

	const onKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>): void => {
			if (event.key === "Escape") {
				event.preventDefault();
				if (dictationPhaseRef.current === "recording") {
					// The composer's own gesture (Esc cancels a recording) rather
					// than a hide: the recorded words would be lost, and Esc-cancel
					// is the muscle memory this product already teaches.
					dictationRef.current?.cancel();
					setDictationNotice(null);
					return;
				}
				dismiss("escape");
				return;
			}
			if (event.key !== "Enter" || event.shiftKey) return;
			if (event.nativeEvent.isComposing) return;
			/*
			 * Enter on a focused BUTTON belongs to the button: intercepting it
			 * here would start one send from the handler and a second from the
			 * button's own activation.
			 */
			const target = event.target as HTMLElement | null;
			if (target?.tagName === "BUTTON") return;
			event.preventDefault();
			if (dictationPhaseRef.current === "recording") {
				/*
				 * ENTER CONFIRMS A RECORDING (review round 1, U2), the same gesture
				 * the composer teaches (`message-input.tsx`): stop, transcribe,
				 * append to the draft. Sending here would file the message without
				 * the words still being spoken — and an admission's "Sent" flash
				 * would hide the window while the mic was live.
				 */
				dictationRef.current?.stop();
				return;
			}
			void beginSend();
		},
		[beginSend, dismiss],
	);

	/* -- paint -------------------------------------------------------------- */

	const notice = state.notice ?? dictationNotice;
	const recording = dictation === "recording";
	/*
	 * Send never fires while a recording is live (review round 1, U2): Enter
	 * confirms the recording instead, and the disabled control is what the
	 * pointer hears. `beginSend` carries the same guard as the belt for every
	 * other caller.
	 */
	const sendDisabled = !canSend(state, text) || recording;
	const statusLine = recording
		? MINI_COPY.recording
		: dictation === "transcribing"
			? MINI_COPY.transcribing
			: state.send === "sent"
				? MINI_COPY.sent
				: (notice ?? MINI_COPY.hint);
	const statusTone =
		state.send === "sent"
			? "text-ink-muted"
			: recording
				? "text-accent"
				: state.send === "error" ||
						(notice !== null && notice === dictationNotice)
					? "text-danger"
					: "text-ink-muted";

	return (
		<div
			className="flex h-screen w-screen flex-col gap-2 bg-canvas p-3 text-ink"
			onKeyDown={onKeyDown}
		>
			<div className="flex h-4 shrink-0 items-center justify-between pb-0.5">
				<span className="text-meta text-ink-muted">{MINI_COPY.seatLabel}</span>
				{/*
				 * THE APP'S CAP IDIOM (design round 1, D4), not a bare mono span: every
				 * other chord in the app rides `KeyboardShortcut`, whose caps carry the
				 * measured ink role at the mono ramp. The tokens are joined with "+"
				 * because the component splits its prop on it — the macOS sentence
				 * spelling (⌘⌥Space, no separators) cannot be split back.
				 */}
				<KeyboardShortcut
					shortcut={formatQuickSendTokens(shortcut, platform).join("+")}
					joined
				/>
			</div>
			<textarea
				ref={inputRef}
				data-tour-tag="mini-composer-input"
				value={text}
				disabled={!isEditable(state)}
				placeholder={MINI_COPY.placeholder}
				aria-label={MINI_COPY.placeholder}
				onChange={(event) => {
					setDictationNotice(null);
					setText(event.target.value);
				}}
				className={cn(
					"min-h-0 w-full flex-1 resize-none rounded-sm border border-control bg-elevated px-3 py-2",
					"text-body-sm text-ink placeholder:text-ink-dim",
					"transition-colors duration-fast ease-out-quart",
					"disabled:border-hairline disabled:bg-sunken disabled:text-ink-disabled",
					"disabled:placeholder:text-ink-disabled",
				)}
			/>
			{/*
			 * h-8, not h-7: the md Send is 32px and must sit inside its row rather
			 * than bleed past it (design round 1, D1).
			 */}
			<div className="flex h-8 shrink-0 items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<Button
						variant="ghost"
						size="icon-sm"
						data-tour-tag="mini-composer-mic"
						aria-label={
							recording ? MINI_COPY.dictationStop : MINI_COPY.dictationStart
						}
						disabled={dictation === "transcribing" || state.send === "sending"}
						onClick={toggleDictation}
					>
						{recording ? (
							<Square aria-hidden="true" />
						) : dictation === "transcribing" ? (
							<Spinner size="xs" />
						) : (
							<Mic aria-hidden="true" />
						)}
					</Button>
					{recording ? (
						<span className="relative block size-2 shrink-0" aria-hidden="true">
							<span className="absolute inset-0 rounded-full border border-accent opacity-0 animate-ping" />
							<span className="block size-2 rounded-full bg-accent" />
						</span>
					) : null}
					<span
						data-tour-tag="mini-composer-status"
						role={notice !== null || recording ? "status" : undefined}
						aria-live={notice !== null ? "polite" : undefined}
						className={cn("truncate text-meta", statusTone)}
					>
						{statusLine}
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{state.send === "error" && state.retryable ? (
						<Button
							variant="ghost"
							size="sm"
							data-tour-tag="mini-composer-retry"
							disabled={recording}
							onClick={() => {
								/*
								 * A Retry after a SEAT refusal must re-resolve, not re-spend the
								 * cached no: the gate goes back to pending and the cached id
								 * is dropped, so `beginSend`
								 * re-asks the route pair. Every other failure just clears the
								 * notice and sends again — the seat is still the one it used.
								 */
								if (state.seat === "blocked") {
									seatRef.current = null;
									update((current) => miniTransitions.seatRetry(current));
								} else {
									update((current) => miniTransitions.clearNotice(current));
								}
								void beginSend();
							}}
						>
							{MINI_COPY.retry}
						</Button>
					) : null}
					<Button
						variant="primary"
						size="md"
						data-tour-tag="mini-composer-send"
						disabled={sendDisabled}
						onClick={() => void beginSend()}
					>
						{state.send === "sending" ? (
							<>
								<Spinner size="xs" />
								{MINI_COPY.send}
							</>
						) : (
							MINI_COPY.send
						)}
					</Button>
				</div>
			</div>
		</div>
	);
}
