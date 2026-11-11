import { AttachmentsPreview } from "@features/chat/components/attachments-preview";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { useMessageInput } from "@shared/hooks/use-message-input";
import { useRecordingShortcutLabel } from "@shared/hooks/use-recording-shortcut";
import { resolvePushToTalkBinding } from "@shared/hooks/use-speech-to-text-manager";
import { isolateLtr, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	type RadientSpeechBlock,
	speechUnavailableReason,
} from "@shared/lib/speech-gate";
import { cn } from "@shared/lib/utils";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { normalizePath } from "@shared/utils/path-utils";
import {
	ArrowUp,
	Check,
	CircleAlert,
	ImagePlus,
	Mic,
	Paperclip,
	X,
} from "lucide-react";
import type { FC, ReactNode } from "react";
import type {
	ClipboardEvent as ReactClipboardEvent,
	DragEvent as ReactDragEvent,
} from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { recordingHintParts } from "../../../../shared/recording-shortcut";
import type { TeamBridgeFilesCapability } from "../../../../shared/team-bridge-contract";
import { rendererPlatform } from "../../mini-view/renderer-platform";
import { registerComposerFocus } from "../chat/composer-field";
import { MentionField, MentionNotice, useComposerMentions } from "./mentions";
import { imagePasteCancelsText } from "./team-bridge-attachments-model";
import {
	clearTeamBridgeComposerFocusRequest,
	composerFocusDisposition,
	teamBridgeComposerFocusPending,
} from "./team-bridge-composer-focus";
import { TeamBridgeFilesStrip } from "./team-bridge-files-strip";
import {
	MIN_DICTATION_CLIP_MS,
	useTeamBridgeDictation,
} from "./use-team-bridge-dictation";
import {
	type FileSend,
	splitBridgeFiles,
	transferredFiles,
	useTeamBridgeFiles,
} from "./use-team-bridge-files";
import {
	type TypingTarget,
	useTeamBridgeTypingEmitter,
} from "./use-team-bridge-typing-emitter";

/**
 * Team Bridge's message composer: one bar, anchored to the foot of the pane.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT `MessageInput` (operator report,
 * 2026-10-30). The page briefly mounted the shared agent composer, which is the
 * chat pane's assembly: a `p-4` card at the frame radius, with a status row and
 * a separate action row inside it. In a conversation pane that is a field with
 * room for a working-directory chip, a model picker and a dictation strip; in a
 * messaging pane it is a 110px card where a 46px bar belongs, and the two extra
 * rows are the dead space the reader sees above and below the box. Adopting it
 * did fix a real defect - the bespoke box could not grow, so the second line of
 * a draft was invisible - and this file keeps that fix and drops the component:
 * the growth belongs to the field (below), not to a foreign shell.
 *
 * WHAT THE SHAPE IS, and each part is an acceptance criterion rather than taste:
 *   - one line plus tight padding at rest (~46px), the placeholder at the left;
 *   - the field grows UPWARD as the draft wraps, to a cap, and then scrolls;
 *   - it shrinks back when the draft comes back to one line, so the pane never
 *     keeps the height a long draft once used;
 *   - the attach control and the send arrow live INSIDE the bar, right-aligned
 *     and centred on the first line, so there is no footer row to reserve;
 *   - slight rounding and a thin `border-control` edge rather than a card.
 *
 * THE TEXT AND THE SEND ARE `useMessageInput`'s, deliberately. That hook owns
 * the draft's one register and the two rules this composer must not restate: an
 * accepted send retires only the text it sent (so a sentence typed during the
 * request survives), and a refused send hands the payload back. Re-deriving
 * either here is how a host grows a second opinion of "what the box holds".
 */
const FIELD_LINE_PX = 20;
/**
 * The field's cap, in px, as a BORDER-BOX height.
 *
 * `CAPPED_BLOCK` (`features/chat/chat-measure.ts`) is this app's cap device: six
 * whole lines at `leading-5`, 120px, chosen so the boundary never lands inside a
 * line's glyphs. That value is a CONTENT height; this field also carries 8px of
 * vertical padding on each side, so the border-box cap is 120 + 16. Sizing the
 * box to a bare 120px would put the boundary through line six and reproduce the
 * exact defect that constant was introduced to remove.
 */
const FIELD_MAX_HEIGHT = 6 * FIELD_LINE_PX + 16;

/**
 * The absent `recordingProbe`, as `MessageInput`'s `EMPTY_RECORDING_PROBE`
 * reads it: no answered capability, and the NEUTRAL block, because a host that
 * passed no probe has no read behind the refusal to report.
 */
const NO_RECORDING_PROBE: {
	canUseRadientSpeech: boolean;
	speechBlock: RadientSpeechBlock;
} = { canUseRadientSpeech: false, speechBlock: "could-not-check" };

/** A stable empty array: a selector that returns a fresh `[]` re-renders forever. */
const NO_ATTACHMENTS = [] as const;

/**
 * The speech manager's registration id for this box.
 *
 * The manager is keyed by id because two live composers - this pane and the
 * chat pane - must not overwrite each other's push-to-talk handler. This is
 * the id the shared composer registered under while it was mounted here, kept
 * so the pane's identity in that map does not move with the component.
 */
const DICTATION_REGISTRATION_ID = "team-bridge-composer";

/**
 * A take's elapsed time as `m:ss`. A numeral in the machine register rather
 * than a sentence: there is no copy to translate, and the strip's label beside
 * it is what says what the number is.
 */
const formatElapsed = (ms: number): string => {
	const total = Math.floor(ms / 1000);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const readFileAsDataUrl = (file: File): Promise<string | null> =>
	new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () =>
			typeof reader.result === "string"
				? resolve(reader.result)
				: resolve(null);
		reader.onerror = () => resolve(null);
		reader.readAsDataURL(file);
	});

export type TeamBridgeComposerProps = {
	/** The draft row this box owns; also the store key its chips live under. */
	conversationId: string;
	placeholder: string;
	/** The box refuses input: no destination, an archived pane, a held attempt. */
	disabled?: boolean;
	/** Nothing can leave right now (a send or a schedule in flight). */
	sendDisabled?: boolean;
	/** A send of this box is going out: the arrow becomes the spinner. */
	sending?: boolean;
	/** The hub takes images. Absent means the attach control is not offered. */
	canAttach?: boolean;
	onFileCountChange?: (count: number) => void;
	fileContext?: {
		accountId?: string;
		tenantId?: string;
		conversationId?: string | null;
		capability: TeamBridgeFilesCapability | null;
	};
	/** Host chrome with no bar slot of its own (the schedule control). */
	trailing?: ReactNode;
	/**
	 * The line at the point of typing (UX round 1, U3 + U4). It states the chord
	 * while the box is idle and WHY the schedule control is refusing while a send
	 * is in flight - one slot, two facts, so the bar never grows a second row.
	 */
	hint?: string;
	/** Id of the sentence that says why the box refuses input, when one is up. */
	disabledReasonId?: string;
	/**
	 * The speech capability, read by the HOST (the owned page) and passed in.
	 *
	 * `MessageInput` states the same seam for the same reason: the probe is a
	 * react-query read of the account and the capability negotiation, and the
	 * page view this box mounts in is rendered WITHOUT a QueryClient by the
	 * desktop suites and the stories. Reading it here made every such mount
	 * throw "No QueryClient set" (the PR's first CI run: seven failures across
	 * the channels, drafts and thread-gate suites). Absent, the box fails closed
	 * exactly as `MessageInput` does: the mic is disabled with the neutral
	 * "could not be checked" reason, never the sign-in sentence.
	 */
	recordingProbe?: {
		canUseRadientSpeech: boolean;
		speechBlock: RadientSpeechBlock;
	};
	onSendMessage: (
		content: string,
		attachments: string[],
		files?: FileSend,
	) => boolean | Promise<boolean>;
	/**
	 * Where this box's typing would be reported (`team_bridge_typing`). `null`
	 * or absent sends nothing: capability off, a new-DM draft with no
	 * conversation yet, or "Show when I'm typing" turned off. The host owns the
	 * gate; the box only feeds the emitter real input events.
	 */
	typingTarget?: TypingTarget | null;
};

export const TeamBridgeComposer: FC<TeamBridgeComposerProps> = ({
	conversationId,
	placeholder,
	disabled = false,
	sending = false,
	sendDisabled = false,
	canAttach = false,
	onFileCountChange,
	fileContext,
	trailing,
	hint,
	disabledReasonId,
	recordingProbe,
	onSendMessage,
	typingTarget = null,
}) => {
	useI18nLocale();
	const fieldId = useId();
	const files = useTeamBridgeFiles({
		scopeKey: conversationId,
		...fileContext,
		capability: fileContext?.capability ?? null,
	});
	useEffect(() => {
		onFileCountChange?.(files.chips.length);
	}, [files.chips.length, onFileCountChange]);
	const attachments = useConversationInputStore(
		(state) => state.inputByConversation[conversationId]?.attachments,
	);
	const removeAttachment = useConversationInputStore(
		(state) => state.removeAttachment,
	);
	const chips = attachments ?? NO_ATTACHMENTS;
	const scopeIdentity = JSON.stringify([
		conversationId,
		fileContext?.accountId,
		fileContext?.tenantId,
	]);
	const scopeReceipt = useRef({ identity: scopeIdentity });
	if (scopeReceipt.current.identity !== scopeIdentity)
		scopeReceipt.current = { identity: scopeIdentity };
	const fileStateAdd = files.add;
	const stageMentionsRef = useRef<(body: string) => void>(() => {});
	/* The emitter is created after `useMessageInput` (it reads the text), but
	   the submit callback is handed over before it exists: a ref bridges them. */
	const typingSendRef = useRef<{
		onSendStart: () => void;
		onSendEnd: () => void;
	}>({ onSendStart: () => {}, onSendEnd: () => {} });

	const {
		inputValue,
		setInputValue,
		appendTranscriptText,
		handleKeyDown,
		handleSubmit,
		textareaRef,
		sendInFlight,
	} = useMessageInput({
		conversationId,
		// A pane with no transcript has no echo to retire its box on, so its
		// accepted send retires it (`transcriptless`, U1). The chips travel beside
		// the text because this host binds them into the request itself.
		transcriptless: true,
		hasAdditionalContent: files.chips.length > 0,
		onSubmit: async (message) => {
			if (files.busy || files.blocked) return false;
			const keys = files.chips.map((chip) => chip.key);
			// @-mentions: stage this text's `mentions[]` for its send (mentions/).
			stageMentionsRef.current(message);
			// Typing stops BEFORE the message leaves, and no heartbeat may follow
			// it until the send settles: a PUT landing after the message would
			// re-show this person as typing for a whole TTL (review round 1, R4).
			const typingSend = typingSendRef.current;
			typingSend.onSendStart();
			let accepted: boolean;
			try {
				accepted = await onSendMessage(
					message,
					(
						useConversationInputStore.getState().inputByConversation[
							conversationId
						]?.attachments ?? NO_ATTACHMENTS
					).map((entry) => entry.path),
					files.receipt(),
				);
			} finally {
				typingSend.onSendEnd();
			}
			if (accepted) for (const key of keys) files.remove(key);
			return accepted;
		},
	});
	/* @-MENTIONS (features/team-bridge/mentions/). Inert with no mention source
	   above this composer. `stageMentionsRef` because `useMessageInput` takes its
	   submit callback before this hook exists. */
	const mentions = useComposerMentions({
		draftKey: conversationId,
		text: inputValue,
		setText: setInputValue,
		fieldRef: textareaRef,
	});
	stageMentionsRef.current = mentions.stage;
	/* TYPING INDICATORS: only the field's own change event reports typing - a
	   restored draft or a programmatic clear arrives through `inputValue`, which
	   the emitter reads solely to STOP on an empty box. */
	const typing = useTeamBridgeTypingEmitter(typingTarget, inputValue);
	typingSendRef.current = typing;

	/*
	 * THE FIELD'S HEIGHT, ASKED OF ITS OWN CONTENT.
	 *
	 * A layout effect rather than an effect, so the growth is in the same frame
	 * as the keystroke that caused it: measuring after paint shows the old height
	 * for one frame, which reads as a lag on every line break. `height: auto`
	 * first because `scrollHeight` is the content height and a field still sized
	 * to its previous value reports the smaller of the two.
	 *
	 * `scrollHeight` includes the padding, and so does a border-box `height`, so
	 * the two are the same unit here. Past the cap the field keeps the cap and
	 * scrolls, which is the only way the bar stops growing without hiding text.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `inputValue` is a re-measure TRIGGER, not a value the body reads (the field is sized from its own ref); dropping it leaves the bar at its previous height after a restored draft or a paste.
	useLayoutEffect(() => {
		const field = textareaRef.current;
		if (!field) return;
		/*
		 * THE SCROLL POSITION SURVIVES THE MEASURE. `height: auto` collapses the
		 * scroll range, and a collapsed range takes `scrollTop` with it - so the
		 * measure alone put the field back at its FIRST line on every keystroke.
		 * Past the cap that is the line the author is not looking at: they keep
		 * typing into a box pinned five lines above the caret. Measured at the cap
		 * before this line existed, the first line was in view and the caret was
		 * not.
		 */
		const measure = () => {
			const held = field.scrollTop;
			field.style.height = "auto";
			// `scrollHeight` is an integer and the laid-out text is not, so a bare
			// assignment can leave a sub-pixel overflow that clips the last line.
			const needed = Math.ceil(field.scrollHeight);
			field.style.height = `${Math.min(needed, FIELD_MAX_HEIGHT)}px`;
			field.style.overflowY = needed > FIELD_MAX_HEIGHT ? "auto" : "hidden";
			if (field.scrollTop !== held) field.scrollTop = held;
		};
		measure();
		/*
		 * Wrapping changes without an input event when the pane narrows. Observe
		 * the field itself (also inside MentionField), but ignore height-only
		 * deliveries caused by our own measurement to avoid a resize feedback loop.
		 * A queued callback may outlive disconnect or a draft effect replacement.
		 */
		if (typeof ResizeObserver === "undefined") return;
		let mounted = true;
		let width = field.getBoundingClientRect().width;
		const observer = new ResizeObserver(() => {
			if (!mounted) return;
			const nextWidth = field.getBoundingClientRect().width;
			if (nextWidth === width) return;
			width = nextWidth;
			measure();
		});
		observer.observe(field);
		return () => {
			mounted = false;
			observer.disconnect();
		};
	}, [inputValue]);

	/*
	 * PASTE AND DROP, ON THE BAR RATHER THAN ON AN ANCESTOR.
	 *
	 * The rules are `attachmentPasteHandlers`' (team-bridge-attachments.tsx), which
	 * is what the bridge's own strip has always used: only IMAGES are taken, a paste
	 * that also carries text keeps its default because the reader is pasting prose -
	 * unless that text is only the files' names, a Finder copy's plain string
	 * (issue #1573, `imagePasteCancelsText`) - and `dragover` is prevented only
	 * when the drag actually carries files - a `preventDefault` on every dragover
	 * makes the whole pane a drop target and swallows text drags.
	 *
	 * They live here, not in that module, because that helper needs the staging
	 * HOOK's state while this bar stages local PATHS into the input store; sharing
	 * the shape and not the object is what keeps the two from being rewritten apart.
	 */
	const pasteHandlers = {
		onPaste: (event: ReactClipboardEvent<HTMLDivElement>) => {
			const files = transferredFiles(event.clipboardData);
			if (files.length === 0) return;
			if (imagePasteCancelsText(event.clipboardData)) event.preventDefault();
			void addFiles(files);
		},
		onDragOver: (event: ReactDragEvent<HTMLElement>) => {
			if (Array.from(event.dataTransfer.types).includes("Files"))
				event.preventDefault();
		},
		onDrop: (event: ReactDragEvent<HTMLElement>) => {
			const files = transferredFiles(event.dataTransfer);
			if (files.length === 0) return;
			event.preventDefault();
			void addFiles(files);
		},
	};

	const addFiles = useCallback(
		async (files: readonly File[]) => {
			/*
			 * THE BOX'S WRITABILITY IS THE GATE, NOT THE HUB'S CAPABILITY.
			 *
			 * `canAttach` is what offers the CONTROL - an affordance that cannot work
			 * is a dead end - but a picture that arrives by drop or paste is already
			 * the reader's, and refusing to stage it would leave them holding a file
			 * with nothing on screen to explain it. So it stages, and the SEND is
			 * where the capability is refused, in words (see the page's `submit`):
			 * pinned by `team-bridge-attachments.test.mjs`'s page R3-01, which stages
			 * a picture against a hub with no capability and expects exactly one chip
			 * plus the capability sentence.
			 */
			if (disabled) return;
			const store = useConversationInputStore.getState();
			const started = scopeReceipt.current;
			const { images, generic } = await splitBridgeFiles(files);
			if (scopeReceipt.current !== started) return;
			if (generic.length) fileStateAdd(generic);
			for (const file of images) {
				/*
				 * THE DRAFT KEEPS PATHS, NOT BYTES. `conversation-input-store` is
				 * persisted to localStorage, so a data URL here would write a base64
				 * copy of every dropped image to disk; a path is a short string whose
				 * bytes are read only if the message is sent. A `File` with no path -
				 * one dragged out of another page - answers "" and there the data URL
				 * is all the renderer will ever have.
				 */
				const path = window.api?.getPathForFile?.(file) ?? "";
				if (path) {
					store.addAttachment(conversationId, {
						id: uuidv4(),
						path: normalizePath(path),
					});
					continue;
				}
				const dataUrl = await readFileAsDataUrl(file);
				if (dataUrl && scopeReceipt.current === started)
					store.addAttachment(conversationId, { id: uuidv4(), path: dataUrl });
			}
		},
		[conversationId, disabled, fileStateAdd],
	);

	const picker = useRef<HTMLInputElement>(null);
	const hasContent =
		inputValue.trim().length > 0 || chips.length > 0 || files.chips.length > 0;
	const blocked = disabled;
	const showSpinner = sending || sendInFlight;

	/*
	 * THE PALETTE'S CARET HAND-OFF (UX round 1, U1 on #1673). Registered with
	 * the same one-slot registry the chat composer uses (`composer-field.ts`), so
	 * the palette's close-time restore (`handCaretToComposer`) can name and focus
	 * this field when a pick moved the view. Only one composer is ever mounted:
	 * the chat pane and Team Bridge are separate routes, and the unregister is
	 * scoped to this registration, so a late teardown of either cannot clear the
	 * other.
	 */
	const giveCaret = useCallback(() => {
		const field = textareaRef.current;
		if (!field) return;
		field.focus();
		clearTeamBridgeComposerFocusRequest();
	}, [textareaRef]);
	const composerNode = useCallback(() => textareaRef.current, [textareaRef]);
	useEffect(
		() => registerComposerFocus(giveCaret, composerNode),
		[giveCaret, composerNode],
	);
	/*
	 * A pick from another route lands before this composer exists (lazy route,
	 * then the status, list and directory reads), so the close-time restore has
	 * nothing to hand to. The pick leaves a request instead, honoured here once
	 * the field is usable for the conversation it opened
	 * (`team-bridge-composer-focus.ts` owns the rules). Re-asked on a
	 * conversation change because a pick made on Team Bridge reuses this mount.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `conversationId` is a TRIGGER (a pick made on Team Bridge keeps this mount and changes only the conversation); the body reads the live request and the live caret.
	useEffect(() => {
		if (blocked || !teamBridgeComposerFocusPending()) return;
		const field = textareaRef.current;
		if (!field) return;
		const active = document.activeElement;
		if (active === field) {
			clearTeamBridgeComposerFocusRequest();
			return;
		}
		const disposition = composerFocusDisposition(active);
		if (disposition === "take") giveCaret();
		else if (disposition === "drop") clearTeamBridgeComposerFocusRequest();
	}, [blocked, conversationId, giveCaret, textareaRef]);

	/*
	 * DICTATION, IN THE BAR RATHER THAN BESIDE IT (the operator's acceptance).
	 *
	 * The capability is the shared probe the five speech surfaces read, and the
	 * reason a disabled mic carries is the one copy table they share - so this
	 * box cannot tell a signed-out reader to check their microphone. The gate is
	 * the COMPOSER's writability, not a turn being idle: the Bridge writes
	 * mid-turn, and dictation is a state of this box.
	 */
	const { canUseRadientSpeech, speechBlock } =
		recordingProbe ?? NO_RECORDING_PROBE;
	const canEnableRecordingFeature = canUseRadientSpeech;
	const recordingUnavailableReason = speechUnavailableReason(
		"recording",
		speechBlock,
	);
	const dictation = useTeamBridgeDictation({
		id: DICTATION_REGISTRATION_ID,
		canRecord: !blocked && canEnableRecordingFeature,
		onTranscript: (text) => appendTranscriptText(text),
	});
	/*
	 * THE MICROPHONE'S TOOLTIP TEACHES BOTH DOORS, from the same two sources the
	 * shared composer reads: the registry's start-recording chord and the
	 * push-to-talk binding `resolvePushToTalkBinding` resolves. `null` from the
	 * chord hook means this window has no chord door (a shadowed binding), which
	 * is the arm that says only what the control does.
	 */
	const shortcutLabel = useRecordingShortcutLabel(rendererPlatform());
	const pttBinding = resolvePushToTalkBinding();
	// Either door cleared means the plain arm: never "or hold " with an empty part.
	const recordingHint = recordingHintParts(
		shortcutLabel,
		pttBinding?.label ?? null,
	);
	const recordingTitle = !canEnableRecordingFeature
		? recordingUnavailableReason
		: recordingHint === null
			? t("ui.chat.composer.start_recording")
			: t("ui.chat.composer.start_recording_hint", {
					shortcut: isolateLtr(recordingHint.shortcut),
					pushToTalk: recordingHint.pushToTalk,
				});

	/*
	 * THE MICROPHONE'S PRESS, as a timestamp: a hold and a tap are the same two
	 * events, and the elapsed press is what tells them apart.
	 */
	const holdStartedAt = useRef(0);
	const MIN_CLIP = MIN_DICTATION_CLIP_MS;

	return (
		<div className="flex w-full flex-col gap-1.5">
			{/* The mention notice sits above the bar for the reason the chips do: it
			    is a sentence about the draft, not a row of the bar, so the bar keeps
			    its field-plus-controls shape in every state (mentions/). */}
			<MentionNotice mentions={mentions} />
			<TeamBridgeFilesStrip state={files} />
			{chips.length > 0 && (
				/*
				 * Chips are not part of the bar's own line (operator: an attachment may
				 * legitimately change the height). They sit ABOVE it, so the bar itself
				 * stays a bar.
				 */
				<div className="max-h-[240px] shrink-0 overflow-y-auto">
					<AttachmentsPreview
						attachments={chips}
						onRemoveAttachment={(id) => removeAttachment(conversationId, id)}
						disabled={blocked}
					/>
				</div>
			)}
			{/*
			 * THE TAKE THAT OUTLIVED ITS FAILURE, above the box and only while it is in
			 * hand: a transient fault is the class where sending the same bytes again
			 * is an action a person can take, so the row offers it. A refusal is not
			 * offered back - re-sending a decision cannot change it - and is said in a
			 * toast instead, from the one failure-copy table the speech surfaces share.
			 */}
			{dictation.failure !== null && (
				<div
					data-dictation-failure=""
					className="flex items-center gap-2 px-2 [min-height:1.5rem]"
				>
					<CircleAlert
						aria-hidden="true"
						className="size-3.5 shrink-0 text-danger"
					/>
					<span className="min-w-0 flex-1 text-body-sm text-ink-muted">
						{dictation.failure}
					</span>
					<Button
						type="button"
						variant="link"
						size="sm"
						className="h-7 shrink-0 px-2 underline"
						onClick={dictation.retry}
					>
						{t("ui.common.actions.retry")}
					</Button>
				</div>
			)}
			{/*
			 * THE BAR: one borderless box on `elevated`, the field on its own line and
			 * the controls on the line below it (operator direction, 2026-10-30: the
			 * pre-adoption shape, "borderless, full width, less rounding, controls on
			 * the line below the field"). It is separated from the pane by the GROUND
			 * value, never by a rule, and it runs the pane's full width.
			 *
			 * THE RING IS DRAWN OUTSIDE THE BOX (`outline-2` at `outline-offset-2`)
			 * and promoted from the field with `:has`, so the box a reader sees
			 * focused is the box they type into. Nothing that encloses this file's
			 * root may become a bounded scroller: that clips the ring's top edge,
			 * which is the defect `team-bridge-composer-ring.test.mjs` pins.
			 */}
			<div
				/* THE DROP TARGET IS THE BAR, not the field: a drag lands anywhere over
				   the box, including its padding, and the bridge's strip has always read
				   it that way. */
				{...pasteHandlers}
				/* The same field-over-material role as the main chat composer;
				 * a second opaque elevated fill would mask the chosen glass. */
				data-glass-region="composer"
				data-composer-bar=""
				className={cn(
					/* `rounded-md` (10px), not `rounded-lg` (14px): the operator asked for LESS
					   rounding than the shared composer, and `rounded-lg` measured rounder than
					   the pre-#1483 bar's 12px (design review round 3, D1). `group` lets the
					   hint below read the field's focus without React state. */
					"group flex w-full flex-col rounded-md bg-elevated transition-colors duration-fast ease-out-quart",
					"has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-accent has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-solid",
				)}
			>
				{/*
				 * THE FIELD IS WRAPPED, NOT REPLACED, for @-mentions: `MentionField`
				 * renders nothing of its own while mentions are inert, and otherwise a
				 * `relative` box that positions the highlight overlay and the popover
				 * against the field. It stays on the field's own line so the control
				 * row below is untouched by the popover.
				 */}
				<MentionField
					mentions={mentions}
					fieldRef={textareaRef}
					text={inputValue}
				>
					<textarea
						ref={textareaRef}
						id={fieldId}
						rows={1}
						value={inputValue}
						disabled={blocked}
						aria-label={placeholder}
						aria-describedby={disabledReasonId}
						placeholder={placeholder}
						onChange={(event) => {
							setInputValue(event.target.value);
							typing.onInput(event.target.value);
						}}
						/* Capture-phase, so this never collides with the `onBlur` the
						   mention binding may spread onto the same field. */
						onBlurCapture={typing.onBlur}
						{...(dictation.isRecording || dictation.isPreparing
							? {
									// A live take owns Enter/Escape via the window listener.
									// Do not let mention selection or normal submission prevent
									// the event first (R1); outside a take both retain their order.
									onKeyDown: () => {},
								}
							: mentions.bindField({ onKeyDown: handleKeyDown }))}
						/*
						 * THE FIELD GROWS AND SHRINKS FROM ITS OWN CONTENT, which is the half of
						 * the shared composer this bar keeps (operator: the old box "didn't
						 * increase the height ... you'd only be able to scroll and see one line
						 * at a time"). `resize-none` because the growth belongs to the measure
						 * above, and the cap is `FIELD_MAX_HEIGHT` in the same place: a drag
						 * handle could exceed it and would be a second opinion of the height.
						 *
						 * `min-h-9` is the resting line (20px of leading + the field's own 8px
						 * padding each side), so the empty bar is compact and no second line is
						 * reserved for anything - dictation included. `relative` so the field
						 * paints above the mention overlay `MentionField` positions under it.
						 */
						className="relative block min-h-9 w-full resize-none bg-transparent px-3 pt-2.5 pb-1.5 text-[14px] leading-5 text-ink outline-none placeholder:text-ink-dim disabled:cursor-not-allowed disabled:text-ink-dim"
					/>
				</MentionField>
				{/*
				 * THE CONTROL ROW, AND THE RECORDING STRIP'S HOME.
				 *
				 * The row is a fixed 36px in EVERY state - idle, preparing, recording,
				 * transcribing - so dictation adds no height to the bar at rest and no
				 * strip is left standing under it when the take is over. That dead strip
				 * is the defect the operator reported against the previous composer: an
				 * idle bar is one row, and the strip occupies that same row only while a
				 * take exists.
				 */}
				<div
					data-composer-controls=""
					className="flex h-9 min-w-0 items-center gap-1 px-1.5 pb-1.5"
				>
					{dictation.isRecording || dictation.isPreparing ? (
						<>
							{/*
							 * THE STRIP: a mark, the state in words, the elapsed reading, then the
							 * two doors. `aria-live` because the state changes without a press
							 * (the release confirms, the recorder stops), so a reader that is not
							 * looking at the row still hears that a take is over.
							 */}
							<span
								data-dictation-strip=""
								aria-live="polite"
								className="flex min-w-0 flex-1 items-center gap-2 ps-1.5"
							>
								<span
									aria-hidden="true"
									className={cn(
										"size-2 shrink-0 rounded-full",
										dictation.isPreparing
											? "bg-accent"
											: "animate-pulse bg-danger",
									)}
								/>
								<span className="shrink-0 font-medium text-meta-sm text-ink">
									{dictation.isPreparing
										? t("ui.chat.composer.starting_recording")
										: t("ui.chat.composer.placeholder.recording")}
								</span>
								{dictation.isRecording && (
									<span
										data-dictation-elapsed=""
										className="shrink-0 font-mono text-meta-sm tabular-nums text-ink-muted"
									>
										{formatElapsed(dictation.elapsedMs)}
									</span>
								)}
							</span>
							{dictation.isRecording && (
								<Button
									variant="ghost"
									size="icon-sm"
									className="shrink-0 text-success hover:bg-success-wash hover:text-success"
									aria-label={t("ui.chat.composer.confirm_recording")}
									title={t("ui.chat.composer.confirm_recording_hint")}
									onClick={dictation.confirm}
								>
									<Check aria-hidden="true" />
								</Button>
							)}
							{/*
							 * CANCEL HAS NO `disabled`, deliberately: it is the microphone's own
							 * off switch, and a box that refuses input must still be able to end
							 * a take it already started.
							 */}
							<Button
								variant="ghost"
								size="icon-sm"
								className="shrink-0 text-danger hover:bg-danger-wash hover:text-danger"
								aria-label={t("ui.chat.composer.cancel_recording")}
								title={t("ui.chat.composer.cancel_recording_hint")}
								onClick={
									dictation.isRecording
										? dictation.cancel
										: () => dictation.stop("abort")
								}
							>
								<X aria-hidden="true" />
							</Button>
						</>
					) : dictation.isTranscribing ? (
						/*
						 * THE TAKE IS WITH THE TRANSCRIPTION SERVICE: one indeterminate
						 * element and the words, in the same row the strip vacated - so the
						 * bar does not move between recording and processing.
						 */
						<span
							data-dictation-transcribing=""
							aria-live="polite"
							className="flex min-w-0 flex-1 items-center gap-2 ps-1.5"
						>
							<Spinner size="sm" />
							<span className="truncate font-medium text-body-sm text-ink-muted">
								{t("ui.chat.composer.processing_audio")}
							</span>
						</span>
					) : (
						<>
							{/* THE CHORD, AT THE POINT OF TYPING and inside the row, so it
							    reserves no line of its own. It never leaves the layout:
							    `opacity` carries its visibility so the controls cannot reflow.
							    It shows only on an EMPTY, FOCUSED field - the moment someone is
							    about to type - and gets out of the way once a draft exists, where
							    a long caption beside the send control competed with it (design
							    review round 3, D2). Focus is read by CSS through the bar's
							    `group`, so no render follows a focus change. */}
							<span
								className={cn(
									"min-w-0 flex-1 truncate ps-1.5 text-meta-sm text-ink-dim opacity-0 transition-opacity duration-fast",
									!hasContent && "group-has-[textarea:focus]:opacity-100",
								)}
								// Read out only while it can show: on the empty field.
								aria-hidden={hasContent}
							>
								{hint ?? t("ui.teamBridge.composer.hint")}
							</span>
							{/*
							 * THE HOLD-TO-TALK BUTTON (operator: "a hold-to-talk button in the
							 * composer that records while held and transcribes on release").
							 * It starts a take on a press AND is the control the push-to-talk
							 * hold drives through the manager - one handler, two doors.
							 *
							 * It is NOT disabled while the acknowledgment is up: a second press
							 * is refused by the take's own guard, and disabling the control the
							 * reader just pressed makes a 28px target go inert under their
							 * finger. `aria-busy` says the control is working.
							 */}
							<Button
								variant="ghost"
								size="icon-sm"
								className="shrink-0 text-ink-dim"
								aria-label={t("ui.chat.composer.start_recording")}
								aria-busy={dictation.isPreparing || undefined}
								title={recordingTitle}
								disabled={blocked || !canEnableRecordingFeature}
								/*
								 * HELD, IT RECORDS; RELEASED, IT TRANSCRIBES - and a TAP leaves the take
								 * running so the strip's Confirm is the door (operator: "a hold-to-talk
								 * button ... that records while held and transcribes on release").
								 *
								 * The two flows cannot share one `click`: a click arrives AFTER the
								 * pointerup that confirmed a hold, so it would start a fresh take on
								 * every release. `pointerdown` starts, `pointerup` confirms when the
								 * press outlived the take's own floor, and the click handler is left
								 * to the KEYBOARD's activation only (`detail === 0`), which is how a
								 * reader who never touched a pointer gets the same control.
								 */
								onPointerDown={(event) => {
									if (event.button !== 0) return;
									/*
									 * CAPTURE IS BEST-EFFORT: it keeps a hold's release ours when the
									 * pointer leaves the button, and a synthetic press (a test rig, a
									 * story's play function) has no real pointer to capture. A refused
									 * capture must not take the press with it.
									 */
									try {
										event.currentTarget.setPointerCapture(event.pointerId);
									} catch {
										// A press that cannot be captured still starts and still settles.
									}
									holdStartedAt.current = performance.now();
									void dictation.start();
								}}
								onPointerUp={(event) => {
									/*
									 * ONLY A CAPTURED PRESS IS OUR RELEASE. An engine without pointer
									 * capture (or a synthetic press from a rig) answers nothing here,
									 * so the press settles on the button itself, which is where it
									 * started - a hold that cannot be captured is a tap, never a lost
									 * microphone.
									 */
									if (
										event.currentTarget.hasPointerCapture?.(event.pointerId) !==
										true
									)
										return;
									event.currentTarget.releasePointerCapture?.(event.pointerId);
									if (performance.now() - holdStartedAt.current < MIN_CLIP)
										return;
									dictation.confirm();
								}}
								onClick={(event) => {
									if (event.detail === 0) void dictation.start();
								}}
							>
								<Mic aria-hidden="true" />
							</Button>
							{(canAttach || files.enabled) && (
								<>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={t(
											files.enabled
												? "ui.teamBridge.files.add"
												: "ui.teamBridge.attachments.add",
										)}
										title={t(
											files.enabled
												? "ui.teamBridge.files.add"
												: "ui.teamBridge.attachments.add",
										)}
										disabled={blocked}
										onClick={() => picker.current?.click()}
									>
										{files.enabled ? (
											<Paperclip size={16} aria-hidden="true" />
										) : (
											<ImagePlus size={16} aria-hidden="true" />
										)}
									</Button>
									<input
										ref={picker}
										type="file"
										// A hint for the OS picker only; the bytes are sniffed regardless.
										accept={
											fileContext?.capability
												? undefined
												: "image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
										}
										multiple
										hidden
										tabIndex={-1}
										onChange={(event) => {
											void addFiles(Array.from(event.target.files ?? []));
											// Reset so picking the same file twice still fires a change.
											event.target.value = "";
										}}
									/>
								</>
							)}
							{trailing}
							<Button
								size="icon-sm"
								/* A 28px accent key with the controls' own 6px corner (visual
								   refresh §3.2 Composer): the circle read as a floating badge
								   beside square ghost controls in the same toolbar row.
								   AT REST IT IS A GHOST GLYPH, NOT A WELL (design round 1, D3):
								   `primary`'s disabled state paints `sunken`, which in the
								   raised `elevated` card was the darkest, most saturated object
								   in an empty composer. Accent only while there is something to
								   send (or it is sending); otherwise the `ghost` disabled state,
								   a transparent ground with `ink-disabled`, as Slack and Discord
								   show an idle send. */
								variant={hasContent || showSpinner ? "primary" : "ghost"}
								className="shrink-0 rounded-sm"
								disabled={
									!hasContent ||
									blocked ||
									sendDisabled ||
									showSpinner ||
									files.busy ||
									files.blocked
								}
								aria-label={t("ui.teamBridge.composer.send")}
								onClick={() => void handleSubmit()}
							>
								{showSpinner ? <Spinner size="sm" /> : <ArrowUp size={16} />}
							</Button>
						</>
					)}
				</div>
			</div>
		</div>
	);
};
