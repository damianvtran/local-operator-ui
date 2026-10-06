/**
 * The Teams roster's summary rows (operator report, 2026-09-30: "just a list
 * view, it doesn't show a lot of information").
 *
 *     node --test scripts/org-teams-summary.test.mjs
 *
 * Four claims, each with the instrument that can falsify it.
 *
 * 1. THE HONESTY RULES ARE EXECUTED, NOT READ OFF JSX. `org-team-summary.ts`
 *    decides what the row may claim about an author's unvalidated data: a bare
 *    `v` for a missing version, `Invalid Date`, "updated" over a creation date and
 *    "3 days ago" over a timestamp from the future are all one careless
 *    expression away, so the module is bundled and called with each of them.
 *
 * 2. THE REAL ROSTER IS MOUNTED (jsdom, the shipped component, a stubbed
 *    transport) and asked the structural questions a frame cannot answer: one
 *    disclosure per row with `aria-expanded`, Pull a SIBLING of the trigger (a
 *    button in a button is invalid and swallows the click), the trigger's name
 *    carrying the description, focus staying on the trigger when a row opens,
 *    Escape closing it back to the trigger, several rows open at once, and - the
 *    reads discipline - ONE `org_teams.list` and ZERO `org_team.get` across
 *    render, hover, focus and expand. Expanding reveals fields the list already
 *    returned; the brief is detail-only and is deliberately not fetched.
 *
 * 3. THE SKELETON IS THE ROW'S BOX. jsdom measures no layout, so the height pin
 *    is source-anchored, in the precedent's own shape (`hub-pager.tsx`'s
 *    `min-h-13` and the page's `agent-hub-pager-placeholder`: "change one, change
 *    both"): both are painted from one `ROW_BOX` constant and the skeleton's line
 *    boxes are the settled lines' own type tokens. The measured heights (settled
 *    two-line row 128.47px = skeleton row 128.47px) are in the PR beside the
 *    frames.
 *
 * 4. THE EVIDENCE TABLE HAS THE STATES. Every story the PR describes is
 *    registered in the capture table and exists as a story.
 *
 * WHAT IT DOES NOT PROVE: pixels. Truncation, the un-clamp, the twelve-line
 * ceiling and Pull's alignment are layout, measured off the rendered frames.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const read = (path) => readFileSync(path, "utf8");
const FEATURE = "src/renderer/src/features/agent-hub";

const bundle = await build({
	stdin: {
		contents: `
			export * from "./${FEATURE}/components/org-team-summary";
			export { OrgTeamsList } from "./${FEATURE}/components/org-teams-list";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	// The app's config loader reads `import.meta.env` at import time.
	define: { "import.meta.env": "__viteEnv" },
	banner: { js: "const __viteEnv = {};" },
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
});
const mountPath = new URL(
	`./_org-teams-summary-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(mountPath, bundle.outputFiles[0].text);
after(async () => {
	await unlink(mountPath).catch(() => {});
});
const lib = await import(mountPath.href);

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const team = (overrides = {}) => ({
	id: "t1",
	tenant_id: "tenant-1",
	account_id: "acct-1",
	name: "Adverse media desk",
	description: "Screens onboarding subjects.",
	manager: "lead-screener",
	members: [
		{ role: "screener", kind: "role", count: 3 },
		{ role: "analyst", kind: "specialist", count: 1 },
	],
	project: "Onboarding",
	version: "1.2.0",
	created_date: new Date(NOW - 41 * DAY).toISOString(),
	updated_at: new Date(NOW - (3 * DAY + 3 * 3_600_000)).toISOString(),
	account_metadata: { name: "Ana Perez", email: "ana@example.com" },
	...overrides,
});

/* ------------------------------------------------------------- the rules */

test("member count is the sum of counts and the manager is not in it", () => {
	assert.equal(lib.memberCount(team()), 4);
	assert.equal(lib.memberCount(team({ members: [] })), 0);
	assert.equal(lib.slotList(team()), "screener ×3, analyst");
});

test("a version never prints a bare or doubled v", () => {
	assert.equal(lib.teamVersion(team({ version: "1.2.0" })), "1.2.0");
	assert.equal(lib.teamVersion(team({ version: "v1.2.0" })), "1.2.0");
	assert.equal(lib.teamVersion(team({ version: "V2" })), "2");
	assert.equal(lib.teamVersion(team({ version: "" })), null);
	assert.equal(lib.teamVersion(team({ version: "  " })), null);
	assert.equal(lib.teamVersion(team({ version: "v" })), null);
});

test("the author is a name, never an email, and absent means absent", () => {
	assert.equal(lib.teamAuthor(team()), "Ana Perez");
	assert.equal(lib.teamAuthor(team({ account_metadata: undefined })), null);
	assert.equal(
		lib.teamAuthor(
			team({ account_metadata: { name: "  ", email: "a@example.com" } }),
		),
		null,
		"an empty name is not replaced by the address",
	);
});

test("a whitespace-only description is a missing one", () => {
	assert.equal(lib.teamDescription(team({ description: " \n " })), null);
	assert.equal(lib.teamDescription(team({ description: " hi " })), "hi");
});

test("recency: updated_at only, honest fallbacks, no lies", () => {
	const three = lib.teamRecency(team(), NOW);
	assert.equal(three.label, "updated");
	assert.equal(three.when, "3 days ago");

	assert.equal(
		lib.teamRecency(
			team({ updated_at: new Date(NOW - 20_000).toISOString() }),
			NOW,
		).when,
		"just now",
		"under a minute is not a seconds counter",
	);

	const future = lib.teamRecency(
		team({ updated_at: "2026-10-02T09:00:00.000Z" }),
		NOW,
	);
	assert.equal(future.label, "updated");
	assert.equal(
		future.when,
		"2 Oct 2026",
		"a future stamp is a date, not '-2 days ago'",
	);
	assert.doesNotMatch(future.when, /ago/);

	const fallback = lib.teamRecency(team({ updated_at: "not a date" }), NOW);
	assert.equal(
		fallback.label,
		"created",
		"never 'updated' over a creation date",
	);
	assert.equal(fallback.when, "1 month ago");

	assert.equal(
		lib.teamRecency(team({ updated_at: "", created_date: "" }), NOW),
		null,
	);
	for (const bad of ["", "garbage", "0000-00-00"]) {
		const r = lib.teamRecency(
			team({ updated_at: bad, created_date: bad }),
			NOW,
		);
		assert.equal(r, null, `${JSON.stringify(bad)} yields no segment`);
	}
});

test("recency is measured against the given clock, never the wall clock", () => {
	/*
	 * M1 (agent review round 1). The distance used to come from
	 * `formatDistanceToNowStrict`, which reads the REAL clock, so the fixture's
	 * synthetic `now` governed only the label and the branch: the assertion above
	 * held until wall time crossed the half-day rounding boundary - measured, 13/13
	 * at 20:47Z and 12/13 at 20:53Z on 2026-09-30 - and the suite then failed for
	 * every run after that, by the calendar rather than by a change.
	 *
	 * The pair below is a decade from any plausible wall clock, so this cannot
	 * regress into a passing test on some future date: under the old code the
	 * distance was ~3,650 days.
	 */
	const dated = team({ updated_at: "2030-01-01T09:00:00.000Z" });
	assert.equal(
		lib.teamRecency(dated, Date.parse("2030-01-04T12:00:00.000Z")).when,
		"3 days ago",
		"the given clock decides the distance",
	);
	/* Both sides of the half-day boundary the rounding turns on. */
	const boundary = team({ updated_at: "2026-09-27T09:00:00.000Z" });
	assert.equal(
		lib.teamRecency(boundary, Date.parse("2026-09-30T20:00:00.000Z")).when,
		"3 days ago",
		"3 days 11 hours rounds down",
	);
	assert.equal(
		lib.teamRecency(boundary, Date.parse("2026-09-30T22:00:00.000Z")).when,
		"4 days ago",
		"3 days 13 hours rounds up",
	);
});

test("the announcement is bounded at rest and whole once the row is open", () => {
	const long = "x".repeat(3_000);
	assert.equal(
		lib.announcedDescription(long, false).length,
		lib.DESCRIPTION_ANNOUNCE_CHARS + 1,
		"a resting row announces the clamped lines, not the whole string",
	);
	assert.ok(lib.announcedDescription(long, false).endsWith("…"), "and says so");
	/*
	 * N3 (agent review round 2): the cut lands on a WORD boundary, not a character.
	 * The property is that the next character in the source is the space the cut
	 * backed off to - a character cut fails it, because the character at the bound
	 * is then a letter ("...adverse med", "...grouped by regim").
	 */
	/*
	 * A fixture whose words do NOT align with the bound, so the two cuts differ:
	 * a character cut stops inside "Antidisestablishmentarianism", a word cut
	 * backs off to the space before it.
	 */
	const prose = "Antidisestablishmentarianism ".repeat(20);
	const cut = lib.announcedDescription(prose, false);
	const head = cut.slice(0, -1);
	assert.equal(cut.at(-1), "…");
	assert.equal(
		prose[head.length],
		" ",
		"the cut stopped at the space it backed off to, dropping no half word",
	);
	assert.ok(head.length < lib.DESCRIPTION_ANNOUNCE_CHARS);
	assert.equal(
		prose.slice(0, head.length),
		head,
		"everything announced is a whole-word prefix of the description",
	);
	/*
	 * And the unbroken-token case above is the fallback, not an accident: a window
	 * with no space in it has no word boundary to back off to, so it cuts at the
	 * bound rather than dropping the whole announcement.
	 */
	assert.equal(
		lib.announcedDescription("x".repeat(3_000), false).length,
		lib.DESCRIPTION_ANNOUNCE_CHARS + 1,
	);
	/*
	 * The near miss (scoped-confirm round 2): a description that OPENS with a short
	 * token and then runs on has its only space near the edge, and backing off to it
	 * announced "ID…" (3 characters) and "Sanctions…" (10) - almost the whole text
	 * hidden behind an ellipsis, which reads as an empty description. The bound is
	 * still respected; the cut just stops being clever when the boundary is too
	 * early to be a word boundary worth having.
	 */
	for (const nearMiss of ["ID ", "Sanctions "]) {
		const announced = lib.announcedDescription(
			`${nearMiss}${"x".repeat(400)}`,
			false,
		);
		assert.equal(
			announced.length,
			lib.DESCRIPTION_ANNOUNCE_CHARS + 1,
			`${JSON.stringify(nearMiss)} keeps the character cut`,
		);
		assert.ok(
			announced.startsWith(nearMiss.trimEnd()),
			"and still announces the words it has",
		);
		assert.ok(
			announced.length > 100,
			"a near-edge boundary must not collapse the announcement",
		);
	}
	assert.equal(
		lib.announcedDescription(long, true),
		long,
		"opening a row is the reader asking for the whole text",
	);
	assert.equal(
		lib.announcedDescription("short", false),
		"short",
		"a short description is announced as written",
	);
});

test("exact dates for the expanded body come from the stored fields", () => {
	const dates = lib.teamDates(
		team({
			created_date: "2026-03-14T10:00:00.000Z",
			updated_at: "2026-09-25T10:00:00.000Z",
		}),
	);
	assert.equal(dates.created, "14 Mar 2026");
	assert.equal(dates.updated, "25 Sep 2026");
	assert.deepEqual(lib.teamDates(team({ created_date: "", updated_at: "x" })), {
		created: null,
		updated: null,
	});
});

test("kinds are labelled, unknown kinds are shown as stored", () => {
	assert.equal(lib.kindLabel("role"), "Role");
	assert.equal(lib.kindLabel("specialist"), "Specialist");
	assert.equal(lib.kindLabel("mystery"), "mystery");
});

/* -------------------------------------------------------- the mounted roster */

const stubTransport = (window, teams) => {
	const requests = [];
	window.api = {
		desktop: {
			request: async (request) => {
				requests.push(request.control?.operation ?? request.op);
				if (request.control?.operation === "org_teams.list") {
					return {
						status: 200,
						body: {
							result: {
								data: { msg: "Teams listed successfully", result: { teams } },
							},
						},
					};
				}
				return { status: 404, body: { detail: "not stubbed" } };
			},
		},
	};
	return requests;
};

const mountRoster = async (teams) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		pretendToBeVisual: true,
		url: "http://localhost/",
	});
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		Element: globalThis.Element,
		navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
	};
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	// A browser has `Element` as a global and the component's key handler reads it.
	globalThis.Element = dom.window.Element;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const requests = stubTransport(dom.window, teams);
	const { createRoot } = await import("react-dom/client");
	const queryClient = new lib.QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				lib.QueryClientProvider,
				{ client: queryClient },
				React.createElement(lib.OrgTeamsList, {
					tenantId: "tenant-1",
					orgName: "Minerva",
				}),
			),
		);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});
	return {
		dom,
		document: dom.window.document,
		requests,
		teardown: async () => {
			await act(async () => root.unmount());
			queryClient.clear();
			dom.window.close();
			globalThis.window = previous.window;
			globalThis.document = previous.document;
			globalThis.Element = previous.Element;
			globalThis.IS_REACT_ACT_ENVIRONMENT = false;
		},
	};
};

const fire = async (dom, element, type, init = {}) => {
	const Ctor = type.startsWith("key")
		? dom.window.KeyboardEvent
		: dom.window.MouseEvent;
	await act(async () => {
		element.dispatchEvent(
			new Ctor(type, { bubbles: true, cancelable: true, ...init }),
		);
	});
};
const click = async (dom, element) => {
	// A keyboard-shaped click (detail 0): the disclosure's own selection guard
	// treats it as a deliberate press.
	await act(async () => {
		element.dispatchEvent(
			new dom.window.MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				detail: 0,
			}),
		);
	});
};

/**
 * The accessible name, computed the one way jsdom can: the trigger's text with
 * `aria-hidden` subtrees removed - which is what a browser does for a name built
 * from content.
 *
 * M2 (agent review round 1): the separator commas ARE the pause the hidden dots
 * stood for, and deleting them left the suite green, so they are asserted rather
 * than described. M4 (round 2): the same helper is what proves the resting NAME is
 * bounded - the sr-only copy's own length cannot see the visible element losing its
 * `aria-hidden`.
 */
const accessibleName = (button) => {
	const clone = button.cloneNode(true);
	for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) {
		hidden.remove();
	}
	return clone.textContent;
};

/** A team whose description is far past the expanded ceiling (row (f) of the fixture). */
const longTeam = () =>
	team({
		id: "long",
		name: "Regulatory watch",
		// The marker sits past the announcement bound, so its presence in the name
		// would be the description arriving twice (M4).
		description: `${"This team keeps a running brief of every regulatory change. ".repeat(
			60,
		)}END-OF-DESCRIPTION`,
	});
/*
 * The roster's Pull control names the team the way every other sentence about a
 * name does (agent review round 1, m4; round 2, m1 asked for this pin). The
 * fixture is a KEBAB key, because the default name's first letter is already
 * upper case and would pass under either spelling.
 */
test("the roster's pull control paints the derived name", async () => {
	const mounted = await mountRoster([team({ id: "k", name: "data-quality" })]);
	try {
		const pull = mounted.document.querySelector(
			'button[aria-label^="Pull team"]',
		);
		assert.ok(pull, "the roster's pull control is rendered");
		assert.equal(
			pull.getAttribute("aria-label"),
			"Pull team Data Quality",
			"the derived form, not the hub's key",
		);
		/*
		 * The FAILURE sentence is a source pin instead, in
		 * `agent-hub-public-teams.test.mjs`: this harness's transport always carries
		 * a message, so the roster renders that and the fallback sentence it guards
		 * is unreachable here.
		 */
	} finally {
		await mounted.teardown();
	}
});

const ROSTER = [
	team({ id: "a", name: "Alpha", description: "Alpha does the first thing." }),
	team({
		id: "b",
		name: "Bravo",
		description: "",
		manager: "",
		project: "",
		version: "",
		members: [],
		account_metadata: undefined,
		updated_at: "",
		created_date: "",
	}),
	/*
	 * A manager and no members, with dates: the row where the expanded body must
	 * NOT repeat L3's `No members` (agent review round 1, U8).
	 */
	team({
		id: "c",
		name: "Charlie",
		manager: "desk-lead",
		members: [],
	}),
];

test("each row is one disclosure, Pull is its sibling, and the name carries the description", async () => {
	const { document, requests, teardown } = await mountRoster(ROSTER);
	try {
		const rows = [
			...document.querySelectorAll('[data-testid="org-teams"] > ul > li'),
		];
		assert.equal(rows.length, 3);
		for (const row of rows) {
			const triggers = row.querySelectorAll("button[aria-expanded]");
			assert.equal(
				triggers.length,
				1,
				"exactly one disclosure trigger per row",
			);
			assert.equal(triggers[0].getAttribute("aria-expanded"), "false");
			assert.equal(
				triggers[0].querySelectorAll("button").length,
				0,
				"no button nested in the trigger",
			);
			const pull = row.querySelector('button[aria-label^="Pull team"]');
			assert.ok(pull, "Pull is present");
			assert.equal(triggers[0].contains(pull), false, "Pull is a sibling");
		}
		const name = accessibleName(rows[0].querySelector("button[aria-expanded]"));
		assert.match(
			name,
			/Manager:\s*lead-screener\s*,\s*4 members/,
			"the composition join is audible",
		);
		assert.match(
			name,
			/Ana Perez\s*,\s*updated \d+ days ago/,
			"and so is the provenance join",
		);
		assert.match(name, /Alpha/);
		assert.match(name, /v1\.2\.0/);
		assert.match(
			name,
			/Alpha does the first thing\./,
			"the description is in the name",
		);
		assert.match(name, /Manager:\s*lead-screener/);
		assert.match(name, /4 members:\s*screener ×3, analyst/);
		assert.match(
			name,
			/Onboarding.*Ana Perez.*updated 3 days ago|updated \d+ days ago/s,
		);
		assert.doesNotMatch(name, /ana@example\.com/, "never the email");
		assert.equal(
			rows[0].querySelector("button[aria-expanded]").hasAttribute("aria-label"),
			false,
			"no triggerLabel: the row's own text is its name",
		);
		// Every separator dot is hidden from the name.
		for (const dot of rows[0].querySelectorAll("span.mx-1\\.5")) {
			assert.equal(dot.getAttribute("aria-hidden"), "true");
		}

		// The sparse row: every omission at once, no orphan dots, no placeholders
		// except the description sentence, no "Invalid Date".
		const sparse = rows[1].querySelector("button[aria-expanded]").textContent;
		assert.match(sparse, /No description/);
		assert.match(sparse, /No members/);
		assert.doesNotMatch(
			sparse,
			/Manager:|Invalid|NaN|No project|Unknown|updated|created|·/,
		);
		assert.equal(
			rows[1].querySelector(".text-ink-dim.text-meta.truncate"),
			null,
			"an empty provenance line is not rendered",
		);

		const list = requests.filter((op) => op === "org_teams.list").length;
		assert.equal(list, 1, "exactly one org_teams.list");
		assert.equal(requests.filter((op) => op === "org_team.get").length, 0);
	} finally {
		await teardown();
	}
});

test("opening a row is client-only, keeps focus on the trigger, and Escape closes back to it", async () => {
	const { dom, document, requests, teardown } = await mountRoster(ROSTER);
	try {
		const rows = [
			...document.querySelectorAll('[data-testid="org-teams"] > ul > li'),
		];
		const [first, second] = rows.map((row) =>
			row.querySelector("button[aria-expanded]"),
		);
		const before = requests.length;

		// Hover and focus read nothing.
		await fire(dom, first, "mouseover");
		first.focus();
		assert.equal(requests.length, before);

		await click(dom, first);
		assert.equal(first.getAttribute("aria-expanded"), "true");
		assert.equal(
			document.activeElement,
			first,
			"focus stays on the trigger on open",
		);
		const panel = document.getElementById(first.getAttribute("aria-controls"));
		assert.ok(panel, "aria-controls names a real panel");
		assert.match(panel.textContent, /lead-screener\s*Manager/);
		assert.match(panel.textContent, /screener\s*Role\s*×3/);
		assert.match(panel.textContent, /analyst\s*Specialist/);
		assert.doesNotMatch(panel.textContent, /×1/, "a slot of one prints no ×1");
		assert.match(
			panel.textContent,
			/Created \d+ \w+ \d{4} · Updated \d+ \w+ \d{4}/,
		);
		assert.ok(
			first.compareDocumentPosition(panel) &
				dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
			"the panel follows its trigger in DOM order",
		);
		// The description un-clamps in place.
		const description = first.querySelector(".break-words");
		assert.match(description.className, /line-clamp-\[12\]/);
		assert.match(description.className, /whitespace-pre-line/);
		assert.doesNotMatch(description.className, /line-clamp-2/);

		/*
		 * U8/D2 (design + UX round 1): the body is a BLOCK with its own statement,
		 * not a fifth summary line - a label, and the roster under it.
		 */
		assert.match(
			panel.textContent,
			/^Members/,
			"the opened body opens with its label",
		);

		// A second row opens WITHOUT closing the first.
		await click(dom, second);
		assert.equal(first.getAttribute("aria-expanded"), "true");
		assert.equal(second.getAttribute("aria-expanded"), "true");
		assert.match(
			document.getElementById(second.getAttribute("aria-controls")).textContent,
			/No members/,
			"the row with no roster AND no dates keeps the line: the chevron must not open onto nothing",
		);

		/*
		 * U8: the row that has a manager and no members does NOT repeat L3's
		 * `No members` - its body carries the manager and the dates instead.
		 */
		const third = rows[2].querySelector("button[aria-expanded]");
		await click(dom, third);
		const thirdPanel = document.getElementById(
			third.getAttribute("aria-controls"),
		);
		assert.match(thirdPanel.textContent, /desk-lead\s*Manager/);
		assert.doesNotMatch(
			thirdPanel.textContent,
			/No members/,
			"L3 already says it; the body does not repeat it",
		);
		assert.match(thirdPanel.textContent, /Created \d+ \w+ \d{4}/);

		/*
		 * D1: a member name is `ink-muted`, so it does not outshout the description
		 * it belongs to. `text-ink` here was the defect.
		 */
		for (const line of thirdPanel.querySelectorAll("li > span:first-child")) {
			assert.match(
				line.className,
				/text-ink-muted/,
				`a member line is muted ink - ${line.className}`,
			);
			assert.doesNotMatch(line.className, /(^|\s|-)text-ink(\s|$)/);
		}

		/*
		 * U5: the description is the row's SELECTABLE text, so a drag across it to
		 * copy does not toggle the row (the primitive's drag guard reads the marker).
		 */
		const selectable = first.querySelector(".break-words");
		assert.ok(selectable.hasAttribute("data-text-surface"));
		assert.match(selectable.className, /select-text/);

		/*
		 * U6: the announcement is bounded at rest. The visible element carries the
		 * whole 3,000-character string; the sr-only copy the name reads is 240.
		 */
		const long = longTeam();
		assert.ok(long.description.length > 3_000);
		const { document: longDoc, teardown: longTeardown } = await mountRoster([
			long,
		]);
		try {
			const trigger = longDoc.querySelector(
				'[data-testid="org-teams"] button[aria-expanded]',
			);
			const srOnly = trigger.querySelector(".sr-only");
			assert.ok(
				srOnly.textContent.length <= lib.DESCRIPTION_ANNOUNCE_CHARS + 1,
				`the resting announcement is bounded - ${srOnly.textContent.length}`,
			);
			/*
			 * M4 (agent review round 2): the bound above measures the sr-only copy
			 * alone, so it stayed green when the `aria-hidden` on the visible element
			 * was stripped - and with it stripped the NAME carries the description
			 * twice: measured 358 -> 3,976 characters on THIS fixture (the review's
			 * own fixture measured 3,957, and the two differ only in their name,
			 * composition and provenance lengths). This asserts the property that
			 * actually matters: the accessible name the reader hears is bounded, so
			 * removing either half of the pair turns it red.
			 */
			const restingName = accessibleName(trigger);
			assert.ok(
				restingName.length <= lib.DESCRIPTION_ANNOUNCE_CHARS + 200,
				`the resting NAME is bounded, not just the copy - ${restingName.length}`,
			);
			assert.doesNotMatch(
				restingName,
				/END-OF-DESCRIPTION/,
				"the tail past the bound does not reach the name, so the description is not in it twice",
			);
			assert.ok(
				restingName.length < long.description.length / 4,
				"the name is the announcement, not the whole description",
			);
			assert.ok(
				trigger.querySelector(".break-words").textContent.length > 3_000,
				"while the visible element still carries the whole text",
			);
		} finally {
			await longTeardown();
		}

		// Escape from the trigger, and from Pull, closes to the trigger.
		first.focus();
		await fire(dom, first, "keydown", { key: "Escape" });
		assert.equal(first.getAttribute("aria-expanded"), "false");
		assert.equal(document.activeElement, first);

		const pull = rows[1].querySelector('button[aria-label^="Pull team"]');
		pull.focus();
		await fire(dom, pull, "keydown", { key: "Escape" });
		assert.equal(second.getAttribute("aria-expanded"), "false");
		assert.equal(
			document.activeElement,
			second,
			"Escape from Pull returns to the trigger",
		);

		assert.equal(
			requests.filter((op) => op === "org_team.get").length,
			0,
			"expanding fetches no brief",
		);
		assert.equal(requests.filter((op) => op === "org_teams.list").length, 1);
	} finally {
		await teardown();
	}
});

/* ------------------------------------------------------- skeleton parity */

test("the skeleton is painted from the row's own box (change one, change both)", () => {
	const list = read(`${FEATURE}/components/org-teams-list.tsx`);
	assert.equal(
		(list.match(/const ROW_BOX = "px-4 py-3";/g) ?? []).length,
		1,
		"the box is one constant",
	);
	const skeleton = list.slice(list.indexOf("const TeamRowSkeleton"));
	const settledRow = list.slice(
		list.indexOf("{teams.map((team) => ("),
		list.indexOf("<Disclosure"),
	);
	assert.match(settledRow, /ROW_BOX/, "the settled row uses the constant");
	assert.match(
		skeleton,
		/cn\(ROW_BOX, "pl-9"\)/,
		"the skeleton uses it too, plus the chevron gutter",
	);
	/*
	 * The skeleton's line boxes are the settled lines' own: name at `text-body`,
	 * two description lines at `text-body-sm`, then two `text-meta` lines, with the
	 * same `mt-1` gaps the summary uses. `1lh` reads the real token, so the two
	 * cannot drift by a hand-kept number.
	 */
	assert.match(skeleton, /h-\[1lh\][^"]*text-body"/);
	assert.match(skeleton, /mt-1 flex h-\[2lh\][^"]*text-body-sm"/);
	assert.equal((skeleton.match(/h-\[1lh\][^"]*text-meta"/g) ?? []).length, 2);
	// Three rows, hidden from assistive tech (the page's own status line says "Loading teams…").
	assert.equal((list.match(/<TeamRowSkeleton \/>/g) ?? []).length, 3);
	assert.match(
		list,
		/aria-hidden="true"\s+className="flex flex-col divide-y divide-hairline"\s+data-testid="org-teams-loading"/,
	);
});

test("the section carries no overflow-hidden and the row keeps its hover and radii", () => {
	const list = read(`${FEATURE}/components/org-teams-list.tsx`);
	const section = list.slice(
		list.indexOf("<section"),
		list.indexOf('data-testid="org-teams"'),
	);
	assert.doesNotMatch(
		section,
		/overflow-hidden/,
		"it would clip the focus outline",
	);
	assert.match(list, /hover:bg-elevated first:rounded-t-md last:rounded-b-md/);
	assert.match(list, /className="mb-6 max-w-4xl rounded-md bg-surface"/);
	assert.doesNotMatch(list, /flex-wrap/, "Pull never wraps under the text");
});

/* ------------------------------------------------------ the evidence table */

test("every state this change describes is a registered capture and a story", () => {
	const table = read("scripts/capture-evidence.mjs");
	const stories = read(`${FEATURE}/agent-hub.stories.tsx`);
	const expected = [
		["org-teams", 1280, "OrgTeams"],
		["org-teams-narrow", 920, "OrgTeamsNarrow"],
		["org-teams-varied", 1280, "OrgTeamsVaried"],
		["org-teams-varied-narrow", 920, "OrgTeamsVariedNarrow"],
		["org-teams-expanded", 1280, "OrgTeamsExpanded"],
		["org-teams-expanded-narrow", 920, "OrgTeamsExpandedNarrow"],
		["org-teams-loading", 1280, "OrgTeamsLoading"],
	];
	for (const [id, width, exportName] of expected) {
		assert.match(
			table,
			new RegExp(`\\["agent-hub-page--${id}", ${width}, 900\\]`),
			`${id} is registered at ${width}`,
		);
		assert.match(stories, new RegExp(`export const ${exportName}\\b`));
	}
});

test("the fixture models the manager as its own field, not as a member", () => {
	const stories = read(`${FEATURE}/agent-hub.stories.tsx`);
	assert.doesNotMatch(
		stories,
		/role: "manager"/,
		"the manager is never a members[] slot",
	);
});
