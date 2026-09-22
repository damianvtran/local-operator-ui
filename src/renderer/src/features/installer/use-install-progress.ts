import { useEffect, useState } from "react";
import {
	INSTALL_IPC_CHANNELS,
	isInstallProgressPayload,
} from "../../../../shared/install-progress";
import type {
	InstallFailure,
	InstallPhase,
} from "../../../../shared/install-progress";

/**
 * The installer window's view of the install, derived from the main process's
 * one channel.
 *
 * Three states, and every one of them is REACHED rather than assumed:
 *
 * - `phase: null` is "nothing has been announced yet", which is the state the
 *   window paints before the first milestone arrives. The panel renders it
 *   indeterminate. A window that invented "step 1 of 4" here would be claiming a
 *   measurement it does not have.
 * - a phase is "that step is the one in progress".
 * - `failure` replaces the running panel with the reason and a Retry; `installed`
 *   settles the stepper and takes the Cancel away.
 *
 * WHY THE LAST PAYLOAD WINS RATHER THAN A LOG. The main process sends the
 * CURRENT phase, not a stream of events, so a late subscriber (this window,
 * which mounts after the pre-flight phases have already run) reconstructs the
 * full state from one message: every phase before the current one is complete,
 * the current one is in progress, the rest are not started. That is also why
 * there is no ordering logic here - a payload cannot be out of order relative to
 * itself.
 */
/**
 * The window's own view of the install.
 *
 * The three states are the three terminals of the channel plus the waiting one,
 * and the panel is a pure function of this. Nothing here computes a fraction or a
 * position: the phase IS the position, and everything the panel paints is derived
 * from it (`phaseState` in `installer-panel.tsx`). That is deliberate - the
 * previous design kept a `completedPhases` helper here that nothing imported, and
 * a second way to answer "which steps are done" is exactly how a stepper starts
 * disagreeing with the list it renders (review R1-10).
 */
export type InstallView = {
	/** The step in progress, or null before any milestone has arrived. */
	phase: InstallPhase | null;
	/** True once the install has finished; the panel then stops offering Cancel. */
	installed: boolean;
	/** Present when the install failed; carries the phase and the reason. */
	failure: InstallFailure | null;
};

const INITIAL: InstallView = { phase: null, installed: false, failure: null };

/**
 * Read the installer window's state off the main process's channel.
 *
 * The bridge is an explicit allowlist in `src/preload/index.ts`, so the channel
 * names here and there have to agree; `send` is only used for the two messages
 * the window originates, and both are on the same allowlist.
 */
export function useInstallProgress(): {
	view: InstallView;
	cancel: () => void;
	retry: () => void;
} {
	const [view, setView] = useState<InstallView>(INITIAL);

	useEffect(() => {
		const unsubscribe = window.api?.ipcRenderer?.on(
			INSTALL_IPC_CHANNELS.progress,
			(...args: unknown[]) => {
				/*
				 * The validator is the first thing this handler does, and it is what stops a
				 * malformed payload from throwing inside the window's ONLY inbound channel
				 * (review R1-7). The previous form hand-rolled the narrowing and then
				 * dereferenced `payload.failure.phase`, so a `{kind: "failed"}` payload with
				 * no `failure` threw where nothing could catch it - and the function written
				 * FOR that case, with a docstring saying a malformed payload must paint
				 * nothing rather than throw, was exported, tested and called by nothing.
				 *
				 * The window's whole contract is `unknown` in and a rendered state out: the
				 * preload bridge is a message port, not a typed call.
				 */
				const payload = args[0];
				if (!isInstallProgressPayload(payload)) return;
				if (payload.kind === "installed") {
					setView({ phase: "verify", installed: true, failure: null });
					return;
				}
				if (payload.kind === "failed") {
					setView({
						phase: payload.failure.phase,
						installed: false,
						failure: payload.failure,
					});
					return;
				}
				setView({
					phase: payload.phase ?? null,
					installed: false,
					failure: null,
				});
			},
		);
		/*
		 * Ask for the phase the window was not alive to hear.
		 *
		 * On macOS the managed runtime is prepared before this window exists, so
		 * its `python` milestone is already spent by the time this subscribes. The
		 * main process replays the current phase on request (and again on load, for
		 * a window that never asks); without this the first painted frame would
		 * claim nothing had happened, which is the one thing the panel must not do.
		 */
		window.api?.ipcRenderer?.send(INSTALL_IPC_CHANNELS.replay);
		return unsubscribe;
	}, []);

	return {
		view,
		cancel: () => window.api?.ipcRenderer?.send(INSTALL_IPC_CHANNELS.cancel),
		retry: () => window.api?.ipcRenderer?.send(INSTALL_IPC_CHANNELS.retry),
	};
}
