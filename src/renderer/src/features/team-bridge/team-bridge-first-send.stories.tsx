import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useEffect, useMemo, useState } from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { SHOT_WIDE_DATA_URL } from "./team-bridge-attachments.fixtures";
import {
	type TeamBridgeOrganization,
	asTeamBridgeTenantId,
} from "./team-bridge-model";
import { TeamBridgePageView } from "./team-bridge-page";
import type { TeamBridgeLocalRowPresentation } from "./team-bridge-send-presentation";

/** Full-page PRESENTATION proof, not a native send/API proof. The real list is
 * empty until the create receipt; only the shared projection supplies the row.
 * Theme remains the Storybook toolbar's choice, not a forced fixture palette. */
const tenantId = asTeamBridgeTenantId("tnt_first_send_fixture");
const self = "acct_first_send_ada";
const recipient = "acct_first_send_bea";
const clientRef = "first-send-fixture-stable-ref";
const localId = "local_first_send_fixture";
const serverId = "bcmsg_first_send_fixture";
const organization: TeamBridgeOrganization = {
	tenantId,
	name: "Northwind Collective",
	role: "owner",
	unread: 0,
};
const people: TeamBridgeDirectoryMember[] = [
	{
		account_id: self,
		display_label: "Ada",
		role: "owner",
		bridge_enabled: true,
		bridge_state: "active",
	},
	{
		account_id: recipient,
		display_label: "Bea",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
		agent: { endpoint_id: "bep_first_send_bea", name: "Aida", state: "active" },
	},
];

/**
 * The composer field's live numbers, re-read one frame after any scroll, input
 * or selection change - after the auto-grow layout effect has run, so the
 * numbers are the ones the reader sees.
 */
function useFieldReadout(enabled: boolean) {
	const [text, setText] = useState("");
	useEffect(() => {
		if (!enabled) return;
		let frame = 0;
		const read = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const field = document.querySelector<HTMLTextAreaElement>(
					"#storybook-root textarea",
				);
				if (!field) return;
				setText(
					`field scrollTop ${Math.round(field.scrollTop)} / ${field.scrollHeight - field.clientHeight} max · caret ${field.selectionStart}/${field.value.length} · height ${field.getBoundingClientRect().height}px · overflow-y ${getComputedStyle(field).overflowY}`,
				);
			});
		};
		read();
		document.addEventListener("scroll", read, true);
		document.addEventListener("input", read, true);
		document.addEventListener("selectionchange", read);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("scroll", read, true);
			document.removeEventListener("input", read, true);
			document.removeEventListener("selectionchange", read);
		};
	}, [enabled]);
	return enabled ? text : null;
}

/**
 * A stable draft journal for the story: `useMemo` on the seed text, so the view
 * does not see a new object every render and reset the draft under the capture.
 */
function useStoryDraft(seed: string) {
	return useMemo(() => ({ body: seed, pending: null }), [seed]);
}

function FirstSendPage({
	state: initialState,
	targetKind,
	width,
	withImage,
	allowSwap,
	dropped = 0,
	frozen = false,
	focusAction = "none",
	composer,
	readout = false,
	fieldScrollTop,
	fieldCaret,
}: {
	state: TeamBridgeLocalRowPresentation["state"];
	targetKind: "chief" | "person";
	/**
	 * The fixture's outer width. `desktop` is the shipped 1380px window and
	 * `narrow` 680px; a NUMBER is any other width a capture needs (design round 2,
	 * D5). The rail is a fixed 288px, so a capture names the OUTER width that
	 * gives the THREAD the width under test: 678 for a 390px thread, 460 for the
	 * app's 172px column floor. An outer 390 would leave a 102px thread - below
	 * the floor, and unreachable in the app, whose window minimum is 600px.
	 */
	width: "desktop" | "narrow" | number;
	withImage: boolean;
	allowSwap: boolean;
	/** Images the failed attempt had to abandon (design round 2, D15). */
	dropped?: number;
	/**
	 * Row actions do nothing. A capture tool that has no hover action can only
	 * hover a control by clicking it, and a live handler would then change the
	 * very state being captured.
	 */
	frozen?: boolean;
	/**
	 * Focus one row action on mount with `focusVisible`, so its keyboard ring can
	 * be captured by a tool that cannot press Tab. Programmatic, and said so.
	 */
	focusAction?: "none" | "retry" | "return" | "discard";
	/**
	 * Text the composer starts with. The view seeds its draft from `draftJournal`,
	 * so a story can show the composer GROWN or AT ITS CAP without anybody typing
	 * during a capture - which is the only way a still can prove the shape of a
	 * grown field.
	 */
	composer: string;
	/**
	 * Print the composer field's scrollTop, caret and height in the frame itself,
	 * so a capture of auto-grow carries its own numbers (frame F-A: does a
	 * keystroke at the cap keep the reader's place?). Story-only; the product
	 * never draws this.
	 */
	readout?: boolean;
	/**
	 * Put the reader somewhere inside a long draft before the capture: the field's
	 * own scroll offset and caret, set once after mount, with the field focused. A
	 * capture tool can scroll the page but not the field, and frame F-A needs a
	 * reader who scrolled UP inside their draft. Programmatic, and said so.
	 */
	fieldScrollTop?: number;
	fieldCaret?: number;
}) {
	const fieldReadout = useFieldReadout(readout);
	useEffect(() => {
		if (fieldScrollTop === undefined && fieldCaret === undefined) return;
		// One frame after mount: the auto-grow layout effect has measured by then.
		const frame = requestAnimationFrame(() => {
			const field = document.querySelector<HTMLTextAreaElement>(
				"#storybook-root textarea",
			);
			if (!field) return;
			field.focus({ preventScroll: true });
			if (fieldCaret !== undefined)
				field.setSelectionRange(fieldCaret, fieldCaret);
			if (fieldScrollTop !== undefined) field.scrollTop = fieldScrollTop;
		});
		return () => cancelAnimationFrame(frame);
	}, [fieldScrollTop, fieldCaret]);
	const draftJournal = useStoryDraft(composer);
	const [state, setState] = useState(initialState);
	useEffect(() => {
		if (focusAction === "none") return;
		const label = {
			retry: t("ui.common.actions.retry"),
			return: t("ui.teamBridge.message.return_to_draft"),
			discard: t("ui.teamBridge.message.discard"),
		}[focusAction];
		const control = [
			...document.querySelectorAll<HTMLButtonElement>(
				"[data-message-id] button",
			),
		].find((button) => button.textContent?.trim() === label);
		control?.focus({ focusVisible: true } as FocusOptions);
	}, [focusAction]);
	const [discarded, setDiscarded] = useState(false);
	useEffect(() => {
		setState(initialState);
		setDiscarded(false);
	}, [initialState]);
	const confirmed = state === "confirmed";
	const id = confirmed ? serverId : localId;
	const conversationId = "bcv_first_send_fixture";
	const message: TeamBridgeMessage = {
		id,
		conversation_id: confirmed ? conversationId : "local_first_send_target",
		seq: confirmed ? 1 : 0,
		sender: { account_id: self, kind: "human", display_label: "Ada" },
		body: "Could you take a look at this before we start?",
		origin: "human",
		created_at: "2026-10-28T12:00:00Z",
		attachments: withImage
			? [
					{
						id: confirmed ? "batt_first_send_fixture" : "local_image_fixture",
						mime: "image/png",
						width: 480,
						height: 360,
						size: 1024,
						state: confirmed ? "bound" : "staged",
					},
				]
			: [],
	};
	// A create receipt is not a fake rail entry: keep conversations empty even
	// after confirmation and pass the resolved receipt through the page seam.
	const resolved: TeamBridgeConversation | null = confirmed
		? {
				id: conversationId,
				tenant_id: tenantId,
				kind: "dm",
				name: "",
				visibility: "private",
				agent_capable: targetKind === "chief",
				status: "open",
				created_by: self,
				latest_seq: 1,
				last_read_seq: 1,
				last_message_at: message.created_at,
				unread_count: 0,
				muted: false,
				members: [
					{
						account_id: self,
						kind: "human",
						display_label: "Ada",
						role: "owner",
						state: "active",
					},
					{
						account_id: recipient,
						kind: targetKind === "chief" ? "agent" : "human",
						display_label: targetKind === "chief" ? "Aida (Bea)" : "Bea",
						role: "member",
						state: "active",
					},
				],
			}
		: null;
	const sendRows = new Map<string, TeamBridgeLocalRowPresentation>();
	if (!discarded)
		sendRows.set(id, {
			clientRef,
			state,
			previewUrls: withImage ? [SHOT_WIDE_DATA_URL] : [],
			droppedAttachments: dropped,
			onRetry: frozen ? () => {} : () => setState("pending"),
			onDiscard: frozen ? () => {} : () => setDiscarded(true),
		});
	return (
		/*
		 * A BOUNDED FRAME (design round 2, D10). `h-dvh` alone let the page grow
		 * to fit its content - the composer grew, the page grew with it, and the
		 * timeline stayed the same height in every frame, which is precisely the
		 * thing an auto-grow capture has to show it does NOT do. An explicit
		 * height plus `overflow-hidden` makes the column the window's height, so
		 * growth can only come out of the timeline.
		 */
		<div
			className="flex max-w-full flex-col overflow-hidden bg-canvas text-ink"
			style={{
				width:
					typeof width === "number" ? width : width === "narrow" ? 680 : 1380,
				height: "100dvh",
			}}
		>
			{fieldReadout !== null && (
				<div className="flex shrink-0 items-center gap-3 border-hairline border-b bg-surface px-3 py-2">
					<output data-field-readout className="font-mono text-[12px]">
						{fieldReadout}
					</output>
					{/*
					 * ONE KEYSTROKE AT THE CARET, the way the browser inserts it. A capture
					 * tool's "type" REPLACES the field's value, which is not what a reader
					 * does and collapses the draft; `insertText` goes through the same
					 * editing path as a key press - it inserts at the selection and fires
					 * the native `input` event React listens for. `onMouseDown` keeps the
					 * field focused, so the caret it inserts at is the reader's own.
					 */}
					<Button
						variant="ghost"
						data-insert-character
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => {
							const field = document.querySelector<HTMLTextAreaElement>(
								"#storybook-root textarea",
							);
							field?.focus({ preventScroll: true });
							document.execCommand("insertText", false, "x");
						}}
					>
						Type one character at the caret
					</Button>
				</div>
			)}
			{allowSwap && (
				<div className="flex shrink-0 items-center gap-3 border-hairline border-b bg-surface px-3 py-2 text-sm">
					<span>Projection fixture · no API dispatch</span>
					<Button onClick={() => setState("confirmed")}>
						Confirm server receipt
					</Button>
					<Button
						variant="ghost"
						onClick={() => {
							setDiscarded(false);
							setState("pending");
						}}
					>
						Reset pending
					</Button>
				</div>
			)}
			<div className="min-h-0 flex-1">
				<TeamBridgePageView
					selfAccountId={self}
					selfName="Ada"
					conversations={[]}
					resolvedConversation={resolved}
					draftJournal={draftJournal}
					target={{ type: targetKind, accountId: recipient }}
					messages={discarded ? [] : [message]}
					sendRows={sendRows}
					organizations={[organization]}
					scope={tenantId}
					totalUnread={0}
					people={people}
					peopleState="ready"
					listState="ready"
					messageState="ready"
					/* Return to draft is only decorated when the page can take a row
					 * back (design round 1, D4): without this the Failed story drew two
					 * of the three actions and the headline recovery affordance was
					 * never in any frame. The handler is a stub here, so this story
					 * evidences the ACTION SET, not the merge-with-typed-text behaviour -
					 * that half needs the live app. */
					onTakeBackSend={() =>
						frozen
							? null
							: {
									body: "Hi Ada, could we move the Wednesday review to Thursday?",
									attachments: [],
								}
					}
					onTarget={() => {}}
					onSend={() => undefined}
					onNewChannel={() => {}}
					onScopeChange={() => {}}
				/>
			</div>
		</div>
	);
}

const meta = {
	title: "Team Bridge/First send",
	component: FirstSendPage,
	parameters: { layout: "fullscreen" },
	args: {
		state: "pending",
		targetKind: "chief",
		width: "desktop",
		withImage: true,
		allowSwap: false,
		composer: "",
	},
	argTypes: {
		state: { control: "select", options: ["pending", "failed", "confirmed"] },
		targetKind: { control: "select", options: ["chief", "person"] },
		width: { control: "select", options: ["desktop", "narrow", 678, 460] },
		dropped: { control: "number" },
		frozen: { control: "boolean" },
		focusAction: {
			control: "select",
			options: ["none", "retry", "return", "discard"],
		},
		composer: { control: "text" },
		readout: { control: "boolean" },
		fieldScrollTop: { control: "number" },
		fieldCaret: { control: "number" },
	},
} satisfies Meta<typeof FirstSendPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {};
export const Failed: Story = { args: { state: "failed" } };

/** THREE LINES: the composer has grown but is still under its cap. */
export const ComposerGrown: Story = {
	args: {
		state: "confirmed",
		composer:
			"Ada - one thing before we start.\nThe Wednesday review moved to Thursday, and the brief needs the numbers from last quarter.",
	},
};

/** TWENTY LINES: past the cap, so the field scrolls instead of eating the thread. */
export const ComposerAtCap: Story = {
	args: {
		state: "confirmed",
		composer: Array.from(
			{ length: 20 },
			(_, index) =>
				`Line ${index + 1}: the quick brown fox jumps over the lazy dog.`,
		).join("\n"),
	},
};
/**
 * FRAME F-A (review A1): the capped composer with its numbers printed in the
 * frame. Scroll the field up, type one character, and the readout says whether
 * the reader's place survived the re-measure.
 */
export const ComposerAtCapReadout: Story = {
	args: { ...ComposerAtCap.args, readout: true },
};
/**
 * F-A's starting state: scrolled to the middle of the draft (100 of 217px), the
 * caret at the start of line 9 - inside the visible band, where a reader who
 * scrolled up to edit would have put it.
 */
export const ComposerAtCapScrolledUp: Story = {
	args: {
		...ComposerAtCap.args,
		readout: true,
		fieldScrollTop: 100,
		fieldCaret: Array.from(
			{ length: 8 },
			(_, index) =>
				`Line ${index + 1}: the quick brown fox jumps over the lazy dog.\n`,
		).join("").length,
	},
};
export const Confirmed: Story = { args: { state: "confirmed" } };
export const PersonPending: Story = { args: { targetKind: "person" } };
export const NarrowFailed: Story = {
	args: { state: "failed", width: "narrow", targetKind: "person" },
};
/** Design round 2, D5/D13: a 390px thread (678 outer, beside the 288px rail). */
export const Failed390: Story = { args: { state: "failed", width: 678 } };
/** The thread at the app's 172px column floor (460 - the 288px rail). */
export const FailedColumnFloor: Story = {
	args: { state: "failed", width: 460 },
};
/** Design round 2, D15: two abandoned images say so once. */
export const FailedTwoImagesDropped: Story = {
	args: { state: "failed", dropped: 2 },
};
/** Hover/focus captures: the actions are inert so a click can only hover. */
export const FailedFrozen: Story = { args: { state: "failed", frozen: true } };

/** These assertions are authored but not executed while the disk hold is active.
 * The image and row DOM identity assertions are the negative controls for a
 * superficial stable-URL fix that still remounts a wrapper or the image tile. */
export const Swap: Story = {
	args: { allowSwap: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const selector = (id: string) => `[data-message-id="${id}"]`;
		await waitFor(() =>
			expect(canvasElement.querySelector(selector(localId))).not.toBeNull(),
		);
		const row = canvasElement.querySelector(selector(localId));
		const image = row?.querySelector("img");
		expect(image).toBeTruthy();
		if (!row || !image) throw new Error("First-send fixture row/image missing");
		const before = image.getBoundingClientRect();
		expect(row).not.toHaveClass("lo-team-bridge-arrival");
		await userEvent.click(
			canvas.getByRole("button", { name: "Confirm server receipt" }),
		);
		await waitFor(() =>
			expect(canvasElement.querySelector(selector(serverId))).toBe(row),
		);
		expect(row.querySelector("img")).toBe(image);
		expect(image.getAttribute("src")).toBe(SHOT_WIDE_DATA_URL);
		expect(row).not.toHaveClass("lo-team-bridge-arrival");
		expect(image.getBoundingClientRect().width).toBe(before.width);
		expect(image.getBoundingClientRect().height).toBe(before.height);
		expect(canvas.queryByText(t("ui.teamBridge.message.sending"))).toBeNull();
	},
};
