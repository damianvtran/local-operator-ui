/**
 * Backend Installer
 *
 * This module is responsible for installing the Local Operator backend.
 * It handles checking if the backend is installed and installing it if needed.
 * Includes crash logging to a persistent location.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import {
	BrowserWindow,
	app,
	dialog as electronDialog,
	ipcMain,
} from "electron";
import type {
	InstallFailure,
	InstallPhase,
	InstallProgressPayload,
} from "../../shared/install-progress";
import {
	INSTALL_IPC_CHANNELS,
	INSTALL_WINDOW_CANVAS,
	installFailureReason,
	installFailureSentence,
	parseInstallMarker,
	splitLines,
} from "../../shared/install-progress";
import {
	ensureVenvBytecodeGuard,
	withPythonBytecodeCache,
} from "../python-bytecode-cache";
import type { WindowShow } from "../window-mode";
import { presentWindow } from "../window-raise";
import { LogFileType, logger } from "./logger";
import {
	type ManagedPythonOptions,
	inspectManagedSelection,
	managedSelectionReady,
	prepareManagedPython,
	setInstallPhaseSink,
} from "./managed-python";
import { managedPythonOptions } from "./managed-python-options";
import {
	linuxInstallScript,
	macosInstallScript,
	windowsInstallScript,
} from "./scripts";
import { setupFailureCause } from "./setup-failure-causes";
import { UV_TOOL_ENV, ensureUvToolExecutable } from "./uv-tool";
import { VENV_PATH_ENV, managedVenvPath } from "./venv-paths";
/**
 * The failure dialog's detail line: what happened, then what was recorded.
 *
 * Why not `error.message` directly, which is what this used to be: several of
 * those strings name internals rather than the user's situation - "Runtime
 * directory escaped its managed root", "Could not allocate backend smoke port",
 * "Invalid managed Python selection" - and a raw `ENOENT: no such file or
 * directory, lstat ...` is the line a user actually reads (design D4). The plain
 * sentence comes first because that is the part that is actionable; the app's own
 * message follows under a label, because a support conversation needs the handle
 * and the log needs the cause. The support root is named rather than a file, so
 * the line does not send anyone to an internal path that may no longer exist.
 *
 * Exported so the copy is pinned by a test rather than only being visible in a
 * dialog that, on this host, cannot be rendered at all.
 */
export function backendSetupFailureDetail(
	error: unknown,
	support: string,
): string {
	const raw = error instanceof Error ? error.message : String(error);
	/*
	 * The causes table itself lives in `setup-failure-causes.ts`, because the
	 * app-owned update path now needs the same remedy and cannot import this module
	 * (it would pull the three install scripts in as `?raw`). This is the same
	 * derivation, asked through the shared leaf.
	 */
	const cause =
		setupFailureCause(error) ?? "The backend could not be set up on this Mac.";
	return [
		`What happened: ${cause}`,
		`The app recorded: ${raw}`,
		`Where its environment lives: ${support}/managed-python`,
	].join("\n\n");
}

/**
 * Backend Installer class
 * Manages the installation of the Local Operator backend
 */
export class BackendInstaller {
	private appDataPath = app.getPath("userData");
	private venvPath: string;
	private resourcesPath: string;
	private pythonPath: string | null = null;
	private preparationWindow: BrowserWindow | null = null;

	/*
	 * The live install child, kept on the instance rather than in a local of the
	 * method that spawned it.
	 *
	 * WHY: the Cancel button, the window's own close handler and the retry path all
	 * have to reach it, and two of those outlive the promise the spawn resolves
	 * through. A retry REPLACES it, so `killInstallProcess` reads the field at call
	 * time - a closure capturing one attempt's pid would signal a process group that
	 * no longer exists and leave the running child orphaned, still pip-installing
	 * into an environment nothing is waiting for.
	 */
	private installProcess: ReturnType<typeof spawn> | null = null;

	/**
	 * True while an attempt is running, from just before the child is spawned to
	 * the moment its outcome is in.
	 *
	 * WHY IT IS NOT `attemptedInstall === null`. That field is null in TWO states -
	 * an attempt in flight, and a window that has nothing left to wait for - and
	 * the close handler needs the first and not the second. The previous spelling
	 * also could not see the FIRST attempt's own state at all: `attemptedInstall`
	 * is only written by the retry, so on a fresh window it stayed null whatever
	 * happened (review R1-3).
	 */
	private attemptInFlight = false;

	/**
	 * Set by the window's Cancel button or its close box, read by the attempt.
	 *
	 * The runner turns a kill into the same `ok: false` every other failure
	 * produces, and only `installEnvironment` can tell the two apart - which is
	 * why the flag is on the instance rather than captured per attempt.
	 */
	private attemptCancelled = false;

	/**
	 * Resolves `install()`'s wait when a failure is on screen and the user owns
	 * the decision.
	 *
	 * WHY `install()` DOES NOT RETURN ON A WINDOW-OWNED FAILURE. The app quits the
	 * moment `install()` resolves false (`index.ts` treats it as "setup was
	 * cancelled or failed"), so a failure that left the panel's Retry on screen and
	 * returned would take the panel down with it a frame later - which is exactly
	 * what made the whole failure state unreachable (review R1-3, UX U2). Instead
	 * the startup wait is held open while the window owns the failure, and the
	 * window resolves it: a successful retry resolves true, "Quit" exits the app
	 * and never resolves at all.
	 */
	private settleUserDecision: ((ok: boolean) => void) | null = null;

	/** The plan this process's launch raises a window under, passed by `index.ts`. */
	private windowShow: WindowShow = "focus";

	/*
	 * The last phase announced to the setup window, and whether a failure is
	 * currently on screen with nobody's answer yet.
	 *
	 * Class state rather than locals of `install`, because the window outlives one
	 * attempt: a retry is the same window asking for a second run, and it needs to
	 * know which phase to name. `failureOnScreen` is what tells `install()` that a
	 * false outcome has already been shown and that the user, not the startup path,
	 * owns what happens next.
	 */
	private lastPhase: InstallPhase | null = null;
	private failureOnScreen = false;

	/**
	 * Record a phase announced by the preparation layer, and pass it on when there is
	 * a window to paint it in.
	 *
	 * Why recording first is not belt-and-braces: the pre-flight phases run BEFORE
	 * the setup window exists - on macOS the window is created after the managed
	 * runtime is prepared - so a sink that only forwarded would drop `python` on
	 * every run and leave the window's first painted frame claiming nothing had
	 * happened, with no step to name. The window asks for what it missed when it
	 * loads; see the `installation-progress-replay` handler.
	 */
	private rememberInstallPhase(phase: InstallPhase): void {
		if (phase === this.lastPhase) return;
		this.lastPhase = phase;
		this.sendInstallProgress({ kind: "phase", phase });
	}

	/**
	 * Whether the setup window is up and can be told things.
	 *
	 * The one test every failure path asks before choosing its surface: a window
	 * that exists owns the failure, and one that does not leaves the modal as the
	 * only thing that can speak.
	 */
	private hasLivePreparationWindow(): boolean {
		const window = this.preparationWindow;
		return window !== null && !window.isDestroyed();
	}

	/**
	 * Tell the window, or the log, that this attempt is over and the install is
	 * done.
	 *
	 * Sent from the far side of the smoke probe rather than from the end of the
	 * script (review R1-11): see `prepareAndInstall`. It is idempotent in the panel
	 * - `installed` is a state, not an event - and it is the last thing either half
	 * says about this run, so a retry that succeeds sends exactly the same payload a
	 * first-run success does.
	 */
	private settleInstalled(): void {
		this.lastPhase = "verify";
		this.failureOnScreen = false;
		this.sendInstallProgress({
			kind: "installed",
			phase: "verify",
			installed: true,
		});
	}

	/**
	 * One failure, one surface: the window when it is up, and a sentence derived
	 * from what actually failed.
	 *
	 * The three fields the panel composes come from three different places on
	 * purpose (design D3). The causes table answers "what does this mean to this
	 * user" and is tried first; `installFailureSentence` covers everything the table
	 * does not recognise, which is the common case; and the captured line travels
	 * separately as `detail`, in machine voice, so the panel can show the evidence
	 * under the sentence instead of as the sentence. Before this, every
	 * unrecognised failure rendered the raw line - `ERROR: Could not find a version
	 * that satisfies the requirement local-operator` - which `docs/branding.md`
	 * section 8 calls an unfinished error.
	 */
	private reportInstallFailure(
		error: unknown,
		captured = "",
		detail: string | null = null,
		exitCode: number | null = null,
	): void {
		if (!this.hasLivePreparationWindow()) return;
		const subject = `${captured}\n${
			error instanceof Error ? error.message : String(error ?? "")
		}`;
		const failure: InstallFailure = {
			phase: this.lastPhase,
			reason:
				setupFailureCause(subject) ?? installFailureSentence(this.lastPhase),
			detail,
			exitCode,
		};
		this.failureOnScreen = true;
		this.sendInstallProgress({ kind: "failed", phase: failure.phase, failure });
	}

	/**
	 * Wait for the window to settle a failure it is showing.
	 *
	 * Resolved `true` by a retry that succeeds. `Quit` exits the process, so this
	 * promise is simply abandoned - there is no third answer to resolve it with,
	 * which is what keeps "Retry or Quit" the whole of the choice.
	 */
	private awaitUserDecision(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			this.settleUserDecision = resolve;
		});
	}

	/**
	 * The one writer to the setup window's channel.
	 *
	 * Guarded on `isDestroyed` because a phase can arrive while the user is closing
	 * the window, and `webContents.send` on a destroyed window throws - which would
	 * abort an install the app was going to complete anyway.
	 */
	private sendInstallProgress(payload: InstallProgressPayload): void {
		const window = this.preparationWindow;
		if (!window || window.isDestroyed()) return;
		window.webContents.send(INSTALL_IPC_CHANNELS.progress, payload);
	}

	/**
	 * Constructor
	 */
	constructor() {
		// The app-managed venv for THIS instance. A packaged install and an
		// unpackaged one must not share it: the venv is created by whatever
		// interpreter the instance resolves, so a shared one puts the installed
		// bundle's stdlib in the dev instance's import path - see `managedVenvPath`,
		// which carries the measurement.
		this.venvPath = managedVenvPath({
			platform: process.platform,
			home: app.getPath("home"),
			appDataPath: this.appDataPath,
			packaged: app.isPackaged,
		});

		// Set resources path
		this.resourcesPath = !app.isPackaged
			? join(process.cwd(), "resources")
			: join(process.resourcesPath);

		// No guard is written from the constructor, and on darwin `this.venvPath` is
		// the selection venv or the `no-environment-selected` sentinel - writing a
		// `sitecustomize.py` into the sentinel would create a directory that looks
		// like state, which is exactly what that name exists to prevent. The guard
		// goes in after the environment is built instead (see `installEnvironment`).
		if (process.platform !== "darwin") this.guardVenvBytecode();
		// Find Python executable
		this.pythonPath = this.findPython();

		logger.info(
			`Backend Installer initialized. Virtual environment path: ${this.venvPath}`,
			LogFileType.INSTALLER,
		);
		logger.info(`Resources path: ${this.resourcesPath}`, LogFileType.INSTALLER);
		logger.info(
			`Python path: ${this.pythonPath || "Not found"}`,
			LogFileType.INSTALLER,
		);

		/*
		 * The phase sink goes in from here rather than from `install`, because the
		 * first phase (`python`) is announced while `prepareManagedPython` runs -
		 * which on macOS is before the setup window exists - so the phase has to be
		 * remembered as well as sent. See `rememberInstallPhase`.
		 */
		setInstallPhaseSink((phase) => this.rememberInstallPhase(phase));
	}

	/**
	 * Find Python executable
	 * @returns Path to Python executable or null if not found
	 */
	private findPython(): string | null {
		// A macOS seed is data, never an executable candidate inside the app.
		if (process.platform === "darwin") return null;
		const possibilities: string[] = [];

		// Prioritize architecture-specific paths based on current process architecture
		if (process.arch === "arm64") {
			// For Apple Silicon (arm64)
			possibilities.push(
				join(process.resourcesPath, "python_aarch64", "bin", "python3"), // Packaged app (aarch64)
				join(process.cwd(), "resources", "python_aarch64", "bin", "python3"), // Development (aarch64)
			);
		} else if (process.arch === "x64") {
			// For Intel (x86_64)
			possibilities.push(
				join(process.resourcesPath, "python", "bin", "python3"), // Packaged app (x86_64)
				join(process.cwd(), "resources", "python", "bin", "python3"), // Development (x86_64)
			);
		}

		// Add Windows-specific paths
		if (process.platform === "win32") {
			const userProfile = process.env.USERPROFILE || app.getPath("home");
			const pyenvDir = join(userProfile, ".pyenv");

			possibilities.push(
				// In packaged app (Windows)
				join(process.resourcesPath, "python", "python.exe"),
				// In development (Windows)
				join(process.cwd(), "resources", "python", "python.exe"),
				// Check for pyenv-win Python
				join(pyenvDir, "pyenv-win", "versions", "3.12.0", "python.exe"),
				// Check for pyenv-win shims
				join(pyenvDir, "pyenv-win", "shims", "python.exe"),
			);
		}

		for (const path of possibilities) {
			if (fs.existsSync(path)) {
				logger.info(`Found Python at ${path}`, LogFileType.INSTALLER);
				return path;
			}
		}

		logger.warn(
			`Could not find Python, checked: ${possibilities.join(", ")}`,
			LogFileType.INSTALLER,
		);
		return null;
	}

	/**
	 * Make the app-managed venv refuse bytecode writes for every process that
	 * uses it, whoever started it.
	 *
	 * Logged rather than silent in both directions: a guard that was already
	 * there, one this call wrote, and one that could not be written (no venv yet,
	 * or a `sitecustomize.py` the operator owns) are three different states of the
	 * same guarantee, and the field diagnosis starts from which one this machine
	 * is in. `ensureVenvBytecodeGuard` never replaces a file it did not write.
	 */
	private guardVenvBytecode(): void {
		const guard = ensureVenvBytecodeGuard(this.venvPath);
		logger.info(
			`Bytecode guard in the app-managed venv: ${guard.reason}`,
			LogFileType.INSTALLER,
		);
	}

	/**
	 * Check if backend is installed
	 * @returns Promise resolving to true if the backend is installed, false otherwise
	 */
	async isInstalled(): Promise<boolean> {
		try {
			if (process.platform === "darwin")
				return await managedSelectionReady(this.managedOptions());
			// Check if virtual environment exists
			if (!fs.existsSync(this.venvPath)) {
				logger.info(
					`Virtual environment not found at ${this.venvPath}`,
					LogFileType.INSTALLER,
				);
				return false;
			}

			// Check if local-operator is installed in the virtual environment
			let localOperatorPath: string;

			if (process.platform === "win32") {
				// Windows
				localOperatorPath = join(
					this.venvPath,
					"Scripts",
					"local-operator.exe",
				);

				if (!fs.existsSync(localOperatorPath)) {
					logger.info(
						`local-operator executable not found at ${localOperatorPath}`,
						LogFileType.INSTALLER,
					);
					return false;
				}
			} else {
				// For non-Windows platforms
				localOperatorPath = join(this.venvPath, "bin", "local-operator");

				if (!fs.existsSync(localOperatorPath)) {
					logger.info(
						`local-operator executable not found at ${localOperatorPath}`,
						LogFileType.INSTALLER,
					);
					return false;
				}
			}

			logger.info("Backend is installed", LogFileType.INSTALLER);
			return true;
		} catch (error) {
			logger.error(
				"Error checking if backend is installed:",
				LogFileType.INSTALLER,
				error,
			);
			return false;
		}
	}

	private managedOptions(): ManagedPythonOptions {
		return managedPythonOptions();
	}

	/**
	 * Install the backend, holding the app's startup open for as long as the setup
	 * window owns the outcome.
	 *
	 * `show` is the LAUNCH's window plan, passed in rather than re-derived: this
	 * window used to be constructed with no `show` at all, so Electron's default
	 * (`true`) applied and every agent-driven or headless first run popped a real
	 * window onto the operator's screen - the one window in the app with no mode
	 * gate, and an omitted option is not a call, so the scan in
	 * `scripts/window-mode.test.mjs` could not see it (UX U7). `index.ts` already
	 * resolves the plan for this process; deriving it again here would be a second
	 * answer to the same question.
	 *
	 * THE LOOP IS THE DIALOG'S, NOT THE WINDOW'S. "Retry setup" in the modal runs
	 * the preparation again. A failure the WINDOW owns never reaches the modal: it
	 * is left on screen and this method waits, which is the whole point of the
	 * in-window failure state.
	 */
	async install(show: WindowShow): Promise<boolean> {
		this.windowShow = show;
		try {
			for (;;) {
				try {
					if (await this.prepareAndInstall(show)) return true;
				} catch (error) {
					logger.error(
						"Backend preparation failed",
						LogFileType.INSTALLER,
						error,
					);
					/*
					 * ALREADY ON SCREEN, and not reported twice. A script that exits non-zero
					 * has its failure handed to the window by `installEnvironment`; on macOS
					 * `prepareManagedPython` then turns that same `false` into a throw, so this
					 * catch sees a failure the panel is already painting. Re-reporting it would
					 * REPLACE a sentence derived from the script's own output - "could not reach
					 * the package index" - with one derived from the wrapper's message
					 * ("Backend preparation did not complete"), which is strictly less true.
					 */
					if (!this.failureOnScreen) {
						/*
						 * ONE SURFACE PER FAILURE. The window owns a failure whenever it is up - the
						 * ones this catch sees included, since those are the app's own preparation
						 * steps and the window is already painting them - and the modal is the
						 * fallback for the runs that never opened one: the update path, which
						 * imports this module and has no window, and a launch whose preparation
						 * failed before there was anything to show. Both used to fire for a single
						 * script failure (the panel painted the failure, the caller's catch raised a
						 * modal over it), which is what made "the two paths are mutually exclusive"
						 * untrue (review R1-4, UX U3).
						 */
						if (!this.hasLivePreparationWindow()) {
							const { response } = await electronDialog.showMessageBox({
								type: "error",
								title: "Backend setup could not finish",
								message:
									"Your existing environment and data were preserved. Retry setup to start this version of Local Operator.",
								detail: backendSetupFailureDetail(
									error,
									this.managedOptions().support,
								),
								buttons: ["Retry setup", "Quit"],
								defaultId: 0,
								cancelId: 1,
							});
							if (response !== 0) return false;
							continue;
						}
						this.reportInstallFailure(error);
					}
				}
				if (!this.failureOnScreen) return false;
				this.failureOnScreen = false;
				/*
				 * The window has the failure and the user has the choice, so startup waits
				 * here rather than resolving false - which `index.ts` reads as "cancelled or
				 * failed" and answers by quitting the app, taking the panel down a frame after
				 * it appeared. A successful retry resolves true; Quit exits the app and never
				 * resolves at all, which is what makes those two the only ways out.
				 */
				return await this.awaitUserDecision();
			}
		} finally {
			if (this.preparationWindow && !this.preparationWindow.isDestroyed())
				this.preparationWindow.close();
			this.preparationWindow = null;
		}
	}

	/**
	 * One attempt: this platform's preparation, then the setup window's own run.
	 *
	 * The platform split is the pre-existing one - macOS prepares a managed runtime
	 * and hands the callback a fresh venv path per generation; the other two build
	 * their environment inside the install script - and it is what decides which
	 * phases exist: `python` is the macOS preparation, and the script's two markers
	 * arrive on all three.
	 */
	private async prepareAndInstall(show: WindowShow): Promise<boolean> {
		if (process.platform !== "darwin") return this.installEnvironment(show);
		/*
		 * Say why, before preparing: a published environment that is gone or no
		 * longer the published bytes is now recovered from rather than refused
		 * (review R8), and the one place that diagnosis survives is this log - the
		 * user is told what to do, not which `pyvenv.cfg` disagreed.
		 */
		const state = inspectManagedSelection(this.managedOptions());
		if (state.kind === "missing")
			logger.warn(
				`Published backend environment is not usable and will be rebuilt: ${state.detail}`,
				LogFileType.INSTALLER,
			);
		/*
		 * THE WINDOW COMES UP FIRST, before the runtime is prepared.
		 *
		 * Measured by the UX round on this machine: the runtime copy and verification
		 * ran for 5-8 seconds on a cold first launch before anything was on screen, so
		 * the very first thing the product did was look like an app that failed to
		 * start - and the phase it then named as in progress had already finished (UX
		 * U12). Creating the window here means the panel paints immediately and the
		 * `python` milestone is watched rather than replayed.
		 */
		this.ensurePreparationWindow(show);
		await prepareManagedPython(this.managedOptions(), async (venv, python) => {
			this.venvPath = venv;
			this.pythonPath = python;
			return this.installEnvironment(show);
		});
		/*
		 * The success terminal, after the smoke probe rather than before it.
		 *
		 * `prepareManagedPython` resolves only once the installed server has answered
		 * `/health`, which is minutes of work that used to happen while the panel
		 * already said all four phases were done and Cancel was disabled - a
		 * finished-looking screen the user could not leave, during the one step that
		 * can still fail after a successful pip (review R1-11). It goes here, on the
		 * far side of that probe, and `verify` is announced on the near side.
		 */
		this.settleInstalled();
		return true;
	}

	/**
	 * Run the install script once, in the window the attempt owns.
	 *
	 * THE SHAPE, because it is otherwise surprising: the window used to be a spinner
	 * with a Cancel, and a failed install closed it and fell back to a detached error
	 * dialog - the user was left with nothing to act on. It now owns the failure: the
	 * phase it failed at, a sentence and the machine line under it, and a Retry that
	 * runs the preparation and this method again. The dialog is kept for the failures
	 * that happen with NO window up (see the catch at its foot and `install`'s), which
	 * is what keeps the two surfaces mutually exclusive rather than layered - one
	 * `failed` payload per failure, written in one place, and a dialog only where
	 * there is nothing else that can speak.
	 *
	 * The window itself is created by `ensurePreparationWindow`, which is idempotent:
	 * the first attempt creates it (on macOS before the runtime is prepared, so the
	 * first frame is not a blank screen), and a retry reuses it, because a window that
	 * rebuilt itself on every Retry would throw away the very state the Retry is
	 * offered from.
	 */
	private async installEnvironment(
		show: WindowShow = "never",
	): Promise<boolean> {
		/*
		 * THE DEFAULT IS `never`, and it is the safe direction rather than the
		 * historical one. Every path inside the app passes the launch's own plan
		 * explicitly (`install` / `prepareAndInstall` / the retry), so the default
		 * only applies to a caller that cannot name a plan - which, today, is the
		 * guard harness that drives this method directly to read the spawn's
		 * options (`scripts/python-bytecode-cache.test.mjs`). A window that is
		 * created but never shown is the one outcome that cannot take the
		 * operator's focus, and it is the failure the previous round found here
		 * (UX U7): the omitted `show` made this the only window in the app that
		 * ignored the mode. Defaulting to the old behaviour would hand that bug
		 * back to the next caller who forgets.
		 */
		/*
		 * Per attempt, not per window: a retry has to be cancellable on its own, and a
		 * `failureOnScreen` left over from the last attempt would make `install` hold
		 * for a decision nobody was being asked for.
		 */
		this.attemptCancelled = false;
		this.failureOnScreen = false;
		try {
			/*
			 * macOS is not prompted here, and that is a deliberate, user-visible
			 * change this branch made rather than an oversight (review R9).
			 *
			 * Two surfaces used to ask one question: this consent prompt, and the
			 * progress window that opens immediately after it, which carries its own
			 * Cancel. On macOS the install now runs inside `prepareManagedPython`'s
			 * preparation lock, so the prompt also stood between a user and a lock,
			 * and a modal held open there starves any other instance waiting to
			 * prepare. The window the user actually watches owns the decision, so the
			 * prompt is not shown and there is no consent state to cancel here; the
			 * platforms that still show it keep the same flow they had.
			 *
			 * What is NOT restored: a non-blocking acknowledgement. Nothing is said
			 * after a successful macOS setup, because the window closing and the app
			 * starting is the acknowledgement - see the note on the completion path.
			 */
			if (process.platform !== "darwin" && !this.hasLivePreparationWindow()) {
				const { response } = await electronDialog.showMessageBox({
					type: "info",
					title: "First-Time Setup Required",
					message:
						"Local Operator needs to set up some components to work properly. This one-time process will take just a few moments.",
					buttons: ["Set Up Now", "Cancel"],
					defaultId: 0,
					cancelId: 1,
				});
				if (response === 1) {
					// User cancelled installation
					logger.info(
						"User cancelled backend installation",
						LogFileType.INSTALLER,
					);
					// Exit the app when installation is cancelled
					setTimeout(() => {
						app.exit(0);
					}, 500);
					return false;
				}
			}

			// Create temporary script file based on platform
			let scriptPath: string;
			let cmd: string;
			let args: string[];
			const tempDir = fs.mkdtempSync(join(tmpdir(), "local-operator-install-"));

			// Set platform-specific script and command
			if (process.platform === "win32") {
				scriptPath = join(tempDir, "install-backend-windows.ps1");
				writeFileSync(scriptPath, windowsInstallScript);
				cmd = "powershell.exe";
				args = ["-ExecutionPolicy", "Bypass", "-File", scriptPath];
			} else if (process.platform === "darwin") {
				scriptPath = join(tempDir, "install-backend-macos.sh");
				writeFileSync(scriptPath, macosInstallScript);
				cmd = "bash";
				args = [scriptPath];
				// Make the script executable
				fs.chmodSync(scriptPath, "755");
			} else {
				// Linux
				scriptPath = join(tempDir, "install-backend-linux.sh");
				writeFileSync(scriptPath, linuxInstallScript);
				cmd = "bash";
				args = [scriptPath];
				// Make the script executable
				fs.chmodSync(scriptPath, "755");
			}

			logger.info(
				`Created and running installation script: ${scriptPath}`,
				LogFileType.INSTALLER,
			);

			/*
			 * The window: created by the one method that builds it, raised under the
			 * launch's own plan, and reused by a retry rather than rebuilt.
			 */
			this.ensurePreparationWindow(show);

			this.attemptInFlight = true;
			const result = await this.runInstallScript(this.venvPath, cmd, args);
			this.attemptInFlight = false;

			// If installation was cancelled, exit the app
			if (this.attemptCancelled) {
				logger.info(
					"Installation was cancelled, exiting app",
					LogFileType.INSTALLER,
				);
				app.exit(1);
				return false;
			}

			if (result.ok) {
				logger.info(
					"Backend installation completed successfully",
					LogFileType.INSTALLER,
				);

				// The venv exists now, so the guard can go in with it rather than
				// waiting for the next start - on every platform. It used to be skipped
				// on darwin, on the reasoning that this venv was built on the installed
				// bundle and editing it was a favour to the pre-split world. That is no
				// longer what this venv is: it is built on a runtime outside every
				// `.app`, and the processes the app does not spawn - the operator's
				// shell, a CLI script, launchd - can still run it and write bytecode
				// into a tree whose identity we assert. The guard is the half that
				// covers them (review R13, QA Q2).
				this.guardVenvBytecode();

				// Verify the installation by checking if the local-operator executable exists
				const localOperatorPath =
					process.platform === "win32"
						? join(this.venvPath, "Scripts", "local-operator.exe")
						: join(this.venvPath, "bin", "local-operator");

				if (!fs.existsSync(localOperatorPath)) {
					logger.error(
						`Installation verification failed: ${localOperatorPath} not found`,
						LogFileType.INSTALLER,
					);
					throw new Error(
						"Installation verification failed: local-operator executable not found",
					);
				}

				logger.info(
					"Installation verified successfully",
					LogFileType.INSTALLER,
				);

				/*
				 * Same platform split as the consent prompt above, and the same reason:
				 * on macOS the acknowledgement used to be a second modal, and it is
				 * deliberately not shown any more. The setup window closing and the app
				 * starting IS the acknowledgement there, and "Let's Go!" gated the
				 * window behind a click that said nothing the state did not already say
				 * (review R9). The platforms that still show it keep their flow.
				 */
				if (process.platform !== "darwin") {
					const { response: successResponse } =
						await electronDialog.showMessageBox({
							type: "info",
							title: "Setup Complete",
							message:
								"Local Operator is ready to use. Everything has been set up successfully.",
							buttons: ["Let's Go!", "Cancel"],
							defaultId: 0,
							cancelId: 1,
						});
					if (successResponse === 1) {
						// User cancelled installation
						logger.info(
							"User ended session after successful installation",
							LogFileType.INSTALLER,
						);
						// Exit the app when installation is cancelled
						setTimeout(() => {
							app.exit(0);
						}, 500);
						return false;
					}
				}

				// A short settle before the app continues, so the window's last frame is
				// painted before it closes. Kept on every platform: it is a paint delay,
				// not a dialog's shadow.
				await new Promise((resolve) => setTimeout(resolve, 500));

				// On Windows, wait for transcript file release before continuing
				if (process.platform === "win32") {
					const transcriptPath = join(
						this.appDataPath,
						"backend-install-shell.log",
					);

					// Wait for the transcript file to be released
					await (async () => {
						logger.info(
							"Waiting for transcript file release before continuing...",
							LogFileType.INSTALLER,
						);

						const maxAttempts = 30;
						let attempts = 0;

						while (attempts < maxAttempts) {
							try {
								const fd = fs.openSync(transcriptPath, "a");
								fs.closeSync(fd);
								logger.info(
									"Transcript file released successfully",
									LogFileType.INSTALLER,
								);
								// Add a small delay after file is released to ensure all resources are freed
								await new Promise((resolve) => setTimeout(resolve, 1000));
								break;
							} catch (_error) {
								logger.info(
									`Waiting for transcript file to be released (attempt ${attempts + 1}/${maxAttempts})`,
									LogFileType.INSTALLER,
								);
								await new Promise((resolve) => setTimeout(resolve, 500));
								attempts++;
							}
						}

						if (attempts >= maxAttempts) {
							logger.warn(
								"Timed out waiting for transcript file release, continuing anyway",
								LogFileType.INSTALLER,
							);
							// Add a longer delay if we timed out
							await new Promise((resolve) => setTimeout(resolve, 2000));
						}
					})();
				}
				/*
				 * The last phase, announced on the NEAR side of the smoke probe: the
				 * environment is built and what happens next is the check, so this is the
				 * step the user is then waiting on. Announcing it afterwards would paint a
				 * step as in progress over the interval nothing is happening in it.
				 *
				 * `installed` used to be sent from HERE, which settled all four steps and
				 * disabled Cancel while the probe still had minutes to run - a
				 * finished-looking panel with no way out, during the one step that can still
				 * fail after a successful pip (review R1-11). It is sent by
				 * `prepareAndInstall`, on the far side of the probe.
				 */
				this.rememberInstallPhase("verify");

				return true;
			}

			/*
			 * The install script exited non-zero: the one failure the user can act on,
			 * and the one the window owns.
			 *
			 * The sentence comes from the causes table where it recognises something -
			 * that table names the remedy where a raw line names only the symptom - and
			 * from `installFailureSentence` otherwise, which is the DEFAULT rather than
			 * the angle: before this, every unrecognised failure rendered the captured
			 * line verbatim, so the surface a user is most likely to meet on a bad day
			 * was a quoted exception (design D3). The line still travels, as `detail`,
			 * for the panel to show UNDER the sentence in machine voice.
			 *
			 * `exitCode === null` is a spawn that never started, which is why the null is
			 * carried through rather than folded into a negative number.
			 */
			this.reportInstallFailure(
				null,
				`${result.stderr}\n${result.stdout}`,
				installFailureReason(result.stdout, result.stderr),
				result.exitCode,
			);

			return false;
		} catch (error) {
			logger.error(
				"Error installing backend:",
				LogFileType.INSTALLER,
				error instanceof Error ? error.message : String(error),
			);
			if (error instanceof Error) {
				logger.exception(error, LogFileType.INSTALLER, "Backend Installation");
			}

			/*
			 * The bookkeeping THIS module owns failing: a runtime copy, a window that
			 * could not be created, a kill that found no child. It has two possible
			 * surfaces and picks by whether a window is up - the panel owns it when one
			 * is (that window is already painting the phase the failure happened in, and
			 * a modal on top of it is the double-surface review R1-4/U3 found), and the
			 * dialog is the fallback for the runs that never opened a window at all:
			 * the update path imports this module and creates none, and the consent
			 * prompt above returns before one exists.
			 */
			if (this.hasLivePreparationWindow()) this.reportInstallFailure(error);
			else
				electronDialog.showErrorBox(
					"Installation Error",
					`Error installing the Local Operator backend: ${error instanceof Error ? error.message : String(error)}`,
				);

			return false;
		}
	}

	/**
	 * The setup window: created once, raised under the launch's plan, reused by a
	 * retry.
	 *
	 * WHY IT IS IDEMPOTENT rather than one creation per attempt. The window is the
	 * surface the Retry is ON, so an attempt that rebuilt it would destroy the
	 * failure state the user was reading and hand them a fresh progress panel - and
	 * a fresh `did-finish-load`, a second replay, and a second `before-quit`
	 * listener (review R1-3). One window per install, however many attempts it
	 * takes.
	 */
	private ensurePreparationWindow(show: WindowShow): BrowserWindow {
		const existing = this.preparationWindow;
		if (existing && !existing.isDestroyed()) return existing;

		const progressWindow = new BrowserWindow({
			/*
			 * THE SIZE IS THE CONTENT BOX, explicitly.
			 *
			 * `useContentSize` is what makes 640x480 mean what the stories and the
			 * frames mean by it. Without it Electron measures width/height INCLUDING
			 * the macOS title bar, so the page gets ~452px of height while every
			 * frame in `docs/evidence/installer-installercontent/` is 480 - the same
			 * class of mismatch this round is fixing (design D1), and the reason the
			 * failure state's buttons would have sat ~22px below the fold in the
			 * window while the frame showed them.
			 */
			useContentSize: true,
			width: 640,
			height: 480,
			resizable: false,
			/*
			 * Minimisable, on a wait of one to five minutes: the window used to refuse
			 * this, so a user who needed the machine had no sanctioned way to put it
			 * aside (design D8). The install runs in this process either way; the panel
			 * says so in words below the Cancel.
			 */
			minimizable: true,
			maximizable: false,
			fullscreenable: false,
			/*
			 * Sentence case, and the same string the renderer's `<title>` carries: the
			 * contract applies to window titles too, and this one is read in the window
			 * menu and by assistive tech (design D11, UX N2).
			 */
			title: "Setting up Local Operator",
			/*
			 * `INSTALL_WINDOW_CANVAS` is what Electron paints before the renderer's
			 * first frame - the same `canvas` the panel paints, asserted against the
			 * generated theme CSS by `scripts/install-progress.test.mjs`, because a
			 * hand-copied duplicate is exactly what drifted here before (the previous
			 * value was the palette's `onAccent`, i.e. ink painted under the whole
			 * window - design D2).
			 */
			backgroundColor: INSTALL_WINDOW_CANVAS,
			/*
			 * `show: false`, then a raise through the launch's own plan.
			 *
			 * An omitted `show` means Electron's default, `true`, which is what made
			 * this the one window in the app with no mode gate: every agent-driven,
			 * headless or CI first run put a real window on the operator's screen (UX
			 * U7). An omitted option is not a call, so the source scan in
			 * `scripts/window-mode.test.mjs` could not see it either. `presentWindow`
			 * is the only raiser in the main process, and a `never` plan leaves this
			 * window invisible and real - which is the point of a headless run, and
			 * unlike a parked conversation there is nothing here for the operator to
			 * come back to: the install finishes or fails in the log.
			 */
			show: false,
			webPreferences: {
				preload: join(__dirname, "../preload/index.js"),
				sandbox: false,
			},
		});

		this.preparationWindow = progressWindow;

		// Load the installer HTML file
		if (is.dev && process.env.ELECTRON_RENDERER_URL) {
			// In development mode, use the dev server URL
			progressWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/installer`);
		} else {
			// In production mode, load the file directly
			progressWindow.loadFile(join(__dirname, "../renderer/installer.html"));
		}
		progressWindow.setMenuBarVisibility(false);

		/*
		 * The window's messages, registered ONCE for its whole lifetime.
		 *
		 * They used to be torn down the moment the install script resolved, while the
		 * window was deliberately kept open on failure - so the Retry the failure
		 * state exists to offer had no listener left to reach (review R1-3, UX U2:
		 * a real click registered with no log line and no change). They come off in
		 * the `closed` handler below, which is the last moment anything can arrive.
		 */
		const listeners: Array<() => void> = [];

		const replayHandler = () => {
			if (this.lastPhase === null) return;
			this.sendInstallProgress({ kind: "phase", phase: this.lastPhase });
		};

		const retryHandler = () => {
			const last = this.failureOnScreen;
			if (!last || this.attemptInFlight) return;
			logger.info(
				"Retrying the backend installation from the setup window",
				LogFileType.INSTALLER,
			);
			this.failureOnScreen = false;
			void this.retryFromWindow();
		};

		const cancelHandler = () => {
			logger.info(
				"Installation cancelled by user from the setup window",
				LogFileType.INSTALLER,
			);
			void this.quitFromWindow();
		};

		ipcMain.on(INSTALL_IPC_CHANNELS.replay, replayHandler);
		ipcMain.on(INSTALL_IPC_CHANNELS.cancel, cancelHandler);
		ipcMain.on(INSTALL_IPC_CHANNELS.retry, retryHandler);
		listeners.push(() => {
			ipcMain.removeListener(INSTALL_IPC_CHANNELS.replay, replayHandler);
			ipcMain.removeListener(INSTALL_IPC_CHANNELS.cancel, cancelHandler);
			ipcMain.removeListener(INSTALL_IPC_CHANNELS.retry, retryHandler);
		});

		/*
		 * Closing the window. Two facts decide what it means, and neither is the
		 * close itself: an attempt still running is an abort (the same thing the
		 * Cancel button does), and a window with nothing left to wait for is just
		 * closing.
		 */
		progressWindow.on("close", () => {
			if (this.attemptInFlight) {
				logger.info(
					"Installation cancelled by user closing the progress window",
					LogFileType.INSTALLER,
				);
				this.attemptCancelled = true;
				this.killInstallProcess();
				return;
			}
			/*
			 * A window closed with a FAILURE on screen is the user declining to retry,
			 * and the app cannot start without setup - so the process leaves with it
			 * rather than waiting on a decision nobody can now make. Without this the
			 * `await` in `install` has no resolver and no surface: the app would sit
			 * alive with no window at all, which is the worse version of the silent quit
			 * this round is fixing.
			 */
			if (this.failureOnScreen) {
				logger.info(
					"Setup window closed with the failure on screen; quitting",
					LogFileType.INSTALLER,
				);
				app.exit(0);
			}
		});

		/*
		 * The phases that ran before this window existed, pushed at the one moment it
		 * can receive them. `did-finish-load` is what makes the first painted frame
		 * true for a window that never asks; the replay channel answers a window that
		 * subscribes after load.
		 */
		progressWindow.webContents.once("did-finish-load", replayHandler);

		/*
		 * The launch's plan, applied through the one raiser in the main process. The
		 * trigger is named rather than inferred, because a headless run's whole value
		 * is that this line is the only record of who brought a window forward.
		 */
		presentWindow(progressWindow, show, {
			trigger: "initial-present",
			report: (line) => logger.info(line, LogFileType.INSTALLER),
		});

		progressWindow.on("closed", () => {
			for (const off of listeners) off();
			this.preparationWindow = null;
		});

		return progressWindow;
	}

	/**
	 * Run the preparation and the install again, from the window's Retry.
	 *
	 * The outcome is reported the same way the first attempt's is - the window is
	 * handed the next failure (or `installed`) through the ordinary payload, so a
	 * retry has no second code path - and a SUCCESS resolves the decision
	 * `install()` is holding on, which is what lets startup continue into the
	 * backend it just installed.
	 */
	private async retryFromWindow(): Promise<void> {
		let ok = false;
		try {
			ok = await this.prepareAndInstall(this.windowShow);
		} catch (error) {
			logger.error(
				"Backend preparation failed on a retry from the setup window",
				LogFileType.INSTALLER,
				error,
			);
			if (!this.failureOnScreen) this.reportInstallFailure(error);
		}
		if (!ok) return;
		const settle = this.settleUserDecision;
		this.settleUserDecision = null;
		settle?.(true);
	}

	/**
	 * Cancel, as the user met it: a confirmation, then quit.
	 *
	 * WHY A CONFIRMATION. The old behaviour was one click and the app was gone
	 * inside a second - no question, no sentence, and nothing on the next launch to
	 * say a setup had been started and abandoned (UX U5). Setup is not optional
	 * work here (the app cannot start without it), so the honest shape is the one
	 * the app already uses for the failures it can explain: say what quitting
	 * costs, and let the user decide.
	 *
	 * Nothing about it is silent: both outcomes are logged, and a cancelled attempt
	 * leaves its partial environment where the next attempt reuses or replaces it.
	 */
	private async quitFromWindow(): Promise<void> {
		const inFlight = this.attemptInFlight;
		const { response } = await electronDialog.showMessageBox({
			type: "question",
			buttons: ["Keep setting up", "Quit without setup"],
			defaultId: 0,
			cancelId: 0,
			title: "Quit without setup?",
			message: "Local Operator needs this setup to run.",
			detail:
				"Quitting now stops it. Nothing that was already on this computer is changed, and the next launch starts the setup again.",
		});
		if (response !== 1) {
			logger.info(
				"Setup quit declined from the setup window",
				LogFileType.INSTALLER,
			);
			return;
		}
		this.attemptCancelled = inFlight;
		if (inFlight) this.killInstallProcess();
		logger.info(
			"Quitting without setup from the setup window",
			LogFileType.INSTALLER,
		);
		app.exit(inFlight ? 1 : 0);
	}

	/**
	 * Kill whichever install child is live - and only the one this process started.
	 *
	 * The pid is read from `this.installProcess` at call time rather than captured by
	 * the caller, because a retry REPLACES the child: a closure holding the first
	 * attempt's pid would signal a process group that no longer exists and leave the
	 * running one orphaned, still pip-installing into an environment nothing is
	 * waiting for.
	 */
	private killInstallProcess(): void {
		const installProcess = this.installProcess;
		if (!installProcess?.pid) return;
		try {
			// On Windows, use taskkill to kill the process tree
			if (process.platform === "win32") {
				spawn("taskkill", ["/pid", installProcess.pid.toString(), "/f", "/t"]);
				return;
			}
			// On Unix-like systems, kill the process group
			process.kill(-installProcess.pid, "SIGTERM");
		} catch (error) {
			logger.error(
				"Error killing installation process:",
				LogFileType.INSTALLER,
				error,
			);
		}
	}

	/**
	 * The install script, run once per attempt.
	 *
	 * Extracted from `installEnvironment` when the window gained a Retry: a retry is
	 * this function again, with the marks a second run has to reset, and the
	 * alternative - re-entering `installEnvironment` - would rebuild the window,
	 * re-register its handlers and re-show any dialog, which is exactly the flash of
	 * chrome a retry must not produce.
	 *
	 * The child is kept on the instance rather than in a local, because the Cancel
	 * button and the window's own close handler both have to reach it and on a retry
	 * there must be exactly one live child to reach.
	 *
	 * The resolved path arrives as an argument rather than being read off the field:
	 * the retry path calls `installEnvironment` again, and this method must install
	 * into the environment that attempt resolved. `prepareManagedPython` allocates a
	 * fresh final path per generation, so reading `this.venvPath` here would install
	 * into whichever generation the last retry left behind.
	 */
	private async runInstallScript(
		venvPath: string,
		cmd: string,
		args: string[],
	): Promise<{
		ok: boolean;
		exitCode: number | null;
		stdout: string;
		stderr: string;
	}> {
		/*
		 * One settle helper rather than a `resolve()` per branch. Three of the four
		 * exits below (spawn error, non-zero exit, cancelled) carry the same shape -
		 * the outcome plus everything the script wrote - and spelling that out three
		 * times is how one of them ends up reporting the wrong exit code. The captured
		 * output is what the window's failure state names the reason from, and a
		 * boolean cannot carry it back to `prepareManagedPython`'s callback contract,
		 * which is why the richer shape stays inside this method.
		 */
		let settled = false;
		return new Promise<{
			ok: boolean;
			exitCode: number | null;
			stdout: string;
			stderr: string;
		}>((resolve) => {
			let captured = "";
			let capturedErrors = "";
			/*
			 * The half of an stdout line that has not arrived yet.
			 *
			 * `data` is a CHUNK, not a line: a marker can be split across two of them, and
			 * a parser run per chunk would see `|LO1:compo` and then `nents` and recognise
			 * neither - which is what `splitLines` exists for, and the one way a correct
			 * parser still misses every milestone. Declared out here rather than inside
			 * the stdout handler so the exit handler can flush what is left.
			 */
			let markerCarry = "";
			const settle = (ok: boolean, exitCode: number | null) => {
				if (settled) return;
				settled = true;
				resolve({ ok, exitCode, stdout: captured, stderr: capturedErrors });
			};
			try {
				// Set environment variables for the installation script.
				//
				// The install script creates the venv with our bundled interpreter,
				// which makes that interpreter - and its stdlib, inside the sealed
				// `.app` - the venv's own, so every python the script or the venv then
				// runs can write `__pycache__/*.pyc` into the bundle and break its code
				// signature.
				//
				// This prefix does not answer that on its own, and the reason is
				// structural: the app does not spawn every python that runs this
				// interpreter, and the ones it does not spawn (the operator's shell, a CLI
				// script, an agent) carry no prefix at all - measured, a venv over this
				// tree wrote 25 `.pyc` into it that way. It is set all the same, for the
				// children that do inherit this environment, and because this spawn runs
				// before the backend's own shell environment exists to inherit one from.
				// The half no spawner can evade is the seal on the tree itself, above.
				const env: Record<string, string | undefined> = withPythonBytecodeCache(
					{ ...process.env },
					this.appDataPath,
				);

				// Pass the resources path to the script for finding bundled Python
				env.ELECTRON_RESOURCE_PATH = this.resourcesPath;

				/*
				 * And the environment this instance's install belongs to.
				 *
				 * The script cannot derive it: it runs as a subprocess with no view of
				 * `app.isPackaged`, so left to itself it builds the packaged name for every
				 * instance - measured by a review, which ran the shipped macOS script under a
				 * dev instance's environment and watched it create `.../local-operator-venv`
				 * while this app's own answer for the same instance was
				 * `.../local-operator-venv-dev`. That is the shared environment whose
				 * interpreter is the installed bundle's, so a dev instance would still pip
				 * into and `rm -rf` the packaged app's environment, and then fail this
				 * class's own `isInstalled()` check and quit. One path decision, handed down
				 * rather than re-made - from the argument rather than from `this.venvPath`,
				 * because this method is called once per attempt and the field belongs to
				 * whichever attempt ran last.
				 */
				env[VENV_PATH_ENV] = venvPath;
				// Hand down Electron's actual paths, not an assumed HOME, including
				// the scripts' hardcoded support boundary during isolated native tests.
				env.HOME = app.getPath("home");
				env.LOCAL_OPERATOR_SUPPORT_PATH =
					process.platform === "darwin"
						? this.managedOptions().support
						: this.appDataPath;
				logger.info(
					`Setting ${VENV_PATH_ENV} to ${venvPath}`,
					LogFileType.INSTALLER,
				);

				/*
				 * And the bundled uv, which is what makes the package install fast.
				 *
				 * WHY THE APP RESOLVES IT RATHER THAN THE SCRIPT PROBING: the resource
				 * namespace, the per-architecture directory and the platform's binary
				 * name are the app's own layout (`uv-tool.ts` reads the one definition),
				 * and a script that re-derived them would be a second copy of that layout
				 * in another language.
				 *
				 * ABSENT IS THE ORDINARY CASE, not a failure: a dev checkout whose
				 * `pnpm setup-python` has not been run, and any artifact built before
				 * this change, have no bundled uv. The script then installs with pip
				 * exactly as it did before, so nothing about that path is left unexercised
				 * by a build that lacks it - the CI install-script jobs are one such
				 * build, and they run the fallback on every pull request.
				 */
				const uv = ensureUvToolExecutable(this.managedOptions());
				if (uv.path !== null) {
					env[UV_TOOL_ENV] = uv.path;
					logger.info(
						uv.healed
							? `Restored the execute bit on the bundled uv (${uv.path}) before handing it to the installer; the mode a bundle arrives with is not covered by codesign's seal`
							: `Setting ${UV_TOOL_ENV} to ${uv.path}`,
						LogFileType.INSTALLER,
					);
				} else {
					logger.info(
						`No bundled uv for ${process.arch}: ${uv.reason}`,
						LogFileType.INSTALLER,
					);
				}

				// Log the resources path for debugging
				logger.info(
					`Setting ELECTRON_RESOURCE_PATH to ${this.resourcesPath}`,
					LogFileType.INSTALLER,
				);

				// If we found Python, pass its path directly
				if (this.pythonPath) {
					env.PYTHON_BIN = this.pythonPath;
					logger.info(
						`Setting PYTHON_BIN to ${this.pythonPath}`,
						LogFileType.INSTALLER,
					);
				}
				this.installProcess = spawn(cmd, args, {
					detached: process.platform !== "win32", // Detach on Unix-like systems for process group
					stdio: "pipe",
					env, // Pass environment variables to the script
				});

				if (this.installProcess.stdout) {
					this.installProcess.stdout.on("data", (data) => {
						const output = data.toString();
						captured += output;
						/*
						 * THE CONSUMER THIS CHANNEL DID NOT HAVE.
						 *
						 * The install scripts have always printed one milestone line per phase
						 * (`|LO1:<phase>`, see `src/shared/install-progress.ts`) and this handler has
						 * always captured them - into the log, and nowhere else. So the window was
						 * told about the two phases `managed-python.ts` reports directly and never
						 * about the script's own two: `environment` and `components` were printed,
						 * written to a file, and dropped, and the panel could only ever go
						 * `python -> verify` (review R1-1, UX U1, which measured the panel sitting
						 * on "Preparing Python" for 2m37s of a 3m11s install and naming that phase
						 * when a pip failure had actually happened two phases later).
						 *
						 * Parsing here rather than in the renderer is deliberate: this process owns
						 * the child, the phase is what the NEXT payload says, and the window in the
						 * macOS flow is created after the `python` phase has already run - so the
						 * fact has to be remembered here to be replayed at all.
						 */
						const split = splitLines(markerCarry, output);
						markerCarry = split.carry;
						for (const line of split.lines) {
							const phase = parseInstallMarker(line);
							if (phase !== null) this.rememberInstallPhase(phase);
						}
						console.log(`Installation stdout: ${output}`);
						logger.info(
							`Installation stdout: ${output}`,
							LogFileType.INSTALLER,
						);
					});
				}

				if (this.installProcess.stderr) {
					this.installProcess.stderr.on("data", (data) => {
						const output = data.toString();
						capturedErrors += output;
						console.error(`Installation stderr: ${output}`);
						logger.error(
							`Installation stderr: ${output}`,
							LogFileType.INSTALLER,
						);
					});
				}

				this.installProcess.on("error", (error) => {
					logger.error(
						`Installation error: ${error instanceof Error ? error.message : String(error)}`,
						LogFileType.INSTALLER,
					);
					if (error instanceof Error) {
						logger.exception(
							error,
							LogFileType.INSTALLER,
							"Installation Process",
						);
					}
					settle(false, null);
				});

				this.installProcess.on("exit", (code) => {
					/*
					 * A last line with no newline after it: a script that ends in `echo -n`,
					 * or an exit that races the flush. Without this the marker in the very last
					 * line is the one milestone that can be lost.
					 */
					if (markerCarry.length > 0) {
						const phase = parseInstallMarker(markerCarry);
						if (phase !== null) this.rememberInstallPhase(phase);
						markerCarry = "";
					}
					logger.info(
						`Installation process exited with code ${code}`,
						LogFileType.INSTALLER,
					);

					// A non-zero exit is the normal case this path exists for, and the
					// window names it from the output the run captured.
					settle(code === 0, code);
					// The window's Cancel handler reaches the child through the field, so a
					// finished child must not be left there: a later cancel would signal a pid
					// the OS has already reaped.
					this.installProcess = null;
				});
			} catch (error) {
				logger.error(
					"Error running installation script:",
					LogFileType.INSTALLER,
					error,
				);
				settle(false, null);
			}
		});
	}
}
