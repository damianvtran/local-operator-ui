/**
 * The move dialog's working-set review, one story per state the operator has to
 * be able to see (design move-working-set §11.4): no capability (the dialog as it
 * shipped), loading, empty (no working files: today's dialog), error, populated,
 * and the `working_set_changed` refusal re-rendered with its fresh manifest.
 *
 * WHY A BRIDGE AND NOT PROPS. The dialog reads the capability and the preflight
 * itself, through the app's own preload seam (`window.api.desktop.request`), so
 * each story installs that seam with the answer its state needs - the same seam
 * `mesh-page.stories.tsx` uses - and the frame is the real component on the real
 * query path rather than a prop-fed lookalike.
 *
 * The manifests are §3.4-shaped, synthetic and home-relative (no real machine's
 * paths), and each state that arrives after paint holds the capture shutter
 * until it is on screen (AGENTS.md "What a capture may claim").
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { DesktopResponse } from "../../../../shared/desktop-contract";
import { movePair } from "../chat/device/chat-device-model";
import { MoveConfirmDialog } from "./mesh-actions";
import { workingSet } from "./mesh-types";

const SESSION = "0123456789ab";
const PEER = `d_${"b".repeat(32)}`;
const DIGEST = `sha256:${"a".repeat(64)}`;
const FRESH_DIGEST = `sha256:${"c".repeat(64)}`;

const pair = movePair({
	sessionId: SESSION,
	recall: false,
	destination: { deviceId: PEER, name: "build-box" },
	source: null,
});

/**
 * A populated block in the core's shape (local-operator `network/workset.py`
 * `to_dict`): two planned trees, one withheld for history-secret material.
 * `carriesFiles` is the core's `carries_files` - false on the first core
 * release (files stay on the source), true once the transfer half lands.
 */
function populatedBlock(digest = DIGEST, carriesFiles = true) {
	const worktrees: Record<string, unknown>[] = [];
	return {
		version: 1,
		scope_digest: digest,
		state: "preflight",
		carries_files: carriesFiles,
		destination: { device_id: PEER, name: "build-box" },
		totals: {
			worktrees: 3,
			unpushed_commits: 4,
			dirty_files: 9,
			bytes: 18_400_000,
		},
		worktrees: worktrees.concat([
			{
				path: "~/local-operator/.worktrees/move-working-set",
				repo: "~/local-operator",
				branch: "feat/move-working-set",
				head: "670cf7187",
				unpushed_commits: 3,
				staged: 2,
				unstaged: 4,
				untracked: 1,
				bundle_bytes: 1_200_000,
				snapshot_bytes: 340_000,
				remote_url: "https://github.com/damianvtran/local-operator.git",
				clone_check: "pending_destination",
				state: "planned",
			},
			{
				path: "~/local-operator-ui/.worktrees/move-confirm-dialog",
				repo: "~/local-operator-ui",
				remote_url: "https://github.com/damianvtran/local-operator-ui.git",
				branch: "feat/move-confirm-working-set",
				head: "1fb3d656c",
				unpushed_commits: 1,
				staged: 0,
				unstaged: 2,
				untracked: 0,
				bundle_bytes: 90_000,
				snapshot_bytes: 12_000,
				clone: {
					url: "https://github.com/damianvtran/local-operator-ui.git",
					bytes: 16_800_000,
				},
				state: "planned",
			},
			{
				path: "~/local-operator/.worktrees/creds-spike",
				repo: "~/local-operator",
				branch: "spike/creds",
				head: "9f1c2ab70",
				unpushed_commits: 2,
				state: "left_behind",
				reason: "history_secret",
			},
		]),
		excluded: [
			{
				path: "~/local-operator/.worktrees/move-working-set/.env.local",
				why: "secret_path",
			},
		],
		left_behind: [
			{
				path: "~/local-operator-ui/.worktrees/move-confirm-dialog/node_modules",
				kind: "dependency_tree",
				recipe: {
					kind: "pnpm",
					run: "pnpm install --frozen-lockfile",
					cwd: "~/local-operator-ui/.worktrees/move-confirm-dialog",
				},
			},
			{
				path: "~/local-operator/.worktrees/move-working-set/.venv",
				kind: "dependency_tree",
				recipe: {
					kind: "uv",
					run: "uv sync",
					cwd: "~/local-operator/.worktrees/move-working-set",
				},
			},
		],
	};
}

type Preflight =
	| { kind: "answer"; result: unknown }
	| { kind: "hold" }
	| { kind: "fail" };

/**
 * The block as a probe-capable core answers it (`apply_probe`, core
 * `network/workset_probe.py`): the destination checked each remote with its own
 * credentials. One row cannot fetch over SSH (HTTPS works, push does not, so a
 * remedy is offered), one cannot push, and the destination lacks `pnpm`/`node`;
 * the conversation uses Team Bridge and the destination is not enrolled.
 */
function probedBlock(carriesFiles = true) {
	const base = populatedBlock(DIGEST, carriesFiles);
	const [first, second, ...rest] = base.worktrees;
	return {
		...base,
		source: { device_id: `d_${"a".repeat(32)}`, name: "damian-mac" },
		worktrees: [
			{
				...first,
				remote_url: "git@github.com:damianvtran/local-operator.git",
				clone_check: "destination_cannot_fetch",
				// A FIXED probe code (core #4241 remediation), never git's raw stderr.
				clone_detail: "timeout",
				https_rewrite: {
					url: "https://github.com/damianvtran/local-operator.git",
					fetch: true,
					push: false,
				},
				remedy: {
					run_on: "lending_device",
					command: "lop network credential share github --with build-box",
				},
				missing_tools: [],
			},
			{
				...second,
				clone_check: "destination_cannot_push",
				clone_detail: "auth_denied",
				remedy: {
					run_on: "lending_device",
					command:
						"lop network credential github include damianvtran/local-operator-ui",
				},
				missing_tools: ["node", "pnpm"],
			},
			...rest,
		],
		destination_probe: {
			state: "answered",
			missing_tools: ["node", "pnpm"],
			team_bridge: { needed: true, enrolled: false },
		},
	};
}

function installBridge(options: {
	capability: boolean;
	preflight: Preflight;
	/** Also advertise `session_transfer_working_set_probe`. */
	probe?: boolean;
}) {
	const bridge = async (request: {
		op: string;
	}): Promise<DesktopResponse> => {
		if (request.op === "capabilities") {
			return {
				status: 200,
				body: {
					result: {
						desktop_contract: 1,
						desktop_available: true,
						desktop_auth: "bearer",
						features: {
							peers: 1,
							session_transfer: 1,
							...(options.capability
								? { session_transfer_working_set: 1 }
								: {}),
							...(options.probe
								? { session_transfer_working_set_probe: 1 }
								: {}),
						},
					},
				},
			};
		}
		if (request.op === "sessions.transfer.preflight") {
			if (options.preflight.kind === "hold") return await new Promise(() => {});
			if (options.preflight.kind === "fail") {
				return {
					status: 503,
					body: {
						detail: {
							code: "peer_unreachable",
							message: "build-box did not answer.",
						},
					},
				};
			}
			return { status: 200, body: { result: options.preflight.result } };
		}
		throw new Error(`unexpected desktop op in this story: ${request.op}`);
	};
	const page = window as unknown as {
		api?: { desktop?: { request: typeof bridge } };
	};
	page.api = { ...(page.api ?? {}), desktop: { request: bridge } };
}

/** Hold the capture rig until `selector` is on screen (see this file's header). */
function holdShutter(selector: string) {
	document.documentElement.dataset.capturePending = "1";
	const started = Date.now();
	const timer = window.setInterval(() => {
		if (document.querySelector(selector)) {
			window.clearInterval(timer);
			document.documentElement.removeAttribute("data-capture-pending");
		} else if (Date.now() - started > 20_000) {
			window.clearInterval(timer);
			document.documentElement.removeAttribute("data-capture-pending");
			document.documentElement.dataset.captureFailed = `working-set-shutter-not-reached: ${selector}`;
		}
	}, 50);
}

/*
 * `destinationName` as the real call sites pass it (design round 1, D5): a story
 * without it rendered the consent naming the device's opaque id.
 */
const Dialog = (props: {
	seed?: Parameters<typeof MoveConfirmDialog>[0]["workingSetSeed"];
}) => (
	<MoveConfirmDialog
		open
		plan={pair.plan}
		alternatives={pair.alternatives}
		risky={false}
		busy={false}
		onCancel={() => {}}
		onChoose={() => {}}
		workingSetSeed={props.seed ?? null}
		destinationName="build-box"
	/>
);

const meta: Meta = {
	title: "Mesh/Move working set",
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-screen bg-canvas">
				<Story />
			</div>
		),
	],
};

export default meta;

type Story = StoryObj;

/** A backend without `session_transfer_working_set`: the dialog as it shipped. */
export const WithoutCapability: Story = {
	render: () => {
		installBridge({
			capability: false,
			preflight: { kind: "answer", result: { working_set: populatedBlock() } },
		});
		holdShutter('[role="dialog"]');
		return <Dialog />;
	},
};

/** The preflight is still answering: Confirm waits for it. */
export const Loading: Story = {
	render: () => {
		installBridge({ capability: true, preflight: { kind: "hold" } });
		holdShutter('[role="dialog"] [aria-live="polite"]');
		return <Dialog />;
	},
};

/** A chat-only session: nothing to carry, so today's dialog exactly. */
export const Empty: Story = {
	render: () => {
		installBridge({
			capability: true,
			preflight: {
				kind: "answer",
				result: {
					working_set: {
						...populatedBlock(),
						worktrees: [],
						excluded: [],
						left_behind: [],
						totals: {
							worktrees: 0,
							unpushed_commits: 0,
							dirty_files: 0,
							bytes: 0,
						},
					},
				},
			},
		});
		holdShutter('[role="dialog"]');
		return <Dialog />;
	},
};

/** The preflight failed: said so, with a retry; the route still guards the move. */
export const ReadFailed: Story = {
	render: () => {
		installBridge({ capability: true, preflight: { kind: "fail" } });
		holdShutter('[role="dialog"] [role="alert"]');
		return <Dialog />;
	},
};

/** Working files present: the warning, the lists, and the required checkbox. */
export const Populated: Story = {
	render: () => {
		installBridge({
			capability: true,
			preflight: { kind: "answer", result: { working_set: populatedBlock() } },
		});
		holdShutter('[data-testid="working-set"]');
		return <Dialog />;
	},
};

/**
 * The route refused `working_set_changed`: the fresh manifest it carried is shown
 * with the reason, and the checkbox is un-ticked for the new list.
 */
export const ChangedRefusal: Story = {
	render: () => {
		installBridge({
			capability: true,
			preflight: { kind: "hold" },
		});
		const fresh = populatedBlock(FRESH_DIGEST);
		fresh.worktrees[0] = { ...fresh.worktrees[0], untracked: 3 };
		const parsed = workingSet(fresh);
		holdShutter('[data-testid="working-set"]');
		return (
			<Dialog
				seed={
					parsed
						? {
								workingSet: parsed,
								changed: true,
								unconfirmed: false,
								withoutOnly: false,
							}
						: null
				}
			/>
		);
	},
};

/**
 * What the FIRST core release answers (`carries_files: false`): the move is gated
 * on consent but the files stay on the source, so the review says the
 * conversation on the destination will NOT have them.
 */
export const PopulatedFilesStay: Story = {
	render: () => {
		installBridge({
			capability: true,
			preflight: {
				kind: "answer",
				result: {
					session_id: SESSION,
					confirmation_required: true,
					working_set: populatedBlock(DIGEST, false),
				},
			},
		});
		holdShutter('[data-testid="working-set"]');
		return <Dialog />;
	},
};

/**
 * The destination probe answered with problems (`session_transfer_working_set_probe`):
 * per-row reachability with the probe's fixed reason code said as a sentence
 * (core DETAIL_CODES `timeout` / `auth_denied`), the HTTPS alternative, the copyable remedy
 * command, and the missing-tools and Team Bridge notes. None of them
 * gates the checkbox: the core never blocks on reachability or prerequisites.
 */
export const ProbeFailures: Story = {
	render: () => {
		installBridge({
			capability: true,
			probe: true,
			preflight: { kind: "answer", result: { working_set: probedBlock() } },
		});
		holdShutter('[data-testid="working-set"] [data-probe-remedy]');
		return <Dialog />;
	},
};

/**
 * The same probed block on the first core release (`carries_files: false`): the
 * kept heading names the device the files stay on (`source`), and the probe
 * still says whether the destination could fetch the work once it is pushed.
 */
export const ProbeFilesStay: Story = {
	render: () => {
		installBridge({
			capability: true,
			probe: true,
			preflight: {
				kind: "answer",
				result: { working_set: probedBlock(false) },
			},
		});
		holdShutter('[data-testid="working-set"] [data-probe-remedy]');
		return <Dialog />;
	},
};

/**
 * The route refused `working_set_unknown` (the owner could not compute the
 * manifest): no list, and the only consent offered is "move without them".
 */
export const UnknownRefusal: Story = {
	render: () => {
		installBridge({ capability: true, preflight: { kind: "hold" } });
		holdShutter('[data-testid="working-set"]');
		return (
			<Dialog
				seed={{
					workingSet: null,
					changed: false,
					unconfirmed: false,
					withoutOnly: true,
				}}
			/>
		);
	},
};

/**
 * The route refused `working_set_unconfirmed` (the move reached it without a
 * reviewed list): the dialog says why it came back (UX round 1, U2).
 */
export const UnconfirmedRefusal: Story = {
	render: () => {
		installBridge({ capability: true, preflight: { kind: "hold" } });
		const parsed = workingSet(populatedBlock());
		holdShutter('[data-testid="working-set"] [data-notice="unconfirmed"]');
		return (
			<Dialog
				seed={
					parsed
						? {
								workingSet: parsed,
								changed: false,
								unconfirmed: true,
								withoutOnly: false,
							}
						: null
				}
			/>
		);
	},
};

/**
 * MANY WORKTREES, LONG PATHS (design round 1, D9): eight trees, several of them
 * deep, plus the withheld and left-behind sections. Proves the dialog caps at
 * 85vh with ONE scroll region, that the withheld rows are reachable by scrolling
 * it, and that long paths wrap at separators rather than mid-word. Capture at a
 * 600 px-tall viewport (the app's `WINDOW_MIN_HEIGHT`).
 */
export const ManyWorktrees: Story = {
	render: () => {
		const base = populatedBlock();
		const many = Array.from({ length: 8 }, (_, index) => ({
			path: `~/code/clients/acme-platform/services/billing-reconciliation-worker/.worktrees/feat/very-long-branch-name-number-${index + 1}`,
			repo: "~/code/clients/acme-platform",
			remote_url:
				"git@github.com:acme-platform/billing-reconciliation-worker.git",
			branch: `feat/very-long-branch-name-number-${index + 1}`,
			head: "4b2e9d1c0",
			unpushed_commits: index % 3,
			staged: index % 2,
			unstaged: index,
			untracked: 0,
			bundle_bytes: 40_000 * (index + 1),
			snapshot_bytes: 9_000,
			clone_check: "pending_destination",
			state: "planned",
		}));
		installBridge({
			capability: true,
			preflight: {
				kind: "answer",
				result: {
					working_set: {
						...base,
						totals: { ...base.totals, worktrees: 9 },
						worktrees: [
							...many,
							...base.worktrees.filter((tree) => tree.state === "left_behind"),
						],
					},
				},
			},
		});
		holdShutter('[data-testid="working-set"]');
		return <Dialog />;
	},
};
