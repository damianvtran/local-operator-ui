// Scratch repro (reviewer, ui#1970 round 4): does the DECIDED scope's own
// remembered conversation get restored when the opening corrects away from a seed?
import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { deferred, delay, mount, until } from "./fixtures/team-bridge-auth-owner-page.mjs";

const SHARED_HOME = { tenant_id: "org_shared", tenant_name: "Shared", role: "member", status: "active", is_home: true, plan: { status: "active", seats: 5 } };
const OTHER = { ...SHARED_HOME, tenant_id: "org_other", tenant_name: "Other", is_home: false };
const row = (o = {}) => ({ id: "bcv_shared", tenant_id: "org_shared", kind: "group", name: "Shared thread", visibility: "private", agent_capable: false, status: "open", created_by: "acct_a", last_message_at: "2026-10-23T12:00:00Z", latest_seq: 0, members: [{ account_id: "acct_a", kind: "human", display_label: "acct_a", state: "active", role: "member" }], last_read_seq: 0, unread_count: 0, muted: false, ...o });

for (const path of ["cached", "delayed"])
	test(`restart, memberships ${path}, STRICT=${process.env.STRICT ?? ""}: the default org's remembered conversation is restored`, async () => {
		const gate = path === "delayed" ? deferred() : null;
		const app = await mount({
			path: "/team-bridge", waitReady: false, membershipsGate: gate, memberships: [OTHER, SHARED_HOME],
			seed: ({ client, ui: bundle, fixture }) => {
				const all = [row(), row({ id: "bcv_shared2", name: "Shared second" }), row({ id: "bcv_other", tenant_id: "org_other", name: "Other thread" })];
				fixture.listFor = (req) => ({ conversations: req.scope === "account" ? all : all.filter((r) => r.tenant_id === req.tenant_id), has_more: false });
				localStorage.setItem("lo.teamBridge.scope.v1", JSON.stringify({ acct_a: "org_other" }));
				localStorage.setItem("lo.teamBridge.view.v1", JSON.stringify({ acct_a: { scope: "org_other", scopes: {
					org_other: { target: { type: "conversation", id: "bcv_other" }, tenantId: "org_other" },
					org_shared: { target: { type: "conversation", id: "bcv_shared2" }, tenantId: "org_shared" },
				} } }));
				client.setQueryData(bundle.teamBridgeKeys.conversations("all", "acct_a"), { conversations: [
					row(), row({ id: "bcv_shared2", name: "Shared second" }), row({ id: "bcv_other", tenant_id: "org_other", name: "Other thread" }),
				], has_more: false });
				if (path === "cached") client.setQueryData(["memberships", "account", "acct_a"], { memberships: [OTHER, SHARED_HOME] });
			},
		});
		try {
			if (gate) {
				await until(() => app.fixture.calls.some((c) => c.control?.operation === "memberships.list"), "memberships in flight");
				await delay(150);
				await act(async () => gate.resolve());
			}
			await until(() => app.frames.some((f) => f.scopeTitle === "Organization: Shared" && f.selectedId), "Shared with a selection");
			await delay(300);
			const sel = [...new Set(app.frames.map((f) => `${f.scopeTitle}|${f.selectedId}`))];
			console.log(path, "STRICT", process.env.STRICT ?? "", JSON.stringify(sel));
			assert.equal(app.frames.at(-1).selectedId, "bcv_shared2", `final selection; sequence ${JSON.stringify(sel)}`);
		} finally { await app.close(); }
	});
