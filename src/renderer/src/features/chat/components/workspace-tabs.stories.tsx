import { TOOLTIP_DELAY_MS } from "@shared/components/ui/tooltip";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import { useState } from "react";
import { type WorkspaceTab, makeWorkspaceTab } from "../workspace-tabs-model";
import { WorkspaceTabs } from "./workspace-tabs";

const names = [
	"Release notes",
	"Design review",
	"Build status",
	"Workspace setup",
	"Accessibility audit",
	"Desktop release checklist",
	"Search improvements",
	"Browser integration",
];
const tabs = names.map((_, index) => ({
	...makeWorkspaceTab({ kind: "session", id: `story-${index}` }),
	pinned: index < 3,
}));
const titles = Object.fromEntries(tabs.map(({ key }, i) => [key, names[i]]));
const regularTabs = tabs.filter((tab) => !tab.pinned);
const pinnedTabs = tabs.map((tab) => ({ ...tab, pinned: true }));
const noop = () => {};

function Strip({
	items,
	rtl = false,
	labels = titles,
	activeTitle = null,
}: {
	items: WorkspaceTab[];
	rtl?: boolean;
	labels?: Record<string, string>;
	activeTitle?: string | null;
}) {
	return (
		<div dir={rtl ? "rtl" : "ltr"} className="w-full max-w-[460px]">
			<WorkspaceTabs
				viewport={{ pinned: 0, regular: 0 }}
				tabs={items}
				activeKey={items.find((tab) => !tab.pinned)?.key}
				activeTitle={activeTitle}
				titles={labels}
				autoClose={false}
				focusRequested={false}
				onAutoCloseChange={noop}
				onTitleSeen={noop}
				onFocusHandled={noop}
				onOpen={noop}
				onClose={noop}
				onCloseMany={noop}
				onPin={noop}
				onMove={noop}
			/>
		</div>
	);
}

const meta = {
	title: "Chat/Workspace Tabs",
	component: Strip,
	args: { items: tabs },
} satisfies Meta<typeof Strip>;
export default meta;
type Story = StoryObj<typeof meta>;

const laneSelector = "[data-workspace-pinned], [data-workspace-regular]";
const setPosition = (
	fraction: number,
	{ canvasElement }: { canvasElement: HTMLElement },
) => {
	for (const lane of canvasElement.querySelectorAll<HTMLElement>(
		laneSelector,
	)) {
		// scrollWidth/clientWidth are integers but the real endpoint can be fractional.
		// Overshoot at the end so Chromium clamps to its true maximum.
		lane.scrollLeft =
			fraction === 1
				? lane.scrollWidth
				: (lane.scrollWidth - lane.clientWidth) * fraction;
	}
};

export const Overflow: Story = {};
export const Middle: Story = { play: (context) => setPosition(0.5, context) };
export const End: Story = { play: (context) => setPosition(1, context) };
export const SingleLaneMiddle: Story = {
	args: { items: regularTabs },
	play: (context) => setPosition(0.5, context),
};
export const OverflowRtl: Story = { args: { rtl: true } };
export const Fits: Story = { args: { items: [tabs[0], tabs[3]] } };
export const Empty: Story = { args: { items: [] } };

const hoverLabels = {
	[tabs[3].key]: "Desktop workspace release readiness checklist",
	[tabs[4].key]: "Notes",
};
export const TitlePan: Story = {
	args: { items: tabs.slice(3, 5), labels: hoverLabels },
};
export const TitlePanRtl: Story = { args: { ...TitlePan.args, rtl: true } };

const titleSelector = "[data-workspace-tab-title]";
const titleTextSelector = "[data-workspace-tab-title-text]";
const nextFrame = () =>
	new Promise<number>((done) => requestAnimationFrame(done));
const afterDwell = async () => {
	// Past the existing tooltip dwell and the two frames that mount and paint.
	await new Promise<void>((done) => setTimeout(done, TOOLTIP_DELAY_MS));
	await nextFrame();
	await nextFrame();
};
const titleParts = (clip: HTMLElement) => {
	const button = clip.closest("button");
	const row = clip.closest("[data-workspace-tab]");
	const lane = clip.closest("[data-workspace-regular]");
	if (!button || !row || !lane) throw new Error("Missing tab title host");
	const controlBoxes = () => ({
		boxes: [clip, row, ...row.querySelectorAll("button")].map((node) =>
			node.getBoundingClientRect().toJSON(),
		),
		scrollLeft: lane.scrollLeft,
		scrollWidth: lane.scrollWidth,
	});
	const pointer = (
		type: "pointerenter" | "pointerleave",
		pointerType = "mouse",
	) => row.dispatchEvent(new PointerEvent(type, { pointerType }));
	const offset = () => {
		const text = clip.querySelector(titleTextSelector);
		const transform = text ? getComputedStyle(text).transform : "none";
		return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
	};
	const expectRest = () => {
		expect(clip.querySelector(titleTextSelector)).toBeNull();
		expect(getComputedStyle(clip).textOverflow).toBe("ellipsis");
		expect(getComputedStyle(clip).maskImage).toBe("none");
	};
	return { button, row, controlBoxes, pointer, offset, expectRest };
};

export const TitlePanRegression: Story = {
	render: () => (
		<>
			<Strip items={tabs.slice(3, 5)} labels={hoverLabels} />
			<Strip items={tabs.slice(3, 5)} labels={hoverLabels} rtl />
		</>
	),
	play: async ({ canvasElement, step }) => {
		await canvasElement.ownerDocument.fonts.ready;
		const [ltr, short, rtl] =
			canvasElement.querySelectorAll<HTMLElement>(titleSelector);
		for (const [clip, direction, sign] of [
			[ltr, "right", -1],
			[rtl, "left", 1],
		] as const) {
			await step(
				`Pan only the ${direction === "right" ? "LTR" : "RTL"} title after dwell`,
				async () => {
					const { button, row, pointer, offset, controlBoxes, expectRest } =
						titleParts(clip);
					const initial = controlBoxes();
					expect(clip.scrollWidth).toBeGreaterThan(clip.clientWidth);
					expectRest();
					const start = performance.now();
					pointer("pointerenter");
					await nextFrame();
					expect(performance.now() - start).toBeLessThan(TOOLTIP_DELAY_MS);
					expectRest();
					await waitFor(() => expect(sign * offset()).toBeGreaterThan(0));
					const text = clip.querySelector(titleTextSelector);
					if (!text) throw new Error("Missing moving text");
					const travel = text.getBoundingClientRect().width - clip.clientWidth;
					expect(sign * offset()).toBeLessThan(travel);
					expect(getComputedStyle(clip).maskImage).toContain(`to ${direction}`);
					expect(controlBoxes()).toEqual(initial);
					for (const control of [row, ...row.querySelectorAll("button")]) {
						expect(getComputedStyle(control).transform).toBe("none");
						expect(getComputedStyle(control).maskImage).toBe("none");
					}
					await expect(button).toHaveAccessibleName(hoverLabels[tabs[3].key]);
					// The coast is bounded by the same dwell and 32px/s reading speed.
					await waitFor(() => expect(sign * offset()).toBeCloseTo(travel, 2), {
						timeout: TOOLTIP_DELAY_MS + (travel / 32) * 1000,
					});
					const held = offset();
					await nextFrame();
					await nextFrame();
					expect(offset()).toBe(held);
					expect(controlBoxes()).toEqual(initial);
					pointer("pointerleave");
					await nextFrame();
					expectRest();
					expect(controlBoxes()).toEqual(initial);
				},
			);
		}
		await step(
			"A fitting title, touch and keyboard focus do not pan",
			async () => {
				const fitting = titleParts(short);
				const overflowing = titleParts(ltr);
				expect(short.scrollWidth).toBe(short.clientWidth);
				fitting.pointer("pointerenter");
				overflowing.pointer("pointerenter", "touch");
				await afterDwell();
				fitting.expectRest();
				overflowing.expectRest();
				fitting.pointer("pointerleave");
				overflowing.pointer("pointerleave", "touch");
				overflowing.button.focus();
				expect(canvasElement.ownerDocument.activeElement).toBe(
					overflowing.button,
				);
				await afterDwell();
				overflowing.expectRest();
				overflowing.button.blur();
			},
		);
	},
};

function LiveTitleStrip() {
	const [title, setTitle] = useState(hoverLabels[tabs[3].key]);
	return (
		<>
			<Strip items={tabs.slice(3, 4)} activeTitle={title} />
			{/* Focus and activate with the keyboard so the pointer stays on the tab. */}
			<button type="button" data-story-rename onClick={() => setTitle("Notes")}>
				Replace active title
			</button>
		</>
	);
}

export const TitlePanLiveRename: Story = { render: () => <LiveTitleStrip /> };

export const TitlePanReducedMotion: Story = {
	args: TitlePan.args,
	beforeEach: () => {
		// Model the OS preference for this story only; leave all other media
		// queries and the actual browser's preference untouched.
		const previous = window.matchMedia;
		window.matchMedia = (query) => {
			const result = previous.call(window, query);
			if (query === "(prefers-reduced-motion: reduce)")
				Object.defineProperty(result, "matches", { value: true });
			return result;
		};
		return () => {
			window.matchMedia = previous;
		};
	},
	play: async ({ canvasElement }) => {
		await canvasElement.ownerDocument.fonts.ready;
		const clip = canvasElement.querySelector<HTMLElement>(titleSelector);
		if (!clip) throw new Error("Missing tab title");
		const title = titleParts(clip);
		expect(clip.scrollWidth).toBeGreaterThan(clip.clientWidth);
		title.pointer("pointerenter");
		await afterDwell();
		title.expectRest();
		title.pointer("pointerleave");
	},
};

// Inspect the gradient's opaque stops, not the timeline variables: those
// variables can still animate at the seam even when it must paint fully opaque.
const expectMask = (
	lane: HTMLElement,
	direction: "right" | "left",
	start: number | readonly number[],
	end: number | readonly number[],
) => {
	// Chromium can retain min(0px, 25%) in the gradient serialization; that
	// zero-length ramp is equivalent to a stop directly on the edge.
	const ramp = (px: number) => `min\\(${px}px, 25%\\)`;
	const alternatives = (
		value: number | readonly number[],
		pattern: (px: number) => string,
	) => (typeof value === "number" ? [value] : value).map(pattern).join("|");
	const startStop = alternatives(start, (px) =>
		px === 0 ? `0px|${ramp(0)}` : ramp(px),
	);
	const endStop = alternatives(end, (px) => {
		const offset = `calc\\(100% - ${ramp(px)}\\)`;
		return px === 0 ? `100%|${offset}` : offset;
	});
	const mask = getComputedStyle(lane).maskImage;
	expect(mask).toMatch(
		new RegExp(
			`^linear-gradient\\(to ${direction}, rgba\\(0, 0, 0, 0\\), rgb\\(0, 0, 0\\) (?:${startStop}), rgb\\(0, 0, 0\\) (?:${endStop}), rgba\\(0, 0, 0, 0\\)\\)$`,
		),
	);
};

export const ScrollFadeRegression: Story = {
	render: () => (
		<>
			<Strip items={tabs} />
			<Strip items={tabs} rtl />
			<Strip items={regularTabs} />
			<Strip items={pinnedTabs} />
			<Strip items={[tabs[0], tabs[3]]} />
			<Strip items={[]} />
			<Strip items={tabs.slice(3, 5)} />
		</>
	),
	play: async ({ canvasElement, step }) => {
		await canvasElement.ownerDocument.fonts.ready;
		const [ltr, rtl, regular, pinned, fit, empty, short] =
			canvasElement.querySelectorAll<HTMLElement>("[data-workspace-tabs]");
		const lanes = (strip: HTMLElement) =>
			strip.querySelectorAll<HTMLElement>(laneSelector);
		for (const [strip, sign, direction] of [
			[ltr, 1, "right"],
			[rtl, -1, "left"],
		] as const) {
			await step(
				`${sign === 1 ? "LTR" : "RTL"}: split seam stays opaque`,
				async () => {
					const [pins, sessions] = lanes(strip);
					const chevron = strip.querySelector("[data-workspace-more]");
					if (!chevron) throw new Error("Missing strip chevron");
					const chevronBox = chevron.getBoundingClientRect().toJSON();
					for (const [lane, neighbor, isPinned] of [
						[pins, sessions, true],
						[sessions, pins, false],
					] as const) {
						const max = lane.scrollWidth - lane.clientWidth;
						expect(max).toBeGreaterThan(48);
						const otherOffset = neighbor.scrollLeft;
						await waitFor(() =>
							expectMask(lane, direction, 0, isPinned ? 0 : 24),
						);
						lane.scrollLeft = sign * (max / 2);
						await waitFor(() =>
							expectMask(lane, direction, isPinned ? 24 : 0, isPinned ? 0 : 24),
						);
						lane.scrollLeft = sign * lane.scrollWidth;
						await waitFor(() =>
							expectMask(lane, direction, isPinned ? 24 : 0, 0),
						);
						expect(neighbor.scrollLeft).toBe(otherOffset);
					}
					expect(chevron.getBoundingClientRect().toJSON()).toEqual(chevronBox);
					expect(getComputedStyle(chevron).maskImage).toBe("none");
				},
			);
		}
		await step(
			"A single pinned or regular lane fades at both outer edges",
			async () => {
				for (const strip of [pinned, regular]) {
					expect(lanes(strip)).toHaveLength(1);
					const [lane] = lanes(strip);
					const max = lane.scrollWidth - lane.clientWidth;
					expect(max).toBeGreaterThan(48);
					await waitFor(() => expectMask(lane, "right", 0, 24));
					lane.scrollLeft = 8;
					await waitFor(() => expectMask(lane, "right", 8, 24));
					lane.scrollLeft = max / 2;
					await waitFor(() => expectMask(lane, "right", 24, 24));
					lane.scrollLeft = lane.scrollWidth;
					await waitFor(() => expectMask(lane, "right", 24, 0));
				}
			},
		);
		await step("Fitting and empty lanes have no fade", async () => {
			for (const lane of lanes(fit)) {
				expect(lane.scrollWidth).toBe(lane.clientWidth);
				expectMask(lane, "right", 0, 0);
			}
			expect(lanes(empty)).toHaveLength(0);
		});
		await step("Short overflow scales with the hidden distance", async () => {
			const [lane] = lanes(short);
			const wrapper = short.parentElement;
			const spacer = short.querySelector("[data-workspace-tab-spacer]");
			if (!wrapper || !spacer)
				throw new Error("Missing short-overflow fixture geometry");
			// Take 8px past the spacer's base size using rendered geometry rather
			// than hard-coding glyph widths or the production spacer's flex basis.
			const spare =
				spacer.getBoundingClientRect().width -
				Number.parseFloat(getComputedStyle(spacer).flexBasis);
			wrapper.style.width = `${short.getBoundingClientRect().width - spare - 8}px`;
			await waitFor(() => {
				expect(lane.scrollWidth - lane.clientWidth).toBe(8);
				// CSS floors the paint stop; CSSOM rounds the measured range.
				expectMask(lane, "right", 0, [7, 8]);
			});
			lane.scrollLeft = lane.scrollWidth;
			await waitFor(() => expectMask(lane, "right", [7, 8], 0));
		});
	},
};
