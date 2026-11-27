import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
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
const noop = () => {};

function Strip({
	items,
	rtl = false,
}: { items: WorkspaceTab[]; rtl?: boolean }) {
	return (
		<div dir={rtl ? "rtl" : "ltr"} className="w-full max-w-[460px]">
			<WorkspaceTabs
				viewport={{ pinned: 0, regular: 0 }}
				tabs={items}
				activeKey={items.find((tab) => !tab.pinned)?.key}
				activeTitle={null}
				titles={titles}
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
export const OverflowRtl: Story = { args: { rtl: true } };
export const Fits: Story = { args: { items: [tabs[0], tabs[3]] } };
export const Empty: Story = { args: { items: [] } };

// Chromium owns scroll sampling. Assert the paint inputs after it samples, not
// merely that the stylesheet contains keyframes or that scrollLeft changed.
const transparentEnd = /(?:100%|calc\(100% - min\(0px, 25%\)\)), rgba?\(/;
const fade = (lane: HTMLElement) => {
	const style = getComputedStyle(lane);
	return ["start", "end"].map((edge) =>
		Number.parseFloat(
			style.getPropertyValue(`--lo-workspace-tab-fade-${edge}`),
		),
	);
};

export const ScrollFadeRegression: Story = {
	render: () => (
		<>
			<Strip items={tabs} />
			<Strip items={tabs} rtl />
			<Strip items={[tabs[0], tabs[3]]} />
			<Strip items={[]} />
			<Strip items={tabs.slice(3, 5)} />
		</>
	),
	play: async ({ canvasElement, step }) => {
		await canvasElement.ownerDocument.fonts.ready;
		const [ltr, rtl, fit, empty, short] =
			canvasElement.querySelectorAll<HTMLElement>("[data-workspace-tabs]");
		const lanes = (strip: HTMLElement) =>
			strip.querySelectorAll<HTMLElement>(laneSelector);
		for (const [strip, sign] of [
			[ltr, 1],
			[rtl, -1],
		] as const) {
			await step(sign === 1 ? "LTR lane edges" : "RTL lane edges", async () => {
				for (const lane of lanes(strip)) {
					const max = lane.scrollWidth - lane.clientWidth;
					expect(max).toBeGreaterThan(48);
					const neighbor = [...lanes(strip)].find((other) => other !== lane);
					const otherOffset = neighbor?.scrollLeft;
					const chevron = strip.querySelector("[data-workspace-more]");
					if (!chevron) throw new Error("Missing strip chevron");
					const chevronBox = chevron.getBoundingClientRect().toJSON();
					await waitFor(() => expect(fade(lane)).toEqual([0, 24]));
					lane.scrollLeft = sign * (max / 2);
					await waitFor(() => expect(fade(lane)).toEqual([24, 24]));
					lane.scrollLeft = sign * lane.scrollWidth;
					await waitFor(() => {
						const [start, end] = fade(lane);
						expect(start).toBe(24);
						expect(end).toBeLessThan(1);
						// The paint rounds the subpixel remainder away at the endpoint.
						const mask = getComputedStyle(lane).maskImage;
						expect(mask, mask).toMatch(transparentEnd);
					});
					expect(neighbor?.scrollLeft).toBe(otherOffset);
					expect(chevron.getBoundingClientRect().toJSON()).toEqual(chevronBox);
					expect(getComputedStyle(chevron).maskImage).toBe("none");
					expect(getComputedStyle(lane).maskImage).toContain(
						sign === 1 ? "to right" : "to left",
					);
					lane.scrollLeft = 0;
				}
			});
		}
		await step("Fitting and empty lanes have no fade", async () => {
			for (const lane of lanes(fit)) {
				expect(lane.scrollWidth).toBe(lane.clientWidth);
				expect(fade(lane)).toEqual([0, 0]);
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
				const [start, end] = fade(lane);
				expect(start).toBe(0);
				expect(end).toBeCloseTo(8, 0);
			});
			lane.scrollLeft = lane.scrollWidth;
			await waitFor(() => {
				const [start, end] = fade(lane);
				expect(start).toBeCloseTo(8, 0);
				expect(end).toBeLessThan(1);
				expect(getComputedStyle(lane).maskImage).toMatch(transparentEnd);
			});
		});
	},
};
