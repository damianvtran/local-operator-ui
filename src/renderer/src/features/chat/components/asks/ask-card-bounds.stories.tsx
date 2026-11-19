import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import type {
	CanonicalFrontendState,
	PendingAsk,
	PendingDesktopGate,
} from "../../../../../../shared/desktop-session-contract";
import "../../../../styles/index.css";
import { QuestionDock } from "../trace/question-dock";
import { AskDrawer } from "./ask-drawer";
import {
	LONG_OPTIONS,
	LONG_QUESTION,
	PROPOSAL_LEGACY_TEXT,
	PROPOSAL_SUMMARY_TEXT,
} from "./long-ask.fixtures";

/*
 * BOUNDED ASK CARDS - the frames design review screenshots (`ask-bounds.tsx`).
 *
 * Each surface gets the 10k-character question and the proposal ask (both the
 * new summary contract and an older runtime's full-brief dump), in the light and
 * dark default themes. The pass condition is visible in the still: the card stops
 * at its cap, the body scrolls, and the options - plus, in the panel, the `Other`
 * row - and the composer stand-in below the dock are on screen.
 *
 * The notifications detail pane embeds the same `AskPanel`; its stories live with
 * the page harness (`notifications.stories.tsx`, `AskDetailLong*`), which is the
 * only place that pane can be reached with its real routing and data.
 */

const TS = 1_760_000_000_000;
const MINUTE = 60_000;
const NOW = TS + 12 * MINUTE;
const noop = () => undefined;

const gate = (over: Partial<PendingDesktopGate>): PendingDesktopGate => ({
	request_id: "req-long-1",
	kind: "ask",
	title: "",
	detail: "",
	options: [],
	secret: false,
	question_index: 0,
	question_total: 1,
	...over,
});

/*
 * THE CHAT COLUMN, reduced to what the bound is about: a transcript that takes
 * the remaining height, the dock, and a composer-sized box under it. The frame is
 * the viewport here (Storybook's iframe), so `vh` in the cap resolves against the
 * same box the app's window would give it.
 */
const ChatColumn = ({ children }: { children: ReactNode }) => (
	<div className="flex h-screen flex-col bg-canvas">
		<div className="min-h-0 flex-1 px-6 pt-4 text-ink-muted text-meta">
			Transcript…
		</div>
		<div className="mx-auto w-full max-w-3xl px-6">{children}</div>
		<div
			data-story-composer=""
			className="mx-auto mb-4 h-24 w-full max-w-3xl shrink-0 rounded-lg border border-control bg-surface px-4 py-3 text-ink-dim text-sm"
		>
			Composer — reply, or type your own answer
		</div>
	</div>
);

const dock = (pending: PendingDesktopGate) => (
	<ChatColumn>
		<QuestionDock gate={pending} onAnswer={noop} />
	</ChatColumn>
);

const LONG_ASK_GATE = gate({
	title: LONG_QUESTION,
	options: [
		{ label: "Go ahead", description: "Apply the plan to every tenant feed" },
		{ label: "Only the pilot tenants" },
		{ label: "Hold" },
	],
	recommended: 0,
});
const PROPOSAL_GATE = gate({
	kind: "approval",
	title: "account profile save",
	detail: PROPOSAL_SUMMARY_TEXT,
});
const PROPOSAL_LEGACY_GATE = gate({
	kind: "approval",
	title: "account profile save",
	detail: PROPOSAL_LEGACY_TEXT,
});

const ask = (over: Partial<PendingAsk> & { ask_id: string }): PendingAsk => ({
	created_at: TS,
	expires_at: TS + 60 * MINUTE,
	timeout_s: 3600,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [],
	...over,
});
const LONG_ASK = ask({
	ask_id: "a-long",
	questions: [
		{
			id: "plan",
			question: LONG_QUESTION,
			options: LONG_OPTIONS,
			recommended: 0,
			multi: false,
		},
	],
});
const PROPOSAL_ASK = ask({
	ask_id: "a-prop",
	questions: [
		{
			id: "apply",
			question: PROPOSAL_LEGACY_TEXT,
			options: [{ label: "Apply" }, { label: "Reject" }],
			multi: false,
		},
	],
});
const frontend = (
	asks: PendingAsk[],
): Pick<CanonicalFrontendState, "asks" | "asks_open" | "asks_truncated"> => ({
	asks,
	asks_open: asks.length,
});

const drawer = (asks: PendingAsk[]) => (
	<div className="flex h-screen justify-end bg-canvas">
		<div className="flex h-full w-[420px] flex-col">
			<AskDrawer
				frontend={frontend(asks)}
				scope="session"
				onClose={noop}
				nowMs={NOW}
				onAnswer={noop}
				onDecline={noop}
			/>
		</div>
	</div>
);

const meta: Meta = {
	title: "Chat/Asks/Bounded cards",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

const LIGHT = { theme: "localOperatorLight" };
const DARK = { theme: "localOperatorDark" };

export const DockLongQuestionLight: Story = {
	args: LIGHT,
	render: () => dock(LONG_ASK_GATE),
};
export const DockLongQuestionDark: Story = {
	args: DARK,
	render: () => dock(LONG_ASK_GATE),
};
export const DockProposalLight: Story = {
	args: LIGHT,
	render: () => dock(PROPOSAL_GATE),
};
export const DockProposalDark: Story = {
	args: DARK,
	render: () => dock(PROPOSAL_GATE),
};
/** An older runtime's full-brief dump: the incident payload, now bounded. */
export const DockProposalLegacyDumpLight: Story = {
	args: LIGHT,
	render: () => dock(PROPOSAL_LEGACY_GATE),
};
export const DockProposalLegacyDumpDark: Story = {
	args: DARK,
	render: () => dock(PROPOSAL_LEGACY_GATE),
};
export const PanelLongQuestionLight: Story = {
	args: LIGHT,
	render: () => drawer([LONG_ASK]),
};
export const PanelLongQuestionDark: Story = {
	args: DARK,
	render: () => drawer([LONG_ASK]),
};
export const PanelProposalLight: Story = {
	args: LIGHT,
	render: () => drawer([PROPOSAL_ASK]),
};
export const PanelProposalDark: Story = {
	args: DARK,
	render: () => drawer([PROPOSAL_ASK]),
};
