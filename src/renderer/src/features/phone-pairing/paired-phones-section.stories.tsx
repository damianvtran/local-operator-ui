/**
 * Settings → Phone access → Paired phones and Turn on phone approvals (pairing
 * design v2 §4.2; local-operator #3949 `phone_pairing`, #3950 `operator_setup`).
 * Presentational views with pinned data; the wired section is exercised by
 * `scripts/phone-pairing.test.mjs`.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { FC, ReactNode } from "react";
import {
	PairedPhonesView,
	PhoneApprovalsSetupView,
} from "./paired-phones-section";
import type { PairedPhone } from "./pairing-model";
import "../../styles/index.css";

const phones: PairedPhone[] = [
	{
		deviceId: "a1b2c3",
		name: "Ana's iPhone",
		platform: "ios",
		pairedAt: 1_762_400_000,
		lastSeen: 1_763_090_000,
		state: "paired",
	},
	{
		deviceId: "d4e5f6",
		name: "Chrome on Pixel 8",
		platform: "web",
		pairedAt: 1_762_900_000,
		lastSeen: null,
		state: "unconfirmed",
	},
	{
		deviceId: "0a0b0c",
		name: "Old Galaxy",
		platform: "android",
		pairedAt: 1_760_000_000,
		lastSeen: 1_761_000_000,
		state: "removing",
	},
];

const noop = () => {};

const Panel: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="max-w-[640px] bg-canvas p-6">{children}</div>
);

const meta: Meta = {
	title: "Phone pairing/Settings",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

export const PairedPhonesList: Story = {
	render: () => (
		<Panel>
			<PairedPhonesView phones={phones} onRemove={noop} />
		</Panel>
	),
};

export const PairedPhonesEmpty: Story = {
	render: () => (
		<Panel>
			<PairedPhonesView phones={[]} onRemove={noop} />
		</Panel>
	),
};

export const PairedPhonesLoadFailed: Story = {
	render: () => (
		<Panel>
			<PairedPhonesView
				phones={undefined}
				loadFailed
				onRemove={noop}
				onRetryLoad={noop}
			/>
		</Panel>
	),
};

/** The Remove dialog: what removal does, and does not, do (D9, U7). */
export const RemoveDialog: Story = {
	render: () => (
		<Panel>
			<PairedPhonesView
				phones={phones}
				onRemove={noop}
				initialConfirm="a1b2c3"
			/>
		</Panel>
	),
};

export const Removing: Story = {
	render: () => (
		<Panel>
			<PairedPhonesView phones={phones} onRemove={noop} removing="a1b2c3" />
		</Panel>
	),
};

/** The admin prompt was cancelled: phases 1-2 took effect, one step remains. */
export const RemoveUnfinished: Story = {
	render: () => (
		<Panel>
			<PairedPhonesView
				phones={phones}
				onRemove={noop}
				notices={{ "0a0b0c": "still_removing" }}
			/>
		</Panel>
	),
};

/*
 * D8: core answers 404 only for a phone it no longer lists, so the refetch has
 * already dropped the row; the notice is said at list level, over the rows left.
 */
export const RemoveNotFound: Story = {
	render: () => (
		<Panel>
			<PairedPhonesView
				phones={phones.filter((phone) => phone.deviceId !== "a1b2c3")}
				onRemove={noop}
				notices={{ a1b2c3: "not_found" }}
			/>
		</Panel>
	),
};

/** D7: a name at core's 64-code-point cap, quoted and truncated in its row. */
export const LongNameAtCap: Story = {
	render: () => (
		<Panel>
			<PairedPhonesView
				phones={[
					{
						...phones[0],
						name: "Ana's iPhone (work) — finance team rota, desk 4, building B, nor",
					},
				]}
				onRemove={noop}
				initialConfirm={null}
			/>
		</Panel>
	),
};

/** The remove dialog for that same name: quoted, wrapped, never markup. */
export const RemoveDialogLongName: Story = {
	render: () => (
		<Panel>
			<PairedPhonesView
				phones={[
					{
						...phones[0],
						name: "Ana's iPhone (work) — finance team rota, desk 4, building B, nor",
					},
				]}
				onRemove={noop}
				initialConfirm={phones[0].deviceId}
			/>
		</Panel>
	),
};

const off = {
	state: "off" as const,
	canPrompt: true,
	inProgress: false,
	message: null,
	fileOnlyNotice: null,
};

export const ApprovalsOff: Story = {
	render: () => (
		<Panel>
			<PhoneApprovalsSetupView state={off} onTurnOn={noop} />
		</Panel>
	),
};

export const ApprovalsTurningOn: Story = {
	render: () => (
		<Panel>
			<PhoneApprovalsSetupView state={off} running onTurnOn={noop} />
		</Panel>
	),
};

export const ApprovalsFinishSetup: Story = {
	render: () => (
		<Panel>
			<PhoneApprovalsSetupView
				state={{ ...off, state: "finish_setup" }}
				onTurnOn={noop}
			/>
		</Panel>
	),
};

/** U18: core's own sentence when no password prompt can appear here. */
export const ApprovalsCannotPrompt: Story = {
	render: () => (
		<Panel>
			<PhoneApprovalsSetupView
				state={{
					...off,
					canPrompt: false,
					message:
						"This computer can't show a password prompt, so approvals can't be turned on from here.",
				}}
				onTurnOn={noop}
			/>
		</Panel>
	),
};

export const ApprovalsJustTurnedOn: Story = {
	render: () => (
		<Panel>
			<PhoneApprovalsSetupView
				state={{ ...off, state: "on" }}
				message="Phone approvals are on."
				onTurnOn={noop}
			/>
		</Panel>
	),
};
