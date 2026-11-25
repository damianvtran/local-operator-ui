import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useState } from "react";
import {
	type ApprovalChoice,
	ApprovalModePickerView,
	type ApprovalPickerNotice,
} from "./approval-mode";

/*
 * The composer's approvals picker, every state on its own story so a capture
 * can name one URL per state (operator request 2026-11-25; the PR's frames).
 *
 * The VIEW is pure, so these stories need no backend: the connected picker's
 * routes and refusal classification are pinned by
 * `scripts/approval-mode-live.test.mjs`; this file pins the pixels. The row
 * wears the composer dock's classes (`composer-dock` / `composer-dock-rail`) so
 * the `[data-composer-picker]` sizing in `styles/index.css` applies exactly as
 * it does beside the model and effort selectors. The full-composer frame is
 * `Chat/MessageInput` -> `ApprovalsPicker`.
 */

const meta: Meta = {
	title: "Chat/Approvals picker",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** A dock-shaped row with room above it for the popover to open into. */
const Row = ({ children }: { children: ReactNode }) => (
	<div className="flex h-screen flex-col justify-end bg-canvas p-6">
		<div className="composer-dock w-[560px]">
			<div className="composer-dock-editor bg-elevated">
				<div className="composer-dock-rail">
					<div className="composer-dock-pickers">{children}</div>
				</div>
			</div>
		</div>
	</div>
);

const Picker = ({
	mode,
	defaultMode = "ask",
	loading = false,
	initiallyOpen = false,
	pending = null,
	notice = null,
}: {
	mode: "ask" | "auto" | null;
	defaultMode?: "ask" | "auto" | null;
	loading?: boolean;
	initiallyOpen?: boolean;
	pending?: ApprovalChoice | null;
	notice?: ApprovalPickerNotice | null;
}) => {
	const [open, setOpen] = useState(initiallyOpen);
	return (
		<Row>
			<ApprovalModePickerView
				mode={mode}
				loading={loading}
				defaultMode={defaultMode}
				open={open}
				onOpenChange={setOpen}
				pending={pending}
				notice={notice}
				onChoose={() => {}}
			/>
		</Row>
	);
};

/** The first read is in flight: the neutral form, never an absent trigger. */
export const Loading: Story = {
	render: () => <Picker mode={null} loading />,
};

/** The backend has stated no mode (a cold session): still a trigger, still opens. */
export const Unknown: Story = {
	render: () => <Picker mode={null} />,
};

export const Ask: Story = { render: () => <Picker mode="ask" /> };

/** Auto keeps the warning tint. */
export const Auto: Story = { render: () => <Picker mode="auto" /> };

export const OpenAsk: Story = {
	render: () => <Picker mode="ask" defaultMode="ask" initiallyOpen />,
};

/** The live mode and default are separate readings, not provenance claims. */
export const OpenAuto: Story = {
	render: () => <Picker mode="auto" defaultMode="ask" initiallyOpen />,
};

export const OpenUnknown: Story = {
	render: () => <Picker mode={null} defaultMode="ask" initiallyOpen />,
};

/** The pressed row shows its spinner; every row is locked until it answers. */
export const Pending: Story = {
	render: () => (
		<Picker
			mode="ask"
			initiallyOpen
			pending={{ scope: "session", mode: "auto" }}
		/>
	),
};

export const Refused: Story = {
	render: () => (
		<Picker
			mode="ask"
			initiallyOpen
			notice={{
				scope: "session",
				kind: "refused",
				detail: "this conversation holds a teammate's message",
			}}
		/>
	),
};

/** The session changed live, but resuming it will not keep the change. */
export const LiveAppliedNotSavedForResume: Story = {
	render: () => (
		<Picker
			mode="auto"
			initiallyOpen
			notice={{
				scope: "session",
				kind: "not-saved-for-resume",
				detail:
					"tool approvals: auto — every tool runs without asking (this session) — applied for this session but NOT saved for resume (PermissionError)",
			}}
		/>
	),
};
