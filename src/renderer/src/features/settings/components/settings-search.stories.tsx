/**
 * The Settings page's search, in the states the design review has to judge:
 * its empty state, results with reasons and section headings (in both faces),
 * no results, and a long query in a narrow column.
 *
 * WHY A STORY AND NOT A RIG. The one thing a browser cannot supply is
 * `window.api.desktop.request` — the preload bridge the settings queries go
 * through — so every frame would photograph a transport error rather than the
 * search. The stub below is `backend-settings.stories.tsx`'s pattern: it answers
 * `settings.list` with the REAL committed projection
 * (`scripts/fixtures/backend-settings-registry.json`), which is why the labels,
 * help sentences and section titles in these frames are the backend's own copy
 * rather than invented ones.
 *
 * THE GROUND IS THE PAGE'S. The field sits in the same `max-w-4xl` content
 * column the settings page renders, on `bg-canvas`, because the design question
 * is how it reads beside a page header — not how it reads floating on a
 * storybook default. The theme is NOT set here: it comes from the preview's
 * `theme` arg (`?args=theme:<id>`), so a dark frame is the theme system's
 * answer, not a story's guess.
 *
 * THE QUERY IS DRIVEN THE WAY A READER TYPES IT. The driven stories set the
 * input's value and dispatch the `input` event (the product's own handler), then
 * hold the shutter (`documentElement.dataset.capturePending`) until the text
 * they claim to show is on screen — the contract `app-updates-section.stories.tsx`
 * documents. A story whose state never arrives fails the sweep rather than
 * committing a picture of an untouched field.
 */

import { PageHeader } from "@shared/components/common/page-header";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { Settings } from "lucide-react";
import { type FC, useLayoutEffect, useMemo } from "react";
import fixtureJson from "../../../../../../scripts/fixtures/backend-settings-registry.json";
import type { BackendSettings } from "../../../../../shared/desktop-contract";
import { searchSettings } from "../search/settings-search-match";
import {
	LONG_NO_MATCH_QUERY,
	NO_MATCH_QUERY,
} from "../search/settings-search.fixtures";
import { SettingsSearch, useSettingsSearchIndex } from "./settings-search";
import { DEFAULT_SETTINGS_SECTIONS } from "./settings-sidebar";

const payload = fixtureJson as unknown as Pick<
	BackendSettings,
	"sections" | "settings"
>;

/*
 * The bridge, stubbed for the two ops these frames can reach. `capabilities` is
 * what unlocks the settings feature flag; `settings.list` is the payload the
 * index is built from. Anything else is answered with an empty 200 so a stray
 * query cannot turn a frame into an error state.
 */
if (typeof window !== "undefined") {
	window.api = window.api ?? {};
	window.api.desktop = {
		request: async (request: { op: string }) => {
			if (request.op === "capabilities") {
				return {
					status: 200,
					body: {
						status: 200,
						message: "ok",
						result: {
							desktop_contract: 1,
							desktop_available: true,
							desktop_auth: "bearer",
							features: { settings: 1 },
						},
					},
				};
			}
			if (request.op === "settings.list") {
				return {
					status: 200,
					body: { status: 200, message: "ok", result: payload },
				};
			}
			return { status: 200, body: { status: 200, message: "ok", result: {} } };
		},
	} as never;
}

/*
 * THE PAGE'S OWN SIDEBAR LIST, not a hand-written four-entry stub.
 *
 * A stub of four sections meant the frame could not render the thing this round
 * fixed: every registry row's destination is `backend`, which the stub omitted,
 * so no `[role="group"]` heading and no "In Backend settings" line ever appeared
 * in a frame (design round 2, D10). `DEFAULT_SETTINGS_SECTIONS` is the exact
 * array the page filters and hands to the index — eleven entries, in the rail's
 * documented order, with `t()`-backed labels — so the story and the page cannot
 * disagree about what a section is called.
 */
const SECTIONS = DEFAULT_SETTINGS_SECTIONS;

/**
 * The page's own content column, at the width the settings page uses.
 *
 * `p-8` and `gap-8` are the page's, not a story's: the frames are meant to be
 * compared against the live surface, and a different gutter would make every
 * alignment judgement a judgement about this file.
 */
const Frame: FC<{
	children: React.ReactNode;
	/**
	 * The content column's own width, so the narrow story can name its measure.
	 * (`className`, not `column`: it is a width override on the column div.)
	 */
	className?: string;
}> = ({ children, className }) => (
	<div className="min-h-screen bg-canvas">
		<div className="mx-auto flex w-full flex-col gap-8">
			<div className={cn("p-8", className)}>
				{/*
				 * The PAGE's own header component, not a stand-in: the hand-written
				 * title row wrapped differently from `PageHeader` at a narrow width,
				 * which made the narrow frame a photograph of a composition the
				 * product may not reach (design D6). `PageHeader` is the same
				 * `flex-wrap items-start justify-between` row the settings page
				 * mounts, and the field is its action slot exactly as it ships.
				 */}
				<PageHeader title={t("ui.settings.page.title")} icon={Settings}>
					{children}
				</PageHeader>
			</div>
			<div className="flex flex-col gap-3 px-8">
				<div className="h-5 w-40 rounded-sm bg-sunken" />
				<div className="h-4 w-full max-w-xl rounded-sm bg-sunken" />
				<div className="mt-4 h-32 w-full rounded-md bg-surface" />
			</div>
		</div>
	</div>
);

/**
 * One scenario: the index the page builds, a query, and a shutter hold.
 *
 * `focus` opens the panel the way a reader does — the component opens it on
 * focus — which is the only way the EMPTY state ("what this box searches" plus
 * the chord) is ever on screen. Without it the idle frame photographed a field
 * at rest and the docstring's claim was a caption the pixels did not carry
 * (design D5).
 */
const Scenario: FC<{
	query: string;
	expect: string;
	focus?: boolean;
	/** A 420px column: below the app's 800px window floor, a wrapping probe. */
	narrow?: boolean;
	/**
	 * This story CLAIMS its query matches nothing. The claim is checked against
	 * the exact index the frame renders — with the page's real sidebar sections
	 * — before the shutter opens, so a corpus change that turns the query into a
	 * hit refuses the frame instead of committing a caption the pixels
	 * contradict (design round 2, D11).
	 */
	expectNoResults?: boolean;
}> = ({
	query,
	expect,
	focus = false,
	narrow = false,
	expectNoResults = false,
}) => {
	const index = useSettingsSearchIndex({
		registry: payload,
		sections: SECTIONS,
	});
	// The frames never press Enter, so every jump is a landing.
	const onJump = useMemo(() => () => "landed" as const, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a story drives its state ONCE on mount; re-running on `focus`/`expect` would re-type a query the harness already settled.
	useLayoutEffect(() => {
		if (focus) {
			document.documentElement.dataset.capturePending = "1";
			let focused = false;
			const focusField = async () => {
				for (let i = 0; i < 60 && !focused; i++) {
					const field =
						document.querySelector<HTMLInputElement>('[role="combobox"]');
					if (field) {
						field.focus();
						focused = document.body.textContent?.includes(
							t("ui.settings.search.empty.summary"),
						);
						if (focused) break;
					}
					await new Promise((resolve) =>
						requestAnimationFrame(() => resolve(null)),
					);
				}
				await new Promise((resolve) =>
					requestAnimationFrame(() => resolve(null)),
				);
				delete document.documentElement.dataset.capturePending;
			};
			void focusField();
			return () => {
				delete document.documentElement.dataset.capturePending;
			};
		}
		if (!query) return undefined;
		if (expectNoResults) {
			const total = searchSettings(index, query, 500).total;
			if (total !== 0) {
				throw new Error(
					`[settings-search story] "${query}" matches ${total} row(s); this story claims none. Pick a query from settings-search.fixtures.ts.`,
				);
			}
		}
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		const settle = async () => {
			for (let i = 0; i < 60; i++) {
				const field =
					document.querySelector<HTMLInputElement>('[role="combobox"]');
				if (field) {
					const setter = Object.getOwnPropertyDescriptor(
						HTMLInputElement.prototype,
						"value",
					)?.set;
					setter?.call(field, query);
					field.dispatchEvent(new Event("input", { bubbles: true }));
				}
				await new Promise((resolve) =>
					requestAnimationFrame(() => resolve(null)),
				);
				if (document.body.textContent?.includes(expect)) break;
			}
			await new Promise((resolve) =>
				requestAnimationFrame(() => resolve(null)),
			);
			if (!cancelled) delete document.documentElement.dataset.capturePending;
		};
		void settle();
		return () => {
			cancelled = true;
			delete document.documentElement.dataset.capturePending;
		};
	}, [query, expect]);

	return (
		<Frame className={narrow ? "w-full max-w-[420px] p-4" : "w-full max-w-4xl"}>
			<SettingsSearch index={index} onJump={onJump} className="ms-auto" />
		</Frame>
	);
};

const meta = {
	title: "Settings/Search",
	component: Scenario,
	parameters: {
		layout: "fullscreen",
	},
	argTypes: {
		query: { control: "text" },
		expect: { control: "text" },
	},
} satisfies Meta<typeof Scenario>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * No query, panel open: what the box searches, and the chord that opens it.
 *
 * The field is FOCUSED so the panel is on screen — that is the state a reader
 * meets on the first keystroke, and the only way these two lines are ever
 * photographed (design D5).
 */
export const Idle: Story = {
	args: { query: "", expect: "", focus: true },
	render: () => <Scenario query="" expect="" focus />,
};

/** Results, with each row's section and the field that actually matched. */
export const Results: Story = {
	args: { query: "theme", expect: t("ui.settings.search.reason.label") },
	render: () => (
		<Scenario query="theme" expect={t("ui.settings.search.reason.label")} />
	),
};

/*
 * There is no `ResultsDark`. The preview reads the theme from the ARG
 * (`?args=theme:<id>`), never from `parameters.theme`, so that story was
 * byte-identical to `Results` in both themes — the sweep photographs every
 * story in every theme already (design D4).
 */

/** A query that finds nothing: the quote, one way out, no dead end. */
export const NoResults: Story = {
	args: {
		query: NO_MATCH_QUERY,
		expect: t("ui.settings.search.no_results.clear"),
	},
	render: () => (
		<Scenario
			expectNoResults
			query={NO_MATCH_QUERY}
			expect={t("ui.settings.search.no_results.clear")}
		/>
	),
};

/**
 * A long query in a narrow column: the no-results heading must wrap rather than
 * push the panel wider than the column it hangs under.
 *
 * The query is a fixture constant, not a sentence: round 1's sentence matched
 * nothing until choice descriptions were folded, and then it matched the theme
 * row — a caption the pixels no longer carried (design round 2, D11). It is
 * asserted zero on this very index before the shutter opens.
 */
export const LongQuery: Story = {
	args: {
		query: LONG_NO_MATCH_QUERY,
		expect: t("ui.settings.search.no_results.clear"),
	},
	parameters: { viewport: { defaultViewport: "narrow" } },
	render: () => (
		<Scenario
			narrow
			expectNoResults
			query={LONG_NO_MATCH_QUERY}
			expect={t("ui.settings.search.no_results.clear")}
		/>
	),
};
