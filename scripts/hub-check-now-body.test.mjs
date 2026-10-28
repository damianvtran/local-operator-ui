/**
 * Q13 (QA round 3 on local-operator-ui #1458, `hub-check-now-body`): the hub
 * links panel's "Check now" sent `link_id`, which core's check route refuses.
 *
 *     node --test scripts/hub-check-now-body.test.mjs
 *
 * WHAT IT PINS, and the instrument for each:
 *
 *   1. THE BODY THE CLIENT COMPOSES. `desktopEndpoint({op:"hub.check"})` is the
 *      one place an op becomes a request, so the assertion is on its output -
 *      the exact member set, not "contains a name".
 *   2. CORE'S ACCEPTANCE OF THAT BODY, from a fixture that mirrors core's
 *      pydantic model rather than from a shape invented here. The fixture
 *      REFUSES the body the old client sent, so it is a discriminating
 *      instrument and not a tautology: a mirror that accepted everything would
 *      have passed the defect.
 *   3. THE MOUNTED HOOK'S REAL REQUEST. `useHubLinkActions` is bundled and
 *      driven through a QueryClientProvider with the transport stubbed, so the
 *      call site - not only the schema - is what is measured. This is the arm
 *      that would have caught #1269: the schema change alone does not prove the
 *      hook stopped sending what the schema no longer allows.
 *   4. THE ANSWER IT WRITES. Core's check answers `reports` + `status` and NO
 *      inventory, so the hook must not write the inventory key at all - the
 *      post-mutation refetch is what refreshes it. Counted by RECORDING
 *      `setQueryData` calls: TanStack treats `setQueryData(key, undefined)` as a
 *      no-op, so a cache read cannot see the old code's write and could not
 *      fail this arm.
 *
 * WHAT IT DOES NOT PROVE: that a live `lop serve` answers 200 and refreshes the
 * panel (QA's real-path pass does, with the fake hub from the #1458 rig), or
 * that the sentence renders (the panel's own suite and frames cover that).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { JSDOM } = require("jsdom");

const contractPath = `${process.cwd()}/src/shared/desktop-contract.ts`;
const actionsPath = `${process.cwd()}/src/renderer/src/shared/api/local-operator/hub-link-actions.ts`;
const hooksPath = `${process.cwd()}/src/renderer/src/shared/api/local-operator/hub-link-hooks.ts`;

/** The transport's records: the only evidence of what left the client. */
globalThis.__hubCheckTest = { records: [] };

const bundle = await build({
	stdin: {
		contents: `export {desktopEndpoint,desktopRequestSchema} from '${contractPath}';export {useHubLinkActions} from '${actionsPath}';export {hubLinksKey} from '${hooksPath}';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
	packages: "external",
	external: ["react", "react/jsx-runtime"],
	jsx: "automatic",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	plugins: [
		{
			name: "record-the-wire",
			setup(b) {
				/*
				 * The transport (every desktop op) is replaced by a recorder. The
				 * fixture is deliberately AS SMALL AS POSSIBLE: this test's subject
				 * is the request body, and a stub answer that carried a `links`
				 * member would hide the cache arm (4).
				 */
				b.onResolve({ filter: /^\.\/desktop-api$/ }, (args) =>
					/hub-(?:link-hooks|link-actions)\.ts$/.test(args.importer)
						? { path: "transport", namespace: "check-fixture" }
						: undefined,
				);
				/*
				 * The write fence is that hook's OWN subject (hub-mutation-
				 * safety.test.mjs drives every arm through it). Pass-through here so
				 * a fixture snapshot cannot decide whether this test observes the
				 * wire at all.
				 */
				b.onResolve({ filter: /^\.\/hub-mutation-safety$/ }, () => ({
					path: "safety",
					namespace: "check-fixture",
				}));
				b.onResolve({ filter: /^@shared\/utils\/toast-manager$/ }, () => ({
					path: "toast",
					namespace: "check-fixture",
				}));
				b.onLoad({ filter: /.*/, namespace: "check-fixture" }, (args) => ({
					contents:
						args.path === "transport"
							? `export class DesktopControlError extends Error {}export async function desktopResult(request){globalThis.__hubCheckTest.records.push(request);return {reports:[{kind:request.kind??'agent',name:request.name??'fixture',outcome:'up-to-date',applied:false}],status:{items:[],credential:'ok'}};}`
							: args.path === "safety"
								? "export const guardHubMutation=async(work)=>work();export const useHubMutationSafety=()=>({canWrite:true,snapshot:null});"
								: "export const showSuccessToast=()=>{};",
					loader: "js",
				}));
			},
		},
	],
});
const mod = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	require,
	mod,
	mod.exports,
);
const api = mod.exports;

/* --------------------------------------------------- core's accepted shape */

/*
 * MIRROR OF CORE'S MODEL, not of this client's hope.
 *
 * Core `local_operator/server/routes/desktop_hub.py` declares
 *
 *     class HubCheck(Input):
 *         request_id: RequestID
 *         kind: Kind | None = None          # Literal["agent", "team", "skill"]
 *         name: str | None = Field(default=None, min_length=1, max_length=128)
 *
 * and `Input` is `BaseModel` with `model_config = ConfigDict(extra="forbid")`
 * (`local_operator/server/routes/desktop_sessions.py`, the base every desktop
 * route input inherits). `extra="forbid"` is the fact Q13 turned on: the route
 * never ran, FastAPI answered 422 for the unknown `link_id` field.
 *
 * Every rule below is copied from those two declarations. Keep it in step with
 * core when the model changes; it is a fixture, so it does not import core.
 */
const HUB_CHECK_MEMBERS = new Set(["request_id", "kind", "name"]);
const HUB_KINDS = ["agent", "team", "skill"];

/** `null` when core accepts the body, else the reason it would answer 422. */
function coreHubCheckRefusal(body) {
	if (body === null || typeof body !== "object" || Array.isArray(body))
		return "body: not an object";
	const unknown = Object.keys(body).filter(
		(key) => !HUB_CHECK_MEMBERS.has(key),
	);
	if (unknown.length) return `extra fields forbidden: ${unknown.join(", ")}`;
	if (typeof body.request_id !== "string" || body.request_id.length === 0)
		return "request_id: a non-empty string is required";
	if (body.kind !== undefined && !HUB_KINDS.includes(body.kind))
		return `kind: must be one of ${HUB_KINDS.join("/")}`;
	if (body.name !== undefined) {
		if (typeof body.name !== "string") return "name: must be a string";
		if (body.name.length < 1) return "name: min_length 1";
		if (body.name.length > 128) return "name: max_length 128";
	}
	return null;
}

const LINK = { link_id: "fixture-link-id", kind: "agent", name: "fixture" };

test("a per-link check composes core's accepted body, not link_id", () => {
	const endpoint = api.desktopEndpoint({
		op: "hub.check",
		requestId: "synthetic-check-1",
		kind: LINK.kind,
		name: LINK.name,
	});
	assert.equal(endpoint.method, "POST");
	assert.equal(endpoint.path, "/v1/desktop/hub/updates/check");
	// EXACT members: a superset is the defect this test exists for.
	assert.deepEqual(endpoint.body, {
		request_id: "synthetic-check-1",
		kind: "agent",
		name: "fixture",
	});
	assert.equal(coreHubCheckRefusal(endpoint.body), null);
	console.log(
		`actual per-link check body: ${JSON.stringify(endpoint.body)} - core accepts it`,
	);
});

test("Check now (every linked item) composes the same accepted shape", () => {
	const endpoint = api.desktopEndpoint({
		op: "hub.check",
		requestId: "synthetic-check-2",
	});
	assert.deepEqual(endpoint.body, { request_id: "synthetic-check-2" });
	assert.equal(coreHubCheckRefusal(endpoint.body), null);
});

test("the fixture refuses the body the old client sent - the 422 is reproduced", () => {
	/*
	 * The exact JSON #1269's call site produced (`useHubLinkActions` check arm:
	 * `linkId` -> `link_id`). If this line ever passes, the fixture stopped
	 * mirroring core and every assertion above this one is worthless.
	 */
	assert.equal(
		coreHubCheckRefusal({
			request_id: "synthetic-check-3",
			link_id: "fixture-link-id",
		}),
		"extra fields forbidden: link_id",
	);
	assert.equal(
		coreHubCheckRefusal({
			request_id: "synthetic-check-3",
			direction: "pull",
		}),
		"extra fields forbidden: direction",
	);
	console.log(
		"negative control: {request_id, link_id} and {request_id, direction} are both REFUSED by core's shape",
	);
});

test("the request schema can no longer build a body core would refuse", () => {
	// `requestId` is a UUID on this wire (`requestId` regex in the contract), so a
	// fixture id has to be one or the positive case would fail for the wrong reason.
	const base = {
		op: "hub.check",
		requestId: "00000000-0000-4000-8000-000000000004",
	};
	assert.equal(api.desktopRequestSchema.safeParse(base).success, true);
	assert.equal(
		api.desktopRequestSchema.safeParse({ ...base, kind: "agent", name: "x" })
			.success,
		true,
	);
	for (const refused of [
		{ linkId: "fixture-link-id" },
		{ direction: "pull" },
	]) {
		const result = api.desktopRequestSchema.safeParse({ ...base, ...refused });
		assert.equal(
			result.success,
			false,
			`hub.check accepted ${Object.keys(refused)[0]}, which core forbids`,
		);
	}
});

test("the mounted hook sends that body, and a check answer leaves the inventory alone", async () => {
	const dom = new JSDOM('<div id="root"></div>', {
		url: "http://fixture.invalid",
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const root = createRoot(document.getElementById("root"));
	let exposed;
	function Probe() {
		exposed = api.useHubLinkActions(LINK);
		return null;
	}
	const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
	try {
		await act(async () => {
			root.render(
				React.createElement(
					QueryClientProvider,
					{ client },
					React.createElement(Probe),
				),
			);
			await pause();
		});
		// The inventory the panel is showing, before the check runs.
		client.setQueryData(api.hubLinksKey, {
			links: [LINK],
			unresolved: [],
		});
		/*
		 * Record every write to the inventory key. The old code wrote
		 * `setQueryData(hubLinksKey, undefined)`, which TanStack discards, so this
		 * counter is the ONLY observable difference between "no write" and
		 * "a write of nothing" - a cache read would pass either way.
		 */
		const inventoryWrites = [];
		const setQueryData = client.setQueryData.bind(client);
		client.setQueryData = (key, value, ...rest) => {
			if (JSON.stringify(key) === JSON.stringify(api.hubLinksKey))
				inventoryWrites.push(value);
			return setQueryData(key, value, ...rest);
		};
		const before = globalThis.__hubCheckTest.records.length;
		await act(async () => {
			await exposed.mutateAsync({ action: "check", linkId: LINK.link_id });
			await pause();
		});
		const sent = globalThis.__hubCheckTest.records.slice(before);
		assert.equal(sent.length, 1, "exactly one request left the hook");
		assert.equal(sent[0].op, "hub.check");
		assert.equal(sent[0].kind, "agent");
		assert.equal(sent[0].name, "fixture");
		assert.equal(sent[0].linkId, undefined);
		assert.equal(sent[0].direction, undefined);
		// Both ends of the wire agree on the same members.
		const body = api.desktopEndpoint(sent[0]).body;
		assert.equal(coreHubCheckRefusal(body), null);
		assert.deepEqual(Object.keys(body).sort(), ["kind", "name", "request_id"]);
		// A check answers no inventory, so the hook left that key alone...
		assert.deepEqual(
			inventoryWrites,
			[],
			"a check answer wrote the inventory key",
		);
		// ...and the panel's inventory is still what it was.
		assert.deepEqual(client.getQueryData(api.hubLinksKey), {
			links: [LINK],
			unresolved: [],
		});
		assert.deepEqual(client.getQueryData(["desktop", "hub-updates"]), {
			items: [],
			credential: "ok",
		});
		console.log(
			`actual mounted-hook request: ${JSON.stringify(sent[0])} -> wire ${JSON.stringify(body)}`,
		);
	} finally {
		await act(async () => root.unmount());
		globalThis.window = undefined;
		globalThis.document = undefined;
	}
});
