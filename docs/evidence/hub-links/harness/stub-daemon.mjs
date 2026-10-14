/**
 * A stand-in for `local_operator serve`, for the hub-links frames.
 *
 * WHY THIS EXISTS. The desktop hub surface (`hub.links` inventory, its
 * policy controls, its skill library and its explicit source confirmation on a
 * legacy unknown-origin row) is being built against the FROZEN wire receipt
 * (`b-wire-receipt-definition-cas-and-adopt.md`), and the core route that will
 * serve it is still being extended to that shape. So there is no daemon on this
 * machine that answers `/v1/desktop/hub/links` yet, and a scene that drives the
 * panel needs one. This is that daemon: it answers the FROZEN receipt's shapes
 * and nothing else.
 *
 * WHAT IT IS NOT. Not a backend: no real hub, no store beyond what its routes
 * mutate, no merges. It fixture-covers the states the panel draws - a healthy
 * public agent link, an org team link, a skill link, and one legacy
 * unknown-origin row the explicit source confirmation is for. Every op it has no
 * answer for is answered 503 and named on stderr, so a scene that needs one shows
 * up as a missing route rather than as a screen that quietly did not paint.
 *
 * IT IS STATEFUL, deliberately (the policy PATCH and the resolve arm mutate
 * `links`), so give each launch its own process - `--records` is per process.
 *
 * Usage: node stub-daemon.mjs --port <n> --records <dir>
 *
 * `--records` is the directory the DRIVER copies into the app's own
 * `<config>/run/serve`, which is how `discovery.ts` admits a daemon at all: a
 * record, a live pid, and a `/health` answer naming the same `instance_id`.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const arg = (name, fallback = null) => {
	const at = process.argv.indexOf(`--${name}`);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};

const PORT = Number(arg("port", "18234"));
const RECORDS = arg("records", null);
const INSTANCE_ID = randomUUID();
const startedAt = Date.now() / 1000;

/** One approved, credential-free source. The panel contributes exactly this. */
const SOURCE = "https://hub.radient.local";
const TENANT_ID = "org-minerva";
const TENANT_NAME = "Minerva";

/** A direction status whose shape is the receipt's rich `HubDirectionStatus`. */
const direction = (overrides = {}) => ({
	state: "healthy",
	classification: null,
	enabled: true,
	last_checked_at: null,
	last_success_at: null,
	attempts: 0,
	next_retry_at: null,
	error_class: null,
	error_subclass: null,
	safe_message: null,
	operation_id: null,
	model_used: null,
	summary: null,
	backup_receipt: null,
	...overrides,
});

/**
 * The fixture rows, in the wire's own field names, one per state the panel draws.
 * `revision` is policy CAS: the PATCH below compares it so a concurrent edit is
 * refused rather than silently overwritten.
 */
const links = [
	{
		link_id: "link-public-agent",
		kind: "agent",
		local_id: "agent-1",
		name: "reviewer",
		hub_id: "hub-agent-reviewer",
		hub_source: SOURCE,
		visibility: "public",
		tenant_id: null,
		tenant_name: null,
		policy: { subscribe: true, auto_push: false, revision: "rev-agens-1" },
		eligibility: { can_auto_push: true, reason: null },
		baseline_state: "known",
		remote_revision: "rev-remote-1",
		auto_will_apply: true,
		auto_will_push: false,
		pull: direction({
			state: "healthy",
			last_success_at: "2026-10-13T10:00:00Z",
		}),
		push: direction({ state: "never", enabled: false }),
	},
	{
		link_id: "link-org-team",
		kind: "team",
		local_id: "team-1",
		name: "lopdev",
		hub_id: "hub-team-lopdev",
		hub_source: SOURCE,
		visibility: "org",
		tenant_id: TENANT_ID,
		tenant_name: TENANT_NAME,
		policy: { subscribe: false, auto_push: false, revision: "rev-team-1" },
		eligibility: {
			can_auto_push: false,
			reason: "auto-push is not enabled for this destination",
		},
		baseline_state: "unknown",
		remote_revision: null,
		auto_will_apply: false,
		auto_will_push: false,
		pull: direction({
			state: "failed",
			error_class: "hub-error/transport",
			attempts: 3,
			next_retry_at: "2026-10-13T11:00:00Z",
		}),
		push: direction({ state: "never", enabled: false }),
	},
	{
		link_id: "link-skill",
		kind: "skill",
		local_id: "skill-1",
		name: "release-notes",
		hub_id: "hub-skill-release-notes",
		hub_source: SOURCE,
		visibility: "public",
		tenant_id: null,
		tenant_name: null,
		policy: { subscribe: true, auto_push: true, revision: "rev-skill-1" },
		eligibility: { can_auto_push: true, reason: null },
		baseline_state: "known",
		remote_revision: "rev-remote-skill",
		auto_will_apply: true,
		auto_will_push: true,
		pull: direction(),
		push: direction({ state: "pending", operation_id: "op-push-1" }),
	},
];

/**
 * The legacy unknown-origin row: a link whose source was never confirmed, so the
 * panel draws the source-confirmation control instead of a healthy row. It is a
 * DIAGNOSTIC and not a link - it carries no policy, no link_id and no origin.
 * Once the resolve arm below is pressed it leaves this list and a real link
 * appears in `links`, which is the transition the scene photographs.
 */
const unresolved = [
	{
		kind: "agent",
		local_id: "agent-legacy",
		name: "legacy-helper",
		hub_id: "hub-agent-legacy",
		reason: "source-unresolved",
	},
];

/** Whether the source confirmation has been accepted for the legacy row. */
let legacyResolved = false;

const ok = (result) => ({ status: 200, body: { result } });

const route = (method, pathname, query, body) => {
	if (method === "GET" && pathname === "/health") {
		return ok({
			status: "ok",
			/*
			 * `pid` is REQUIRED, not decoration: `discovery.ts` matches the answering
			 * process's pid against the serve record's and REJECTS the record as
			 * `identity-mismatch` when it is absent ("The answering PID does not match
			 * the record."), so a daemon that answers without it is never admitted and
			 * the app stays offline. Measured: the first run of this scene answered
			 * `/health` without `pid` and the driver logged `no valid daemon among 1
			 * record(s)`.
			 */
			pid: process.pid,
			instance_id: INSTANCE_ID,
			version: "0.0.0-stub",
			prefix: process.cwd(),
			install_kind: "stub",
		});
	}
	/* The claim handshake, without which the app shows an "unattached" banner. */
	if (method === "POST" && pathname === "/v1/desktop/claim") {
		return ok({ claimed: true });
	}
	/*
	 * The app's ATTACH PROBE: `backend-service.ts` probes the daemon with a
	 * one-row session list before it attaches, and a 503 here reads as "answered
	 * this app's desktop read with HTTP 503" — the app then refuses to attach and
	 * every surface shows "Server is offline", which is what the first run of this
	 * scene measured. An EMPTY list is the honest answer (this fixture has no
	 * sessions; the hub frames are about a rule's policy, not a transcript), and
	 * it answers the probe the way a real daemon with no sessions would.
	 */
	if (method === "GET" && pathname === "/v1/desktop/sessions") {
		return ok({ sessions: [], truncated: false });
	}
	if (method === "GET" && pathname === "/v1/capabilities") {
		return ok({
			desktop_contract: 1,
			desktop_available: true,
			desktop_auth: "bearer",
			features: {
				auth: 1,
				settings: 1,
				commands: 1,
				catalogues: 1,
				lifecycle: 1,
				mcp: 1,
				radient: 1,
				profile_catalogue: 1,
				team_catalogue: 1,
				session_catalogue: 1,
				/*
				 * THE CAPABILITY THIS SCENE IS OF. A daemon that does not advertise
				 * `hub_links` leaves the panel unmounted entirely (`enabled` is
				 * `desktopFeatureEnabled(capabilities.data, "hub_links")`), so the
				 * capability and the route below describe one another.
				 */
				hub_links: 1,
			},
		});
	}
	if (method === "GET" && pathname === "/v1/desktop/hub/links") {
		/*
		 * The FROZEN receipt's inventory shape: `links` (healthy rows) and
		 * `unresolved` (legacy unknown-origin diagnostics). `?kind=` filters, and
		 * a filtered read still carries the full `unresolved` list the panel
		 * narrows itself - the route does not decide for the caller.
		 */
		const kind = query.get("kind");
		return ok({
			links: kind ? links.filter((row) => row.kind === kind) : links,
			unresolved,
		});
	}
	/*
	 * The two catalogues the agents page reads before it draws the detail pane
	 * the hub panel rides in. The linked rows' `local_id`s name these records, so
	 * the panel's `linksForLocalItem` filter resolves them here.
	 */
	if (method === "GET" && pathname === "/v1/desktop/profiles") {
		return ok({
			profiles: [
				{ name: "reviewer", source: "custom", description: "" },
				{ name: "coder", source: "custom", description: "" },
			],
		});
	}
	if (method === "GET" && pathname === "/v1/desktop/teams") {
		return ok({ teams: [{ name: "lopdev", description: "" }] });
	}
	const profileMatch = pathname.match(/^\/v1\/desktop\/profiles\/([^/]+)$/);
	if (method === "GET" && profileMatch) {
		const name = decodeURIComponent(profileMatch[1]);
		return ok({
			name,
			kind: "role",
			source: "custom",
			agent_id: "agent-1",
			description: "",
			instructions: "",
			tools: [],
			effort: null,
			delegate: false,
			definition_revision: "def-rev-1",
		});
	}
	const teamMatch = pathname.match(/^\/v1\/desktop\/teams\/([^/]+)$/);
	if (method === "GET" && teamMatch) {
		const name = decodeURIComponent(teamMatch[1]);
		return ok({
			name,
			id: "team-1",
			description: "",
			manager: "manager",
			members: [],
			aliases: [],
			instructions: "",
			project: "",
			definition_revision: "def-rev-2",
		});
	}
	/* Policy PATCH: CAS on the captured policy revision, per the receipt. */
	const policyMatch = pathname.match(/^\/v1\/desktop\/hub\/links\/([^/]+)$/);
	if (method === "PATCH" && policyMatch) {
		const link = links.find((row) => row.link_id === policyMatch[1]);
		if (!link) return { status: 404, body: { detail: "no such link" } };
		if (
			typeof body?.expected_policy_revision === "string" &&
			body.expected_policy_revision !== link.policy.revision
		) {
			return {
				status: 409,
				body: {
					detail: {
						code: "policy-revision-changed",
						message: "the policy changed since it was read",
					},
				},
			};
		}
		if (typeof body?.subscribe === "boolean")
			link.policy.subscribe = body.subscribe;
		if (typeof body?.auto_push === "boolean")
			link.policy.auto_push = body.auto_push;
		link.policy.revision = `rev-${randomUUID().slice(0, 8)}`;
		/* Return the whole row, which is what the client writes back into cache. */
		return ok({ link });
	}
	/*
	 * The source-resolution arm, on the EXISTING apply route. Only the fields the
	 * desktop transport sends are read: a request that names a resolve and carries
	 * the frozen shape succeeds; anything else falls through to the 503 below.
	 */
	if (method === "POST" && pathname === "/v1/desktop/hub/updates/apply") {
		if (body?.resolve_source === true) {
			const row = unresolved.find(
				(candidate) =>
					candidate.kind === body.kind && candidate.name === body.name,
			);
			if (!row) {
				return { status: 404, body: { detail: "no such unresolved row" } };
			}
			/*
			 * A PUBLIC resolution must not name an organization, and an ORG one must.
			 * The service owns this check; the stub states it so the scene can drive
			 * the refusal branch by choosing a destination.
			 */
			if (body.visibility === "org" && !body.tenant_id) {
				return {
					status: 422,
					body: { detail: "an org source resolution needs tenant_id" },
				};
			}
			if (body.visibility === "public" && body.tenant_id) {
				return {
					status: 422,
					body: {
						detail: "a public source resolution must not name an organization",
					},
				};
			}
			const isOrg = body.visibility === "org";
			const adopted = {
				link_id: `link-${row.local_id}`,
				kind: row.kind,
				local_id: row.local_id,
				name: row.name,
				hub_id: row.hub_id,
				hub_source: body.hub_source,
				visibility: body.visibility,
				tenant_id: isOrg ? body.tenant_id : null,
				tenant_name: isOrg ? TENANT_NAME : null,
				policy: { subscribe: false, auto_push: false, revision: "rev-new" },
				eligibility: {
					can_auto_push: false,
					reason: "a newly adopted source has no auto-push grant yet",
				},
				baseline_state: "unknown",
				remote_revision: null,
				auto_will_apply: false,
				auto_will_push: false,
				pull: direction({ state: "never" }),
				push: direction({ state: "never", enabled: false }),
			};
			if (!legacyResolved) {
				legacyResolved = true;
				unresolved.length = 0;
				links.push(adopted);
			}
			return ok({
				reports: [],
				/*
				 * `HubLinkActionResponse`: the full inventory under `links` and a
				 * `status` in the legacy `HubUpdates` shape, which is what the caller
				 * writes into each cache. A bare `{links,unresolved}` here would set
				 * the WRONG key and leave the panel reading a stale row.
				 */
				links: { links, unresolved },
				status: {
					generated_at: new Date().toISOString(),
					credential: "ok",
					settings: { auto_agents: true, auto_teams: true, interval_min: 15 },
					counts: {},
					items: [],
				},
				link: adopted,
				resolved: {
					source: adopted.hub_source,
					visibility: adopted.visibility,
					tenant_id: adopted.tenant_id,
					/*
					 * THE RESOLVE ARM ALWAYS RECORDS `adopt-unknown` (core
					 * `service.py` `resolve_source`), never the receipt's earlier
					 * shorthand `adopted`. The key is `baseline_state`.
					 */
					baseline_state: "adopt-unknown",
					scope_known: true,
				},
			});
		}
	}
	return {
		status: 503,
		body: { detail: `the stub has no answer for ${method} ${pathname}` },
	};
};

const server = createServer((request, response) => {
	const chunks = [];
	request.on("data", (chunk) => chunks.push(chunk));
	request.on("end", () => {
		const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
		let body = null;
		if (chunks.length > 0) {
			try {
				body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			} catch {
				body = null;
			}
		}
		const answer = route(
			request.method ?? "GET",
			url.pathname,
			url.searchParams,
			body,
		);
		process.stderr.write(
			`stub ${request.method} ${url.pathname}${url.search} -> ${answer.status}\n`,
		);
		response.writeHead(answer.status, { "content-type": "application/json" });
		response.end(JSON.stringify(answer.body));
	});
});

server.listen(PORT, "127.0.0.1", () => {
	process.stderr.write(`stub daemon listening on 127.0.0.1:${PORT}\n`);
	if (RECORDS) {
		mkdirSync(RECORDS, { recursive: true });
		const recordPath = join(RECORDS, `${process.pid}.json`);
		const write = () => {
			const now = Date.now() / 1000;
			writeFileSync(
				recordPath,
				JSON.stringify({
					pid: process.pid,
					host: "127.0.0.1",
					port: PORT,
					instance_id: INSTANCE_ID,
					version: "0.0.0-stub",
					source_ref: "hub-links-desktop",
					prefix: process.cwd(),
					install_kind: "stub",
					desktop: true,
					claim_key: "stub",
					started_at: startedAt,
					heartbeat_at: now,
				}),
			);
		};
		write();
		/*
		 * The heartbeat is not decoration: `discovery.ts` calls a record with a live
		 * pid and a STOPPED heartbeat `wedged`, and the app then shows a banner over
		 * the very surface these frames are of.
		 */
		setInterval(write, 5_000).unref();
		process.stderr.write(`serve record written to ${RECORDS}\n`);
	}
});
