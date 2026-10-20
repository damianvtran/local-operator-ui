/**
 * A HUB-ONLY stub for the Hub Skills surface QA pass.
 *
 * WHY THIS EXISTS, and why it is not `hub-links/harness/stub-daemon.mjs`. That
 * daemon is a *backend* fixture: it answers the desktop plane so a renderer can
 * be photographed against invented link rows, and its skill payloads were never
 * consumed by a real core. This pass drives the REAL core at
 * `hub_skills: 1`, which fetches `GET {base}/skills/:id` itself, so the stub
 * must satisfy the core's strict manifest validation
 * (`hub_sync/skill_document.py`): a SKILL.md with YAML frontmatter whose
 * `name`/`description` match the row exactly, and files under
 * `references/`, `scripts/` or `assets/`.
 *
 * It also carries the two lifecycle controls this matrix needs and the older
 * fixture has no equivalent for: an opaque revision bump (so an update can
 * arrive and the row can show it waiting) and an injectable failure (so a
 * per-row failure and its Retry can be observed instead of asserted).
 *
 * ENDPOINTS
 *   GET  /v1/skills?page&per_page   public catalogue, hub `{msg,result}` envelope
 *   GET  /v1/skills/:id             one manifest with files; 404 `{msg:"not found"}`
 *   POST /__fixture/revision {id, bump}  advance content_revision + revision
 *   POST /__fixture/fail {count, status} next N skill reads answer `status`
 *   POST /__fixture/clear           forget injected failures
 *   GET  /__fixture/state           what this stub currently serves
 *   GET  /health                    200, the core-agnostic probe
 *
 * NOT A BACKEND. It answers no `/v1/desktop/*` route; the app is pointed at the
 * real core. A request for one is a wiring mistake and answers 404 loudly.
 */

import { createServer } from "node:http";

const PORT = Number(arg("--port", "8127"));
const HOST = arg("--host", "127.0.0.1");

function arg(name, fallback) {
	const at = process.argv.indexOf(name);
	return at >= 0 ? process.argv[at + 1] : fallback;
}

/**
 * The served rows. `body` is the prose under the frontmatter and is versioned
 * with the row so a pull after a bump demonstrably wrote DIFFERENT bytes.
 */
const state = {
	skills: [
		{
			id: "skill-release-notes",
			name: "release-notes",
			description: "Draft release notes from a merged PR list.",
			content_revision: 1,
			bump: 0,
			body: "Version one of the stub body.",
		},
		{
			id: "skill-transcript-audit",
			name: "transcript-audit",
			description: "Audit a transcript for policy contradictions.",
			content_revision: 1,
			bump: 0,
			body: "Audit the transcript in one pass.",
		},
	],
	/*
	 * A row that EXISTS but must be invisible to anyone who cannot prove
	 * membership: excluded from the public list and answered 404 on detail, so
	 * an outsider's "no such row" and "not yours" are the same answer. This is
	 * how the real hub treats an org skill (routes.go optionalAuth), and it is
	 * the negative the surface must not leak.
	 */
	orgOnly: {
		id: "skill-org-playbook",
		name: "org-playbook",
		description: "Private playbook visible to its organization only.",
		content_revision: 9,
		bump: 0,
		body: "This body must never be served to an outsider.",
	},
	fail: { remaining: 0, status: 500 },
};

/**
 * The strict v1 manifest. The frontmatter is not decoration: the core's
 * `SkillDocument` refuses a SKILL.md whose frontmatter `name`/`description`
 * differ from the manifest's, so these are built from the same fields rather
 * than written twice.
 */
const documentFor = (row) => ({
	id: row.id,
	name: row.name,
	description: row.description,
	document_version: 1,
	visibility: "public",
	content_revision: row.content_revision,
	// Opaque INCLUDING quotes, exactly as the hub serves it.
	revision: `"rev-pub-${row.content_revision}"`,
	sync_contract: { revision_cas: 1, skills: 1 },
	files: [
		{
			path: "SKILL.md",
			content:
				`---\nname: ${row.name}\ndescription: ${row.description}\n---\n\n` +
				`# ${row.name}\n\n${row.body}\n`,
		},
		{
			path: "references/notes.md",
			content: `Reference notes for ${row.name}, revision ${row.content_revision}.\n`,
		},
		{
			path: "scripts/run.sh",
			content: "#!/bin/sh\necho stub-revision-" + row.content_revision + "\n",
		},
	],
});

const summary = (row) => ({
	id: row.id,
	name: row.name,
	description: row.description,
	document_version: 1,
	visibility: "public",
	content_revision: row.content_revision,
	revision: `"rev-pub-${row.content_revision}"`,
	sync_contract: { revision_cas: 1, skills: 1 },
});

const envelope = (result) => JSON.stringify({ msg: "ok", result });
const notFound = () => JSON.stringify({ msg: "not found" });

function readBody(request) {
	return new Promise((resolve) => {
		const chunks = [];
		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => {
			try {
				resolve(
					chunks.length
						? JSON.parse(Buffer.concat(chunks).toString("utf8"))
						: {},
				);
			} catch {
				resolve({});
			}
		});
	});
}

const server = createServer(async (request, response) => {
	const url = new URL(request.url, `http://${HOST}:${PORT}`);
	const { pathname, searchParams } = url;
	/*
	 * CORS, because the CLIENT here is the app's own renderer (`webSecurity:
	 * true`) fetching this origin cross-origin, exactly as it fetches the real
	 * hub. A real hub answers CORS; a stub that does not makes a working
	 * catalogue look broken and photographs the failure instead of the surface.
	 */
	const send = (status, body) => {
		response.writeHead(status, {
			"content-type": "application/json",
			"cache-control": "no-store",
			"access-control-allow-origin": "*",
			"access-control-allow-headers": "accept, content-type",
			"access-control-allow-methods": "GET, POST, OPTIONS",
			// Private Network Access: the renderer's page origin reaches a
			// loopback hub from a less-private context, which Chromium refuses
			// without this on the preflight (the "Failed to fetch" a missing
			// header produces looks exactly like the hub being down).
			"access-control-allow-private-network": "true",
		});
		response.end(body);
	};

	if (request.method === "OPTIONS") return send(204, "");

	if (pathname === "/health")
		return send(200, JSON.stringify({ status: "ok" }));

	if (request.method === "POST" && pathname === "/__fixture/revision") {
		const body = await readBody(request);
		const row = state.skills.find(
			(entry) => entry.id === (body.id ?? state.skills[0].id),
		);
		if (!row) return send(404, notFound());
		const bump = Number(body.bump ?? 1);
		row.content_revision += bump;
		row.body = `Body at content revision ${row.content_revision} (the stub was bumped).`;
		return send(
			200,
			JSON.stringify({ object: summary(row), state: state.skills }),
		);
	}

	if (request.method === "POST" && pathname === "/__fixture/fail") {
		const body = await readBody(request);
		state.fail = {
			remaining: Number(body.count ?? 1),
			status: Number(body.status ?? 500),
		};
		return send(200, JSON.stringify({ object: state.fail }));
	}

	if (request.method === "POST" && pathname === "/__fixture/clear") {
		state.fail = { remaining: 0, status: 500 };
		return send(200, JSON.stringify({ object: state.fail }));
	}

	if (request.method === "GET" && pathname === "/__fixture/state") {
		return send(
			200,
			JSON.stringify({
				object: {
					skills: state.skills.map(summary),
					org_only: summary(state.orgOnly),
					fail: state.fail,
				},
			}),
		);
	}

	if (pathname.startsWith("/v1/desktop/")) {
		// Wiring mistake: this process is the hub, never the app's backend.
		return send(
			404,
			JSON.stringify({ msg: "this stub is the hub, not a local backend" }),
		);
	}

	if (request.method === "GET" && pathname === "/v1/skills") {
		const page = Number(searchParams.get("page") ?? "1");
		const perPage = Number(searchParams.get("per_page") ?? "20");
		const records = state.skills.map(summary);
		return send(
			200,
			envelope({
				page,
				per_page: perPage,
				total_pages: 1,
				total_records: records.length,
				records,
				sync_contract: { revision_cas: 1, skills: 1 },
			}),
		);
	}

	const match = pathname.match(/^\/v1\/skills\/([^/]+)$/);
	if (request.method === "GET" && match) {
		if (state.fail.remaining > 0) {
			state.fail.remaining -= 1;
			return send(
				state.fail.status,
				JSON.stringify({ msg: "injected failure" }),
			);
		}
		const row = state.skills.find(
			(entry) => entry.id === decodeURIComponent(match[1]),
		);
		if (row) return send(200, envelope(documentFor(row)));
		// INCLUDING the org-only row: an outsider gets exactly the answer a
		// nonexistent id gets. The distinction is not disclosed anywhere.
		return send(404, notFound());
	}

	return send(404, notFound());
});

server.listen(PORT, HOST, () => {
	console.log(`[stub-hub] listening on http://${HOST}:${PORT}`);
	for (const row of state.skills) {
		console.log(
			`[stub-hub] ${row.id} name=${row.name} content_revision=${row.content_revision}`,
		);
	}
});
