/**
 * The hub's Skills tab count: the catalogue's own total, in both scopes.
 *
 *     node --test scripts/agent-hub-skills-tab-count.test.mjs
 *
 * Four claims, each measured off a rendered page rather than read off the
 * source:
 *
 * 1. THE PUBLIC COUNT IS `total_records`, NOT THE ROWS ON SCREEN. The public
 *    skill catalogue is paginated, so a page of five rows under a catalogue of
 *    fourteen must not paint "5". The same total must appear on the library's
 *    own count line, because two observers of one query disagreeing about the
 *    number is the defect this surface exists to prevent.
 *
 * 2. ZERO IS A NUMBER. The public catalogue held exactly zero records when this
 *    count was added, and a tab that went blank read as loading or broken. The
 *    tab must carry `0`.
 *
 * 3. THE ORG COUNT IS THE UNPAGINATED CATALOGUE'S LENGTH. The organization
 *    route returns every skill in one answer, so six skills is six. That read
 *    rides the credential proxy and must not be issued for a signed-out viewer.
 *
 * 4. THE COUNT FOLLOWS THE SCOPE CHIP, and both observers of one scope share ONE
 *    read: the page observes page 1 for the tab, the library mounts on the same
 *    key, and the transport sees a single request per scope.
 *
 * WHAT THIS DOES NOT PROVE: that the live hub serves these shapes or that the
 * tab looks right. The mount is jsdom, not a browser; pixel proof belongs to the
 * evidence frames. What it does prove is the number's source, the zero state and
 * the scope switch - the three things the operator's report named.
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
	`./_hub-skills-tab-count-config-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	configStubPath,
	`export const apiConfig = { baseUrl: "http://127.0.0.1:1", radientBaseUrl: "https://hub.test" };
	export const config = {};
	export const setDiscoveredBackendUrl = () => {};`,
);
const apiConfigStubPath = new URL(
	`./_hub-skills-tab-count-api-config-${process.pid}.mjs`,
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
	`./_hub-skills-tab-count-mui-${process.pid}.mjs`,
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
	`./_hub-skills-tab-count-mount-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(mountPath, mountBundle.outputFiles[0].text);
after(async () => {
	await unlink(mountPath).catch(() => {});
});

/** One hub skill row, in the wire's own shape; the card reads these fields. */
const skillRow = (index, over = {}) => ({
	id: `skill-${String(index).padStart(3, "0")}`,
	name: `Catalogue skill ${index}`,
	description: "A skill in the catalogue.",
	document_version: 1,
	visibility: "public",
	content_revision: 1,
	revision: `"rev-${index}"`,
	sync_contract: { revision_cas: 1, skills: 1 },
	...over,
});

const rows = (count) =>
	Array.from({ length: count }, (_, index) => skillRow(index + 1));

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
 */
const mountPage = async ({
	publicTotal = 14,
	publicRows = 5,
	orgSkills = 6,
	signedIn = false,
	withOrg = true,
	failPublicSkills = false,
	skillsCapability = true,
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

	const publicSkillReads = [];
	const orgSkillReads = [];
	const bridgeReads = [];

	const hubFetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname === "/v1/skills") {
			const page = Number(url.searchParams.get("page") ?? 1);
			publicSkillReads.push(page);
			if (failPublicSkills) {
				return jsonResponse(500, { detail: "The catalogue is unavailable." });
			}
			return jsonResponse(200, {
				msg: "Skills listed successfully",
				result: {
					page,
					per_page: 20,
					// Deliberately NOT the number of rows below: the page holds a
					// short page while the catalogue's total says fourteen.
					total_pages: Math.max(1, Math.ceil(publicTotal / 20)),
					total_records: publicTotal,
					records: rows(publicRows),
					sync_contract: { revision_cas: 1, skills: 1 },
				},
			});
		}
		/*
		 * THE PAGE READS THE PUBLIC TEAM CATALOGUE TOO, for the Teams tab count
		 * (the sibling `agent-hub-teams-tab-count` suite tests that behaviour). This
		 * harness mounts the whole page, so it answers the read: without an arm here
		 * every mount issues a request that lands in the catch-all, and its retry
		 * timer outlives the assertions.
		 */
		if (url.pathname === "/v1/teams") {
			return jsonResponse(200, {
				msg: "Teams listed successfully",
				result: {
					page: 1,
					per_page: 12,
					total_pages: 0,
					total_records: 0,
					records: [],
				},
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
					...(skillsCapability ? { hub_skills: 1 } : {}),
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
				case "org_teams.list":
					return proxy({
						msg: "Teams listed successfully",
						result: { teams: [] },
					});
				case "org_skills.list": {
					const tenant = request.control?.tenant_id;
					orgSkillReads.push(tenant);
					const orgRows = rows(orgSkills).map((row) => ({
						...row,
						visibility: "org",
						tenant_id: tenant,
					}));
					return proxy({
						msg: "Skills listed successfully",
						result: {
							skills: orgRows,
							sync_contract: { revision_cas: 1, skills: 1 },
						},
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
		publicSkillReads,
		orgSkillReads,
		bridgeReads,
		teardown: async () => {
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
 * `click` event left the tab unchanged and the library unmounted, which is how
 * this file's first run reported "the library's count line" missing.
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
 * Flush until `predicate` holds, or fail by name. Query settles land in
 * microtasks the render's own `act` does not flush, so every assertion after an
 * action needs this; the bound is the rig's, so a fixture that never settles
 * fails loudly rather than hanging the runner.
 *
 * THE WAIT IS 20MS, NOT 0. React Query's retry delay before the second attempt
 * is a real second (its default), so a zero-delay loop expires before a 500's
 * retry has even been issued - measured: the failed-catalogue test settled on
 * "still pending" at ~0.5s and then left the retry timer armed at teardown, which
 * kept the whole lane's event loop alive. 200 x 20ms is a four-second budget.
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
 * The library's count sentences, held at the top level: a regex literal inside
 * a callback is what `useTopLevelRegex` reports, and hoisting changes nothing
 * about what is asserted.
 */
const FOURTEEN_SKILLS = /14 skills/;
const ZERO_SKILLS = /0 skills/;
const SIX_SKILLS_SHARED = /6 skills shared with Minerva/;

test("the public Skills tab counts total_records, not the page's rows", async () => {
	const mounted = await mountPage({ publicTotal: 14, publicRows: 5 });
	try {
		await settle(
			() => tabCount(mounted.dom, "skills") === "14",
			"the tab carries the catalogue's total",
		);
		assert.equal(
			tab(mounted.dom, "skills")?.textContent?.startsWith("Skills"),
			true,
			"the count sits on the Skills tab, whose label it follows",
		);
		assert.equal(
			mounted.publicSkillReads.length,
			1,
			"the tab count is one read, issued before the tab is opened",
		);

		await click(mounted.dom, tab(mounted.dom, "skills"));
		await settle(
			() => FOURTEEN_SKILLS.test(text(mounted.dom)),
			"the library's own count line states the same total",
		);
		const rendered = mounted.dom.window.document.querySelectorAll(
			'[data-testid="hub-skill-open"]',
		);
		assert.equal(
			rendered.length,
			5,
			"the page really holds fewer rows than the total it reports",
		);
		assert.equal(
			mounted.publicSkillReads.length,
			1,
			"the library's first page shares the tab's cache entry",
		);
	} finally {
		await mounted.teardown();
	}
});

test("zero renders as 0 on the tab, never as a blank tab", async () => {
	const mounted = await mountPage({ publicTotal: 0, publicRows: 0 });
	try {
		await settle(
			() => tabCount(mounted.dom, "skills") === "0",
			"a zero total is a rendered number",
		);
		assert.equal(
			mounted.dom.window.document.querySelectorAll(
				'[data-testid="hub-skill-open"]',
			).length,
			0,
			"the catalogue really is empty",
		);
		await click(mounted.dom, tab(mounted.dom, "skills"));
		await settle(
			() => ZERO_SKILLS.test(text(mounted.dom)),
			"the library states the same zero",
		);
	} finally {
		await mounted.teardown();
	}
});

test("a failed catalogue paints no number at all, not 0 and not a stale one", async () => {
	const mounted = await mountPage({ failPublicSkills: true });
	try {
		await settle(() => {
			const queries = mounted.queryClient
				.getQueryCache()
				.findAll({ queryKey: ["hub-skills"] });
			return (
				queries.length > 0 &&
				queries.every((query) => query.state.status === "error")
			);
		}, "the catalogue read failed");
		assert.ok(
			mounted.publicSkillReads.length >= 1,
			"the read was attempted rather than skipped",
		);
		assert.equal(
			tabCount(mounted.dom, "skills"),
			null,
			"the tab renders no number after a failure",
		);
		assert.equal(
			tab(mounted.dom, "skills")?.querySelector("span"),
			null,
			"there is no count span to misread as zero",
		);
	} finally {
		await mounted.teardown();
	}
});

test("without the hub_skills capability there is no tab and no catalogue read", async () => {
	const mounted = await mountPage({ skillsCapability: false });
	try {
		await settle(
			() =>
				mounted.queryClient.getQueryState(["desktop", "capabilities"])
					?.status === "success",
			"capabilities answered",
		);
		/* Give a page-mount read every chance to start before saying it did not. */
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
		assert.equal(
			tab(mounted.dom, "skills"),
			null,
			"a backend without the capability gets no Skills tab",
		);
		assert.equal(
			mounted.publicSkillReads.length,
			0,
			"and no public catalogue read is issued for a tab that does not exist",
		);
		assert.equal(
			mounted.bridgeReads.includes("org_skills.list"),
			false,
			"nor an org catalogue read",
		);
	} finally {
		await mounted.teardown();
	}
});

test("the org scope counts the unpaginated catalogue, and the count follows the chip", async () => {
	const mounted = await mountPage({
		publicTotal: 14,
		publicRows: 5,
		orgSkills: 6,
		signedIn: true,
	});
	try {
		await settle(
			() => tabCount(mounted.dom, "skills") === "14",
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
			() => tabCount(mounted.dom, "skills") === "6",
			"the tab follows the scope chip to the organization's total",
		);
		assert.deepEqual(
			mounted.orgSkillReads,
			["org-1"],
			"the org catalogue was read once, through the credential proxy",
		);

		await click(mounted.dom, tab(mounted.dom, "skills"));
		await settle(
			() => SIX_SKILLS_SHARED.test(text(mounted.dom)),
			"the library's count line agrees with the tab in the org scope",
		);
		assert.equal(
			mounted.orgSkillReads.length,
			1,
			"the library's mount reuses the tab's org read",
		);
		assert.equal(
			mounted.dom.window.document.querySelectorAll(
				'[data-testid="hub-skill-open"]',
			).length,
			6,
			"six skills are on screen",
		);

		await click(
			mounted.dom,
			mounted.dom.window.document.querySelector(
				'[data-testid="agent-hub-scope-public"]',
			),
		);
		await settle(
			() => tabCount(mounted.dom, "skills") === "14",
			"and back to the public total",
		);
		assert.equal(
			mounted.publicSkillReads.length,
			1,
			"the public total is still served from the scope's one cache entry",
		);
	} finally {
		await mounted.teardown();
	}
});

test("a signed-out viewer never issues the org catalogue read", async () => {
	const mounted = await mountPage({
		publicTotal: 14,
		publicRows: 5,
		signedIn: false,
	});
	try {
		await settle(
			() => tabCount(mounted.dom, "skills") === "14",
			"the public count is available without a credential",
		);
		assert.equal(
			mounted.orgSkillReads.length,
			0,
			"the credential proxy was never asked for a private catalogue",
		);
		assert.equal(
			mounted.dom.window.document.querySelector(
				'[data-testid="agent-hub-scope-org-org-1"]',
			),
			null,
			"no organization chip exists to switch to",
		);
	} finally {
		await mounted.teardown();
	}
});
