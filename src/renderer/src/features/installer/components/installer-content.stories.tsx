import type { Meta, StoryObj } from "@storybook/react";
import type React from "react";
import "../../../styles/index.css";
/*
 * The sentence the app falls back to, CALLED rather than copied (design D21): a
 * hand-typed copy of what `installFailureSentence` returns is the drift this
 * file's own notes call a defect, and the frame would keep asserting the old
 * wording after the function changed.
 */
import { installFailureSentence } from "../../../../../shared/install-progress";
import { InstallerContent, InstallerShell } from "./installer-content";
import { InstallPanel } from "./installer-panel";

/**
 * The installer window: the first screen a new user ever sees.
 *
 * It renders inside its own html entry, so the story reproduces that entry's
 * wrapper rather than the app shell, at the window's real size - which is now
 * literally true: the window is created 640x480, the viewport below says 640x480,
 * and the frames in `docs/evidence/installer-installercontent/` are therefore
 * pictures of the surface the app ships. They were not before: the window was
 * 1380x800 while the story was 640x480, so all sixty frames documented a
 * composition no user had ever been shown (review R1-5, design D1, UX U6).
 *
 * The window itself only ever renders one palette: `installer.tsx` calls
 * `applyThemeToDocument(DEFAULT_THEME)` and nothing there reads a stored
 * preference, so eleven of the twelve frames below show a theme this window
 * cannot produce. They are kept because the panel's own contrast should hold on
 * any ground it is ever pointed at, but the one that matches the product is
 * `localOperatorDark` - which is also why the main process paints that palette's
 * `canvas` behind it (asserted, not asserted-in-prose: see
 * `scripts/install-progress.test.mjs`).
 *
 * ## Why the states are stories rather than a story the harness drives
 *
 * `InstallerContent` subscribes to the preload bridge, which does not exist in a
 * browser, so it can only ever render the state an absent main process leaves it
 * in. Each state worth reviewing is therefore rendered through `InstallPanel` -
 * the same component the window uses, with the same props, given the state
 * directly. Nothing here is a mock of the panel; the mock would be the bridge.
 *
 * The five states are the five a user can be left in: the mounted entry, nothing
 * announced yet (indeterminate), the long download (phase 3), the failure (the
 * sentence, the captured line under it, and the Retry), and the moment after
 * success.
 */
const meta: Meta = {
	title: "Installer/InstallerContent",
	parameters: {
		layout: "fullscreen",
		viewport: {
			defaultViewport: "custom",
			viewports: {
				custom: {
					name: "Installer Window",
					styles: { width: "640px", height: "480px" },
				},
			},
		},
	},
	/* The installer entry is its own window, so the story reproduces the
	   full-bleed column that entry renders rather than sitting in page flow. */
	render: () => (
		<div className="flex h-screen w-screen overflow-hidden font-sans">
			<InstallerContent />
		</div>
	),
};

export default meta;
type Story = StoryObj;

/**
 * The window as the entry renders it, off the live bridge.
 *
 * In Storybook there is no main process, so this is also what a user sees in the
 * seconds before anything has been announced: every step waiting, the bar
 * indeterminate, and nothing claiming a fraction.
 */
export const Default: Story = {};

const panel = (
	props: React.ComponentProps<typeof InstallPanel>,
): React.ReactElement => (
	/* The product's own wrapper, not a copy of it: see `InstallerShell`. */
	<div className="h-screen w-screen overflow-hidden font-sans">
		<InstallerShell>
			<InstallPanel {...props} />
		</InstallerShell>
	</div>
);

const noop = () => {};

/** Nothing announced yet: the honest indeterminate state, no step claimed. */
export const Indeterminate: Story = {
	render: () =>
		panel({
			phase: null,
			installed: false,
			failure: null,
			onCancel: noop,
			onRetry: noop,
		}),
};

/** The long phase: two steps finished, the download running. */
export const MidInstall: Story = {
	render: () =>
		panel({
			phase: "components",
			installed: false,
			failure: null,
			onCancel: noop,
			onRetry: noop,
		}),
};

/**
 * The failure state: the sentence, the captured line as evidence, and the way
 * out.
 *
 * The composition rather than the fallback, because the fallback was the whole
 * problem (design D3): this state used to render the last line the install
 * captured, VERBATIM, as the message - `ERROR: Could not find a version that
 * satisfies the requirement local-operator` - and that was the DEFAULT path for
 * every failure the causes table did not recognise, not a corner. The sentence
 * above the line comes from that table; the line under it is machine voice, and
 * the third line says what survived, which is the first question a failed setup
 * raises and the one nothing on this screen answered.
 */
export const Failure: Story = {
	render: () =>
		panel({
			phase: "components",
			installed: false,
			failure: {
				phase: "components",
				reason:
					"Local Operator could not reach the package index, which is usually the network or a proxy. Check the connection and retry.",
				/*
				 * The line the LIVE flow picks, not a plausible one (UX U16). The
				 * shipped script prints pip's failure and then its own `ERROR:` line, and
				 * `installFailureReason` takes the last error-shaped line, so a real
				 * failure of this kind renders the script's summary - a story that
				 * authored a longer pip line documented a state the app does not produce.
				 */
				detail: "ERROR: Failed to install local-operator package. Exit code: 1",
				exitCode: 1,
			},
			onCancel: noop,
			onRetry: noop,
		}),
};

/**
 * The failure the cause table does NOT recognise - the composition this
 * screen's own code calls the common case, and the only one of the two the
 * evidence set did not show (design D12).
 *
 * WHY ITS MACHINE LINE IS LONG ON PURPOSE: with no recognised cause the
 * sentence above is generic, so this line is the only specific thing on the
 * screen, and pip puts the specific part at the END - the requirement, the URL,
 * `(from versions: none)`. A one-line clamp showed the head and hid exactly the
 * part a user could act on; this frame is the one that proves the second line
 * arrives. The sentence is `installFailureSentence("components")`, which is what
 * the app falls back to. The line is the captured one, not a longer invention:
 * a 137-character line would need three lines, and what ships is a two-line
 * clamp.
 */
export const FailureFallback: Story = {
	render: () =>
		panel({
			phase: "components",
			installed: false,
			failure: {
				phase: "components",
				reason: installFailureSentence("components"),
				detail:
					"ERROR: Could not find a version that satisfies the requirement local-operator (from versions: none)",
				exitCode: 1,
			},
			onCancel: noop,
			onRetry: noop,
		}),
};

/** Settled: every step complete and the Cancel spent. */
export const Installed: Story = {
	render: () =>
		panel({
			phase: "verify",
			installed: true,
			failure: null,
			onCancel: noop,
			onRetry: noop,
		}),
};
