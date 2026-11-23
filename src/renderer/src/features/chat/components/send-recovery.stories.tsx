/**
 * The composer's "cannot send" line (D4) and a failed message's fix (D3),
 * onboarding friction 2026-11.
 *
 * The line is the production `SendBlockedLineView`; the in-context frames are
 * `Chat/Composer band` (`EmptyChatNoProvider`, `BlockedNoModel`,
 * `BlockedServerOffline`, `BlockedColumnFloor`). The undelivered rows render
 * the production `UndeliveredLineView` with each state's derived sentence and
 * fix pinned (see the note above `FailedRows`).
 */

import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import {
	SendBlockedLineView,
	UndeliveredLineView,
} from "./send-recovery-action";
import "../../../styles/index.css";

const meta: Meta = { title: "Chat/Send recovery" };
export default meta;
type Story = StoryObj;

const Frame = ({ children }: { children: React.ReactNode }) => (
	<div className="flex w-[640px] flex-col gap-6 bg-canvas p-6">{children}</div>
);
const noop = () => {};

export const BlockedLines: Story = {
	render: () => (
		<Frame>
			<SendBlockedLineView block="no_provider" onFix={noop} />
			<SendBlockedLineView block="no_provider" emphasis onFix={noop} />
			<SendBlockedLineView block="no_model" onFix={noop} />
			<SendBlockedLineView
				block="local_not_default"
				brand="Ollama"
				onFix={noop}
			/>
			<SendBlockedLineView
				block="local_not_default"
				brand="Ollama"
				busy
				onFix={noop}
			/>
			<SendBlockedLineView block="offline" onFix={noop} />
			<SendBlockedLineView block="offline" busy onFix={noop} />
			<SendBlockedLineView
				block="offline"
				outcome="Still not responding · checked at 2:32:07 PM"
				onFix={noop}
			/>
		</Frame>
	),
};

/*
 * The rows below are the production `UndeliveredLineView` with the sentence and
 * fix `UndeliveredLine` derives (`undeliveredSentence`, `recoveryForFailure`),
 * so each state is pinned rather than left to whatever the live reads answer
 * in Storybook. The config rows carry the store's OWN sentence for the cause
 * (R1): what a 503 `runtime_unreachable` with the backend's vetted reason now
 * keeps.
 */
const view = (over: Partial<Parameters<typeof UndeliveredLineView>[0]>) => (
	<UndeliveredLineView
		sentence=""
		recovery={null}
		offerSendAgain
		onFix={noop}
		onSendAgain={noop}
		onEdit={noop}
		{...over}
	/>
);

const FailedRows = () => (
	<>
		{view({
			sentence: t("ui.recovery.send.failed_no_provider"),
			recovery: "connect_provider",
			offerSendAgain: false,
		})}
		{view({
			sentence: t("ui.recovery.send.failed_no_model"),
			recovery: "choose_model",
			offerSendAgain: false,
		})}
		{/* U2: the cause was fixed since; the row offers Send again. */}
		{view({ sentence: t("ui.recovery.send.failed_no_provider") })}
		{view({
			sentence:
				"Couldn't reach Local Operator. Your message may not have been sent.",
			recovery: "reconnect",
		})}
		{view({
			sentence:
				"Couldn't reach Local Operator. Your message may not have been sent.",
			recovery: "reconnect",
			busy: true,
		})}
		{/* Q2: the row's Reconnect states its result where it was pressed. */}
		{view({
			sentence: t("ui.recovery.send.still_offline", { time: "2:32:07 PM" }),
			recovery: "reconnect",
		})}
		{view({
			sentence:
				"Couldn't confirm your message was sent. Sending it again is safe.",
		})}
	</>
);

export const FailedSends: Story = {
	render: () => (
		<Frame>
			<FailedRows />
		</Frame>
	),
};

/**
 * The same rows at the chat column floor (550px), the frame long locales are
 * checked against with `?args=locale:ru` (design round 1 evidence gap 2).
 */
export const FailedSendsColumnFloor: Story = {
	render: () => (
		<div className="flex w-[550px] flex-col gap-6 bg-canvas p-6">
			<FailedRows />
		</div>
	),
};
