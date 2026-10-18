/**
 * The shared sound player in every state it can be in.
 *
 * WHY THE STATES ARE FORCED, NOT PLAYED. A story is a picture of a state, and a
 * story that started real playback would (a) depend on the machine's audio
 * device and (b) put sound in the operator's room while someone scrolls the
 * gallery — the lane's audio-safety rule, stated in the engine's header. So each
 * story writes the ENGINE's state directly: the same fields a real press settles,
 * with a clock-only fake element and no `play()` behind them. The player reads its live clock, which is
 * why the frames are honest about layout, ink and labels while making no claim
 * about decoding.
 *
 * THE PEAKS ARE A REAL-LOOKING ENVELOPE, generated here rather than fetched:
 * a story must render without a session, and a flat line would make every story
 * the same picture. `waveform-model.ts` owns the geometry, so a shape that drew
 * badly here would draw badly in the app for the same reason.
 *
 * THE STRIPS BELOW show the two variants at the widths the app gives them: the
 * full player in the transcript's column, the compact one in a Files row.
 *
 * THE OPERATOR GATE IS ONE HEADLESS COMMAND, and it is NOT these stories:
 * `node scripts/run-sounds-scene.mjs` seeds the isolated daemon, builds this
 * source and invokes `renderer-driver.mjs --scene sounds` headlessly. It routes
 * the player's real element through the engine's zero-gain output
 * graph and proves playback by `currentTime` and the played-ink fill fraction —
 * never by ear. The seam is `installAudioOutputGraph`; production installs
 * nothing and plays at gain 1.0.
 */

import { useAudioEngineStore } from "@shared/store/audio-engine-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import "../../../styles/index.css";
import { SoundPlayer } from "./sound-player";

/** A deterministic envelope: no randomness, so a frame diff means a code change. */
const PEAKS = Array.from({ length: 240 }, (_, index) => {
	const wave = Math.sin(index / 7) * Math.sin(index / 23);
	const shaped = 0.15 + Math.abs(wave) * 0.85;
	return Math.min(1, Math.max(0.08, shaped));
});

const OWNER = `sound:${"a".repeat(32)}`;

/** Drives the shared engine into one state for a story's frame. */
function EngineState({
	status,
	current,
	duration,
}: {
	status: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
	current: number;
	duration: number;
}) {
	useEffect(() => {
		const active = status !== "idle";
		useAudioEngineStore.setState({
			/*
			 * A clock-only fake element: the fields below are what the player
			 * reads, and an element that never played is what keeps a gallery
			 * silent. `ownerId` is what makes the row read "this one is mine".
			 */
			element: { currentTime: current, duration } as HTMLAudioElement,
			ownerId: active ? OWNER : null,
			url: active ? "story://silent" : null,
			status,
			currentTime: current,
			duration,
			volume: 1,
			playbackRate: 1,
		});
		return () => {
			useAudioEngineStore.setState({
				element: null,
				ownerId: null,
				url: null,
				status: "idle",
				currentTime: 0,
				duration: 0,
			});
		};
	}, [status, current, duration]);
	return null;
}

const meta: Meta<typeof SoundPlayer> = {
	title: "Chat/Canonical/SoundPlayer",
	component: SoundPlayer,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-[520px] rounded-sm bg-surface p-4">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof SoundPlayer>;

const player = (
	over: Partial<React.ComponentProps<typeof SoundPlayer>> = {},
) => (
	<SoundPlayer
		ownerId={OWNER}
		src="story://silent"
		label="Storm swell"
		peaks={PEAKS}
		durationHint={12.4}
		{...over}
	/>
);

export const Idle: Story = {
	render: () => (
		<>
			<EngineState status="idle" current={0} duration={0} />
			{player()}
		</>
	),
};

export const Loading: Story = {
	render: () => (
		<>
			<EngineState status="loading" current={0} duration={0} />
			{player()}
		</>
	),
};

export const Playing: Story = {
	render: () => (
		<>
			<EngineState status="playing" current={5.2} duration={12.4} />
			{player()}
		</>
	),
};

/** Hold a real pointer-handler scrub frame against the clock-only fake. */
function ScrubbingFrame() {
	const root = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const slider = root.current?.querySelector<HTMLElement>(
			"[data-sound-slider]",
		);
		if (!slider) return;
		const oldCapture = slider.setPointerCapture;
		slider.setPointerCapture = () => {};
		const frame = requestAnimationFrame(() => {
			const box = slider.getBoundingClientRect();
			for (const [type, x] of [
				["pointerdown", box.left + 1],
				["pointermove", box.left + box.width * (8.1 / 12.4)],
			] as const) {
				slider.dispatchEvent(
					new PointerEvent(type, {
						pointerId: 3,
						clientX: x,
						clientY: box.top + 20,
						bubbles: true,
					}),
				);
			}
		});
		return () => {
			cancelAnimationFrame(frame);
			slider.setPointerCapture = oldCapture;
		};
	}, []);
	return (
		<div ref={root} className="w-[488px]">
			<EngineState status="paused" current={8.1} duration={12.4} />
			{player()}
		</div>
	);
}
export const Scrubbing: Story = { render: () => <ScrubbingFrame /> };

export const Ended: Story = {
	render: () => (
		<>
			<EngineState status="ended" current={12.4} duration={12.4} />
			{player()}
		</>
	),
};

/*
 * Named `Failed`, not `Error`: the story exports become module bindings, and a
 * binding called `Error` shadows the global constructor for every later line of
 * this file (biome's `noShadowRestrictedNames`).
 */
export const Failed: Story = {
	name: "Error",
	render: () => (
		<>
			<EngineState status="error" current={0} duration={12.4} />
			{player()}
		</>
	),
};

export const NoPeaks: Story = {
	name: "No peaks (flat scrubber)",
	render: () => (
		<>
			<EngineState status="idle" current={0} duration={0} />
			{player({ peaks: null })}
		</>
	),
};

export const Compact: Story = {
	render: () => (
		<>
			<EngineState status="playing" current={2.4} duration={6} />
			<div className="w-[300px]">
				{player({ variant: "compact", label: "Chime", durationHint: 6 })}
			</div>
		</>
	),
};

export const BothVariants: Story = {
	name: "Both variants",
	render: () => (
		<>
			<EngineState status="paused" current={3.1} duration={12.4} />
			<div className="flex flex-col gap-4">
				{player()}
				<div className="w-[300px] border-t border-hairline pt-3">
					{player({ variant: "compact", label: "Chime", durationHint: 6 })}
				</div>
			</div>
		</>
	),
};

/** Placement fixtures complement, but never replace, the integrated sounds scene. */
export const CanvasFilesSounds: Story = {
	name: "Canvas Files / Sounds",
	render: () => (
		<>
			<EngineState status="paused" current={5.2} duration={12.4} />
			<section className="w-[340px] border-t border-hairline py-2">
				<h3 className="text-meta text-ink-muted">Sounds</h3>
				{player({ variant: "compact" })}
			</section>
		</>
	),
};
export const HighlightsSounds: Story = {
	name: "Highlights / Sounds",
	render: () => (
		<>
			<EngineState status="ended" current={12.4} duration={12.4} />
			<section className="w-[340px] py-2">
				<h3 className="text-meta text-ink-muted">Sounds</h3>
				{player({ variant: "compact" })}
			</section>
		</>
	),
};
