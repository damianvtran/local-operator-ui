import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import { MermaidDiagram } from "./mermaid-diagram";

/*
 * Mermaid's categorical fills, which are the one surface in the app where a
 * SECOND decorative hue buys something functional rather than aesthetic.
 *
 * ## What this story is for
 *
 * `fillType0..7` is mermaid's own categorical ramp (`mermaid-diagram.tsx`'s
 * `WASH_CYCLE`) and it drives the journey and radar diagram types. Until the
 * second accent existed, entry 1 of that ramp was `info` — so a diagram's second
 * category was painted the colour that everywhere else in the app means "here is
 * a fact". The ramp now starts `accentWash`, `accentAltWash`, `infoWash`, … and
 * the diff that did it is TWO LINES, which is exactly the kind of change that
 * ships with no picture unless something takes one: there was no frame anywhere
 * under `docs/evidence` whose path contained `mermaid` before this story, so a
 * reviewer had nothing to look at.
 *
 * ## Why a JOURNEY and not a flowchart
 *
 * Because the ramp has to be visible for the frame to be evidence. The journey
 * type spends `fillType0..7` per SECTION, and it is the only diagram type this
 * app can render that spends the ramp in a fixed, legible order — a flowchart's
 * node fills come from `mainBkg`/`primaryColor` and a pie's sections come from
 * `pie1..12`, neither of which touches `fillType`. Six sections therefore show
 * all six entries of the cycle, including the new one at index 1.
 *
 * The chart is a plan the app's own user would write, not a colour chart: a
 * frame is evidence about the app only if it is a state the app really renders.
 */

/** Six sections, so the whole wash cycle is spent — including index 1. */
const CATEGORICAL_JOURNEY = `journey
    title A change through the gate
    section Spec
      Scope the slice: 5: Operator
      Measure the floors: 3: Operator, Agent
    section Build
      Implement the roles: 4: Agent
      Wire the stylesheet: 2: Agent
    section Review
      Read the diff: 4: Reviewer
      Answer the findings: 3: Agent
    section QA
      Drive the surface: 5: QA
      Record the matrix: 3: QA
    section Design
      Look at the frames: 4: Designer
    section Release
      Tag and publish: 2: Operator
`;

/**
 * Hold the shutter until the diagram has actually DRAWN.
 *
 * The render is asynchronous — the mermaid module is a 3.6 MB dynamic import
 * (`getMermaid`) and `mermaid.render` resolves afterwards — so the component
 * mounts in its "Loading diagram..." state and swaps in the SVG a moment later.
 * The rig's readiness poll asks whether the story rendered, and a story holding
 * one loading line answers yes, so without this handshake the frame is the
 * placeholder in some themes and the diagram in others — and the two are
 * indistinguishable once they are files in a directory.
 *
 * Held from the RENDER, not from an effect: the rig can find the story prepared
 * before a passive effect has run, which is the same defect wearing the other
 * hat. Released as soon as the SVG is in the DOM, and on unmount, so a theme
 * whose diagram fails to render fails loudly at the rig's 60 s timeout instead
 * of quietly producing a frame of nothing.
 */
const AwaitDiagram: FC<{ chart: string }> = ({ chart }) => {
	const box = useRef<HTMLDivElement>(null);
	const [drawn, setDrawn] = useState(false);
	document.documentElement.dataset.capturePending = "1";

	useEffect(() => {
		if (box.current?.querySelector("svg")) {
			setDrawn(true);
			return;
		}
		const timer = window.setInterval(() => {
			if (box.current?.querySelector("svg")) setDrawn(true);
		}, 50);
		return () => window.clearInterval(timer);
	}, []);

	useEffect(() => {
		if (drawn) delete document.documentElement.dataset.capturePending;
		return () => {
			delete document.documentElement.dataset.capturePending;
		};
	}, [drawn]);

	return (
		<div ref={box} className="flex-1">
			<MermaidDiagram chart={chart} />
		</div>
	);
};

const meta = {
	title: "Chat/Mermaid diagram",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/**
 * The categorical ramp, in the app's own frame.
 *
 * The play asserts what the shutter was waiting for, so a frame is only taken
 * over a diagram that rendered — a play that throws is caught by the rig before
 * the screenshot and stops the sweep with the story named.
 */
export const CategoricalFills: Story = {
	render: () => (
		<div className="flex min-h-screen flex-col gap-3 bg-canvas p-6">
			<AwaitDiagram chart={CATEGORICAL_JOURNEY} />
		</div>
	),
	play: async ({ canvasElement }) => {
		await waitFor(
			() => {
				expect(canvasElement.querySelector("svg")).toBeTruthy();
			},
			{ timeout: 30_000 },
		);
	},
};
