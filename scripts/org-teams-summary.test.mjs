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
];

test("each row is one disclosure, Pull is its sibling, and the name carries the description", async () => {
	const { document, requests, teardown } = await mountRoster(ROSTER);
	try {
		const rows = [
			...document.querySelectorAll('[data-testid="org-teams"] > ul > li'),
		];
		assert.equal(rows.length, 2);
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
		const name = rows[0].querySelector("button[aria-expanded]").textContent;
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

		// A second row opens WITHOUT closing the first.
		await click(dom, second);
		assert.equal(first.getAttribute("aria-expanded"), "true");
		assert.equal(second.getAttribute("aria-expanded"), "true");
		assert.match(
			document.getElementById(second.getAttribute("aria-controls")).textContent,
			/No members/,
		);

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
