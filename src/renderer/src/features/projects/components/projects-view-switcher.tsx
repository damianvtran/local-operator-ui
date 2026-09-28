/**
 * The tab's view switcher and the choice's persistence.
 *
 * THE CONTROL IS THE APP'S OWN SEGMENTED ONE: `Tabs`/`TabsList`/`TabsTrigger`
 * — whose own docstring calls the primitive "a segmented control" — rather
 * than a bespoke row of buttons, so selection reads as the same lightness step
 * every other segmented control in the app uses, and arrow keys move within
 * the group for free.
 *
 * WHERE THE CHOICE IS STORED, AND WHY NOT THE URL: `localStorage` under
 * `projects-view`, the key style the app already uses for layout choices it
 * keeps between sessions (`chat-sidebar-disclosures`, `onboarding-storage`).
 * The URL stays the tab's own two routes (`/projects`, `/projects/:projectId`)
 * — a view is how the SAME objects are drawn, not a different document, and
 * encoding it in the URL would make three addresses that all mean "the
 * projects list" (and break every existing link's meaning on a default
 * change). The design's "persisted the way the app persists layout choices"
 * is this paragraph.
 *
 * A LOCKED STORE IS NOT A VIEW CHANGE'S PROBLEM: reads and writes are guarded
 * and fall back to the default — the page must still switch views in a session
 * whose storage is unavailable.
 */

import { Tabs, TabsList, TabsTrigger } from "@shared/components/ui";
import type { FC } from "react";

export type ProjectsView = "list" | "board" | "timeline";

export const PROJECTS_VIEW_STORAGE_KEY = "projects-view";

const VIEWS: { value: ProjectsView; label: string }[] = [
	{ value: "list", label: "List" },
	{ value: "board", label: "Board" },
	{ value: "timeline", label: "Timeline" },
];

/** The stored choice, or `list` — the design's default — for anything else. */
export function readProjectsView(): ProjectsView {
	try {
		const stored = localStorage.getItem(PROJECTS_VIEW_STORAGE_KEY);
		if (stored === "board" || stored === "timeline" || stored === "list")
			return stored;
	} catch {
		/* storage unavailable: the default is the honest answer */
	}
	return "list";
}

export function writeProjectsView(view: ProjectsView): void {
	try {
		localStorage.setItem(PROJECTS_VIEW_STORAGE_KEY, view);
	} catch {
		/* see above: a failed persist must not fail the switch */
	}
}

export const ProjectsViewSwitcher: FC<{
	value: ProjectsView;
	onChange: (view: ProjectsView) => void;
}> = ({ value, onChange }) => (
	<Tabs value={value} onValueChange={(next) => onChange(next as ProjectsView)}>
		<TabsList aria-label="Project view" data-tour-tag="projects-view-switcher">
			{VIEWS.map((view) => (
				<TabsTrigger key={view.value} value={view.value}>
					{view.label}
				</TabsTrigger>
			))}
		</TabsList>
	</Tabs>
);
