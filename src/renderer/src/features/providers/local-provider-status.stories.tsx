/**
 * The local-model panel's status, in every state `diagnoseLocal` can produce
 * (D1, onboarding friction 2026-11).
 *
 * WHAT THESE FRAMES ARE: the production presentational view
 * (`LocalProviderStatusView`) with fixture diagnoses; the probe and model-list
 * reads it is fed by are pinned in `scripts/onboarding-recovery.test.mjs`.
 * `Interactive` wires a stand-in check that always finds nothing, so a press
 * shows the held "Checking" state and then the receipt changing - the
 * behaviour the PostHog replays show missing (146 users, 8.4 presses each on
 * Windows, on a control that changed nothing visible).
 */

import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useState } from "react";
import type { LocalDiagnosis } from "./local-provider-diagnosis";
import { LocalProviderStatusView } from "./local-provider-status";
import "../../styles/index.css";

const OLLAMA = {
	id: "ollama",
	name: "Ollama",
	brand: "Ollama",
	base_url: "http://localhost:11434/v1",
};
const LM_STUDIO = {
	id: "lmstudio",
	name: "LM Studio",
	brand: "LM Studio",
	base_url: "http://localhost:1234/v1",
};
/* A fixed clock reading so frames are comparable across runs. */
const CHECKED = new Date(2026, 10, 17, 14, 32, 7).getTime();

const Panel: FC<{ children: React.ReactNode }> = ({ children }) => (
	<div className="w-[560px] rounded-[14px] bg-surface px-4 py-4">
		{children}
	</div>
);

const meta: Meta<typeof LocalProviderStatusView> = {
	title: "Providers/Local model status",
	component: LocalProviderStatusView,
	render: (args) => (
		<Panel>
			<LocalProviderStatusView {...args} />
		</Panel>
	),
	args: {
		provider: OLLAMA,
		testing: false,
		checkedAt: CHECKED,
		failedChecks: 1,
		onCheckAgain: () => {},
		onUseHosted: () => {},
	},
};
export default meta;
type Story = StoryObj<typeof LocalProviderStatusView>;

const d = (diagnosis: LocalDiagnosis) => diagnosis;

/** The first check, in flight: the loading state. */
export const Checking: Story = {
	args: { diagnosis: null, testing: true, checkedAt: null, failedChecks: 0 },
};

/** Nothing answered at Ollama's default address: not installed, or not started. */
export const NotRunning: Story = {
	args: { diagnosis: d({ kind: "not_running" }) },
};

/** The same, after the third press: the receipt says "still", with a new time. */
export const NotRunningRepeated: Story = {
	args: { diagnosis: d({ kind: "not_running" }), failedChecks: 3 },
};

/** A re-check in flight: the control holds "Checking" and is disabled. */
export const Rechecking: Story = {
	args: {
		diagnosis: d({ kind: "not_running" }),
		testing: true,
		failedChecks: 2,
	},
};

/** Running, nothing pulled: the empty state, with a copyable pull command. */
export const NoModels: Story = {
	args: { diagnosis: d({ kind: "no_models" }) },
};

/** LM Studio running with nothing loaded: no one-line command exists, so the step is in words. */
export const NoModelsLmStudio: Story = {
	args: { provider: LM_STUDIO, diagnosis: d({ kind: "no_models" }) },
};

/** A changed address that nothing answers. */
export const NoAnswerAtChangedAddress: Story = {
	args: {
		provider: { ...OLLAMA, base_url: "http://192.168.1.40:11434/v1" },
		diagnosis: d({ kind: "wrong_address", status: null }),
	},
};

/** Something else on the port: the error state with the status it answered. */
export const WrongServer: Story = {
	args: { diagnosis: d({ kind: "wrong_address", status: 404 }) },
};

/** Ready: the populated state. No alternative is offered. */
export const Running: Story = {
	args: { diagnosis: d({ kind: "ready", models: 3 }), failedChecks: 0 },
};

/** Not running where the census has no Radient row: no hosted way out is drawn. */
export const NotRunningNoHostedRow: Story = {
	args: { diagnosis: d({ kind: "not_running" }), onUseHosted: undefined },
};

/** Press Check again: the held in-flight state, then a fresh receipt each time. */
export const Interactive: Story = {
	render: () => {
		const [testing, setTesting] = useState(false);
		const [checkedAt, setCheckedAt] = useState<number>(CHECKED);
		const [failed, setFailed] = useState(1);
		return (
			<Panel>
				<LocalProviderStatusView
					provider={OLLAMA}
					diagnosis={{ kind: "not_running" }}
					testing={testing}
					checkedAt={checkedAt}
					failedChecks={failed}
					onCheckAgain={() => {
						setTesting(true);
						setTimeout(() => {
							setTesting(false);
							setCheckedAt((at) => at + 3000);
							setFailed((count) => count + 1);
						}, 400);
					}}
					onUseHosted={() => {}}
				/>
			</Panel>
		);
	},
};
