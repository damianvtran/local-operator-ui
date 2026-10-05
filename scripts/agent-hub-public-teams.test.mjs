/**
 * The public teams library: the anonymous read, the display name, and what the
 * catalogue does with the rows it fetched.
 *
 *     node --test scripts/agent-hub-public-teams.test.mjs
 *
 * Five claims, each with the instrument that can falsify it.
 *
 * 1. THE DISPLAY NAME IS THE RUNTIME'S DERIVATION, NOT A SECOND ONE. The hub
 *    carries no label field, so every listing derives the human spelling from
 *    the key. The derivation asserted here is copied from
 *    `local_operator/display_labels.py` (`default_label`), including the case a
 *    reader is most likely to get wrong: an initialism token keeps its upper
 *    case (`qa-tester` -> `QA Tester`). The one deliberate DIVERGENCE from the
 *    core's composition is that the hub does NOT fall back to the raw key when
 *    the derived form differs only in case: `mathematician` reads
 *    `Mathematician` here, because the core's raw-key arm protects a LOCAL row
 *    that has a stored-label field, and a hub row has none.
 *
 * 2. THE PUBLIC READ IS ANONYMOUS AND CARRIES NO BEARER. `listPublicTeams` and
 *    `getPublicTeam` are the one hub path that does not ride the desktop proxy,
 *    and the claim that makes that safe is asserted rather than asserted-to: the
 *    request carries no Authorization header, asks the hub's own `/v1/teams`
 *    route, and refuses a redirect (following one would render another origin's
 *    rows as the public hub).
 *
 * 3. A FAILURE IS A TYPED ONE. A non-2xx and an unreadable body raise
 *    `PublicHubError` with the status the retry policy reads, and a transport
 *    failure raises it with a NULL status — which is what tells "the hub refused"
 *    from "the hub was never reached".
 *
 * 4. THE HOOK REGISTERS THE KEY ITS BUILDER PRODUCES, and the DETAIL key is the
 *    id's. Mounted against a real `QueryClient`: the list hook's key is compared
 *    with `publicTeamKeys.list(...)`, and a page change registers a different
 *    one (the agent list's own defect — a hook keying an inline array while a
 *    builder existed — is the reason this is measured rather than read).
 *
 * 5. THE CATALOGUE FILTERS AND THE BRIEF IS A READ. Mounted in jsdom against
 *    both transports: typing in the box narrows the rendered rows without a
 *    second request, and opening a row issues exactly ONE `getPublicTeam` — the
 *    brief is the one field the list form omits, so the expand is where that
 *    read belongs.
 *
 * WHAT IT DOES NOT PROVE: that the live hub serves the shape these fixtures use
 * (the frames against the real hub do), or that the surface renders as designed
 * (the frames do). The mounts below are jsdom, not a browser: they prove keys,
 * requests and text, and nothing about pixels.
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

/* ------------------------------------------------------ 1. the display name */

/*
 * The bundled helper and the API module, in one data: URL. Both are pure enough
 * to import without a DOM; the module's own `@shared/config` import is aliased
 * away because it builds the app's environment at module scope and throws in a
 * bare node import (measured: "Failed to load configuration").
 */
const configStubPath = new URL(
	`./_public-teams-config-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	configStubPath,
	`export const apiConfig = { baseUrl: "http://127.0.0.1:1", radientBaseUrl: "https://hub.test" };
	export const config = {};`,
);
/* `@shared/config/api-config` is a SUBPATH of the alias above, and esbuild's
 * alias rewrites by prefix — so the subpath needs its own stub or the rewrite
 * points at `<stub-file>/api-config`. Only the two names the app reads. */
const apiConfigStubPath = new URL(
	`./_public-teams-api-config-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	apiConfigStubPath,
	`export const apiConfig = { baseUrl: "http://127.0.0.1:1", radientBaseUrl: "https://hub.test" };
	export const setDiscoveredBackendUrl = () => {};`,
);
const apiBundle = await build({
	stdin: {
		contents: `
			export { hubDisplayName, deriveHubDisplayName, normalizeHubKey } from "./${FEATURE}/display-name";
			export { listPublicTeams, getPublicTeam, PublicHubError } from "@shared/api/radient/agents-api";
			export { publicHubFailureMessage } from "./${FEATURE}/public-hub-failure";
			export { retryPublicHubQuery } from "./${FEATURE}/hooks/use-public-teams-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@shared/config": configStubPath.pathname,
		"@shared/config/api-config": apiConfigStubPath.pathname,
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});
const apiSource = apiBundle.outputFiles[0].text;
const loadApi = () =>
	import(
		`data:text/javascript;base64,${Buffer.from(apiSource).toString("base64")}#${Math.random()}`
	);

/*
 * The cases are the runtime's own, and each names the module it came from so a
 * reader can check the rule rather than the test.
 */
const DISPLAY_NAME_CASES = [
	// `default_label` splits on [._-] and Title Cases each token ...
	[
		"data-quality",
		"Data Quality",
		"a separator is information the key cannot carry",
	],
	["content-writer", "Content Writer", "the public catalogue's own keys"],
	["engineering-platform", "Engineering Platform", "three tokens"],
	[
		"local_operator-development",
		"Local Operator Development",
		"an underscore separates too",
	],
	["content.writer", "Content Writer", "so does a dot"],
	// ... except the initialisms, which stay upper-cased.
	["qa-tester", "QA Tester", "an initialism token is not Title Cased"],
	["ux-reviewer", "UX Reviewer", "one of the six"],
	/*
	 * THE DIVERGENCE FROM THE CORE'S COMPOSITION, case by case: the core's
	 * teams arm drops a derived form that differs from the key only in case,
	 * because a LOCAL row's key is all anybody chose and it has a label field
	 * for the case a human does choose. The hub has no label field, so the
	 * derived form IS the display and the raw-key arm would leave `content`
	 * lowercase between two Title-Case siblings.
	 */
	["mathematician", "Mathematician", "the hub paints the derivation, always"],
	["ui", "UI", "an initialism alone is upper-cased, not left raw"],
	["content", "Content", "the live catalogue's one-token keys"],
	[
		"investigations",
		"Investigations",
		"the same, and the frame a manager read",
	],
	["aida", "Aida", "a single token is still Title Cased"],
	["support-desk", "Support Desk", "the live catalogue's own spelling"],
];

test("the display-name rule is the runtime's, case by case", async () => {
	const { hubDisplayName } = await loadApi();
	for (const [key, expected, why] of DISPLAY_NAME_CASES) {
		assert.equal(hubDisplayName(key), expected, `${key}: ${why}`);
	}
	assert.equal(hubDisplayName(""), "", "the empty key is not a crash");
	// The derived form is exported for the pinned cases above to be readable
	// against the runtime's module rather than against the composition.
	const { deriveHubDisplayName } = await loadApi();
	assert.equal(deriveHubDisplayName("qa-tester"), "QA Tester");
	assert.equal(deriveHubDisplayName("mathematician"), "Mathematician");
});

/* ------------------------------------------------------ 2/3. the public read */

/** A `fetch` stub that records what it was asked and answers one envelope. */
const stubFetch = (handler) => {
	const calls = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		return handler(String(url), init);
	};
	return {
		calls,
		restore: () => {
			globalThis.fetch = original;
		},
	};
};

const jsonResponse = (status, body) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
});

test("listPublicTeams asks the hub's public route, anonymously, and paginates", async () => {
	const { listPublicTeams } = await loadApi();
	const stub = stubFetch(async () =>
		jsonResponse(200, {
			msg: "Teams listed successfully",
			result: {
				page: 2,
				per_page: 12,
				records: [{ id: "t", name: "data-quality" }],
				total_pages: 3,
				total_records: 30,
			},
		}),
	);
	try {
		const envelope = await listPublicTeams("https://api.radienthq.com", 2, 12);
		assert.equal(stub.calls.length, 1);
		assert.equal(
			stub.calls[0].url,
			"https://api.radienthq.com/v1/teams?page=2&per_page=12",
			"the hub's own route, with the page it asked for",
		);
		assert.equal(stub.calls[0].init.method, "GET");
		assert.equal(
			stub.calls[0].init.redirect,
			"error",
			"a followed redirect would render another origin's rows as the public hub",
		);
		const headers = stub.calls[0].init.headers;
		assert.equal(
			Object.keys(headers).some((key) => /authorization/i.test(key)),
			false,
			"no bearer rides this read — the route is anonymous",
		);
		assert.equal(envelope.result.total_records, 30);
		assert.equal(envelope.result.records[0].name, "data-quality");
	} finally {
		stub.restore();
	}
});

test("getPublicTeam reads one document by id, and encodes it into the path", async () => {
	const { getPublicTeam } = await loadApi();
	const stub = stubFetch(async () =>
		jsonResponse(200, {
			msg: "Team retrieved successfully",
			result: { id: "a/b", name: "content", instructions: "Do the thing." },
		}),
	);
	try {
		const envelope = await getPublicTeam("https://api.radienthq.com/", "a/b");
		assert.equal(
			stub.calls[0].url,
			"https://api.radienthq.com/v1/teams/a%2Fb",
			"a trailing slash is not doubled and the id is encoded",
		);
		assert.equal(
			envelope.result.instructions,
			"Do the thing.",
			"the document arrives under `result`, not wrapped",
		);
	} finally {
		stub.restore();
	}
});

test("a hub failure is reported as a hub failure, never as the local server", async () => {
	const { publicHubFailureMessage, PublicHubError, retryPublicHubQuery } =
		await loadApi();
	/*
	 * Design round 1, D1 = QA round 1, Q1: `backendErrorKind` reads a status off a
	 * `DesktopControlError` only, so every `PublicHubError` fell through to
	 * `unreachable` and the alert told the reader "The Local Operator server is not
	 * answering." — naming a machine that was answering — while discarding the
	 * transport's own sentence.
	 */
	assert.equal(
		publicHubFailureMessage(
			"The public team catalogue could not be read.",
			new PublicHubError("The public hub answered 503.", 503),
		),
		"The public hub answered 503.",
		"the transport's own sentence is what the reader gets",
	);
	assert.equal(
		publicHubFailureMessage(
			"The public team catalogue could not be read.",
			new PublicHubError("The public hub could not be reached.", null),
		),
		"The public hub could not be reached.",
		"and the transport arm is a complete sentence, with no browser text in it",
	);
	assert.match(
		publicHubFailureMessage(
			"The public team catalogue could not be read.",
			new Error("x"),
		),
		/not answering/,
		"an error that is not the hub's still gets the local server's diagnosis",
	);

	/*
	 * Agent review round 1, m2: the docstring claimed transport failures get no
	 * second ask while the code retried once. The code now does what the desktop
	 * policy does — a null status is not worth another wait.
	 */
	assert.equal(
		retryPublicHubQuery(0, new PublicHubError("never reached", null)),
		false,
	);
	assert.equal(
		retryPublicHubQuery(0, new PublicHubError("answered 503", 503)),
		true,
	);
	assert.equal(
		retryPublicHubQuery(1, new PublicHubError("answered 503", 503)),
		false,
	);
	assert.equal(
		retryPublicHubQuery(0, new PublicHubError("answered 404", 404)),
		false,
	);
});

test("a refusal and a transport failure raise typed errors, and are told apart", async () => {
	const { listPublicTeams, PublicHubError } = await loadApi();
	const refused = stubFetch(async () => jsonResponse(503, { detail: "nope" }));
	try {
		await assert.rejects(
			() => listPublicTeams("https://api.radienthq.com"),
			(error) => {
				assert.ok(error instanceof PublicHubError, "a typed error");
				assert.equal(error.status, 503, "the status the retry policy reads");
				return true;
			},
		);
	} finally {
		refused.restore();
	}
	const unreachable = stubFetch(async () => {
		throw new TypeError("fetch failed");
	});
	try {
		await assert.rejects(
			() => listPublicTeams("https://api.radienthq.com"),
			(error) => {
				assert.ok(error instanceof PublicHubError);
				assert.equal(
					error.status,
					null,
					"no answer is not the same fact as a refusal",
				);
				/*
				 * QA round 2, Q2: the browser's own text belongs on the error, for a
				 * log, and NOT in the sentence a reader meets.
				 */
				assert.equal(
					error.message,
					"The public hub could not be reached.",
					"a complete sentence, with no `Failed to fetch` in it",
				);
				assert.match(
					String(error.reason),
					/fetch failed/,
					"the transport's own text is kept, on the cause",
				);
				return true;
			},
		);
	} finally {
		unreachable.restore();
	}
	const unreadable = stubFetch(async () => ({
		ok: true,
		status: 200,
		json: async () => {
			throw new SyntaxError("not json");
		},
	}));
	try {
		await assert.rejects(
			() => listPublicTeams("https://api.radienthq.com"),
			(error) => {
				assert.ok(error instanceof PublicHubError);
				assert.equal(error.status, 200);
				return true;
			},
		);
	} finally {
		unreadable.restore();
	}
});

/* ------------------------------------------------------- 4/5. the hook, mounted */

/*
 * The mount bundle. Written to disk with `packages: "external"` so the component
 * under test and this file's `react-dom` share ONE React (a data: URL cannot
 * resolve a bare specifier, and two Reacts is an invalid hook call).
 *
 * `@shared/config` is replaced, for the reason the org-sharing suite records:
 * it builds the app's environment at module scope and throws in a bare node
 * import. The hook reads `apiConfig.radientBaseUrl` and nothing else from it.
 */
after(async () => {
	await unlink(configStubPath).catch(() => {});
	await unlink(apiConfigStubPath).catch(() => {});
});

const mountBundle = await build({
	stdin: {
		contents: `
			export { usePublicTeamsQuery, usePublicTeamQuery, publicTeamKeys } from "./${FEATURE}/hooks/use-public-teams-query";
			export { PublicTeamsLibrary } from "./${FEATURE}/components/public-teams-library";
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
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared/config": configStubPath.pathname,
		"@shared/config/api-config": apiConfigStubPath.pathname,
	},
	write: false,
});
const mountPath = new URL(
	`./_public-teams-mount-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(mountPath, mountBundle.outputFiles[0].text);
after(async () => {
	await unlink(mountPath).catch(() => {});
});

/** The nine rows the live hub serves, trimmed to what these claims read. */
const TEAM_ROWS = [
	{
		id: "team-1",
		name: "support-desk",
		description: "Triage and response crew.",
		manager: "manager",
		project: "",
		version: "1.0.0",
		members: [{ role: "researcher", kind: "agent", count: 2 }],
		account_metadata: { name: "Damian Tran" },
		created_date: "2026-10-03T11:38:21.442Z",
		updated_at: "2026-10-03T11:38:21.442Z",
	},
	{
		id: "team-2",
		name: "data-quality",
		description: "Guardrails for the records.",
		manager: "manager",
		project: "",
		version: "1.0.0",
		members: [],
		account_metadata: { name: "Damian Tran" },
		created_date: "2026-10-03T11:38:21.442Z",
		updated_at: "2026-10-03T11:38:21.442Z",
	},
];

/**
 * A jsdom document with both transports stubbed.
 *
 * `window.fetch` answers the hub (the anonymous public read) and
 * `window.api.desktop.request` answers the desktop bridge (the pull the library
 * mounts). Requests are recorded per transport so a claim can say which one it
 * counted.
 */
const mountLibrary = async ({
	rows = TEAM_ROWS,
	holdList = false,
	refusePull = false,
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
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;

	const hubRequests = [];
	const hubFetch = async (input) => {
		const url = String(input);
		if (url.includes("/v1/teams/")) {
			hubRequests.push("get");
			const id = decodeURIComponent(url.split("/v1/teams/")[1]);
			const row = rows.find((team) => team.id === id);
			return jsonResponse(200, {
				msg: "Team retrieved successfully",
				// `result` IS the document (see `HubTeamResult`): the live route does not
				// wrap it, and a stub that did hid the empty-brief defect this file's own
				// live pass found.
				result: { ...row, instructions: "Screen, then report." },
			});
		}
		hubRequests.push("list");
		if (holdList) return await new Promise(() => {});
		return jsonResponse(200, {
			msg: "Teams listed successfully",
			result: {
				page: 1,
				per_page: 12,
				records: rows,
				total_pages: 1,
				total_records: rows.length,
			},
		});
	};
	/*
	 * BOTH globals. The module under test is bundled to a file and imported by
	 * node, so its `fetch` is READ FROM `globalThis` at call time — a stub set only
	 * on `dom.window` answers nothing and the mount then photographs the loading
	 * state (measured: the first run of this file did exactly that).
	 */
	dom.window.fetch = hubFetch;
	globalThis.fetch = hubFetch;

	const bridgeRequests = [];
	dom.window.api = {
		desktop: {
			request: async (request) => {
				bridgeRequests.push(request.op ?? request.control?.operation);
				// The arm the local server takes with no Radient credential: a prose
				// 401, not a coded `PublicationError` (QA round 1, Q2).
				if (refusePull) {
					return { status: 401, body: { detail: "Unauthorized" } };
				}
				return {
					status: 200,
					body: {
						status: 200,
						message: "Team pulled from Radient successfully",
						result: { id: "local-1", name: "support-desk" },
					},
				};
			},
		},
	};

	const mod = await import(mountPath.href);
	const { QueryClient, QueryClientProvider } = mod;
	const { createRoot } = await import("react-dom/client");
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client: queryClient },
				React.createElement(mod.PublicTeamsLibrary, {
					signedIn: true,
					onOpenSettings: () => {},
				}),
			),
		);
	});
	/*
	 * SETTLE THE READ. The query resolves in a microtask the render's own `act`
	 * does not flush, so without this the assertions run against the loading
	 * state (measured: the first version of this file asserted over skeletons and
	 * reported "the row paints no name"). The bound is the rig's, not a race: a
	 * fixture that never settles fails loudly here instead of hanging.
	 */
	const settled = () =>
		/(teams? in the public hub|No teams have been published|Try again)/.test(
			dom.window.document.body.textContent ?? "",
		);
	for (let attempt = 0; attempt < 100 && !settled(); attempt += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
	assert.ok(settled(), "the catalogue read settled");

	return {
		dom,
		mod,
		queryClient,
		hubRequests,
		bridgeRequests,
		teardown: async () => {
			await act(async () => root.unmount());
			// React Query keeps a gc timer per cached query; without `clear()` the
			// process lives ten more minutes and `node --test` waits it out.
			queryClient.clear();
			dom.window.close();
			globalThis.window = previous.window;
			globalThis.document = previous.document;
			globalThis.fetch = previous.fetch;
			globalThis.IS_REACT_ACT_ENVIRONMENT = false;
		},
	};
};

const text = (dom) => dom.window.document.body.textContent ?? "";

/**
 * Flush until `predicate` holds, or fail by name.
 *
 * A settled query lands in a microtask the render's own `act` does not flush, so
 * every assertion that follows an ACTION needs this; the bound is the rig's, so a
 * fixture that never settles fails loudly rather than hanging the runner.
 */
const settle = async (predicate, label) => {
	for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
	assert.ok(predicate(), label);
};

test("the library paints the display names and the rows' own facts", async () => {
	const mounted = await mountLibrary();
	try {
		assert.match(text(mounted.dom), /Support Desk/);
		assert.match(text(mounted.dom), /Data Quality/);
		assert.doesNotMatch(
			text(mounted.dom),
			/support-desk/,
			"the key is not what the card paints",
		);
		assert.match(text(mounted.dom), /Damian Tran/, "the author line");
		assert.match(text(mounted.dom), /2 teams in the public hub/);
		assert.equal(
			mounted.hubRequests.filter((kind) => kind === "list").length,
			1,
			"one listing read for the first paint",
		);
	} finally {
		await mounted.teardown();
	}
});

test("the search narrows the rendered rows without a second request", async () => {
	const mounted = await mountLibrary();
	try {
		const box = mounted.dom.window.document.querySelector(
			'[data-testid="agent-hub-public-teams-search"]',
		);
		assert.ok(box, "the search box is rendered");
		/*
		 * REACT'S OWN VALUE SETTER, not a plain assignment. React tracks the last
		 * value it rendered and skips its `onChange` when the DOM value still equals
		 * it, so `box.value = "data"` followed by an `input` event is a write React
		 * deliberately ignores — measured: the first version of this test filtered
		 * nothing and reported two rows.
		 */
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				mounted.dom.window.HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(box, "data");
			box.dispatchEvent(
				new mounted.dom.window.Event("input", { bubbles: true }),
			);
		});
		await settle(
			() =>
				mounted.dom.window.document.querySelectorAll(
					'[data-testid="agent-hub-public-team"]',
				).length === 1,
			"the filter narrowed the rendered rows",
		);
		const rendered = mounted.dom.window.document.querySelectorAll(
			'[data-testid="agent-hub-public-team"]',
		);
		assert.equal(rendered.length, 1, "one row matches");
		assert.match(text(mounted.dom), /Data Quality/);
		assert.doesNotMatch(text(mounted.dom), /Support Desk/);
		assert.equal(
			mounted.hubRequests.filter((kind) => kind === "list").length,
			1,
			"the filter is client-side: no second read",
		);

		/*
		 * AND THE KEY'S OWN SPELLING MATCHES. `data-quality` is what the hub and the
		 * CLI print; normalising the QUERY to the display form's shape is what lets
		 * one term cover both spellings (agent review round 1, n2).
		 */
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				mounted.dom.window.HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(box, "data-quality");
			box.dispatchEvent(
				new mounted.dom.window.Event("input", { bubbles: true }),
			);
		});
		await settle(
			() =>
				mounted.dom.window.document.querySelectorAll(
					'[data-testid="agent-hub-public-team"]',
				).length === 1,
			"the key's own spelling finds the same row",
		);
	} finally {
		await mounted.teardown();
	}
});

test("opening a row is the ONE brief read the list form omits", async () => {
	const mounted = await mountLibrary();
	try {
		assert.equal(
			mounted.hubRequests.filter((kind) => kind === "get").length,
			0,
			"nothing is fetched until a row is opened",
		);
		const trigger = Array.from(
			mounted.dom.window.document.querySelectorAll("button"),
		).find((button) =>
			(button.getAttribute("aria-label") ?? "").startsWith(
				"View the brief for",
			),
		);
		assert.ok(trigger, "the first row carries a brief trigger");
		await act(async () => {
			trigger.dispatchEvent(
				new mounted.dom.window.MouseEvent("click", {
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await settle(
			() => text(mounted.dom).includes("Collaboration brief"),
			"the brief read settled into the open row",
		);
		assert.equal(
			mounted.hubRequests.filter((kind) => kind === "get").length,
			1,
			"opening one row is one getPublicTeam",
		);
		assert.match(text(mounted.dom), /Collaboration brief/);
		assert.match(text(mounted.dom), /Screen, then report\./);
	} finally {
		await mounted.teardown();
	}
});

const setSearchValue = async (mounted, box, value) => {
	/*
	 * REACT'S OWN VALUE SETTER, not a plain assignment: React skips its `onChange`
	 * when the DOM value still equals the last one it rendered.
	 */
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			mounted.dom.window.HTMLInputElement.prototype,
			"value",
		)?.set;
		setter?.call(box, value);
		box.dispatchEvent(new mounted.dom.window.Event("input", { bubbles: true }));
	});
};

test("clearing the search returns the caret to the box", async () => {
	const mounted = await mountLibrary();
	try {
		const box = mounted.dom.window.document.querySelector(
			'[data-testid="agent-hub-public-teams-search"]',
		);
		assert.ok(box, "the search box is rendered");
		await setSearchValue(mounted, box, "data");
		await settle(
			() =>
				mounted.dom.window.document.querySelectorAll(
					'[data-testid="agent-hub-public-team"]',
				).length === 1,
			"the filter applied",
		);
		box.focus();
		await setSearchValue(mounted, box, "");
		await settle(
			() =>
				mounted.dom.window.document.querySelectorAll(
					'[data-testid="agent-hub-public-team"]',
				).length === 2,
			"the filter cleared",
		);
		/*
		 * The platform's own clear control takes focus with it when it is pressed,
		 * so the caret has to be handed back or the reader types at nothing (agent
		 * review round 1, m3; round 2, m3 asked for the pin).
		 */
		assert.equal(
			mounted.dom.window.document.activeElement,
			box,
			"the caret is back in the box that was cleared",
		);
	} finally {
		await mounted.teardown();
	}
});

test("a refused pull renders its sentence beside the control, not under the brief", async () => {
	const mounted = await mountLibrary({ refusePull: true });
	try {
		const briefTrigger = Array.from(
			mounted.dom.window.document.querySelectorAll("button"),
		).find((button) =>
			(button.getAttribute("aria-label") ?? "").startsWith(
				"View the brief for",
			),
		);
		await act(async () => {
			briefTrigger.dispatchEvent(
				new mounted.dom.window.MouseEvent("click", {
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await settle(
			() => text(mounted.dom).includes("Collaboration brief"),
			"the brief opened",
		);
		const pull = mounted.dom.window.document.querySelector(
			'[data-testid="agent-hub-public-team"] button[aria-label^="Pull team"]',
		);
		await act(async () => {
			pull.dispatchEvent(
				new mounted.dom.window.MouseEvent("click", {
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await settle(
			() => text(mounted.dom).includes("could not be pulled"),
			"the refusal rendered",
		);
		const failure = mounted.dom.window.document.querySelector(
			'[data-testid="agent-hub-public-team-pull-error"]',
		);
		assert.ok(failure, "the failure block is rendered");
		/*
		 * THE ACTOR IS THIS MACHINE (QA round 2, Q1): the 401 is the local server's
		 * own credential check, taken before any hub call.
		 */
		assert.match(
			failure.textContent,
			/this machine has no Radient sign-in for the hub/,
		);
		assert.match(failure.textContent, /Sign in on the settings page/);
		/*
		 * AND IT LANDS IN THE HEADER (design round 1, D2 = agent round 1, M1): the
		 * failure shares a column with the button that produced it and precedes the
		 * open brief, which is the arrangement that used to hide it.
		 */
		assert.equal(
			failure.parentElement?.contains(pull),
			true,
			"the refusal is in the same column as its control",
		);
		const brief = mounted.dom.window.document.querySelector(
			'[data-testid="agent-hub-public-team-brief"]',
		);
		assert.ok(brief, "the brief is still open");
		assert.ok(
			failure.compareDocumentPosition(brief) &
				mounted.dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
			"the refusal precedes the brief in document order",
		);
	} finally {
		await mounted.teardown();
	}
});

test("the prose about a name paints the derived form too", async () => {
	/*
	 * A SOURCE pin for the three surfaces this suite has no mount for: the delist
	 * confirmation and the action-failure alert on the details page, the card
	 * container's alert, and the roster's own failure sentence (whose fallback is
	 * unreachable in the roster harness, whose transport always carries a message).
	 * The idiom is `agent-hub-org-sharing.test.mjs`'s own for that page.
	 */
	const details = read(
		"src/renderer/src/features/agent-hub/agent-details-page.tsx",
	);
	assert.match(
		details,
		/const displayName = agent \? hubDisplayName\(agent\.name\) : ""/,
		"the page derives the name once",
	);
	assert.match(details, /This takes "\{displayName\}" off the hub/);
	assert.match(
		details,
		/agentActionFailureMessage\(\s*failure\.action,\s*failure\.error,\s*displayName,/,
	);
	assert.doesNotMatch(details, /This takes "\{agent\.name\}"/);

	const container = read(
		"src/renderer/src/features/agent-hub/components/agent-card-container.tsx",
	);
	assert.match(container, /agentActionFailureMessage\(/);
	assert.match(
		container,
		/hubDisplayName\(agent\.name\),/,
		"the alert is composed from the derived name",
	);

	const roster = read(
		"src/renderer/src/features/agent-hub/components/org-teams-list.tsx",
	);
	assert.match(roster, /`Pull team \$\{hubDisplayName\(team\.name\)\}`/);
	assert.match(
		roster,
		/`"\$\{hubDisplayName\(team\.name\)\}" could not be pulled\.`/,
	);
});

test("the hook registers the key its own builder produces", async () => {
	const mounted = await mountLibrary();
	try {
		const keys = mounted.queryClient
			.getQueryCache()
			.getAll()
			.map((query) => query.queryKey);
		const pageOne = mounted.mod.publicTeamKeys.list(1, 12);
		assert.ok(
			keys.some((key) => JSON.stringify(key) === JSON.stringify(pageOne)),
			`the mounted hook registered ${JSON.stringify(pageOne)}`,
		);
	} finally {
		await mounted.teardown();
	}
});
