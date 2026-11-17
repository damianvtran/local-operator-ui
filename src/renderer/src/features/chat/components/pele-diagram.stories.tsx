import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import type { FC, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ChatDiagram } from "./chat-diagram";
import { MermaidDiagram } from "./mermaid-diagram";
import { PeleDiagram } from "./pele-diagram";

const FLOWCHART = `flowchart TD
    A[Operator sends a prompt] --> B{Plane reachable?}
    B -->|yes| C[Stream the turn]
    B -->|no| D[Show the offline banner]
    C --> E[Render the transcript]
    D --> F[Retry with backoff]
    F --> B
    E --> G((Done))
`;

const SEQUENCE = `sequenceDiagram
    participant U as Operator
    participant UI as Desktop UI
    participant P as Plane
    U->>UI: Send prompt
    UI->>P: POST /turns
    P-->>UI: Stream events
    loop Every event
        UI->>UI: Reduce into transcript
    end
    UI-->>U: Settled answer
`;

const STATE = `stateDiagram-v2
    [*] --> Idle
    Idle --> Streaming: send
    Streaming --> Settled: done
    Streaming --> Failed: error
    Failed --> Idle: retry
    Settled --> Idle: next prompt
    Settled --> [*]
`;

const JOURNEY = `journey
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
`;

const PIE = `pie title Turn time
    "Model" : 62
    "Tools" : 25
    "Render" : 8
    "Other" : 5
`;

const INVALID = `flowchart TD
    A[Start --> B
`;

const AwaitDiagrams: FC<{ count: number; children: ReactNode }> = ({
	count,
	children,
}) => {
	const box = useRef<HTMLDivElement>(null);
	const [drawn, setDrawn] = useState(false);
	if (!drawn) document.documentElement.dataset.capturePending = "1";

	useEffect(() => {
		const check = () =>
			(box.current?.querySelectorAll("svg[role], svg.pele, svg[id]").length ??
				0) >= count;
		if (check()) {
			setDrawn(true);
			return;
		}
		const timer = window.setInterval(() => {
			if (check()) setDrawn(true);
		}, 50);
		return () => window.clearInterval(timer);
	}, [count]);

	useEffect(() => {
		if (drawn) delete document.documentElement.dataset.capturePending;
		return () => {
			delete document.documentElement.dataset.capturePending;
		};
	}, [drawn]);

	return (
		<div ref={box} className="flex flex-1 flex-col gap-3">
			{children}
		</div>
	);
};

const Frame: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="flex min-h-screen flex-col gap-3 bg-canvas p-6">
		{children}
	</div>
);

const awaitSvg = async (canvasElement: HTMLElement, count = 1) => {
	await waitFor(
		() => {
			expect(
				canvasElement.querySelectorAll("svg[role], svg.pele, svg[id]").length,
			).toBeGreaterThanOrEqual(count);
		},
		{ timeout: 30_000 },
	);
};

const meta = {
	title: "Chat/Pele diagram",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Flowchart: Story = {
	render: () => (
		<Frame>
			<AwaitDiagrams count={1}>
				<PeleDiagram chart={FLOWCHART} />
			</AwaitDiagrams>
		</Frame>
	),
	play: async ({ canvasElement }) => awaitSvg(canvasElement),
};

export const Sequence: Story = {
	render: () => (
		<Frame>
			<AwaitDiagrams count={1}>
				<PeleDiagram chart={SEQUENCE} />
			</AwaitDiagrams>
		</Frame>
	),
	play: async ({ canvasElement }) => awaitSvg(canvasElement),
};

export const State: Story = {
	render: () => (
		<Frame>
			<AwaitDiagrams count={1}>
				<PeleDiagram chart={STATE} />
			</AwaitDiagrams>
		</Frame>
	),
	play: async ({ canvasElement }) => awaitSvg(canvasElement),
};

export const CategoricalFills: Story = {
	render: () => (
		<Frame>
			<AwaitDiagrams count={2}>
				<PeleDiagram chart={JOURNEY} />
				<PeleDiagram chart={PIE} />
			</AwaitDiagrams>
		</Frame>
	),
	play: async ({ canvasElement }) => awaitSvg(canvasElement, 2),
};

export const InvalidSource: Story = {
	render: () => (
		<Frame>
			<PeleDiagram chart={INVALID} />
		</Frame>
	),
	play: async ({ canvasElement }) => {
		await waitFor(
			() => {
				expect(canvasElement.querySelector('[role="alert"]')).toBeTruthy();
			},
			{ timeout: 30_000 },
		);
	},
};

const Pair: FC<{ chart: string }> = ({ chart }) => (
	<div className="grid grid-cols-2 gap-3">
		<PeleDiagram chart={chart} />
		<MermaidDiagram chart={chart} />
	</div>
);

export const AgainstMermaid: Story = {
	render: () => (
		<Frame>
			<AwaitDiagrams count={6}>
				<Pair chart={FLOWCHART} />
				<Pair chart={SEQUENCE} />
				<Pair chart={STATE} />
			</AwaitDiagrams>
		</Frame>
	),
	play: async ({ canvasElement }) => awaitSvg(canvasElement, 6),
};

export const SelectedByFlag: Story = {
	render: () => (
		<Frame>
			<AwaitDiagrams count={1}>
				<ChatDiagram chart={FLOWCHART} />
			</AwaitDiagrams>
		</Frame>
	),
	play: async ({ canvasElement }) => awaitSvg(canvasElement),
};
