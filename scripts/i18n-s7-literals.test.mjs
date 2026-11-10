import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

// Bundle the production helpers together so catalogue registration and all copy
// readers share one locale owner. Synthetic translations test lookup timing
// without pretending that this English-only slice supplies audited translations.
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/i18n";',
			'export * from "./src/renderer/src/features/aida/aida-control";',
			'export * from "./src/renderer/src/features/chat/approval-words";',
			'export * from "./src/renderer/src/features/chat/components/run-details/mcp-failure";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	tsconfig: "tsconfig.web.json",
});
const api = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("S7 copy resolves on demand while approval wire words remain stable", () => {
	api.setLocale("en");
	assert.equal(
		api.aidaControlReceipt("status", { paused: true }).text,
		"Aida is paused.",
	);
	assert.equal(
		api.MCP_FAILURE_LEAD.cancel,
		"The cancellation could not be confirmed",
	);
	api.registerCatalogue("fr", {
		"ui.notices.aida.paused": "Aida en pause.",
		"ui.chat.run_details.mcp_failure.cancel_lead": "Annulation non confirmée",
		"ui.chat.run_details.mcp_failure.refused":
			"{lead} : refus sans changement.",
		"ui.chat.approval.option.approve": "Autoriser",
	});
	api.setLocale("fr");
	assert.equal(
		api.aidaControlReceipt("status", { paused: true }).text,
		"Aida en pause.",
	);
	assert.equal(api.MCP_FAILURE_LEAD.cancel, "Annulation non confirmée");
	assert.equal(
		api.mcpFailure("cancel", new api.DesktopControlError(409, "refused"), false)
			.message,
		"Annulation non confirmée : refus sans changement.",
	);
	assert.equal(api.APPROVAL_OPTIONS[0].label, "Approve");
	assert.equal(api.APPROVAL_OPTIONS[1].label, "Deny");
	assert.equal(api.approvalVerdict("Approve"), true);
	assert.equal(api.approvalVerdict("Deny"), false);
	assert.equal(api.approvalVerdict("Autoriser"), null);
	assert.equal(
		api.approvalOptionDisplay(api.APPROVAL_OPTIONS[0]).label,
		"Autoriser",
	);
	api.setLocale("en");
	api.clearRegisteredCatalogues();
});

test("S7 ICU messages preserve configuration examples, values and plural counts", () => {
	api.setLocale("en");
	assert.ok(
		api
			.t("ui.chat.run_details.mcp_auth.no_references")
			.includes("explicit ${NAME} references"),
	);
	assert.equal(
		api.t("ui.chat.run_details.child.brief.show_more", { count: 1 }),
		"Show 1 more line",
	);
	assert.equal(
		api.t("ui.chat.run_details.child.brief.show_more", { count: 1000 }),
		"Show 1000 more lines",
	);
	assert.equal(
		api.t("ui.notices.aida.open_fallback", {
			name: "Rae",
			detail: "Try again.",
		}),
		"Rae's conversation could not be opened, so you are in a new chat instead. Try again.",
	);
	assert.equal(
		api.t("ui.chat.run_details.mcp_auth.status", { status: "pending" }),
		"Sign-in pending.",
	);
});

test("S7 allowance keeps only the reviewed approval tokens and encoder diagnostics", () => {
	const { entries } = JSON.parse(
		readFileSync("i18n/literal-allowance.json", "utf8"),
	);
	const targets = [
		"agents-page.tsx",
		"aida-control.ts",
		"run-child-reader.tsx",
		"mcp-auth-dialog.tsx",
		"mcp-failure.ts",
	];
	for (const name of targets)
		assert.equal(
			entries.some((entry) => entry.file.endsWith(name)),
			false,
			name,
		);
	for (const name of ["approval-words.ts", "recording-encoder/main.ts"]) {
		assert.equal(
			entries.find((entry) => entry.file.endsWith(name)).ids.length,
			4,
			name,
		);
	}
});
