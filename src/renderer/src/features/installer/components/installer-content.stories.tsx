import type { Meta, StoryObj } from "@storybook/react";
import type React from "react";
import "../../../styles/index.css";
/*
 * The sentence the app falls back to, CALLED rather than copied (design D21): a
 * hand-typed copy of what `installFailureSentence` returns is the drift this
 * file's own notes call a defect, and the frame would keep asserting the old
 * wording after the function changed.
 */
import {
	EMPTY_SUB_PROGRESS,
	type InstallTiming,
	foldInstallLine,
	installFailureSentence,
} from "../../../../../shared/install-progress";
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
 * The eight states are the eight a user can be left in: the mounted entry, the
 * first phase with nothing behind it (the cold run's opening minutes), the long
 * download (phase 3), the last phase with its smoke probe running, the failure a
 * THROWN error leaves behind when it happens before the first milestone (no
 * phase to name), the failure in both of its other compositions (a recognised
 * cause and the unrecognised one the code calls the common case), and the moment
 * after success.
 *
 * WHY THERE IS NO `Indeterminate` STORY BESIDE `Default`. There was one, and it
 * was byte-identical to `Default` in all twelve themes - measured across the
 * whole frame, 0 differing pixels (review 6) - because `phase: null` IS the state
 * an absent bridge leaves the entry in. So the pair proved something the frames did
 * not need a second row to say (the props path and the mount path agree) and one of
 * the eight declared states documented no state of its own. `Default` is the one
 * that is kept, because it is the app's own entry rather than a hand-built props
 * object, and the measurement above is what the second row was worth.
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
 * seconds before anything has been announced: every step waiting, the rail's own
 * head mark turning, and nothing claiming a fraction.
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

/*
 * A PINNED CLOCK for the frames that show the status line (first-run
 * onboarding, U8): `now` is fixed and the run's instants are offsets from it, so
 * "Step 3 of 4 · 0:05 elapsed · about 10 s left" is the same pixels on every
 * capture rather than whatever second the capture landed on.
 */
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const timingAt = (
	elapsedMs: number,
	phaseElapsedMs: number,
	lines: string[] = [],
): InstallTiming => ({
	startedAt: NOW - elapsedMs,
	phaseStartedAt: NOW - phaseElapsedMs,
	platform: "darwin",
	sub:
		lines.length === 0
			? null
			: lines.reduce(foldInstallLine, EMPTY_SUB_PROGRESS),
});

/**
 * The first phase, with nothing finished behind it.
 *
 * WHY THIS IS A FRAME AND NOT A COROLLARY OF `MidInstall`. This is the state the
 * window sits in for the first minutes of a COLD first run - `python` is the
 * runtime copy, and on a machine that has never had one it is the only phase
 * whose work is entirely in front of the user. A panel whose progress affordance
 * is a fill reads NOTHING here (this is the measured first-run frame of the
 * previous round: an empty track for 2m37s, design D4/UX U9), so the state the
 * whole design is judged on had no frame at all until this one.
 */
export const FirstStage: Story = {
	render: () =>
		panel({
			phase: "python",
			installed: false,
			failure: null,
			timing: timingAt(1_000, 1_000),
			now: NOW,
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
			/* uv's real narration, three of six large downloads in (see the test's
			   UV_COLD_RUN fixture for where these lines come from). */
			timing: timingAt(9_000, 3_000, [
				"Resolved 55 packages in 888ms",
				"Downloading pydantic-core (1.9MiB)",
				"Downloading local-operator (13.5MiB)",
				"Downloading cryptography (3.7MiB)",
				"Downloading pillow (4.6MiB)",
				"Downloading pygments (1.2MiB)",
				"Downloading pillow-heif (4.1MiB)",
				" Downloaded pygments",
				" Downloaded pydantic-core",
				" Downloaded cryptography",
			]),
			now: NOW,
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

/**
 * The failure that happens BEFORE the first milestone: no phase to name.
 *
 * WHY THIS STATE IS A FRAME. `reportInstallFailure` sends the last phase the run
 * announced, which starts `null`, so a thrown failure in the window between the
 * panel mounting and the first marker arriving is a real and validated payload
 * (`isInstallProgressPayload` accepts `failure.phase === null`, and
 * `installFailureSentence(null)` is written for it). The panel rendered it as a
 * liveness mark turning above four hollow rings and a block saying setup had
 * stopped - the one failure composition where the screen contradicted itself, and
 * the one no frame showed (review P1). The rail here is deliberately empty of
 * marks: nothing was announced, so nothing is claimed, and the head mark is
 * absent because the run is over rather than working.
 */
export const FailureBeforePhase: Story = {
	render: () =>
		panel({
			phase: null,
			installed: false,
			failure: {
				phase: null,
				reason: installFailureSentence(null),
				/*
				 * A LINE THE SCRIPT REALLY PRINTS BEFORE ITS FIRST MARKER, not a plausible
				 * one: `macos-install-script.sh` checks the bundled interpreter for its venv
				 * module and exits with this line well before the first `|LO1:` marker, so a
				 * failure here leaves `lastPhase` at its initial `null` and this is the
				 * captured text the panel's machine line would carry.
				 */
				detail:
					"ERROR: Python venv module not available in the Python installation",
				exitCode: 1,
			},
			onCancel: noop,
			onRetry: noop,
		}),
};

/**
 * The last phase, which is the one that can still fail after a successful pip.
 *
 * It is also the phase with the longest RUNWAY of any in the panel - the smoke
 * probe starts the installed server and waits on `/health` - and it was never
 * photographed, so the composition of a full rail with one step still running
 * was undocumented (see `installer-panel.tsx` on why `installed` is sent on the
 * far side of that probe rather than at the end of the script).
 */
export const Verifying: Story = {
	render: () =>
		panel({
			phase: "verify",
			installed: false,
			failure: null,
			timing: timingAt(16_000, 1_000),
			now: NOW,
			onCancel: noop,
			onRetry: noop,
		}),
};

/**
 * A slow network: the download phase has outrun its baseline, and the estimate
 * says so in words rather than counting past zero (first-run onboarding, Q5).
 */
export const SlowNetwork: Story = {
	render: () =>
		panel({
			phase: "components",
			installed: false,
			failure: null,
			timing: timingAt(41_000, 31_000, [
				"Resolved 55 packages in 888ms",
				"Downloading local-operator (13.5MiB)",
			]),
			now: NOW,
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
