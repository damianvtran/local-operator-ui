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
import { SettingsSearch, useSettingsSearchIndex } from "./settings-search";

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

const SECTIONS = [
	{
		id: "general",
		label: t("ui.settings.navigation.settings_sidebar.general_settings"),
	},
	{
		id: "appearance",
		label: t("ui.settings.navigation.settings_sidebar.appearance"),
	},
	{
		id: "keyboard",
		label: t("ui.settings.navigation.settings_sidebar.keyboard_shortcuts"),
	},
	{
		id: "providers",
		label: t("ui.settings.navigation.settings_sidebar.model_providers"),
	},
];

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
}> = ({ query, expect, focus = false, narrow = false }) => {
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
	args: { query: "thermal", expect: t("ui.settings.search.no_results.clear") },
	render: () => (
		<Scenario
			query="zzz nothing here"
			expect={t("ui.settings.search.no_results.clear")}
		/>
	),
};

/**
 * A long query in a narrow column: the no-results heading must wrap rather than
 * push the panel wider than the column it hangs under.
 */
export const LongQuery: Story = {
	args: {
		query: "retention days",
		expect: t("ui.settings.search.no_results.clear"),
	},
	parameters: { viewport: { defaultViewport: "narrow" } },
	render: () => (
		<Scenario
			narrow
			query="a very long query that is not going to match anything at all in this registry"
			expect={t("ui.settings.search.no_results.clear")}
		/>
	),
};
