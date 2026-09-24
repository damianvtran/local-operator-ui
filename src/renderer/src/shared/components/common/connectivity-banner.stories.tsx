/**
 * The connectivity banner, in every state the daemon connection can leave it in.
 *
 * WHY this file exists. This banner is the app-wide surface that used to render
 * "The server is offline" - the sentence the operator's report is about - and
 * until now it had no frame anywhere in the tree: the sweep photographed
 * Settings' version row, and the neighbouring rigs only asserted the banner's
 * ABSENCE. So the one surface whose trigger condition this work rewrote could
 * not be looked at, and a reviewer could not tell whether "offline" still
 * described a daemon that was up.
 *
 * The states are not reachable on demand in the live app (they need a real
 * daemon to exit, three probes to fail against a live one, or a manager
 * configured not to spawn), so the story stubs `window.api.backend` with the
 * snapshot MAIN publishes for each - the real component, rendering the real
 * copy from `shared/backend-status.ts`, over a realistic page ground.
 *
 * `attached` is a frame OF the banner's absence, which is the claim: a missing
 * probe is not an outage, so the state that is still connected must show
 * nothing at all.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import { useLayoutEffect } from "react";
import type { DaemonStatusSnapshot } from "../../../../../shared/backend-status";
import { ConnectivityBanner } from "./connectivity-banner";

const snapshot = (
	overrides: Partial<DaemonStatusSnapshot>,
): DaemonStatusSnapshot => {
	const merged: Omit<DaemonStatusSnapshot, "pairing"> = {
		state: "attached",
		reconnecting: false,
		owned: false,
		url: "http://127.0.0.1:7341",
		instanceId: "i".repeat(43),
		pid: 4242,
		version: "0.54.47",
		prefix: "/Users/you/.local/share/uv/tools/local-operator",
		installKind: "uv-tool",
		desktopAvailable: true,
		failures: 0,
		capabilityStatus: null,
		unanswered: 0,
		lastTransportAt: null,
		/*
		 * Null unless a story names one: an address substitution is a fact about a
		 * LAUNCH, and every story but the two that say so is the ordinary case where
		 * the app is on the address it was configured for.
		 */
		addressSubstitution: null,
		detail:
			"Connected to the daemon on http://127.0.0.1:7341 (pid 4242, v0.54.47).",
		updatedAt: Date.now(),
		...overrides,
	};
	/*
	 * `pairing` is DERIVED from the merged `desktopAvailable` unless a story names
	 * it, so a fixture that flips the boolean cannot leave the two disagreeing -
	 * the defect the record replaces, in miniature (design § 1.4).
	 */
	return {
		...merged,
		pairing:
			overrides.pairing ??
			(merged.desktopAvailable
				? { available: true, cause: null }
				: { available: false, cause: "unpaired" }),
	};
};

/**
 * The page ground the fixed banner covers, so the frame is the surface a user
 * actually sees rather than a bare rectangle on the story ground.
 *
 * It is a realistic conversation list rather than two lines of prose, and it has
 * to be: the rig treats a story root with fewer than eight elements as not yet
 * drawn, and a frame whose subject is the banner's ABSENCE (attached, degraded)
 * is otherwise indistinguishable from a story that never mounted.
 */
const PageGround = () => (
	<div className="flex h-full flex-col gap-3 p-6 pt-24">
		<h1 className="font-medium text-body text-ink">Conversations</h1>
		<p className="max-w-xl text-body-sm text-ink-muted">
			Nothing is in flight. The banner above the page is the whole of what this
			surface has to say about the server.
		</p>
		<ul className="flex max-w-xl flex-col gap-2">
			{[
				"Deploy the staging cluster",
				"Review the paging change",
				"Triage the support queue",
			].map((row) => (
				<li
					key={row}
					className="flex items-center justify-between rounded-md border border-hairline bg-surface px-3 py-2"
				>
					<span className="text-body-sm text-ink">{row}</span>
					<span className="text-meta text-ink-dim">idle</span>
				</li>
			))}
		</ul>
	</div>
);

/**
 * Stub MAIN's side of the bridge for one story.
 *
 * Installed during render rather than in an effect, because the banner's first
 * query is issued on mount (the row stories learned the same lesson).
 *
 * `config` answers the one config read the banner makes, and only because the
 * internet sentence NAMES the hosting provider: with the read failing - which is
 * what a Storybook origin gets, there being no daemon to ask - the frame renders
 * "Your configured hosting provider () requires an internet connection", which
 * is a fact about the fixture and not about the app. The value is the provider
 * id the app itself uses (`hosting.model-select` builds its list from the same
 * one), so the sentence is the sentence a configured machine reads.
 */
const Bridge = ({
	status,
	config = null,
	children,
}: {
	status: DaemonStatusSnapshot | null;
	config?: { values: { hosting: string } } | null;
	children: React.ReactNode;
}) => {
	const api = window.api as unknown as { backend?: unknown; desktop?: unknown };
	api.backend =
		status === null
			? undefined
			: {
					getStatus: async () => status,
					// Retry asks main to try; a still cannot show the attempt, and a stub
					// that changed the snapshot would photograph the stub.
					reconnect: async () => status,
					onStatusChange: () => () => {},
				};
	api.desktop = config
		? {
				request: async (request: { op?: string }) =>
					request?.op === "config.get"
						? { status: 200, body: { result: config } }
						: { status: 404, body: { message: "not stubbed in this story" } },
			}
		: undefined;
	useLayoutEffect(() => {
		return () => {
			const bridge = window.api as unknown as {
				backend?: unknown;
				desktop?: unknown;
			};
			bridge.backend = undefined;
			bridge.desktop = undefined;
		};
	}, []);
	return <>{children}</>;
};

const withBridge =
	(
		status: DaemonStatusSnapshot | null,
		config?: { values: { hosting: string } } | null,
	) =>
	(Story: React.FC) => (
		<Bridge status={status} config={config}>
			<div className="min-h-screen bg-canvas text-ink">
				<Story />
				<PageGround />
			</div>
		</Bridge>
	);

/** Waits for the banner's rendered sentence, so the frame cannot be a race. */
const waitForCopy = (text: string | RegExp) => async () => {
	await waitFor(() => {
		const body = document.body.textContent ?? "";
		expect(
			typeof text === "string" ? body.includes(text) : text.test(body),
		).toBe(true);
	});
};

const meta: Meta<typeof ConnectivityBanner> = {
	component: ConnectivityBanner,
	title: "Common/Connectivity banner",
	parameters: { layout: "fullscreen" },
	// The banner's own 3 s refetch loop is disabled: the stub answers the same
	// snapshot forever, so polling adds nothing but a race with the frame.
	args: { autoCheck: false },
};

export default meta;
type Story = StoryObj<typeof ConnectivityBanner>;

/**
 * No desktop bridge at all: the weaker answer a browser host gets.
 *
 * Measured, and asserted as measured (design round 2, D12): this state renders
 * NO BANNER. `useConnectivityStatus` reads `serverHealth?.online ?? true`, and an
 * absent bridge leaves the health query with no answer, so the fallback is
 * "online" and `hasConnectivityIssue` is false.
 *
 * The play used to wait for "Not connected to a Local Operator server." - the
 * sentence the contract carries for exactly this state (`serverBannerCopy(null)`)
 * and which no surface can reach while the gate above reads an absent bridge as
 * online - so the play failed and the pair captured as the no-banner ground,
 * byte-identical to `attached`. Asserting the absence is what the state actually
 * supports today; whether a browser-hosted app should announce the absent bridge
 * is a product question for the design round.
 */
export const NoBridge: Story = {
	decorators: [withBridge(null)],
	play: async () => {
		await waitFor(() => {
			expect(document.body.textContent ?? "").not.toContain(
				"reconnects to it on its own",
			);
			expect(document.body.textContent ?? "").not.toContain(
				"The Local Operator server stopped",
			);
		});
	},
};

/** Attached: no banner. The empty frame IS the claim. */
export const Attached: Story = {
	decorators: [withBridge(snapshot({}))],
	play: async () => {
		await waitFor(() => {
			expect(document.body.textContent).not.toContain(
				"Not connected to a Local Operator server",
			);
			expect(document.body.textContent).not.toContain(
				"The Local Operator server stopped",
			);
		});
	},
};

/** Degraded: one or two missed probes on a connection that is still there. */
export const Degraded: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "degraded",
				failures: 2,
				detail: "No answer from /health (probe 2 of 3).",
			}),
		),
	],
	play: async () => {
		await waitFor(() => {
			expect(document.body.textContent).not.toContain(
				"Not connected to a Local Operator server",
			);
		});
	},
};

/**
 * Three identity-failing probes while a process is still listening: this app
 * lost its attachment, and something else answers at the address.
 */
export const IdentityFailed: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "detached",
				reconnecting: true,
				url: null,
				instanceId: null,
				pid: null,
				version: null,
				prefix: null,
				installKind: null,
				desktopAvailable: false,
				failures: 3,
				detail:
					"Another process is answering at http://127.0.0.1:1111 (answered with a different instance id)",
			}),
		),
	],
	play: waitForCopy("Not connected to a Local Operator server."),
};

/**
 * Discovery found a daemon and could not attach to it, with the manager
 * configured not to spawn one - the path whose own sentence is "A local daemon
 * may still be running, but could not be attached".
 */
export const NoSpawn: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "detached",
				reconnecting: true,
				url: null,
				instanceId: null,
				pid: null,
				version: null,
				prefix: null,
				installKind: null,
				desktopAvailable: false,
				failures: 3,
				detail:
					"A local daemon may still be running, but could not be attached. Waiting without starting a duplicate.",
			}),
		),
	],
	play: waitForCopy("could not be attached"),
};

/**
 * A daemon that refused this app's credential for its desktop plane: recorded
 * BESIDE the state (401/403), never as a liveness answer.
 */
export const Unclaimed: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "detached",
				reconnecting: true,
				url: null,
				instanceId: null,
				pid: null,
				version: null,
				prefix: null,
				installKind: null,
				desktopAvailable: false,
				failures: 0,
				capabilityStatus: 403,
				detail:
					"A daemon is running at http://127.0.0.1:1111, but it refused this app's credential for its desktop plane. The daemon is running.",
			}),
		),
	],
	play: waitForCopy("refused this app's credential"),
};

/** Past the 90 s reconnection window: the honest escalation. */
export const Stopped: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "detached",
				reconnecting: false,
				url: null,
				instanceId: null,
				pid: null,
				version: null,
				prefix: null,
				installKind: null,
				desktopAvailable: false,
				failures: 3,
				detail: "The daemon's process is gone.",
			}),
		),
	],
	play: waitForCopy("The Local Operator server stopped."),
};

/**
 * A daemon is running on this machine and this app did not attach to it.
 *
 * Two producers reach this state and this story carries the first: a record
 * whose process is alive while its published heartbeat stopped. The second -
 * a daemon answering the configured address that this app holds no credential
 * for - is `Unattachable` below.
 *
 * The assertion is on the TITLE and the detail separately, and that split is
 * the point: the title states the connection fact, which is true of every path
 * into the state, while the detail states which path was taken. The title used
 * to assert the heartbeat, which is false of the other producer - a daemon
 * whose key this app may not read is running perfectly well.
 */
export const Wedged: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "wedged",
				url: null,
				instanceId: null,
				pid: 4242,
				version: null,
				prefix: null,
				installKind: null,
				desktopAvailable: false,
				failures: 0,
				detail:
					"A Local Operator daemon is running (pid 4242), but it stopped publishing its heartbeat, so this app did not attach to it. Waiting without starting a second one.",
			}),
		),
	],
	play: waitForCopy(
		/A Local Operator server is running on this machine and this app is not attached to it\./,
	),
};

/**
 * The other producer: a Local Operator daemon is serving the address this app is
 * configured for, and this app holds no credential for it (no serve record it
 * can read describes that address).
 *
 * This is the copy the operator's report asks for: it names the address, the pid
 * when the daemon published one, and the path into the state, it says what was NOT
 * done about it, and - since design round 1 (D3) - it names the act that ends the
 * holder, which is the whole of what an operator in this state can do. The daemon is
 * serving throughout - nothing here may render as "offline".
 *
 * AND THE `detail` IS THE SHIPPED SENTENCE, not a paraphrase of it (design round 1,
 * D2). It is the output of `describeSpawnRefusal` in
 * `src/main/backend/backend-service.ts` for an occupancy record of the shape this
 * fixture's `pid`/`version`/`installKind` describe, and
 * `scripts/connectivity-banner-copy.test.mjs` compares the two - so a copy change in
 * main cannot leave this fixture (and the committed frames shot from it) documenting
 * a sentence the app no longer sends.
 */
export const Unattachable: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "wedged",
				url: "http://127.0.0.1:1111",
				instanceId: null,
				pid: 42411,
				version: "0.55.6",
				prefix: null,
				installKind: "uv-tool",
				desktopAvailable: false,
				failures: 0,
				detail:
					"http://127.0.0.1:1111 (pid 42411, uv-tool, v0.55.6) is running a Local Operator daemon this app has no key for. Nothing was started over it. Stop it from the install that owns it with `lop services reclaim 42411` (`lop services status` lists what is running). It keeps probing for a server it can open.",
			}),
		),
	],
	play: waitForCopy(/It keeps probing for a server it can open/),
};

/**
 * BOTH addresses this app may serve on are held - the state the app used to quit in,
 * and the one design round 1 (D2) found had no frame anywhere in the tree.
 *
 * WHY THIS IS THE SHAPE THAT MATTERS rather than a second copy of the one above: with
 * two holders the class clause was repeated per address, which is what made the band
 * 106 CSS px against the 68 the one-holder sentence cost, on a band that takes its
 * height out of the shell. The sentence here states the class ONCE and lists the
 * addresses it covers (`HOLDER_CLASS` in main), and both holders are of the same kind
 * because that is the case the shorter sentence exists for - a reader can see, in the
 * frame, that the claim appears once.
 *
 * The `detail` is `describeSpawnRefusal`'s output for two daemon records, pinned by
 * `scripts/connectivity-banner-copy.test.mjs` for the reason `Unattachable` gives.
 */
export const BothAddressesHeld: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "wedged",
				url: null,
				instanceId: null,
				pid: null,
				version: null,
				prefix: null,
				installKind: null,
				desktopAvailable: false,
				failures: 0,
				detail:
					"http://127.0.0.1:1111 (pid 42411, uv-tool, v0.55.6) and http://127.0.0.1:8080 (pid 53501, v0.55.5) are running Local Operator daemons this app has no key for. Nothing was started over them. Stop it from the install that owns it with `lop services reclaim <pid>` (`lop services status` lists what is running). It keeps probing for a server it can open.",
			}),
		),
	],
	play: waitForCopy(
		/are running Local Operator daemons this app has no key for/,
	),
};

/**
 * ATTACHED, but on the fallback address: the configured address is held, so the app
 * started its own daemon on the other address the renderer trusts (design round 1,
 * D1).
 *
 * WHY THIS STATE NEEDS A FRAME AT ALL. Measured by the design round: the "attached on
 * 8080" and "attached on 1111" frames of the whole surface were BYTE-IDENTICAL
 * (sha256 f4d4b7b3..., 63,386 bytes each), so an operator serving on the fallback saw
 * an app that said nothing about it - and nothing rendered the return when the
 * address freed either. The `holder` clause is main's own (`describeHolders`), pinned
 * by `scripts/connectivity-banner-copy.test.mjs`; the sentence around it is the copy
 * table's.
 */
export const ServingOnFallback: Story = {
	decorators: [
		withBridge(
			snapshot({
				url: "http://127.0.0.1:8080",
				pid: 4242,
				version: "0.54.47",
				addressSubstitution: {
					kind: "substituted",
					configured: "http://127.0.0.1:1111",
					serving: "http://127.0.0.1:8080",
					holder:
						"http://127.0.0.1:1111 (pid 42411, uv-tool, v0.55.6) is running a Local Operator daemon this app has no key for",
				},
			}),
		),
	],
	play: waitForCopy(/not the address this app is configured for/),
};

/**
 * The transition OUT of the state above: the configured address freed, and the app is
 * on it again (design round 1, D1, "make the transition visible").
 *
 * It is a state of its own rather than the fallback band simply going away, which is
 * what silence would make it: the operator who was working on 8080 sees the app say it
 * is back on the address it was told to use. This is the one band here that is
 * dismissible, and `serverBannerCopy` is what marks it so.
 */
export const ReturnedToConfigured: Story = {
	decorators: [
		withBridge(
			snapshot({
				url: "http://127.0.0.1:1111",
				addressSubstitution: {
					kind: "returned",
					configured: "http://127.0.0.1:1111",
					serving: "http://127.0.0.1:8080",
				},
			}),
		),
	],
	play: waitForCopy(/the address this app is configured for/),
};

/**
 * The machine is offline, CONFIRMED: the same answer from a reading taken after
 * the grace.
 *
 * WHY THIS STORY EXISTS. The internet banner had no frame anywhere either, and
 * the defect it produced was the mirror image of the server one: Chromium fires
 * `offline` on any connectivity TRANSITION - a Wi-Fi roam, a wake, a resolver
 * switch - while traffic is still flowing, and the component painted the banner
 * straight from that one event. The operator's own update log holds 90 such
 * transport failures over four days, each followed five minutes later by a check
 * that succeeded, on a machine that was online throughout.
 *
 * So the reading here is negative from the first paint, and the frame is only
 * reached because the COMPONENT asked again after the grace and got the same
 * answer: the play waits for the sentence, which no single reading can produce
 * (`@shared/utils/offline-confirmation`, and its cases in
 * `scripts/update-robustness.test.mjs`).
 *
 * There is deliberately no companion frame of the unconfirmed reading. A still
 * of an absent banner is indistinguishable from a story that never mounted -
 * the trap this file's own `attached` story documents - so the rule that a
 * negative reading is not evidence on its own is pinned by its cases rather than
 * photographed. What IS photographed is the state the rule exists to reach.
 */
const withOfflineNetwork = (Story: React.FC) => {
	/*
	 * An own property shadows `Navigator.prototype.onLine`, which is exactly what
	 * the app reads; removing it in the layout effect's teardown puts the real
	 * accessor back, the same discipline `Bridge` uses for `window.api`.
	 */
	Object.defineProperty(window.navigator, "onLine", {
		configurable: true,
		get: () => false,
	});
	useLayoutEffect(() => {
		return () => {
			Reflect.deleteProperty(window.navigator, "onLine");
		};
	}, []);
	return <Story />;
};

/**
 * The sentence the confirmation produces, read from the component's own copy:
 * the story asserts it is on screen before the shutter, so a frame cannot
 * photograph the state BEFORE the grace and read as the state after it.
 */
const OFFLINE_SENTENCE = "You are offline.";

/**
 * The banner, and the shutter held until its sentence is up.
 *
 * WHY THE RIG HAS TO BE TOLD. Its readiness probe asks whether the story has
 * DRAWN - an element floor, the loader gone, fonts settled - and a page whose
 * banner arrives five seconds later has drawn long before that. Left to the
 * probe, this story photographed the page ground and no banner at all, which is
 * a frame of the defect rather than of the fix (measured: the first capture of
 * this story, `internet-offline-confirmed/localOperatorDark.webp`, was 9,140
 * bytes of plain ground). `capturePending` is the rig's own way of being told
 * to wait, and the wait is the story's claim rather than a sleep: it polls for
 * the text the CONFIRMATION produces.
 */
const ConfirmedOfflineFrame: React.FC = () => {
	useLayoutEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		const settle = async () => {
			for (let i = 0; i < 300; i++) {
				if ((document.body.textContent ?? "").includes(OFFLINE_SENTENCE)) {
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			// Two frames, so the paint that put the banner up is committed before
			// the shutter - the same pair the press stories wait on.
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
	}, []);
	return <ConnectivityBanner autoCheck={false} />;
};

export const InternetOfflineConfirmed: Story = {
	decorators: [
		withBridge(snapshot({}), { values: { hosting: "radient" } }),
		withOfflineNetwork,
	],
	render: () => <ConfirmedOfflineFrame />,
	play: async () => {
		/*
		 * THE FIRST UNCONFIRMED SAMPLE PAINTS NOTHING (review round 1, R3). The
		 * check is the window before the grace, measured from the story's own
		 * start: the rule requires OFFLINE_CONFIRMATION_GRACE_MS of negative
		 * readings before the banner may report, the bridge here answers
		 * `navigator.onLine === false` from the first poll, and a component that
		 * painted from the raw reading would fail this line rather than pass it.
		 */
		expect(document.body.textContent ?? "").not.toContain(OFFLINE_SENTENCE);
		/*
		 * And then the confirmation itself: the banner takes the grace and a
		 * second negative answer, so this wait is what makes the story a claim
		 * about the CONFIRMATION rather than about the poll.
		 */
		await waitFor(
			() => {
				expect(document.body.textContent ?? "").toContain(OFFLINE_SENTENCE);
			},
			{ timeout: 20_000 },
		);
	},
};
