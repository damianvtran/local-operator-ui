/**
 * Settings -> Speech voicing, in the states the voicing cascade can be in.
 *
 * WHAT THESE FRAMES ARE FOR. The group makes three claims a reader cannot check
 * anywhere else in the app: WHICH rung of the text-to-speech cascade would serve
 * this machine, WHY the rungs above it did not, and WHAT to do when none of them
 * can. Each is worth a frame, because each has a state that reads wrong if it is
 * only ever photographed on a configured machine:
 *
 *  - `RadientPass`: signed in, the Radient rung available — the ordinary case.
 *  - `StoredProviderKey`: signed OUT, an ElevenLabs row in the credential store,
 *    the cascade still servable. This is the combination a "sign in to use speech"
 *    notice gets wrong, and the reason the group's reminder is driven by
 *    AVAILABILITY rather than by the account.
 *  - `NothingAvailable`: signed out with no provider at all — the arm that names
 *    the route (`/login radient`) and still offers no credential field.
 *  - `BackendOlder`: a daemon that does not advertise `features.tts`, so the
 *    group states the version gap instead of firing a read at a route that is not
 *    there.
 *  - `Unreadable`: the availability read fails — the honest "could not be read"
 *    arm, which must not be photographed as either "ready" or "unavailable".
 *
 * The rows are the REAL registry rows: the payload is
 * `scripts/fixtures/backend-settings-registry.json`, the committed `/v1/settings`
 * projection, so a label, a help sentence or an enum's choices that is wrong in a
 * frame is wrong in the daemon's own registry. The availability payload is built
 * here in the resolver's own shape (`local_operator/tts/cascade.py`), because the
 * daemon decides it per machine rather than per release.
 *
 * The desktop transport is stubbed the way `backend-settings.stories.tsx` stubs
 * it (`window.api.desktop.request`, the bridge `desktop-api.desktopRequest`
 * prefers): without it every frame would photograph a transport error.
 *
 * THE SHUTTER WAITS FOR THE AVAILABILITY READ TO SETTLE. The rig's readiness
 * probe fires on a rendered-element count, and this panel's pending arm already
 * carries the seven rows, so a frame taken on that probe photographs a retrying
 * query rather than a state (design review round 1, D1; UX review round 1, U1:
 * the `unreadable` frame showed the spinner, not the failed read it is named
 * for). The story therefore holds `documentElement.dataset.capturePending`, as
 * `backend-settings.stories.tsx` does for its driven states.
 */

import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useLayoutEffect } from "react";
import fixtureJson from "../../../../../../scripts/fixtures/backend-settings-registry.json";
import { UNAVAILABLE_SENTENCE } from "./speech-section";
import { SpeechSection } from "./speech-section";

type BridgeRequest = {
	op?: string;
	control?: { operation?: string };
};

type DesktopResponse = { status: number; body: unknown };

const REGISTRY = fixtureJson as BackendSettings;

/** The rungs, in the resolver's frozen order. */
const RADIENT = "provider_tts_radient";
const ELEVENLABS = "provider_tts_elevenlabs";
const OPENAI = "provider_tts_openai";

type StoryState =
	| "radient-pass"
	| "stored-provider-key"
	| "nothing-available"
	| "backend-older"
	| "unreadable";

/** The resolution one state's daemon would report, in the resolver's shape. */
const resolutionFor = (state: StoryState) => {
	if (state === "radient-pass") {
		return {
			path: RADIENT,
			reason: "Signed in to Radient.",
			servable: true,
			rungs: [
				{ path: RADIENT, available: true, reason: "Signed in to Radient." },
				{
					path: ELEVENLABS,
					available: false,
					reason: "No ElevenLabs API key is stored.",
				},
				{
					path: OPENAI,
					available: false,
					reason: "No OpenAI API key is stored.",
				},
			],
		};
	}
	if (state === "stored-provider-key") {
		return {
			path: ELEVENLABS,
			reason: "An ElevenLabs API key is stored.",
			servable: true,
			rungs: [
				{
					path: RADIENT,
					available: false,
					reason: "Not signed in to Radient.",
				},
				{
					path: ELEVENLABS,
					available: true,
					reason: "An ElevenLabs API key is stored.",
				},
				{
					path: OPENAI,
					available: false,
					reason: "No OpenAI API key is stored.",
				},
			],
		};
	}
	return {
		path: "none",
		reason:
			"No text-to-speech provider is available: sign in to Radient, or store an ElevenLabs or OpenAI API key.",
		servable: false,
		rungs: [
			{
				path: RADIENT,
				available: false,
				reason: "Not signed in to Radient.",
			},
			{
				path: ELEVENLABS,
				available: false,
				reason: "No ElevenLabs API key is stored.",
			},
			{
				path: OPENAI,
				available: false,
				reason: "No OpenAI API key is stored.",
			},
		],
	};
};

let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

const installBridge = (state: StoryState) => {
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { status: 200, message: "ok", result },
	});
	/*
	 * Only the Radient-pass frame has an account. `stored-provider-key` is
	 * deliberately signed OUT and still served — the daemon's cascade reaches a
	 * stored provider key with no Radient session at all, and that is the state
	 * this story exists to photograph.
	 */
	const signedIn = state === "radient-pass";
	bridge = async (request) => {
		switch (request?.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					/*
					 * `tts` is the gate this surface sits behind, and it is the one key
					 * `backend-older` withholds: a daemon that predates voicing advertises
					 * no such key, and the group must not ask it for the route.
					 */
					features: {
						settings: 1,
						auth: 1,
						catalogues: 1,
						radient: 1,
						...(state === "backend-older" ? {} : { tts: 1 }),
					},
				});
			case "settings.list":
				return ok(REGISTRY);
			case "credentials.list":
				return ok({ keys: [] });
			case "tts.paths":
				if (state === "unreadable") {
					return {
						status: 500,
						body: {
							detail: "The resolver could not read the credential store.",
						},
					};
				}
				return ok(resolutionFor(state));
			case "radient.request":
				/*
				 * The account read, in the two answers the group distinguishes: a stored
				 * account, or the daemon's own no-credential refusal (whose CODE is what
				 * classifies the reader as signed out rather than as an outage).
				 */
				if (request?.control?.operation !== "account") break;
				if (signedIn) {
					return ok({
						data: {
							msg: "ok",
							result: {
								account: {
									id: "acct_storybook_speech",
									tenant_id: "ten_storybook_speech",
									email: "speech@example.test",
									name: "Voicing Fixture",
									role: "owner",
									status: "active",
								},
								identity: {
									email: "speech@example.test",
									provider: "google",
									provider_id: "google-speech-fixture",
								},
							},
						},
					});
				}
				return {
					status: 409,
					body: {
						detail: {
							code: "radient_no_credential",
							message: "Sign in to Radient to use this.",
						},
					},
				};
			default:
				break;
		}
		return {
			status: 404,
			body: { detail: { code: "not_implemented", message: request?.op } },
		};
	};
};

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			/*
			 * Untyped for the same reason `slash-highlight.stories.tsx` leaves it
			 * untyped: this is a fixture standing in for main, and a partially
			 * shaped snapshot would be a claim about a contract this file is not
			 * testing. The two fields read are `state` and `url`.
			 */
			backend?: Record<string, unknown>;
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	// Without a bridge the connectivity gate falls back to a real health fetch,
	// which in Storybook answers nothing — and an offline host would make every
	// frame render the offline arm.
	api.backend = {
		getStatus: async () => ({ state: "attached", url: "http://127.0.0.1:9/" }),
	};
	api.desktop = {
		request: (request: BridgeRequest) => {
			if (!bridge) throw new Error("no bridge installed for this story");
			return bridge(request);
		},
	};
}

/* ------------------------------------------------------------- the shutter */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () =>
	new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

/**
 * The sentence this state's SETTLED arm renders, or `null` where the section
 * issues no read and so has nothing to settle.
 *
 * Derived from the fixture this story stubs rather than from a copy of the app's
 * wording: the two servable states settle on the serving rung's own line (its
 * reason), `nothing-available` on the resolution's sentence, and `unreadable` on
 * the failed read's - which is the one string the story has to be told, because
 * nothing in its own payload produces it.
 */
const settleTargetFor = (state: StoryState): string | null => {
	if (state === "unreadable") return UNAVAILABLE_SENTENCE;
	return resolutionFor(state)?.reason ?? null;
};

/**
 * How long the latch holds before it gives up, in ms.
 *
 * The rig gives the shutter 60s before it refuses a story (its readiness probe is
 * 300 polls at 200ms, `capture-evidence.mjs`), so this holds just inside that
 * bound: the state gets the whole window the rig will wait for, and the marker
 * below is written while the rig is still reading it. Releasing earlier - as this
 * latch did at 6s on the first pass - hands the shutter back mid-flight for any
 * state slower than the bound, which is the defect design review round 1's D1 was.
 */
const SHUTTER_HOLD_MS = 55_000;

/**
 * The section, installed against one cascade state.
 *
 * The bridge is installed as the story RENDERS rather than from an effect,
 * which is `backend-settings.stories.tsx`'s pattern: the group's queries can fire
 * before a parent layout effect runs, and a delegate that throws "no bridge
 * installed" would turn that race into a transport error in the frame.
 *
 * The latch is armed in a LAYOUT effect, so it is on the document before the
 * rig's readiness probe can see the rendered rows - the same ordering argument
 * `backend-settings.stories.tsx` states for its driven states - and it waits for
 * the sentence this state SETTLES on. It waits for the sentence rather than for
 * the pending one to go away, which is a distinction that cost a round (design
 * review round 1, D1; UX round 1, U1): this section's FIRST arm is its registry
 * read's early return, so "the checking sentence is gone" is satisfied before the
 * availability read has even started, and the shutter opened inside the one retry
 * `retryDesktopQuery` allows. `app-updates-section.stories.tsx` waits on its own
 * `expect` text for the same reason.
 *
 * THE EXPIRY IS A FAILURE, NOT A SILENT RELEASE (the evidence lane's review of
 * #815, routed here). A reworded sentence must not release the shutter quietly:
 * the marker written below is `data-capture-failed`, which the rig REFUSES a
 * frame for, in the same seat and shape `agent-hub.stories.tsx`'s `holdShutter`
 * and `docs-library.stories.tsx`'s `HubHold` set it. Without it this latch would
 * have expired at 6s, written nothing, and filed whatever the retrying query was
 * showing under the state's name - the class D1 closed.
 */
const Section: FC<{ state: StoryState }> = ({ state }) => {
	installBridge(state);
	const settled = settleTargetFor(state);
	useLayoutEffect(() => {
		if (!settled) return;
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		const run = async () => {
			const started = Date.now();
			let reached = false;
			while (Date.now() - started < SHUTTER_HOLD_MS) {
				if (document.body.textContent?.includes(settled)) {
					reached = true;
					break;
				}
				await sleep(20);
			}
			await nextFrame();
			if (cancelled) return;
			delete document.documentElement.dataset.capturePending;
			if (!reached) {
				document.documentElement.dataset.captureFailed = `speech-shutter-not-reached: ${settled}`;
			}
		};
		void run();
		return () => {
			cancelled = true;
			delete document.documentElement.dataset.capturePending;
		};
	}, [settled]);
	return (
		<div className="min-h-screen bg-canvas p-8">
			{/*
			 * `max-w-4xl`, which is the page's own content column
			 * (`settings-page.tsx`), not the `max-w-3xl` this story mounted at until
			 * design review round 1 (D3). The sibling story states the rule: mounting a
			 * settings section at another width would photograph a layout the product
			 * never renders.
			 */}
			<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
				<SpeechSection />
			</div>
		</div>
	);
};

const meta: Meta<{ state: StoryState }> = {
	title: "Settings/Speech",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<{ state: StoryState }>;

/** Signed in to Radient: the Radient rung serves, and no other rung is lit. */
export const RadientPass: Story = {
	args: { state: "radient-pass" },
	render: (args) => <Section state={args.state} />,
};

/**
 * Signed out with a stored provider key: the cascade serves through ElevenLabs,
 * so the group shows no reminder at all — the combination a sign-in notice gets
 * wrong.
 */
export const StoredProviderKey: Story = {
	args: { state: "stored-provider-key" },
	render: (args) => <Section state={args.state} />,
};

/** Nothing can speak: the daemon's own reason, and the route that fixes it. */
export const NothingAvailable: Story = {
	args: { state: "nothing-available" },
	render: (args) => <Section state={args.state} />,
};

/** A daemon that predates the voicing surface: the version gap, stated. */
export const BackendOlder: Story = {
	args: { state: "backend-older" },
	render: (args) => <Section state={args.state} />,
};

/** The availability read failed: neither "ready" nor "no provider" is claimed. */
export const Unreadable: Story = {
	args: { state: "unreadable" },
	render: (args) => <Section state={args.state} />,
};
