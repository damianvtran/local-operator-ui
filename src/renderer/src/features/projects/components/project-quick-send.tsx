/**
 * The quick-send strip: pick a linked session, type a message, send it — from
 * the project view, without opening the conversation.
 *
 * WHY IT EXISTS: the operator's own words — "steer from the project view". A
 * project's linked sessions are the conversations doing the work, and reaching
 * one meant leaving the project, finding the chat, typing, and coming back.
 *
 * WHAT IT IS NOW (operator, 2026-10-05 — one composer for every send): the box
 * is the app's own `MessageInput`, the same control the chat pane, the mini
 * quick-send popup and the agents ask page mount. It replaced a hand-rolled
 * `Input` + `Send` pair whose whole surface was a text field and one button, so
 * speech, file-dialog and drop attachments and the session's readings row only
 * existed in some of the app's entry points. The composer is mounted here the
 * way the mini mounts it (`mini-composer.tsx`): `transcriptless` (there is no
 * transcript on this page to hand it), `ownGutter` (the 24px chat inset exists
 * to align a box with a transcript's scrollbar gutter, and this card's own
 * padding is the edge), and a one-shot `sessions.get` reading of the SELECTED
 * session handed to the composer's status strip through the shared read
 * (`useSessionSnapshot`, the shape the mini's own read was carved into).
 *
 * WHAT IT DELIBERATELY IS NOT: a second send mechanism. Nothing here talks to
 * `sessions.message` itself; the store's admission decides modes, dedup and
 * failure classification, and this component only chooses the target, collects
 * the text and reports the outcome (toasts live with the detail screen, which
 * owns the write, `project-detail.tsx`).
 *
 * MODE VISIBILITY: when the selected session is mid-turn the strip says the
 * message will STEER the running turn. That is not decoration — it is the
 * difference between queueing behind a turn and interrupting it, and the
 * composer marks the same fact beside its own send control.
 *
 * AN IMAGE ALONE IS A MESSAGE (issue #790), and the composer's own admission
 * test carries it: the wire refuses only when text, images AND audio are all
 * absent (`Prompt.nonempty`), so a pasted screenshot alone is a message. The
 * hand-rolled strip's text-only predicate is gone with the hand-rolled field.
 */

import {
	MessageInput,
	type MessageInputHandle,
	type MessageInputProps,
} from "@shared/components/composer";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import { useSessionSnapshot } from "@shared/hooks/use-session-snapshot";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import type { DesktopLinkedSession } from "../../../../../shared/desktop-control-contract";
import { sessionLabel } from "../project-model";

export type ProjectQuickSendProps = {
	links: DesktopLinkedSession[];
	/** The session a message goes to; the section owns this so a row action can set it. */
	target: string | null;
	onTargetChange: (sessionId: string) => void;
	/**
	 * Sends one message through the chat's own admission path; resolves `true`
	 * when the message is on its way (including a provable replay), `false`
	 * when nothing was admitted — the detail screen owns the words either way.
	 *
	 * `attachments` is the composer's own list — pasted images as data URLs,
	 * file-dialog picks as paths, exactly the form the chat's send carries. The
	 * admission seam encodes it into the wire's images, admits the pair, and
	 * keeps the list as the payload identity the one-row-per-conversation dedup
	 * compares.
	 */
	onSend: (
		sessionId: string,
		text: string,
		mode: "prompt" | "steer",
		attachments: string[],
	) => Promise<boolean>;
	/**
	 * Bumped by a row's "message" action. Focusing is an EFFECT rather than a
	 * command because the box may have just mounted with the strip; the tick
	 * is what tells a strip that is already up to take the keyboard.
	 */
	focusTick: number;
};

/**
 * The composer needs a `conversationId` before a target is chosen, and the key
 * is the TARGET'S OWN ID at every moment: `MessageInput` keeps its draft in the
 * app's persisted input store keyed by this value and re-seeds the box from that
 * key whenever the value changes, so one key is one draft. The unseated constant
 * is therefore a draft of its own rather than a staging area for the first
 * session's - text typed before a target is chosen does NOT follow the user into
 * the session they then pick, exactly as it does not follow them from one
 * session to the next (a strip with no target still deserves a box that keeps
 * what was typed into it), and it cannot collide with a session id (ids are
 * minted hex, never this string).
 */
const UNSETTLED_TARGET_KEY = "project-quick-send:no-target";

/** Nothing above this box is a transcript; see `transcriptless` below. */
const EMPTY_MESSAGES: MessageInputProps["messages"] = [];

export const ProjectQuickSend: FC<ProjectQuickSendProps> = ({
	links,
	target,
	onTargetChange,
	onSend,
	focusTick,
}) => {
	const inputRef = useRef<MessageInputHandle | null>(null);
	const recordingProbe = useRadientCredentialProbe();
	/*
	 * THE SELECTED SESSION'S OWN READINGS, read one-shot when the target changes
	 * and handed to the composer's status strip. The mini's shape, not a copy of
	 * its code: `useSessionSnapshot` is that read, shared.
	 */
	const { frontend, refresh } = useSessionSnapshot();
	/*
	 * THE ADMISSION WINDOW, WHICH IS SILENT ON THIS MOUNT WITHOUT THIS (UX round 1,
	 * U1). The composer retires its text when the transcript receives the message,
	 * and this page has no transcript - so between the press and `onSend`
	 * resolving, the box still holds the text, the composer's pending-send sentence
	 * is a placeholder that value hides, and nothing on the surface says anything
	 * happened. The chat pane is covered by its echo and the mini by its Sent
	 * flash; the strip's own line is this one.
	 */
	const [sending, setSending] = useState(false);

	/*
	 * THE DRAFT KEY IS THE TARGET'S OWN SESSION ID once one is chosen, so the
	 * strip's text is the same draft the chat pane for that conversation holds -
	 * one draft per conversation, the rule the mini's seat key already follows -
	 * and the unseated constant until then.
	 */
	const draftKey = target ?? UNSETTLED_TARGET_KEY;

	useEffect(() => {
		if (target) void refresh(target);
	}, [target, refresh]);

	useEffect(() => {
		if (focusTick > 0) inputRef.current?.focusInput();
	}, [focusTick]);

	const sendable = links.filter((link) => link.exists);
	const selected = sendable.find((link) => link.session_id === target) ?? null;
	/*
	 * THE CAPTION'S BUSY IS THE LINK'S OWN RUNTIME, NOT THE SNAPSHOT'S (review round
	 * 1, R6). Two busy sources meet on this card: the project detail's `links`
	 * (`runtime.busy`, what chooses `steer` versus `prompt` at the send) and the
	 * snapshot's `streaming` (what the readings strip paints). They are different
	 * reads of the same session at different cadences and nothing in the wire makes
	 * them agree, so the SEND MODE and the caption both follow the link's value -
	 * the one the admission seam is handed - and the readings row is left to speak
	 * for its own snapshot. A disagreement would show as the row's streaming mark
	 * and this caption differing for one poll interval; it can never change what the
	 * press carries.
	 */
	const busy = selected?.runtime?.busy === true;

	return (
		<div
			data-tour-tag="project-quick-send"
			/*
			 * THE CARD IS `surface`, NOT `elevated` (design round 1, D1). The shared box
			 * is `bg-elevated`, and its documented separation from its column is the
			 * lightness STEP rather than an edge at rest - so a card painted in the same
			 * `elevated` token left the field with no boundary at all until focus
			 * (measured ΔE00 0.00 between the two fills). `surface` is the rung the ground
			 * ladder already defines between `canvas` and `elevated`, so the box steps off
			 * its card exactly as it steps off a chat column.
			 */
			className="flex flex-col gap-2 rounded-md bg-surface p-3"
		>
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-meta text-ink-muted">Send to</span>
				<Select
					value={target ?? undefined}
					onValueChange={(value) => onTargetChange(value)}
				>
					<SelectTrigger
						aria-label="Select the session to message"
						className="max-w-72"
					>
						<SelectValue placeholder="No session selected" />
					</SelectTrigger>
					<SelectContent>
						{sendable.map((link) => (
							<SelectItem key={link.session_id} value={link.session_id}>
								{sessionLabel(link)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{/*
				 * ONE LINE, THE MOST IMMEDIATE FACT FIRST (UX round 1, U1): the admission
				 * window outranks the steer caption because it is the user's own press being
				 * answered, and the caption returns the moment the send settles. The row is
				 * the strip's own and already carries this sentence for a busy target, so the
				 * in-flight state costs no new row and moves nothing (the row measured 244px
				 * of slack at 1380x900).
				 */}
				{sending ? (
					/* biome-ignore lint/a11y/useSemanticElements: `role="status"` is the polite announcement this sentence wants, and `<output>` - the element the rule suggests - is a form-result element with its own implied semantics; this is a statement about a send, not a form result. The same suppression, for the same reason, is on the readings strip's dropped-readings line. */
					<span role="status" className="text-meta text-ink-muted">
						Sending…
					</span>
				) : busy ? (
					<span className="text-meta text-ink-muted">
						The session is working — this message steers the running turn.
					</span>
				) : null}
			</div>
			{/*
			 * THE SHARED BOX (see the header): speech, attachments (file dialog,
			 * drop and paste) and the readings row, the same control every other
			 * send surface in the app mounts. Its `onSendMessage` seam is the
			 * STRIP's `onSend`, so the send still travels through `admitChatDraft`
			 * on the detail screen — this component adds no second path.
			 *
			 * `ownGutter` because the strip is not a chat column: the composer's
			 * 24px inset aligns a box with a transcript's scrollbar gutter, and
			 * this card's own `p-3` is the edge (the reason the mini passes it too).
			 */}
			<MessageInput
				ref={inputRef}
				conversationId={draftKey}
				messages={EMPTY_MESSAGES}
				isLoading={false}
				ownGutter
				transcriptless
				/*
				 * THE CLIPBOARD ROUTE STAYS TAUGHT (design round 1, D4). The hint is the
				 * strip's own pre-existing copy, and the operator called that copy in scope:
				 * the attach control is visible now, but "an image alone is a message"
				 * (#790) lands on this surface through the clipboard, and the hint is the
				 * only thing that says so. It is truthful for the file dialog and the drop
				 * zone too - paste is simply the route that has no visible affordance.
				 */
				placeholderOverride="Message the session — paste an image to attach it"
				cwd={frontend?.cwd}
				cwdReadOnlyReason="Quick send follows the conversation's directory."
				/*
				 * THE READINGS BELONG TO A TARGET, SO THEY LEAVE WITH IT (review round 2,
				 * n1). The hook retires the previous session's snapshot when the target
				 * CHANGES, but nothing retires it when the target goes away - and a strip
				 * that has lost its target shows the refusal sentence beside the last
				 * session's model, cwd and context, which reads as readings of a conversation
				 * this card is no longer aimed at. `target` is the term, not `selected`:
				 * the snapshot is keyed by the session the strip ASKED about, and a target
				 * that stopped being sendable is exactly the case that has to drop it.
				 */
				sessionStatus={frontend && target ? { frontend } : undefined}
				recordingProbe={recordingProbe}
				/*
				 * A STRIP WITH NOTHING TO SEND TO REFUSES ITS BOX AND SAYS WHY (review round
				 * 1, R5). The hand-rolled field this mounts replaced disabled its Send when no
				 * target was usable; the composer's Send predicate cannot see that fact, so a
				 * typed message with no target was a silent no-op. `hostNotice` is the
				 * composer's own channel for exactly this shape - a host state that refuses
				 * input, with the host's own sentence and placeholder - and `blocksInput`
				 * joins `isInputDisabled`, so typing, paste, dictation and the form's submit
				 * are refused together rather than one door at a time.
				 */
				hostNotice={
					target
						? undefined
						: {
								id: "project-quick-send-no-target",
								node: (
									<p className="text-meta text-ink-muted">
										Choose a session to send to.
									</p>
								),
								blocksInput: true,
								placeholder: "Choose a session to send to.",
							}
				}
				onSendMessage={async (content, attachments) => {
					if (!target) return false;
					setSending(true);
					try {
						/*
						 * `false` is the composer's own "put the text back" answer, and it
						 * is the honest one here: the admission seam reports whether the
						 * message left, and a refusal keeps the draft rather than spending
						 * it.
						 */
						return await onSend(
							target,
							content,
							busy ? "steer" : "prompt",
							attachments,
						);
					} finally {
						setSending(false);
						/*
						 * THE PRESS HANDS THE KEYBOARD BACK TO THE BOX. A pointer press focuses
						 * the Send control, and the browser drops focus to `<body>` when the send
						 * settles - measured: the next message needed a fresh click, while the
						 * Enter path kept the box focused (the renderer driver's
						 * `project-detail` scene asserts `document.activeElement` for exactly
						 * this). On a refusal the text is already back in the box, so the caret
						 * belongs there too.
						 */
						inputRef.current?.focusInput();
					}
				}}
			/>
		</div>
	);
};
