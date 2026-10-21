/**
 * Complete-adapter gate: mounted real hooks, latest-cache withdrawal, and the
 * shared stub's write consent/legacy routes. No browser/app build or real hub.
 * The transport alone is an instrument; React Query and capability hooks are real.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const React = require("react");
const { createRoot } = require("react-dom/client");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { act } = React;
const dom = new JSDOM("<main id='root'></main>", { url: "http://127.0.0.1/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "localStorage", {
	value: dom.window.localStorage,
	configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const released = {
	desktop_contract: 1,
	desktop_available: true,
	desktop_auth: "bearer",
	features: {
		hub_links: 1,
		skill_catalogue: 1,
		radient_org: 1,
		future_unknown: 9,
	},
};
const state = {
	capabilities: released,
	remote: [],
	requests: [],
	hold: false,
	pending: [],
};
globalThis.__hubSkillGateTest = state;
const transport = `export { DesktopControlError, isDeadlineExceeded } from "${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts"; export async function desktopResult(input) { const s=globalThis.__hubSkillGateTest; s.requests.push(input); if(input.op==='capabilities')return s.capabilities; return {links:{links:[],unresolved:[]},reports:[],link:null,local_link_receipt:null}; }`;
const catalogue = `export const hubSourceAddress=(origin)=>origin.replace(/\\/+$/,'')+'/v1';const call=(kind,args)=>{const s=globalThis.__hubSkillGateTest;s.remote.push({kind,args});const result={result:{skills:[],records:[],total_pages:1,sync_contract:{revision_cas:1,skills:1}}};return s.hold?new Promise(resolve=>s.pending.push(()=>resolve(result))):Promise.resolve(result);};export const listPublicSkills=(...a)=>call('public-list',a);export const getPublicSkill=(...a)=>call('public-detail',a);export const listOrgSkills=(...a)=>call('org-list',a);export const getOrgSkill=(...a)=>call('org-detail',a);`;
const built = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/agent-hub/hooks/use-hub-skills";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	write: false,
	packages: "external",
	logLevel: "silent",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	plugins: [
		{
			name: "instrument-only-transports",
			setup(b) {
				// Skills tests do not mount link policy hooks. Keep their optional MAIN
				// health dependency explicit; the separate write-guard suite mounts it.
				b.onResolve(
					{ filter: /^@shared\/hooks\/use-connectivity-status$/ },
					() => ({ path: "health", namespace: "instrument" }),
				);
				b.onResolve(
					{ filter: /desktop-api\.ts$/, namespace: "instrument" },
					(args) => ({ path: args.path, namespace: "file" }),
				);
				b.onResolve({ filter: /(?:^|\/)desktop-api$/ }, () => ({
					path: "desktop",
					namespace: "instrument",
				}));
				b.onResolve({ filter: /(?:^|\/)skills-api$/ }, () => ({
					path: "skills",
					namespace: "instrument",
				}));
				b.onResolve({ filter: /^@shared\/config$/ }, () => ({
					path: "config",
					namespace: "instrument",
				}));
				b.onLoad({ filter: /.*/, namespace: "instrument" }, (args) => ({
					contents:
						args.path === "health"
							? 'export const useServerHealth=()=>{throw new Error("unexpected Hub policy mount in Skills-only test");};'
							: args.path === "desktop"
								? transport
								: args.path === "skills"
									? catalogue
									: 'export const apiConfig={radientBaseUrl:"http://127.0.0.1:8127"};',
					loader: "js",
				}));
			},
		},
	],
});
const mod = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(
	require,
	mod,
	mod.exports,
);
const hooks = mod.exports;
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));

test("real mounted Skills hooks gate absence, explicit enablement, and retained callbacks after cap loss", async () => {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: 0 },
			mutations: { retry: false },
		},
	});
	client.setQueryData(["desktop", "capabilities"], released);
	const root = createRoot(document.getElementById("root"));
	let exposed;
	function Probe() {
		const pub = { visibility: "public", tenantId: null, organization: null };
		const org = {
			visibility: "org",
			tenantId: "org-minerva",
			organization: "Minerva",
		};
		exposed = {
			pub: hooks.useRemoteSkills(pub, 1, true),
			org: hooks.useRemoteSkills(org, 1, true),
			pubDetail: hooks.useRemoteSkill(pub, "skill-release-notes", true),
			orgDetail: hooks.useRemoteSkill(org, "skill-minerva-deploy", true),
			pull: hooks.usePullHubSkill(),
			subscribe: hooks.useSubscribeHubSkill(),
			unpull: hooks.useUnpullHubSkill(),
			publish: hooks.useInitialSkillPublication(),
		};
		return null;
	}
	const pull = {
		requestId: "12345678-1234-4123-8123-123456789abc",
		remoteId: "skill-release-notes",
		scope: { visibility: "public", tenantId: null, organization: null },
		alias: "release-notes",
		subscribe: true,
		autoPush: false,
		consent: false,
	};
	const publication = {
		requestId: pull.requestId,
		draft: {
			sourceSkill: "release-notes",
			localAlias: "release-notes-copy",
			visibility: "public",
			tenantId: null,
			subscribe: true,
			autoPush: false,
			confirmPublicEgress: false,
		},
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
		assert.equal(
			state.remote.length,
			0,
			"three legacy flags and unknown keys must NOT open Skills",
		);
		for (const value of [0, undefined]) {
			const caps = {
				...released,
				features: {
					...released.features,
					...(value === undefined ? {} : { hub_skills: value }),
				},
			};
			await act(async () => {
				client.setQueryData(["desktop", "capabilities"], caps);
				await pause();
			});
			await act(async () => {
				await Promise.all([
					exposed.pub.refetch(),
					exposed.org.refetch(),
					exposed.pubDetail.refetch(),
					exposed.orgDetail.refetch(),
				]);
			});
			assert.equal(
				state.remote.length,
				0,
				"manual refetch must recheck current capability",
			);
			await assert.rejects(
				exposed.pull.mutateAsync(pull),
				/complete Hub Skills adapter/,
			);
			await assert.rejects(
				exposed.publish.mutateAsync(publication),
				/complete Hub Skills adapter/,
			);
		}
		for (const version of [0, undefined]) {
			const unsupported = {
				...released,
				features: {
					...released.features,
					...(version === undefined ? {} : { hub_skills: version }),
				},
			};
			state.capabilities = unsupported;
			await act(async () => {
				client.setQueryData(["desktop", "capabilities"], unsupported);
				await pause();
				await exposed.pub.refetch();
			});
			await assert.rejects(
				exposed.pull.mutateAsync(pull),
				/complete Hub Skills adapter/,
			);
			assert.equal(
				state.remote.length,
				0,
				"unknown/zero capability starts no remote Skills calls",
			);
		}
		const enabled = {
			...released,
			features: { ...released.features, hub_skills: 1 },
		};
		state.capabilities = enabled;
		await act(async () => {
			client.setQueryData(["desktop", "capabilities"], enabled);
			await pause();
		});
		assert.deepEqual(
			new Set(state.remote.map((x) => x.kind)),
			new Set(["public-list", "org-list", "public-detail", "org-detail"]),
		);
		await act(async () => {
			await exposed.pull.mutateAsync(pull);
			await exposed.publish.mutateAsync(publication);
			await pause();
		});
		assert(state.requests.some((x) => x.op === "hub.skillPull"));
		assert(state.requests.some((x) => x.op === "hub.skillPublish" && x.dryRun));
		/*
		 * The two membership acts are separate ops with separate bodies: a
		 * subscribe names the remote identity and an alias and carries no policy,
		 * and an unpull names the LOCAL link and nothing else. Both seed the
		 * inventory from their own answer, so a card can change state without
		 * waiting for the next poll.
		 */
		await act(async () => {
			await exposed.subscribe.mutateAsync({
				requestId: "12345678-1234-4123-8123-123456789abd",
				remoteId: "skill-release-notes",
				scope: { visibility: "public", tenantId: null, organization: null },
				alias: "release-notes",
			});
			await exposed.unpull.mutateAsync({
				requestId: "12345678-1234-4123-8123-123456789abe",
				linkId: "synthetic-link",
			});
			await pause();
		});
		const subscribeWrite = state.requests.find(
			(x) => x.op === "hub.skillSubscribe",
		);
		assert.deepEqual(
			{
				hubId: subscribeWrite.hubId,
				localAlias: subscribeWrite.localAlias,
				visibility: subscribeWrite.visibility,
				tenantId: subscribeWrite.tenantId,
			},
			{
				hubId: "skill-release-notes",
				localAlias: "release-notes",
				visibility: "public",
				tenantId: null,
			},
		);
		assert(
			!("subscribe" in subscribeWrite),
			"a subscribe carries no install policy",
		);
		/*
		 * THE SEAM QA FOUND (F1, PR #1269): core approves the base its config
		 * normalises to, which carries `/v1`; the bare origin is refused
		 * `origin-conflict`. Both writes and the link join name the same address.
		 */
		assert.equal(
			subscribeWrite.hubSource,
			"http://127.0.0.1:8127/v1",
			"a skill write names the approved (versioned) hub source",
		);
		assert.equal(
			state.requests.find((x) => x.op === "hub.skillPull").hubSource,
			"http://127.0.0.1:8127/v1",
		);
		const unpullWrite = state.requests.find((x) => x.op === "hub.skillUnpull");
		assert.equal(unpullWrite.linkId, "synthetic-link");
		assert(
			!("hubId" in unpullWrite),
			"unpull addresses the local link, never re-resolves the remote",
		);
		/*
		 * The cache-seeding half is deliberately NOT asserted through the query
		 * cache: this client runs `gcTime: 0`, so the inactive inventory query is
		 * collected the moment `onSettled` invalidates it and a read here would
		 * report `undefined` whether or not the write seeded it. What is observable
		 * is the wire: each act is its own op with its own body, which is what the
		 * assertions above read. All three skill writes share one seeding helper
		 * (`seedSkillLinkWrite`) so they cannot drift.
		 */
		const failedRemoteCount = state.remote.length;
		await act(async () => {
			client
				.getQueryCache()
				.find({ queryKey: ["desktop", "capabilities"] })
				.setState({
					status: "error",
					error: new Error("synthetic negotiation failure"),
				});
			await pause();
			await exposed.pub.refetch();
		});
		await assert.rejects(
			exposed.pull.mutateAsync(pull),
			/complete Hub Skills adapter/,
		);
		assert.equal(
			state.remote.length,
			failedRemoteCount,
			"failed negotiation cannot reuse stale positive capability data",
		);
		await act(async () => {
			client.setQueryData(["desktop", "capabilities"], enabled);
			await pause();
		});
		const retained = { ...exposed };
		state.hold = true;
		let pendingRead;
		await act(async () => {
			pendingRead = retained.pub.refetch();
			await pause();
		});
		assert(
			state.pending.length > 0 &&
				client.getQueryState([
					"hub-skills",
					"http://127.0.0.1:8127",
					"public",
					null,
					1,
				])?.fetchStatus === "fetching",
			"withdrawal is tested with a genuinely pending remote read",
		);
		const beforeRemote = state.remote.length;
		const beforeWrites = state.requests.filter((x) =>
			x.op.startsWith("hub.skill"),
		).length;
		state.capabilities = released;
		await act(async () => {
			client.setQueryData(["desktop", "capabilities"], released);
			await pause();
		});
		await act(async () => {
			for (const resolve of state.pending.splice(0)) resolve();
			await pendingRead;
			state.hold = false;
			await retained.pub.refetch();
			await retained.orgDetail.refetch();
		});
		await assert.rejects(
			retained.pull.mutateAsync(pull),
			/complete Hub Skills adapter/,
		);
		await assert.rejects(
			retained.publish.mutateAsync(publication),
			/complete Hub Skills adapter/,
		);
		await assert.rejects(
			retained.subscribe.mutateAsync({
				requestId: "12345678-1234-4123-8123-123456789abf",
				remoteId: "skill-release-notes",
				scope: { visibility: "public", tenantId: null, organization: null },
				alias: "release-notes",
			}),
			/complete Hub Skills adapter/,
		);
		await assert.rejects(
			retained.unpull.mutateAsync({
				requestId: "12345678-1234-4123-8123-123456789ac0",
				linkId: "synthetic-link",
			}),
			/complete Hub Skills adapter/,
		);
		console.log(
			`capability withdrawal: pending read settled, remote calls ${beforeRemote} -> ${state.remote.length}, writes ${beforeWrites} -> ${state.requests.filter((x) => x.op.startsWith("hub.skill")).length}`,
		);
		assert.equal(
			state.remote.length,
			beforeRemote,
			"cap withdrawal blocks retained query callbacks",
		);
		assert.equal(
			state.requests.filter((x) => x.op.startsWith("hub.skill")).length,
			beforeWrites,
			"cap withdrawal blocks retained mutations",
		);
	} finally {
		await act(async () => root.unmount());
		client.clear();
	}
});

test("page gates its effective selection, entry and mount on complete adapter, not legacy link cap", () => {
	const page = readFileSync(
		"src/renderer/src/features/agent-hub/agent-hub-page.tsx",
		"utf8",
	);
	assert.match(
		page,
		/desktopFeatureEnabled\(\s*capabilities\.data,\s*"hub_skills"/,
	);
	assert(page.includes('requestedView === "skills" && !skillsAvailable'));
	assert(
		page.includes(
			'if (requestedView === "skills" && !skillsAvailable) setView("agents")',
		),
	);
	assert(
		!page.includes('desktopFeatureEnabled(capabilities.data, "hub_links")'),
	);
});

test("shared stub retains legacy links and refuses only unsafe public auto-push writes, not previews or read-only copies", async () => {
	const reservation = createServer();
	reservation.listen(0, "127.0.0.1");
	await once(reservation, "listening");
	const port = reservation.address().port;
	await new Promise((resolve) => reservation.close(resolve));
	const server = spawn(
		process.execPath,
		[
			"docs/evidence/hub-links/harness/stub-daemon.mjs",
			"--port",
			String(port),
			"--skills-adapter",
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	const exited = once(server, "exit");
	let logs = "";
	server.stderr.on("data", (b) => {
		logs += b;
	});
	const base = `http://127.0.0.1:${port}`;
	const request = async (path, body, method = "POST") => {
		const response = await fetch(
			base + path,
			body
				? {
						method,
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}
				: {},
		);
		return { status: response.status, body: await response.json() };
	};
	try {
		for (let i = 0; i < 100 && !logs.includes("listening"); i++) await pause();
		assert(logs.includes("listening"));
		assert.equal((await request("/health")).body.result.pid, server.pid);
		assert.equal(
			(await request("/v1/capabilities")).body.result.features.hub_skills,
			1,
		);
		const before = await request("/v1/desktop/hub/links");
		assert.equal(before.status, 200);
		assert(Array.isArray(before.body.result.links));
		const legacy = before.body.result.links.find(
			(row) => row.kind === "agent" && row.visibility === "org",
		);
		assert(legacy);
		const patch = await request(
			`/v1/desktop/hub/links/${legacy.link_id}`,
			{ expected_policy_revision: legacy.policy.revision, subscribe: false },
			"PATCH",
		);
		assert.equal(patch.status, 200);
		assert.equal(patch.body.result.link.policy.subscribe, false);
		assert.equal(
			(
				await request(
					`/v1/desktop/hub/links/${legacy.link_id}`,
					{ expected_policy_revision: "stale", subscribe: true },
					"PATCH",
				)
			).status,
			409,
		);
		const beforeUnsafe = await request("/v1/desktop/hub/links");
		const draft = {
			visibility: "public",
			tenant_id: null,
			source_skill: "release-notes",
			local_alias: "gate-test",
			subscribe: true,
			auto_push: true,
			confirm_public_egress: false,
		};
		assert(
			(
				await request("/v1/desktop/hub/skills/publish", {
					...draft,
					dry_run: true,
				})
			).body.result.preview,
			"preview without consent is valid and side-effect-free",
		);
		assert.equal(
			(
				await request("/v1/desktop/hub/skills/publish", {
					...draft,
					dry_run: false,
					preview_receipt: "receipt-stub-1",
					confirm_publish: true,
				})
			).status,
			422,
		);
		assert.equal(
			(await request("/v1/desktop/hub/skills/pull", draft)).status,
			422,
		);
		assert.deepEqual(
			(await request("/v1/desktop/hub/links")).body,
			beforeUnsafe.body,
			"refusal never writes inventory",
		);
		assert.equal(
			(
				await request("/v1/desktop/hub/skills/pull", {
					...draft,
					auto_push: false,
				})
			).status,
			200,
			"public copy without future autopush needs no grant",
		);
		assert.equal(
			(
				await request("/v1/desktop/hub/skills/pull", {
					...draft,
					confirm_public_egress: true,
				})
			).status,
			200,
		);
		assert.equal(
			(
				await request("/v1/desktop/hub/skills/publish", {
					...draft,
					dry_run: false,
					confirm_public_egress: true,
				})
			).status,
			200,
		);
	} finally {
		server.kill();
		await exited;
	}
});
