/**
 * The inbound Team Bridge card's detail pane, in every body state (bridge-body
 * design §7 item 3). Production `BridgeDetail` + `BridgeCardBodySection`, with
 * the read answered by an in-story transport instead of the desktop door, so
 * each state is the parser's and the section's real output for a pinned §4
 * frame. `Before` is the pane as it shipped before the read existed (and as an
 * older backend still renders it): the capability gate closed.
 */

import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import {
	BridgeCardBodySection,
	type BridgeCardBodyTransport,
} from "./bridge-card-body";
import { BridgeDetail } from "./tool-detail";
import "../../../../styles/index.css";

const item = (fields: Record<string, unknown>) => ({
	message_id: "bcmsg_story",
	conversation_id: "bcv_story",
	...fields,
});
const answer =
	(frame: unknown): BridgeCardBodyTransport =>
	async () =>
		frame;

const SHORT =
	"Hi! Could your agent re-run the **Q3 churn export** with the new `region` filter? The old one is in [the shared drive](https://example.com/drive).";
const LONG = [
	"## Release checklist for Thursday",
	"",
	"Thanks for picking this up. Here is everything I know so far, roughly in the order it needs doing:",
	"",
	"1. Freeze the `main` branch at noon and cut the release candidate from it.",
	"2. Run the migration dry-run against the staging snapshot and post the timing.",
	"3. Check the three flaky integration tests; two of them are probably the clock skew we saw last week.",
	"4. Draft release notes from the merged pull requests since the last tag.",
	"",
	"If anything blocks, ping me in this thread rather than the channel, so the on-call rotation is not paged for it. The rollback plan is the same as last time: revert the deploy, then restore the feature flags from the snapshot we take before step one.",
	"",
	"Last line of the message: END.",
].join("\n");
/** Short lines under the character limit: folds by line count (D3). */
const SHORT_LINES = Array.from(
	{ length: 20 },
	(_, index) => `- [ ] step ${index + 1}: check the box`,
).join("\n");
/** One paragraph over the character limit: the prose cut ends in "…" (D3). */
const PROSE = `${"The rollback plan is the same as last time, so revert the deploy first and then restore the flags. ".repeat(7)}Last words: END.`;

const TRANSPORTS: Record<string, BridgeCardBodyTransport | null> = {
	before: null,
	loading: () => new Promise(() => {}),
	admitted: answer({
		v: 1,
		items: [item({ state: "admitted", body: SHORT, source: "local" })],
		more: 0,
	}),
	long: answer({
		v: 1,
		items: [item({ state: "admitted", body: LONG, source: "hub" })],
		more: 0,
	}),
	shortLines: answer({
		v: 1,
		items: [item({ state: "admitted", body: SHORT_LINES, source: "hub" })],
		more: 0,
	}),
	prose: answer({
		v: 1,
		items: [item({ state: "admitted", body: PROSE, source: "hub" })],
		more: 0,
	}),
	held: answer({
		v: 1,
		items: [
			item({
				state: "held",
				hold: { class: "awaiting_review", held_for_s: 40 },
			}),
		],
		more: 0,
	}),
	heldTransient: answer({
		v: 1,
		items: [
			item({ state: "held", hold: { class: "transient", held_for_s: 3 } }),
		],
		more: 0,
	}),
	refused: answer({ v: 1, items: [item({ state: "refused" })], more: 0 }),
	pending: answer({ v: 1, items: [item({ state: "pending" })], more: 0 }),
	notAdmitted: answer({
		v: 1,
		items: [item({ state: "not_admitted" })],
		more: 0,
	}),
	unavailable: answer({
		v: 1,
		items: [item({ state: "unavailable", reason: "other_account" })],
		more: 0,
	}),
	unavailableOffline: answer({
		v: 1,
		items: [item({ state: "unavailable", reason: "offline" })],
		more: 0,
	}),
	coalesced: answer({
		v: 1,
		items: [
			item({ message_id: "bcmsg_a", state: "admitted", body: "First one." }),
			item({ message_id: "bcmsg_b", state: "held" }),
			item({
				message_id: "bcmsg_c",
				state: "admitted",
				body: "And a follow-up with a list:\n\n- one\n- two",
			}),
		],
		more: 4,
	}),
	/** The #1977 D2 frame: 20 short bodies plus server overflow. */
	coalescedMany: answer({
		v: 1,
		items: Array.from({ length: 20 }, (_, index) =>
			item({
				message_id: `bcmsg_${index}`,
				state: "admitted",
				body: `Message ${index + 1} of the thread.`,
			}),
		),
		more: 3,
	}),
};

/** Press the first toggle matching `selector` once the read has landed. */
const press =
	(selector: string) =>
	async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		for (let tries = 0; tries < 50; tries += 1) {
			const toggle = canvasElement.querySelector<HTMLButtonElement>(selector);
			if (toggle) {
				toggle.click();
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	};

/** The pane exactly as `BridgeIncomingRow` composes it, open. */
const Pane: FC<{ state: string }> = ({ state }) => {
	const transport = TRANSPORTS[state] ?? undefined;
	const offered = TRANSPORTS[state] !== null;
	return (
		<BridgeDetail
			isError={false}
			view={{
				headline: "Received from Ola Fagbemi · Direct message",
				body: null,
				// As the row does (review R3): without the read, today's sentence
				// stays in the outcome slot above the provenance line.
				outcome: offered ? null : t("ui.chat.bridgeReceipt.unavailable"),
				internals: [],
				raw: "[team_bridge message envelope]",
			}}
		>
			<div className="flex flex-wrap items-center justify-between gap-2 text-ink-dim text-meta">
				<p data-bridge-provenance="">{t("ui.chat.bridgeReceipt.provenance")}</p>
				{/* i18n: ignore - fixed story timestamp, not product copy */}
				<time>Nov 18, 2026, 9:41 AM</time>
			</div>
			{offered ? (
				<BridgeCardBodySection
					sessionId="a1b2c3d4e5f6"
					entryId={`story${state}`}
					enabled
					transport={transport}
				/>
			) : null}
		</BridgeDetail>
	);
};

const meta: Meta<typeof Pane> = {
	title: "Chat/Trace/Bridge card body",
	component: Pane,
	render: (args) => (
		<div className="w-[640px] bg-surface p-4">
			<Pane {...args} />
		</div>
	),
};
export default meta;
type Story = StoryObj<typeof Pane>;

export const Before: Story = { args: { state: "before" } };
export const Loading: Story = { args: { state: "loading" } };
export const Admitted: Story = { args: { state: "admitted" } };
export const LongCollapsed: Story = { args: { state: "long" } };
/** The same body after the reader pressed "Show more" (the story presses it). */
export const LongExpanded: Story = {
	args: { state: "long" },
	play: press("[data-bridge-body-toggle]"),
};
export const ShortLinesCollapsed: Story = { args: { state: "shortLines" } };
export const ProseCollapsed: Story = { args: { state: "prose" } };
export const Held: Story = { args: { state: "held" } };
export const HeldTransient: Story = { args: { state: "heldTransient" } };
export const Refused: Story = { args: { state: "refused" } };
export const Pending: Story = { args: { state: "pending" } };
export const NotAdmitted: Story = { args: { state: "notAdmitted" } };
export const Unavailable: Story = { args: { state: "unavailable" } };
export const UnavailableOffline: Story = {
	args: { state: "unavailableOffline" },
};
export const Coalesced: Story = { args: { state: "coalesced" } };
export const CoalescedManyCollapsed: Story = {
	args: { state: "coalescedMany" },
};
/** The many-message card after the reader pressed the card's "Show more". */
export const CoalescedManyExpanded: Story = {
	args: { state: "coalescedMany" },
	play: press("[data-bridge-card-toggle]"),
};

/** Every state on one page, so one navigation captures the whole set. */
export const AllStates: Story = {
	render: () => (
		<div className="flex w-[640px] flex-col gap-4 bg-surface p-4">
			{Object.keys(TRANSPORTS).map((state) => (
				<div key={state} className="flex flex-col gap-1">
					{/* i18n: ignore - story section label */}
					<div className="font-mono text-ink-dim text-mono-sm">{state}</div>
					<Pane state={state} />
				</div>
			))}
		</div>
	),
};
