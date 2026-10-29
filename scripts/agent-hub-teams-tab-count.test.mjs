/**
 * The hub's Teams tab count: the public catalogue's total, and the org roster's
 * length, on the same strip as the other two views.
 *
 *     node --test scripts/agent-hub-teams-tab-count.test.mjs
 *
 * Five claims, each measured off a rendered page rather than read off the
 * source:
 *
 * 1. THE PUBLIC COUNT IS `total_records`, NOT THE ROWS ON SCREEN. The public
 *    team catalogue is paginated, so a page of three rows under a catalogue of
 *    nine must not paint "3". The same total must appear on the library's own
 *    count line, because two observers of one query disagreeing about the
 *    number is the defect this surface exists to prevent.
 *
 * 2. ZERO IS A NUMBER. A catalogue holding no teams must render `0`, not a
 *    blank tab that reads as loading or broken.
 *
 * 3. THE COUNT FOLLOWS THE SCOPE CHIP, and each scope is ONE read: the public
 *    page observes page 1 and the library mounts on the same key, so the
 *    transport sees a single request; the org roster is read once through the
 *    credential proxy and the tab paints that roster's length (the route
 *    returns no total of its own).
 *
 * 4. THE FILTER SUPPRESSION IS THE AGENTS TAB'S, unchanged: an active search
 *    clears BOTH counts, and clearing the search brings them back.
 *
 * 5. AN UNRESOLVED OR FAILED READ RENDERS NOTHING. A tab that cannot know its
 *    number shows no number, rather than a zero it would have invented.
 *
 * WHAT THIS DOES NOT PROVE: that the live hub serves these shapes or that the
 * tab looks right. The mount is jsdom, not a browser; pixel proof belongs to
 * the evidence frames. What it does prove is the number's source, the zero
 * state, the scope switch and the single shared read - the four things the
 * change names.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const FEATURE = "src/renderer/src/features/agent-hub";

/*
 * `@shared/config` builds the app's environment at module scope and throws in a
 * bare node import ("Failed to load configuration"). The page only reads
 * `apiConfig.radientBaseUrl`, so both aliases point at the same two-name stub -
 * the subpath needs its own file because esbuild's alias rewrites by prefix.
 */
const configStubPath = new URL(
	`./_hub-teams-tab-count-config-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	configStubPath,
	`export const apiConfig = { baseUrl: "http://127.0.0.1:1", radientBaseUrl: "https://hub.test" };
	export const config = {};
	export const setDiscoveredBackendUrl = () => {};`,
);
const apiConfigStubPath = new URL(
	`./_hub-teams-tab-count-api-config-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	apiConfigStubPath,
	`export const apiConfig = { baseUrl: "http://127.0.0.1:1", radientBaseUrl: "https://hub.test" };
	export const setDiscoveredBackendUrl = () => {};`,
);
/*
 * The page reaches `shared/themes` through the UI-preferences store, whose
 * store module builds the default theme at import time. That module's only MUI
 * VALUE is `createTheme`, and leaving `@mui/material/styles` external makes
 * Node's ESM resolver refuse the package's directory import (the package is
 * bundled-style, resolved by a bundler in the app). A passthrough factory is
 * enough to build the theme object the store reads a name from; nothing in
 * this test renders MUI.
 */
const muiStubPath = new URL(
	`./_hub-teams-tab-count-mui-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	muiStubPath,
	`export const createTheme = (options) => options;
	export const ThemeProvider = ({ children }) => children;`,
);

const mountBundle = await build({
	stdin: {
		contents: `
			export { AgentHubPage } from "./${FEATURE}/agent-hub-page";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { MemoryRouter } from "react-router-dom";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared/config": configStubPath.pathname,
		"@shared/config/api-config": apiConfigStubPath.pathname,
		"@mui/material/styles": muiStubPath.pathname,
	},
	write: false,
});
/*
 * The stubs go NOW, not in a hook: both bundles have inlined them by this point,
 * and a hook can run while a parallel build is still resolving its aliases (the
 * race the public-teams suite records).
 */
await unlink(configStubPath).catch(() => {});
await unlink(apiConfigStubPath).catch(() => {});
await unlink(muiStubPath).catch(() => {});
const mountPath = new URL(
	`./_hub-teams-tab-count-mount-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(mountPath, mountBundle.outputFiles[0].text);
after(async () => {
	await unlink(mountPath).catch(() => {});
});

/** One public team row, in the list form's own shape; the card reads these. */
const teamRow = (index, over = {}) => ({
	id: `team-${String(index).padStart(3, "0")}`,
	name:
		["support-desk", "data-quality", "release-crew"][index - 1] ??
		`team-${index}`,
	description: "A published team.",
	manager: "manager",
	project: "",
	version: "1.0.0",
	members: [{ role: "researcher", kind: "agent", count: 2 }],
	account_metadata: { name: "Damian Tran" },
	created_date: "2026-10-03T11:38:21.442Z",
	updated_at: "2026-10-03T11:38:21.442Z",
	...over,
});

const rows = (count) =>
	Array.from({ length: count }, (_, index) => teamRow(index + 1));

const membership = {
	tenant_id: "org-1",
	tenant_name: "Minerva",
	role: "admin",
	status: "active",
	is_home: true,
	plan: { status: "active", seats: 4 },
};

const jsonResponse = (status, body) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
});

const ok = (result) => ({ status: 200, body: { result } });
/** The Radient proxy's two envelopes: `radientProxy` unwraps `data`. */
const proxy = (envelope) => ok({ data: envelope });

/*
 * jsdom installs these on its own `window`, while the shipped tree references
 * several by BARE identifier (`@radix-ui/react-select` reads `HTMLFormElement`
 * in a passive effect, React DOM reads `Node`/`Element` for `instanceof`), and
 * the mount bundle runs in Node's global scope. Copying them across is the
 * cheapest honest harness: the same globals a browser gives the app.
 */
const DOM_GLOBALS = [
	"HTMLElement",
	"HTMLFormElement",
	"HTMLInputElement",
	"HTMLButtonElement",
	"HTMLSelectElement",
	"HTMLAnchorElement",
	"HTMLDivElement",
	"Element",
	"Node",
	"Event",
	"MouseEvent",
	"CustomEvent",
	"KeyboardEvent",
	"FocusEvent",
	"Document",
	"DocumentFragment",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"ResizeObserver",
	"MutationObserver",
	"IntersectionObserver",
	"DOMRect",
	"navigator",
	"localStorage",
];

/** Copy the DOM globals a jsdom window owns onto `globalThis`; returns a restore. */
const installDomGlobals = (dom) => {
	const saved = new Map();
	for (const key of DOM_GLOBALS) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		let value;
		try {
			value = dom.window[key];
		} catch {
			value = undefined;
		}
		if (value === undefined) continue;
		try {
			Object.defineProperty(globalThis, key, {
				value,
				configurable: true,
				writable: true,
			});
		} catch {
			// A fixed engine global that refuses shadowing: the mount will name it if
			// it truly needed it, rather than this helper failing on an unrelated one.
		}
	}
	return () => {
		for (const [key, descriptor] of saved) {
			try {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			} catch {
				// Same rule as above: restore what can be restored.
			}
		}
	};
};

/**
 * Mount the shipped page with its desktop bridge and the public-hub fetch
 * stubbed, and the real transport, queries and components above them.
 *
 * `hub_skills` is deliberately ABSENT: this file is about the Teams tab, and
 * withholding the capability keeps the Skills tab (and its read) out of the
 * picture rather than making every assertion carry an unrelated one.
 */
const mountPage = async ({
	publicTotal = 9,
	publicPageRows = 3,
	orgTeamRows = 2,
	signedIn = false,
	withOrg = true,
	failPublicTeams = false,
	/*
	 * The agent grid's own read, held open. The browse controls (search, scope,
	 * sort) are INERT once an empty hub settles - there is no query to clear - so
	 * the filter-suppression claim needs the cold-load state, where they are on
	 * screen, to type into. That is the state a reader's first paint has anyway.
	 */
	holdAgents = false,
} = {}) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		pretendToBeVisual: true,
		url: "http://localhost/",
	});
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		fetch: globalThis.fetch,
	};
	const restoreDomGlobals = installDomGlobals(dom);
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;

	const publicTeamReads = [];
	const orgTeamReads = [];
	const bridgeReads = [];
	/*
	 * The gate a held agent read waits on, and the one call that opens it.
	 * TEARDOWN OPENS IT: a promise left pending keeps the lane's event loop alive
	 * after the last assertion, which node:test reports as the FILE failing while
	 * every test inside it passed (measured on the first run of this one).
	 */
	let openAgentsGate = () => {};
	const agentsGate = holdAgents
		? new Promise((resolve) => {
				openAgentsGate = resolve;
			})
		: Promise.resolve();

	const hubFetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname === "/v1/teams") {
			const page = Number(url.searchParams.get("page") ?? 1);
			publicTeamReads.push({
				page,
				perPage: Number(url.searchParams.get("per_page") ?? 12),
			});
			if (failPublicTeams) {
				return jsonResponse(500, { detail: "The catalogue is unavailable." });
			}
			return jsonResponse(200, {
				msg: "Teams listed successfully",
				result: {
					page,
					per_page: 12,
					// Deliberately NOT the number of rows below: the page holds a
					// short page while the catalogue's total says nine.
					total_pages: Math.max(1, Math.ceil(publicTotal / 12)),
					total_records: publicTotal,
					records: rows(publicPageRows),
				},
			});
		}
		if (url.pathname.startsWith("/v1/teams/")) {
			publicTeamReads.push({ detail: decodeURIComponent(url.pathname) });
			const id = decodeURIComponent(url.pathname.split("/v1/teams/")[1]);
			const row = rows(publicPageRows).find((team) => team.id === id);
			return jsonResponse(200, {
				msg: "Team retrieved successfully",
				result: { ...row, instructions: "Screen, then report." },
			});
		}
		throw new Error(`unexpected public-hub fetch: ${url}`);
	};
	dom.window.fetch = hubFetch;
	globalThis.fetch = hubFetch;

	const bridge = async (request) => {
		bridgeReads.push(request.op ?? request.control?.operation);
		if (request.op === "capabilities") {
			return ok({
				desktop_contract: 1,
				desktop_available: true,
				desktop_auth: "bearer",
				features: {
					radient: 1,
					radient_org: 1,
					hub_links: 1,
				},
			});
		}
		if (request.op === "hub.links") {
			return ok({ links: [], unresolved: [] });
		}
		if (request.op === "radient.request") {
			switch (request.control?.operation) {
				case "account":
					if (!signedIn) {
						return {
							status: 409,
							body: { detail: "Sign in to Radient to access your account" },
						};
					}
					return proxy({
						account: {
							id: "acct-1",
							tenant_id: "tenant-1",
							email: "dana@example.com",
							name: "Dana Whitfield",
							role: "member",
						},
						identity: {
							email: "dana@example.com",
							provider: "radient",
							provider_id: "provider-1",
						},
					});
				case "memberships.list":
					return proxy({
						msg: "Memberships listed successfully",
						result: { memberships: withOrg ? [membership] : [] },
					});
				case "agents.list":
				case "org_agents.list":
					if (holdAgents) {
						await agentsGate;
					}
					return proxy({
						msg: "Agents listed successfully",
						result: {
							page: 1,
							per_page: 12,
							total_pages: 0,
							total_records: 0,
							records: [],
						},
					});
				case "org_teams.list": {
					const tenant = request.control?.tenant_id;
					orgTeamReads.push(tenant);
					return proxy({
						msg: "Teams listed successfully",
						result: { teams: rows(orgTeamRows) },
					});
				}
				default:
					return {
						status: 404,
						body: { detail: `unknown operation ${request.control?.operation}` },
					};
			}
		}
		return { status: 404, body: { detail: `unknown op ${request.op}` } };
	};
	dom.window.api = { desktop: { request: bridge } };

	const mod = await import(mountPath.href);
	const { createRoot } = await import("react-dom/client");
	const queryClient = new mod.QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				mod.QueryClientProvider,
				{ client: queryClient },
				React.createElement(
					mod.MemoryRouter,
					null,
					React.createElement(mod.AgentHubPage),
				),
			),
		);
	});

	return {
		dom,
		queryClient,
		publicTeamReads,
		orgTeamReads,
		bridgeReads,
		teardown: async () => {
			openAgentsGate();
			await act(async () => root.unmount());
			for (const mutation of queryClient.getMutationCache().getAll()) {
				mutation.destroy();
			}
			// React Query keeps a gc timer per cached query; without this the
			// process lives ten more minutes and the suite's lane bound reads it as
			// a stall.
			queryClient.clear();
			dom.window.close();
			restoreDomGlobals();
			globalThis.window = previous.window;
			globalThis.document = previous.document;
			globalThis.fetch = previous.fetch;
			globalThis.IS_REACT_ACT_ENVIRONMENT = false;
		},
	};
};

const tab = (dom, value) =>
	dom.window.document.querySelector(`[data-testid="agent-hub-view-${value}"]`);

/** The count span inside a tab, or null when the tab rendered no number. */
const tabCount = (dom, value) =>
	tab(dom, value)?.querySelector("span")?.textContent ?? null;

/*
 * A REAL PRESS, in the order a browser sends it. Radix's `TabsTrigger`
 * activates on `mousedown` (and on focus), not on `click` alone - a bare
 * `click` event left the tab unchanged, which is how this file's sibling
 * (the skills count) first reported its library missing.
 */
const click = async (dom, element) => {
	assert.ok(element, "the control to press exists");
	await act(async () => {
		const init = { bubbles: true, cancelable: true, button: 0 };
		element.dispatchEvent(new dom.window.MouseEvent("mousedown", init));
		element.dispatchEvent(new dom.window.MouseEvent("mouseup", init));
		element.dispatchEvent(new dom.window.MouseEvent("click", init));
	});
};

/**
 * Type into a React-controlled input the way a browser does.
 *
 * Assigning `.value` directly is swallowed by React's value tracker, so the
 * native setter is called first and then the `input` event is dispatched - the
 * pair that makes React read the new value and fire `onChange`.
 */
const type = async (dom, element, value) => {
	assert.ok(element, "the input to type into exists");
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			dom.window.HTMLInputElement.prototype,
			"value",
		)?.set;
		setter?.call(element, value);
		element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
};

/**
 * Flush until `predicate` holds, or fail by name. Query settles land in
 * microtasks the render's own `act` does not flush, so every assertion after an
 * action needs this; the bound is the rig's, so a fixture that never settles
 * fails loudly rather than hanging the runner.
 *
 * THE STEP IS 20MS, NOT 0. React Query's retry delay before the second attempt
 * is a real second (its default), so a zero-delay loop expires before a 500's
 * retry has even been issued. 200 x 20ms is a four-second budget, and the
 * retry test below waits for the query's own `error` state rather than for the
 * tab, which is blank in every state before success.
 */
const settle = async (predicate, label) => {
	for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
	}
	assert.ok(predicate(), label);
};

const text = (dom) => dom.window.document.body.textContent ?? "";

/*
 * The library's count sentence, held at the top level: a regex literal inside a
 * callback is what `useTopLevelRegex` reports, and hoisting changes nothing
 * about what is asserted.
 */
const NINE_TEAMS = /9 teams in the public hub/;

test("the public Teams tab counts total_records, not the page's rows", async () => {
	const mounted = await mountPage({ publicTotal: 9, publicPageRows: 3 });
	try {
		await settle(
			() => tabCount(mounted.dom, "teams") === "9",
			"the tab carries the catalogue's total",
		);
		assert.equal(
			tab(mounted.dom, "teams")?.textContent?.startsWith("Teams"),
			true,
			"the count sits on the Teams tab, whose label it follows",
		);
		assert.equal(
			mounted.publicTeamReads.length,
			1,
			"the tab count is one read, issued before the tab is opened",
		);
		assert.deepEqual(
			mounted.publicTeamReads[0],
			{ page: 1, perPage: 12 },
			"and it observes the library's own page 1",
		);

		await click(mounted.dom, tab(mounted.dom, "teams"));
		await settle(
			() => NINE_TEAMS.test(text(mounted.dom)),
			"the library's own count line states the same total",
		);
		assert.equal(
			mounted.dom.window.document.querySelectorAll(
				'[data-testid="agent-hub-public-team"]',
			).length,
			3,
			"the page really holds fewer rows than the total it reports",
		);
		assert.equal(
			mounted.publicTeamReads.length,
			1,
			"the library's first page shares the tab's cache entry",
		);
		/*
		 * LIST entries only: a card that is not open still registers the DETAIL
		 * observer under `publicTeamKeys.detail("")`, and that disabled entry is not
		 * one of the two observers this claim is about.
		 */
		const entries = mounted.queryClient
			.getQueryCache()
			.findAll({ queryKey: ["public-teams", "list"] });
		assert.equal(
			entries.length,
			1,
			"the tab and the library are one cache entry, not two observers of two reads",
		);
		assert.deepEqual(
			entries[0].queryKey,
			["public-teams", "list", { page: 1, perPage: 12 }],
			"under the key the library's first page registers",
		);
	} finally {
		await mounted.teardown();
	}
});

test("zero renders as 0 on the tab, never as a blank tab", async () => {
	const mounted = await mountPage({ publicTotal: 0, publicPageRows: 0 });
	try {
		await settle(
			() => tabCount(mounted.dom, "teams") === "0",
			"a zero total is a rendered number",
		);
		assert.equal(
			mounted.dom.window.document.querySelectorAll(
				'[data-testid="agent-hub-public-team"]',
			).length,
			0,
			"the catalogue really is empty",
		);
		await click(mounted.dom, tab(mounted.dom, "teams"));
		await settle(
			() =>
				(
					mounted.dom.window.document.querySelector(
						'[data-testid="agent-hub-public-teams-empty"]',
					)?.textContent ?? ""
				).includes("No teams have been published"),
			"the library states the same empty catalogue",
		);
	} finally {
		await mounted.teardown();
	}
});

test("the count follows the scope chip, and each scope is one read", async () => {
	const mounted = await mountPage({
		publicTotal: 9,
		publicPageRows: 3,
		orgTeamRows: 2,
		signedIn: true,
	});
	try {
		await settle(
			() => tabCount(mounted.dom, "teams") === "9",
			"the public total is the first scope's number",
		);
		await settle(
			() =>
				mounted.dom.window.document.querySelector(
					'[data-testid="agent-hub-scope-org-org-1"]',
				) !== null,
			"the organization chip is offered to an entitled member",
		);
		const orgChip = mounted.dom.window.document.querySelector(
			'[data-testid="agent-hub-scope-org-org-1"]',
		);

		await click(mounted.dom, orgChip);
		await settle(
			() => tabCount(mounted.dom, "teams") === "2",
			"the tab follows the scope chip to the organization's roster length",
		);
		assert.deepEqual(
			mounted.orgTeamReads,
			["org-1"],
			"the org roster was read once, through the credential proxy",
		);

		await click(
			mounted.dom,
			mounted.dom.window.document.querySelector(
				'[data-testid="agent-hub-scope-public"]',
			),
		);
		await settle(
			() => tabCount(mounted.dom, "teams") === "9",
			"and back to the public total",
		);
		assert.equal(
			mounted.publicTeamReads.length,
			1,
			"the public total is still served from the scope's one cache entry",
		);
	} finally {
		await mounted.teardown();
	}
});

test("an active search clears the count, and clearing it restores the number", async () => {
	const mounted = await mountPage({
		publicTotal: 9,
		publicPageRows: 3,
		holdAgents: true,
	});
	try {
		await settle(
			() => tabCount(mounted.dom, "teams") === "9",
			"the unfiltered tab carries its number",
		);
		const search = mounted.dom.window.document.querySelector(
			'[data-testid="agent-hub-search"]',
		);
		await type(mounted.dom, search, "support");
		await settle(
			() => tabCount(mounted.dom, "teams") === null,
			"an active search suppresses the Teams count, as it does the Agents one",
		);
		assert.equal(
			tabCount(mounted.dom, "agents"),
			null,
			"the Agents tab is suppressed by the same filter",
		);

		await type(mounted.dom, search, "");
		await settle(
			() => tabCount(mounted.dom, "teams") === "9",
			"clearing the search brings the number back",
		);
	} finally {
		await mounted.teardown();
	}
});

test("a failed catalogue read leaves the tab blank, not zero", async () => {
	const mounted = await mountPage({ failPublicTeams: true });
	try {
		await settle(
			() =>
				mounted.queryClient.getQueryState([
					"public-teams",
					"list",
					{ page: 1, perPage: 12 },
				])?.status === "error",
			"the public catalogue really failed (its one retry included)",
		);
		assert.equal(
			tabCount(mounted.dom, "teams"),
			null,
			"the tab renders no number after a failure",
		);
		assert.equal(
			tab(mounted.dom, "teams")?.querySelector("span"),
			null,
			"there is no count span to misread as zero",
		);
		await click(mounted.dom, tab(mounted.dom, "teams"));
		await settle(
			() =>
				mounted.dom.window.document.querySelector(
					'[data-testid="agent-hub-public-teams-error"]',
				) !== null,
			"the library states the failure it shares",
		);
	} finally {
		await mounted.teardown();
	}
});
