import { UpdateNotification } from "@shared/components/common/update-notification";
import { apiConfig } from "@shared/config/api-config";
import type { Meta, StoryObj } from "@storybook/react";
import type { UpdateInfo } from "electron-updater";
import type { FC } from "react";
import { useLayoutEffect } from "react";
import type { UpdateCheckVerdict } from "../../../../../main/update-check-verdict";
import { AppUpdatesSection } from "./app-updates-section";

/**
 * Settings, Application updates and info, in the state the operator reported.
 *
 * ## Why this story exists
 *
 * A user pressed "Check for updates" once and got both "Server version 0.54.44
 * is available. You are currently using version 0.54.43." and "You are up to
 * date" - application 0.22.1 against server 0.54.43, with 0.54.44 published.
 * The two sentences came from two components the app mounts in different
 * places, and it is their disagreement that is the defect: the panel says what
 * `UpdateNotification` renders from the server channel's offer, and the
 * snackbar said what `CheckForUpdatesButton` rendered from the app channel's
 * own "nothing newer" event - each true about its own channel, together a
 * contradiction. So this story renders both, on the real section chrome.
 *
 * ## Why it drives the real button with a press
 *
 * The affirmation under test is the one a real press produces, so the story
 * finds the section's own button and clicks it. Nothing here calls the check
 * directly: a story that did would be a picture of the harness.
 *
 * ## Why it is captured from a built Storybook rather than the dev server
 *
 * `CheckForUpdatesButton` refuses to check at all when `import.meta.env.DEV` is
 * true - the dev server renders "Updates are not checked in development mode",
 * which is the right thing for the product and the wrong thing to photograph.
 * `pnpm build-storybook` is a production bundle, where the button checks, so
 * the frames are taken from a static build served on a loopback port. The
 * same command run against the pre-fix tree produces this story's "before"
 * frame, since the story itself contains no part of the fix.
 *
 * ## The two readings the story owns
 *
 * The section reads the server version over HTTP and the app version over the
 * preload bridge. Both are answered here with the report's own numbers, because
 * a frame has to be a function of the tree: an unstubbed health read would
 * photograph whatever backend happened to be listening on the operator's port.
 */

/** The versions in the report: application 0.22.1, server 0.54.43, 0.54.44 out. */
const RUNNING_APP = "0.22.1";
const INSTALLED_SERVER = "0.54.43";
const PUBLISHED_SERVER = "0.54.44";

/**
 * The three numbers one story's world is made of.
 *
 * Per story rather than module constants because the stories now frame TWO
 * machines: the one in the first report (0.22.1 / 0.54.43 / 0.54.44) and the
 * operator's own, where an app-managed server three releases behind its published
 * release was reported as up to date. A frame's numbers are part of what it
 * asserts - the Server version row and the offer's sentence have to be read
 * against each other - so a story that reused another machine's numbers would be
 * a picture of neither.
 */
type MachineNumbers = {
	/** What `window.api.systemInfo.getAppVersion` answers. */
	app: string;
	/** What the daemon's `/health` reports, and what the Server version row prints. */
	server: string;
	/** What the registry publishes, i.e. what an offer names. */
	published: string;
};

const REPORTED_MACHINE: MachineNumbers = {
	app: RUNNING_APP,
	server: INSTALLED_SERVER,
	published: PUBLISHED_SERVER,
};

const BACKEND_ORIGIN = new URL(apiConfig.baseUrl).origin;

/**
 * What the whole check found out here, as GIVEN data.
 *
 * The rule that produces a verdict lives in `src/main/update-check-verdict.ts`
 * and is asserted in `scripts/update-robustness.test.mjs`. It is written out
 * rather than imported because this story is captured from BOTH this tree and a
 * worktree at the pre-fix commit - where that module does not exist - so a
 * story that imported it could not be photographed on the before tree, and the
 * pair would be two different scripts rather than one script on two trees. The
 * type IS imported, so a change to the verdict's shape fails this file's
 * typecheck the moment it lands.
 *
 * `affirmation: null` is the point of the frame, not a detail of it: an offer on
 * the server channel means this check positively did not prove the installation
 * current, so it earns no sentence - while the app channel's own "nothing
 * newer" event still fires, which is what the pre-fix button turned into "You
 * are up to date".
 */
const REPORTED_VERDICT: UpdateCheckVerdict = {
	app: "current",
	server: "available",
	affirmation: null,
};

/**
 * The one pair that EARNS a sentence: both channels proved current.
 *
 * Written out for the same reason as `REPORTED_VERDICT` - this file is
 * photographed on a tree without the fix, where the module that owns the
 * sentence does not exist, so a value import here would break the before half
 * of the pair. The literal must match `UP_TO_DATE_AFFIRMATION` in
 * `src/main/update-check-verdict.ts`, which is the shipped copy.
 *
 * `satisfies` rather than `: UpdateCheckVerdict` so the sentence stays a
 * `string` here: it is the text the frame below waits for. The type still
 * fails this file the moment the verdict's shape changes.
 */
const ALL_CURRENT_VERDICT = {
	app: "current",
	server: "current",
	affirmation: "The application and server are up to date",
} satisfies UpdateCheckVerdict;

/** The payload the main process sends on `backend-update-available`. */
type ServerOfferListener = Parameters<
	typeof window.api.updater.onBackendUpdateAvailable
>[0];

/**
 * A bridge that answers one press the way the main process answered it.
 *
 * Both halves are scripted because both are the defect: each channel emits its
 * OWN renderer event - the app's `update-not-available`, the server's
 * `backend-update-available` - and the call resolves the verdict for the whole
 * check. A bridge that fired only the events could not show what the fixed
 * button does with an answer, and one that returned only the verdict could not
 * show the offer the answer must not contradict.
 *
 * Every method the mounted components subscribe to is present, including the
 * ones only `UpdateNotification` reaches: a bridge missing one throws inside a
 * mount effect, and Storybook draws its own error page over the frame, so the
 * capture would fail as "never prepared" rather than as the missing method.
 */
/**
 * What one story's world is, beyond the verdict: the three versions, the offer
 * the server channel sends, and the skew notice the check raises on the state
 * that has nothing to offer.
 *
 * The verdict is the RULE's output and these are the PRODUCER's payloads, so a
 * story that frames a state the rule can reach states both - which is what the
 * pairs below are: one machine, the verdict before the change and the verdict
 * after it.
 */
type StoryWorld = {
	verdict: UpdateCheckVerdict;
	numbers: MachineNumbers;
	/** Fired on `backend-update-available` when present, instead of the default. */
	offer?: Record<string, unknown>;
	/** Fired on `backend-update-not-available` when present. */
	skew?: Record<string, unknown>;
};

const scriptedUpdater = ({ verdict, numbers, offer, skew }: StoryWorld) => {
	const appCurrent: Array<(info: UpdateInfo) => void> = [];
	const serverOffered: Array<ServerOfferListener> = [];
	const serverNotAvailable: Array<(info: Record<string, unknown>) => void> = [];
	const hold = <T,>(sink: T[], listener: T) => {
		sink.push(listener);
		return () => {
			const at = sink.indexOf(listener);
			if (at >= 0) sink.splice(at, 1);
		};
	};
	const noop = () => () => {};
	return {
		checkForUpdates: async () => ({ updateInfo: {}, cancellationToken: null }),
		checkForBackendUpdates: async () => null,
		checkForAllUpdates: async () => {
			/*
			 * Each channel's event follows the verdict this call is answering
			 * with, so the script cannot contradict itself: an app that is
			 * current says so on the app channel, and a server that trails
			 * carries the offer. A channel whose verdict is anything else stays
			 * silent here rather than being scripted to say the opposite.
			 */
			if (verdict.app === "current") {
				for (const listener of [...appCurrent]) {
					listener({ version: numbers.app } as UpdateInfo);
				}
			}
			/*
			 * The skew notice is a producer event of its own (main sends it on the state
			 * with nothing to offer), so a story whose world has one fires it here rather
			 * than leaving the frame to imply it.
			 */
			if (skew) {
				for (const listener of [...serverNotAvailable]) listener(skew);
			}
			if (verdict.server !== "available") return verdict;
			for (const listener of [...serverOffered]) {
				listener(
					(offer ?? {
						currentVersion: numbers.server,
						latestVersion: numbers.published,
						// The command the plan resolves for a uv-tool server, and the flag
						// that says the app can run it - the panel's buttons come from the
						// flag, and `manual` is the producer saying this check is the
						// user's own, which is what ends a by-hand panel.
						updateCommand: "uv tool upgrade local-operator",
						canManageUpdate: true,
						manual: true,
					}) as Parameters<ServerOfferListener>[0],
				);
			}
			return verdict;
		},
		updateBackend: async () => false,
		downloadUpdate: async () => [],
		quitAndInstall: async () => true,
		quitForUpdateInstall: async () => true,
		getLastInstallAttempt: async () => null,
		onUpdateAvailable: noop,
		onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) =>
			hold(appCurrent, callback),
		onUpdateDevMode: noop,
		onUpdateNpxAvailable: noop,
		onBackendUpdateAvailable: (callback: ServerOfferListener) =>
			hold(serverOffered, callback),
		onBackendUpdateDevMode: noop,
		onBackendUpdateNotAvailable: (
			callback: (info: Record<string, unknown>) => void,
		) => hold(serverNotAvailable, callback),
		onBackendUpdateCompleted: noop,
		onBackendUpdateProgress: noop,
		/*
		 * The surface this check's failure lands on now that the panel subscribes to
		 * it: a stub missing it throws inside the panel's mount effect, and Storybook
		 * draws its own error page over the frame.
		 */
		onBackendUpdateError: noop,
		onBackendUpdateManualRequired: noop,
		onUpdateDownloaded: noop,
		onUpdateProgress: noop,
		onUpdateError: noop,
		onUpdateInstallBlocked: noop,
		onUpdateInstallFailed: noop,
		onUpdateInstallInFlight: noop,
		onBeforeQuitForUpdate: noop,
		/*
		 * Not part of the real bridge: the story below waits for the panel's own
		 * subscription before it presses, because the components subscribe in
		 * PASSIVE effects and a press from the layout phase would fire its event
		 * into an empty registry - a frame of this harness rather than of the
		 * app.
		 */
		listenerCounts: () => ({
			appCurrent: appCurrent.length,
			serverOffered: serverOffered.length,
			serverNotAvailable: serverNotAvailable.length,
		}),
	};
};

/**
 * The scripted bridge this page installed, once it has been installed. The
 * story reads its listener registry, which the real bridge does not have.
 */
const updaterRef = () =>
	(window as unknown as { __loUpdater?: ReturnType<typeof scriptedUpdater> })
		.__loUpdater;

/**
 * Install the two readings this story owns, from the meta decorator.
 *
 * The verdict is the STORY's, taken from its `parameters`, because the fixture
 * has to be installed before the components mount and each story is a different
 * answer to the same press.
 *
 * Not in the frame's own effect: the section reads the bridge and the health
 * endpoint in its mount effects, and React runs a CHILD's effects before its
 * parent's - so a fixture installed by a parent effect would land after the
 * reads it answers. A decorator's body runs before its children render, which
 * is early enough for both.
 */
const installFixtures = (world: StoryWorld) => {
	const window_ = window as unknown as {
		api: { updater: unknown; systemInfo: unknown };
		__loSectionFixtures?: boolean;
		__loUpdater?: ReturnType<typeof scriptedUpdater>;
	};
	if (window_.__loSectionFixtures) return;
	window_.__loSectionFixtures = true;
	const scripted = scriptedUpdater(world);
	window_.__loUpdater = scripted;
	window_.api.updater = scripted;
	window_.api.systemInfo = {
		getAppVersion: async () => world.numbers.app,
		getPlatformInfo: async () => ({
			platform: "darwin",
			arch: "arm64",
			nodeVersion: "22.14.0",
			electronVersion: "33.2.1",
			chromeVersion: "130.0.6723.152",
		}),
	};
	const original = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		if (url.startsWith(BACKEND_ORIGIN)) {
			/*
			 * The SERVING server's own reading, which is what the Server version row
			 * prints: a frame whose offer names one version while this answers another
			 * is the contradiction the panel exists to avoid, so both come from the
			 * story's one world.
			 */
			return new Response(
				JSON.stringify({ result: { version: world.numbers.server } }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}
		return original(input, init);
	};
};

/** The section's own button, pressed the way a user presses it. */
const pressCheckForUpdates = () => {
	const button = [...document.querySelectorAll("button")].find(
		(candidate) => candidate.textContent?.trim() === "Check for updates",
	);
	button?.click();
	return Boolean(button);
};

/**
 * The press, and the shutter.
 *
 * `expect` is the text this verdict's own press is supposed to put on screen -
 * the notification's offer when the server trails, the affirmation sentence
 * when the whole check proved both channels current - and the shutter waits for
 * it rather than for a fixed delay. The frame therefore cannot silently
 * photograph a press that produced nothing, and the wait is a property of the
 * story's script rather than of how long the harness happened to sleep.
 */
const ReportFrame: FC<{ expect: string }> = ({ expect }) => {
	useLayoutEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		const settle = async () => {
			/*
			 * `UpdateNotification` and the button both subscribe in passive
			 * effects. Pressing before those land would fire the events into an
			 * empty registry, which is a frame of the harness rather than of the
			 * app, and it would look like the bug being absent rather than like
			 * the fixture being early.
			 */
			for (let i = 0; i < 200; i++) {
				const counts = updaterRef()?.listenerCounts();
				if ((counts?.serverOffered ?? 0) > 0) break;
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			await new Promise((resolve) =>
				requestAnimationFrame(() => resolve(null)),
			);
			/*
			 * The press is the subject, so it happens before anything is
			 * photographed, and the shutter waits for the text the verdict produces.
			 * On the pre-fix tree the affirmation is committed in the same pass as
			 * the panel, so both are up by the time the offer lands.
			 */
			await pressCheckForUpdates();
			for (let i = 0; i < 100; i++) {
				if (document.body.textContent?.includes(expect)) {
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			await new Promise((resolve) =>
				requestAnimationFrame(() => resolve(null)),
			);
			await new Promise((resolve) =>
				requestAnimationFrame(() => resolve(null)),
			);
			if (!cancelled) {
				delete document.documentElement.dataset.capturePending;
			}
		};
		void settle();
		return () => {
			cancelled = true;
			delete document.documentElement.dataset.capturePending;
		};
	}, [expect]);

	return (
		<div className="min-h-screen bg-canvas p-6 font-sans text-body text-ink">
			{/*
			 * Both are fixed to the same bottom-right corner while they are up, so
			 * their ORDER is what decides which one is legible: in `app.tsx` the
			 * notification is mounted before the shell, so the section's snackbar
			 * paints over it - which is the order the report's screenshot shows.
			 * Drawn the other way round, the notification's own "a new server
			 * update is available" would cover the affirmation the frame exists to
			 * show, and the before frame would look like a fix that is absent
			 * rather than like a fixture with the wrong order.
			 *
			 * `autoCheck={false}` because this frame answers the one press above
			 * and not a check nobody asked for.
			 */}
			<UpdateNotification autoCheck={false} />
			<AppUpdatesSection />
		</div>
	);
};

const meta = {
	title: "Settings/App updates section",
	component: AppUpdatesSection,
	/*
	 * `verdict` is the story's own script: the decorator installs a bridge that
	 * answers the press with it, so the ServerUpdateOffered and AllCurrent
	 * frames differ in the answer the check gave and in nothing else.
	 */
	parameters: {
		layout: "fullscreen",
		verdict: REPORTED_VERDICT,
		numbers: REPORTED_MACHINE,
	},
	/*
	 * Every story here drives the updater through a scripted bridge and reads
	 * the server version from a fixture, so a story added later cannot pick up
	 * the live ones by accident.
	 */
	decorators: [
		(Story, context) => {
			installFixtures({
				verdict: context.parameters.verdict as UpdateCheckVerdict,
				numbers: (context.parameters.numbers ??
					REPORTED_MACHINE) as MachineNumbers,
				offer: context.parameters.offer as Record<string, unknown> | undefined,
				skew: context.parameters.skew as Record<string, unknown> | undefined,
			});
			return <Story />;
		},
	],
} satisfies Meta<typeof AppUpdatesSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The reported state: the app is current and the server trails, so one press
 * offers the server update and the whole check earns no affirmation.
 *
 * Before the fix this frame is the report - the offer as a panel and "You are
 * up to date" as a success snackbar, from that one press. After it, the same
 * press leaves the offer standing and says nothing ITSELF: the notification's
 * own "a new server update is available" line is still up beside it.
 */
export const ServerUpdateOffered: Story = {
	render: () => <ReportFrame expect="Server update available" />,
};

/**
 * The state the sentence exists for: both channels current, so the verdict
 * carries the affirmation and no offer is raised. One press leaves the
 * affirmation and nothing else on screen.
 *
 * This is the AFTER half of the copy this branch introduces, and the state the
 * two hand-rolled stories deleted from `check-for-updates-button.stories.tsx`
 * used to depict: those fired a channel's own `onUpdateNotAvailable` and drew
 * their own button, which is a mechanism the shipped button no longer turns
 * into a sentence - it reads one from the verdict of the check it ran.
 */
export const AllCurrent: Story = {
	parameters: { verdict: ALL_CURRENT_VERDICT },
	render: () => <ReportFrame expect={ALL_CURRENT_VERDICT.affirmation} />,
};

/**
 * THE OPERATOR'S OWN MACHINE, before and after: the pair this change exists for.
 *
 * What the two frames are, exactly. The machine state is real and was read off
 * this host: the desktop application 0.26.5, `/health` answered by an app-managed
 * environment at 0.56.8 (prefix
 * `.../managed-python/packaged/environments/183bbfdc…-7ad511f5…`), the global uv
 * tool install at 0.56.11 - which is also what PyPI published. The two VERDICTS
 * and the two EVENT PAYLOADS below are the ones the main process really produced
 * for that state: `BeforeTheFix` is what origin/main answered (run against this
 * machine's live backend, log lines in the pull request), and `ServerBehindServingInstall`
 * is what this branch answers for the same state.
 *
 * So each frame is the mapping the renderer performs on a producer answer that
 * was actually produced - not a hand-written picture of a state nobody reached.
 * The pair is the point: the same press, the same Server version row (0.56.8 ·
 * 127.0.0.1:1111), and the sentence that changed.
 */
const OPERATOR_MACHINE: MachineNumbers = {
	app: "0.26.5",
	server: "0.56.8",
	published: "0.56.11",
};

/**
 * What origin/main concluded: the check classified the install `local-operator`
 * resolves to (the uv tool install at 0.56.11, the published release), so the
 * whole check affirmed the installation current - while the same pane's Server
 * version row read the daemon it is actually talking to.
 */
const OPERATOR_VERDICT_BEFORE: UpdateCheckVerdict = {
	app: "current",
	server: "current",
	affirmation: "The application and server are up to date",
};

/**
 * The offer this branch produces: the SERVING install's version (0.56.8) against
 * the published release (0.56.11), with the remedy for the install that is behind.
 *
 * The fields are the real payload's, including the two that matter for honesty -
 * `canManageUpdate: false` and an EMPTY `updateCommand`, because this install is
 * the app's own managed environment and no package manager owns it - and the
 * `detail` line naming the install the check judged.
 */
const OPERATOR_OFFER = {
	currentVersion: "0.56.8",
	latestVersion: "0.56.11",
	runningVersion: "0.56.8",
	updateCommand: "",
	canManageUpdate: false,
	startupMode: "EXISTING_SERVER",
	remedy:
		"This server is running from Local Operator's own managed environment, which no package manager owns - so there is no terminal command that can update it correctly. Local Operator updates that environment itself when it starts the server.",
	detail:
		'The server serving this app runs from Local Operator\'s own managed environment at ~/Library/Application Support/Local Operator/managed-python/packaged/environments/183bbfdc...-7ad511f5..., which the app owns rather than a package manager (the backend reports it as install kind "pip"), at version 0.56.8.',
	sourceBuild: false,
	restartable: false,
	manual: true,
};

/**
 * BEFORE - the defect. One press, the app channel's own "nothing newer" event,
 * and the affirmation about the WHOLE installation, on a pane whose own row says
 * the server is 0.56.8 while 0.56.11 is published.
 */
export const BeforeTheFix: Story = {
	parameters: {
		verdict: OPERATOR_VERDICT_BEFORE,
		numbers: OPERATOR_MACHINE,
		skew: {
			version: "0.56.11",
			runningVersion: "0.56.8",
			restartable: false,
		},
	},
	render: () => (
		<ReportFrame expect={OPERATOR_VERDICT_BEFORE.affirmation as string} />
	),
};

/**
 * AFTER - the same press on this branch: the offer names the SERVING install
 * (0.56.8) against the published release, no affirmation is earned, and no
 * package-manager command is offered for an install that has none.
 */
export const ServerBehindServingInstall: Story = {
	parameters: {
		verdict: {
			app: "current",
			server: "available",
			affirmation: null,
		} satisfies UpdateCheckVerdict,
		numbers: OPERATOR_MACHINE,
		offer: OPERATOR_OFFER,
	},
	render: () => (
		<ReportFrame
			expect={`Server version ${OPERATOR_MACHINE.published} is available`}
		/>
	),
};

/**
 * THE STATE THE NEW STATUS EXISTS FOR, and the one this pair is about: the
 * install on disk is at the published release and the process serving this app
 * is not.
 *
 * It is the state the machine walks into one step after the offer above is
 * acted on - the environment is moved, the daemon keeps serving the old build
 * until it restarts - and it is the state the reported defect turned into a
 * contradiction: the check called it `current`, so the whole check earned "The
 * application and server are up to date" and rendered it beside this very
 * notice, which says the opposite.
 *
 * The verdict is `restart-required` now: the same notice (the only surface that
 * can carry a skew when there is nothing to offer), and no affirmation at all.
 * Read against `BeforeTheFix`, which is that notice with the green sentence
 * above it, the two frames are the rule's whole point.
 */
export const ServingServerBehindInstall: Story = {
	parameters: {
		verdict: {
			app: "current",
			server: "restart-required",
			affirmation: null,
		} satisfies UpdateCheckVerdict,
		numbers: OPERATOR_MACHINE,
		skew: {
			version: OPERATOR_MACHINE.published,
			runningVersion: OPERATOR_MACHINE.server,
			restartable: false,
		},
	},
	render: () => (
		<ReportFrame expect="The server is on an older build than the install" />
	),
};
