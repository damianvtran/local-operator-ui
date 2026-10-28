/**
 * Hub link actions, from the press to the body core accepts: #1461, Q13 of
 * local-operator-ui #1458, and review round 1's MAJOR-1.
 *
 *     node --test scripts/hub-check-now-body.test.mjs
 *
 * WHAT IT PINS, and the instrument for each:
 *
 *   1. THE ADDRESS. `desktopEndpoint({op:"hub.check"|"hub.apply"|"hub.retry"})`
 *      is the one place an op becomes a request, so the assertion is on its
 *      output - the exact member set, not "contains a name". Core addresses one
 *      item by `kind` + (`local_id` | `name`); `link_id` and `direction` are
 *      NOT members of `HubCheck`/`HubApply`/`HubRetry` and are refused.
 *   2. CORE'S ACCEPTANCE, from a fixture that mirrors core's pydantic models
 *      rather than from a shape invented here. The fixture REFUSES the body the
 *      old client sent, so it is a discriminating instrument and not a
 *      tautology: a mirror that accepted everything would have passed the bug.
 *   3. THE MOUNTED HOOK'S REAL REQUEST, both ways round:
 *      - `hub_items_by_id` advertised -> `{kind, local_id}` and never a name;
 *      - absent -> `{kind, name: <DISPLAY name>}`, because an agent/team link
 *        row's `name` is its registry ID (a UUID), not its display name, and
 *        core matches names against the DISPLAY name. That is MAJOR-1: the
 *        fixture link below carries a UUID `name` beside a separate display
 *        name, so a regression to `link.name` fails here.
 *   4. THE ANSWER A CHECK WRITES. Core's check answers `reports` + `status` and
 *      NO inventory, so the hook must not write the inventory key at all - the
 *      post-mutation refetch is what refreshes it. Counted by RECORDING
 *      `setQueryData` calls: TanStack treats `setQueryData(key, undefined)` as a
 *      no-op, so a cache read cannot see the old code's write and could not
 *      fail this arm.
 *
 * WHAT IT DOES NOT PROVE: that a live `lop serve` answers 200 and refreshes the
 * panel (QA's real-path pass does), or that the sentence renders (the panel's
 * own suite and frames cover that).
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
		contents: `export {desktopEndpoint,desktopRequestSchema} from '${contractPath}';export {useHubLinkActions,hubItemAddress} from '${actionsPath}';export {hubLinksKey} from '${hooksPath}';`,
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
 * MIRROR OF CORE'S MODELS, not of this client's hope.
 *
 * Core `local_operator/server/routes/desktop_hub.py` (origin/main, core #3080)
 * declares
 *
 *     LocalId = Field(default=None, min_length=1, max_length=128, pattern=r"\S")
 *
 *     class HubCheck(Input):
 *         request_id: RequestID
 *         kind: Kind | None = None          # Literal["agent", "team", "skill"]
 *         name: str | None = Field(default=None, min_length=1, max_length=128)
 *         local_id: str | None = LocalId
 *         # _one_address(..., required=False)
 *
 *     class HubApply(Input):
 *         request_id: RequestID; kind: Kind
 *         name: str | None; local_id: str | None
 *         prefer; acknowledge_unknown_baseline; replace; confirm_replace; dry_run
 *         # _one_address(..., required=True); resolve_source refuses local_id
 *
 *     class HubRetry(Input):
 *         request_id: RequestID; kind: Kind
 *         name: str | None; local_id: str | None
 *         # _one_address(..., required=True)
 *
 * and `Input` is `BaseModel` with `model_config = ConfigDict(extra="forbid")`
 * (`local_operator/server/routes/desktop_sessions.py`, the base every desktop
 * route input inherits). `extra="forbid"` is the fact Q13 turned on: the route
 * never ran, FastAPI answered 422 for the unknown `link_id` field.
 *
 * Every rule below is copied from those declarations. Keep it in step with
 * core when the model changes; it is a fixture, so it does not import core.
 */
const HUB_CHECK_MEMBERS = new Set(["request_id", "kind", "name", "local_id"]);
const HUB_APPLY_MEMBERS = new Set([
	"request_id",
	"kind",
	"name",
	"local_id",
	"prefer",
	"acknowledge_unknown_baseline",
	"replace",
	"confirm_replace",
	"dry_run",
	"resolve_source",
	"hub_source",
	"visibility",
	"tenant_id",
]);
const HUB_KINDS = ["agent", "team", "skill"];

function oneAddress(body) {
	if (body.name !== undefined && body.local_id !== undefined)
		return "pass either name or local_id, not both";
	if (body.local_id !== undefined && body.kind === undefined)
		return "local_id needs kind";
	return null;
}

function localIdRule(value) {
	if (typeof value !== "string") return "local_id: must be a string";
	if (value.length < 1) return "local_id: min_length 1";
	if (value.length > 128) return "local_id: max_length 128";
	if (!/\S/.test(value)) return "local_id: whitespace-only is refused";
	return null;
}

function nameRule(value) {
	if (typeof value !== "string") return "name: must be a string";
	if (value.length < 1) return "name: min_length 1";
	if (value.length > 128) return "name: max_length 128";
	return null;
}

function sharedChecks(body, members) {
	if (body === null || typeof body !== "object" || Array.isArray(body))
		return "body: not an object";
	const unknown = Object.keys(body).filter((key) => !members.has(key));
	if (unknown.length) return `extra fields forbidden: ${unknown.join(", ")}`;
	if (typeof body.request_id !== "string" || body.request_id.length === 0)
		return "request_id: a non-empty string is required";
	if (body.kind !== undefined && !HUB_KINDS.includes(body.kind))
		return `kind: must be one of ${HUB_KINDS.join("/")}`;
	if (body.name !== undefined) {
		const bad = nameRule(body.name);
		if (bad) return bad;
	}
	if (body.local_id !== undefined) {
		const bad = localIdRule(body.local_id);
		if (bad) return bad;
	}
	return oneAddress(body);
}

/** `null` when core's `HubCheck` accepts the body, else the reason it refuses. */
function coreHubCheckRefusal(body) {
	return sharedChecks(body, HUB_CHECK_MEMBERS);
}

/** `null` when core's `HubApply` accepts the body, else the reason it refuses. */
function coreHubApplyRefusal(body) {
	const shared = sharedChecks(body, HUB_APPLY_MEMBERS);
	if (shared) return shared;
	if (body.kind === undefined) return "kind: required";
	if (body.name === undefined && body.local_id === undefined)
		return "pass name or local_id";
	if (body.resolve_source === true && body.local_id !== undefined)
		return "resolve_source addresses its item by name";
	return null;
}

/*
 * THE ROW AS CORE SENDS IT FOR AN AGENT (or a team): `links_snapshot` sets
 * `name = record.local_alias or record.local_id`, and `local_alias` exists only
 * for skills - so an agent/team row's `name` is its registry UUID. The display
 * name lives on the local item, which is what the panel already receives as its
 * `name` prop. Both facts are in this fixture on purpose: a regression to
 * `link.name` would send the UUID and fail.
 */
const DISPLAY = "Coder";
const LINK = {
	link_id: "fixture-link-id",
	kind: "agent",
	local_id: "d73e7532-d7ee-4c7d-8d42-bfc7530e497f",
	name: "d73e7532-d7ee-4c7d-8d42-bfc7530e497f",
};

test("a per-link check with the id capability composes core's exact body", () => {
	const endpoint = api.desktopEndpoint({
		op: "hub.check",
		requestId: "synthetic-check-1",
		kind: LINK.kind,
		localId: LINK.local_id,
	});
	assert.equal(endpoint.method, "POST");
	assert.equal(endpoint.path, "/v1/desktop/hub/updates/check");
	// EXACT members: a superset is the defect this test exists for.
	assert.deepEqual(endpoint.body, {
		request_id: "synthetic-check-1",
		kind: "agent",
		local_id: LINK.local_id,
	});
	assert.equal(coreHubCheckRefusal(endpoint.body), null);
	console.log(
		`actual per-link check body: ${JSON.stringify(endpoint.body)} - core accepts it`,
	);
});

test("the released name arm still composes a body core accepts", () => {
	const endpoint = api.desktopEndpoint({
		op: "hub.check",
		requestId: "synthetic-check-2",
		kind: LINK.kind,
		name: DISPLAY,
	});
	assert.deepEqual(endpoint.body, {
		request_id: "synthetic-check-2",
		kind: "agent",
		name: DISPLAY,
	});
	assert.equal(coreHubCheckRefusal(endpoint.body), null);
});

test("Check now (every linked item) composes the addressless body", () => {
	const endpoint = api.desktopEndpoint({
		op: "hub.check",
		requestId: "synthetic-check-3",
	});
	assert.deepEqual(endpoint.body, { request_id: "synthetic-check-3" });
	assert.equal(coreHubCheckRefusal(endpoint.body), null);
});

test("apply and retry address one item and carry no link_id or direction", () => {
	const apply = api.desktopEndpoint({
		op: "hub.apply",
		requestId: "synthetic-apply-1",
		kind: LINK.kind,
		localId: LINK.local_id,
		prefer: "remote",
		acknowledgeUnknownBaseline: true,
		dryRun: true,
	});
	assert.deepEqual(apply.body, {
		request_id: "synthetic-apply-1",
		kind: "agent",
		local_id: LINK.local_id,
		prefer: "remote",
		acknowledge_unknown_baseline: true,
		dry_run: true,
	});
	assert.equal(coreHubApplyRefusal(apply.body), null);

	const retry = api.desktopEndpoint({
		op: "hub.retry",
		requestId: "synthetic-retry-1",
		kind: LINK.kind,
		localId: LINK.local_id,
	});
	assert.deepEqual(retry.body, {
		request_id: "synthetic-retry-1",
		kind: "agent",
		local_id: LINK.local_id,
	});
	assert.equal(coreHubApplyRefusal(retry.body), null);
	// The push arm is a different route and stays link-addressed.
	const push = api.desktopEndpoint({
		op: "hub.push",
		requestId: "synthetic-push-1",
		linkId: LINK.link_id,
		direction: "push",
		dryRun: true,
	});
	assert.deepEqual(push.body, {
		request_id: "synthetic-push-1",
		link_id: LINK.link_id,
		direction: "push",
		dry_run: true,
	});
});

test("the fixture refuses what the old client and a bad address send", () => {
	/*
	 * The exact JSON #1269's call site produced (`useHubLinkActions` check arm:
	 * `linkId` -> `link_id`). If this ever passes, the fixture stopped mirroring
	 * core and every assertion above is worthless.
	 */
	assert.equal(
		coreHubCheckRefusal({
			request_id: "synthetic-check-4",
			link_id: LINK.link_id,
		}),
		"extra fields forbidden: link_id",
	);
	assert.equal(
		coreHubCheckRefusal({ request_id: "synthetic-check-4", direction: "pull" }),
		"extra fields forbidden: direction",
	);
	// Both arms at once, and an id without its kind, are refused too.
	assert.equal(
		coreHubCheckRefusal({
			request_id: "synthetic-check-4",
			kind: "agent",
			name: DISPLAY,
			local_id: LINK.local_id,
		}),
		"pass either name or local_id, not both",
	);
	assert.equal(
		coreHubCheckRefusal({
			request_id: "synthetic-check-4",
			local_id: LINK.local_id,
		}),
		"local_id needs kind",
	);
	assert.equal(
		coreHubApplyRefusal({
			request_id: "synthetic-apply-2",
			link_id: LINK.link_id,
			direction: "pull",
			dry_run: true,
		}),
		"extra fields forbidden: link_id, direction",
	);
	console.log(
		"negative control: link_id/direction, both arms, and an id without kind are all REFUSED by core's shape",
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
	for (const accepted of [
		{ kind: "agent", name: DISPLAY },
		{ kind: "agent", localId: LINK.local_id },
	])
		assert.equal(
			api.desktopRequestSchema.safeParse({ ...base, ...accepted }).success,
			true,
		);

	for (const refused of [
		{ linkId: LINK.link_id },
		{ direction: "pull" },
		{ kind: "agent", name: DISPLAY, localId: LINK.local_id },
		{ localId: LINK.local_id },
	]) {
		const result = api.desktopRequestSchema.safeParse({ ...base, ...refused });
		assert.equal(
			result.success,
			false,
			`hub.check accepted ${JSON.stringify(refused)}, which core refuses`,
		);
	}
});

test("the mounted hook addresses by local_id, and by display name without the capability", async () => {
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
		exposed = {
			byId: api.useHubLinkActions(LINK, {
				displayName: DISPLAY,
				itemsById: true,
			}),
			byName: api.useHubLinkActions(LINK, {
				displayName: DISPLAY,
				itemsById: false,
			}),
		};
		return null;
	}
	const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
	/** Run one action on one hook and return the request it left behind. */
	const sent = async (hook, input) => {
		const before = globalThis.__hubCheckTest.records.length;
		await act(async () => {
			await hook.mutateAsync(input);
			await pause();
		});
		const records = globalThis.__hubCheckTest.records.slice(before);
		assert.equal(records.length, 1, "exactly one request left the hook");
		return records[0];
	};
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
		// The inventory the panel is showing, before anything runs.
		client.setQueryData(api.hubLinksKey, { links: [LINK], unresolved: [] });
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

		// 1. Capability present: the exact arm, and no name beside it.
		const check = await sent(exposed.byId, {
			action: "check",
			linkId: LINK.link_id,
		});
		assert.equal(check.op, "hub.check");
		assert.equal(check.kind, "agent");
		assert.equal(check.localId, LINK.local_id);
		assert.equal(check.name, undefined);
		assert.equal(check.linkId, undefined);
		assert.equal(check.direction, undefined);
		const checkBody = api.desktopEndpoint(check).body;
		assert.equal(coreHubCheckRefusal(checkBody), null);
		assert.deepEqual(Object.keys(checkBody).sort(), [
			"kind",
			"local_id",
			"request_id",
		]);

		// 2. Capability absent: the DISPLAY name, never the row's UUID `name`.
		const named = await sent(exposed.byName, {
			action: "check",
			linkId: LINK.link_id,
		});
		assert.equal(named.name, DISPLAY);
		assert.notEqual(named.name, LINK.name);
		assert.equal(named.localId, undefined);
		assert.deepEqual(Object.keys(api.desktopEndpoint(named).body).sort(), [
			"kind",
			"name",
			"request_id",
		]);

		// 3. Apply and retry are addressed the same way (Q1's twin defect).
		const apply = await sent(exposed.byId, {
			action: "apply",
			linkId: LINK.link_id,
			preview: true,
			prefer: "remote",
		});
		assert.equal(apply.op, "hub.apply");
		assert.equal(apply.localId, LINK.local_id);
		assert.equal(apply.linkId, undefined);
		assert.equal(apply.direction, undefined);
		assert.equal(apply.previewReceipt, undefined);
		assert.equal(apply.confirmApply, undefined);
		assert.equal(coreHubApplyRefusal(api.desktopEndpoint(apply).body), null);

		const retry = await sent(exposed.byName, {
			action: "retry",
			linkId: LINK.link_id,
			direction: "pull",
		});
		assert.equal(retry.op, "hub.retry");
		assert.equal(retry.name, DISPLAY);
		assert.equal(retry.localId, undefined);
		assert.equal(retry.linkId, undefined);
		assert.equal(retry.direction, undefined);
		assert.equal(coreHubApplyRefusal(api.desktopEndpoint(retry).body), null);

		// 4. A check answers no inventory, so the hook left that key alone...
		assert.deepEqual(
			inventoryWrites,
			[],
			"a hub action wrote the inventory key",
		);
		// ...and the panel's inventory is still what it was.
		assert.deepEqual(client.getQueryData(api.hubLinksKey), {
			links: [LINK],
			unresolved: [],
		});
		console.log(
			`actual mounted-hook bodies: check(byId)=${JSON.stringify(api.desktopEndpoint(check).body)} check(byName)=${JSON.stringify(api.desktopEndpoint(named).body)} apply=${JSON.stringify(api.desktopEndpoint(apply).body)} retry=${JSON.stringify(api.desktopEndpoint(retry).body)}`,
		);
	} finally {
		await act(async () => root.unmount());
		globalThis.window = undefined;
		globalThis.document = undefined;
	}
});
