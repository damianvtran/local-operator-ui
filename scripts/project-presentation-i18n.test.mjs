import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/* Execute the shipped helper and related-project button JSX, extracted with the
 * unique source boundaries rather than reimplementing their interpolation. This isolates
 * presentation from transport/polling and tests the actual expressions with SSR;
 * it is deliberately not full-component, layout, or native rendering evidence.
 * All paths resolve from this worktree, including the real catalogue and model.
 */
const editorsPath = resolve(
	"src/renderer/src/features/projects/components/project-editors.tsx",
);
const detailPath = resolve(
	"src/renderer/src/features/notifications/components/notification-detail.tsx",
);
const editors = readFileSync(editorsPath, "utf8");
const detail = readFileSync(detailPath, "utf8");
const helper = [...editors.matchAll(/^function editLabels\([\s\S]*?^\}/gm)];
assert.equal(helper.length, 1, "unique production helper boundary");
const calls = [
	...editors.matchAll(
		/editLabels\(\s*"([^"]+)",\s*(t\("ui\.projects\.project_editors\.[^"]+"\)),?\s*\)/g,
	),
];
const nouns = new Map(calls.map((match) => [match[1], match[2]]));
for (const field of ["title", "key", "status", "description"]) {
	assert.equal(nouns.get(field), `t("ui.projects.project_editors.${field}")`);
}
const buttons = [
	...detail.matchAll(
		/<button\s+type="button"\s+onClick=\{\(\) => onOpenProject\(project\.key\)\}[\s\S]*?<\/button>/g,
	),
];
assert.equal(buttons.length, 1, "unique production related-project button");
const bundle = await build({
	stdin: {
		contents: `import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { t, setLocale } from "./src/i18n";
import { projectStatusMeta } from "./src/renderer/src/features/projects/project-model";
import { InlineEditControls } from "./src/renderer/src/shared/components/inline-edit/inline-edit-controls";
${helper[0][0]}
const FolderKanban = () => null;
export { t, setLocale, projectStatusMeta, editLabels };
export const labelFor = (field) => editLabels(field, ({${[...nouns].map(([field, expression]) => `${JSON.stringify(field)}: () => ${expression}`).join(",")}})[field]());
export const card = (project) => renderToStaticMarkup(${buttons[0][0]});
export const controls = (labels, phase) => renderToStaticMarkup(<InlineEditControls api={{ labels, phase, dirty: true, slotRef: { current: null }, begin() {}, accept() {}, cancel() {} }} />);`,
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	banner: {
		js: `import { createRequire } from "node:module"; const require = createRequire(${JSON.stringify(import.meta.url)});`,
	},
	jsx: "automatic",
	write: false,
	alias: {
		"@shared/i18n": resolve("src/i18n/index.ts"),
		"@shared": resolve("src/renderer/src/shared"),
	},
});
const {
	t,
	setLocale,
	projectStatusMeta,
	editLabels,
	labelFor,
	card,
	controls,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const actions = {
	begin: "edit_field",
	accept: "save_field",
	cancel: "discard_the_field_edit",
	busy: "saving_the_field",
	retry: "retry_saving_the_field",
};
const manifest = JSON.parse(
	readFileSync(resolve("i18n/languages.json"), "utf8"),
);
const locales = manifest.languages
	.filter((entry) => ["source", "supported"].includes(entry.status))
	.map((entry) => entry.code);
for (const locale of [...locales, "fr"]) {
	test(`${locale}: every action uses the localized noun, not identity or user text`, () => {
		setLocale(locale);
		for (const field of ["title", "key", "status", "description"]) {
			const noun = t(`ui.projects.project_editors.${field}`);
			assert.notEqual(noun, `ui.projects.project_editors.${field}`);
			if (["fr", "es"].includes(locale)) assert.notEqual(noun, field);
			const labels = labelFor(field);
			assert.equal(labels.name, noun);
			for (const [action, key] of Object.entries(actions)) {
				assert.equal(
					labels[action],
					t(`ui.projects.project_editors.${key}`, { field: noun }),
					`${locale}/${field}/${action}`,
				);
			}
			assert.equal(
				labels.saved,
				t("ui.projects.project_editors.display_saved", { display: noun }),
			);
			assert.deepEqual(editLabels("SYNTHETIC_MACHINE_FIELD", noun), labels);
			for (const [phase, expected] of Object.entries({
				idle: { begin: labels.begin },
				editing: { cancel: labels.cancel, accept: labels.accept },
				saving: { cancel: labels.busy },
				error: { cancel: labels.cancel, accept: labels.retry },
			})) {
				const dom = new JSDOM(controls(labels, phase));
				try {
					for (const [control, label] of Object.entries(expected)) {
						const button = dom.window.document.querySelector(
							`[data-inline-edit-control="${control}"]`,
						);
						assert.ok(button, `${field}/${phase}/${control}`);
						assert.equal(button.getAttribute("aria-label"), label);
						assert.equal(button.getAttribute("title"), label);
					}
				} finally {
					dom.window.close();
				}
			}
		}
	});
	test(`${locale}: production related-project JSX agrees with chips and preserves unknown/user text`, () => {
		setLocale(locale);
		const project = {
			key: "synthetic-key",
			name: "USER_TITLE_unchanged",
			status: "active",
		};
		const before = structuredClone(project);
		const markup = card(project);
		assert.ok(markup.includes(project.name));
		assert.ok(markup.includes(`>${projectStatusMeta("active").label}</span>`));
		assert.ok(
			card({ ...project, status: "future_status_v2" }).includes(
				">future_status_v2</span>",
			),
		);
		assert.ok(
			!card({ ...project, status: "" }).includes(
				'class="text-ink-dim text-meta"',
			),
		);
		assert.deepEqual(project, before);
	});
}

test("presentation fixes leave field markers and wire payload expressions at the base", () => {
	/* These exact production expressions are deliberately not translated. Changes
	 * to their identity must be a separate wire-contract change, not this fix. */
	for (const expression of [
		"data-project-field={field}",
		"commitFields={(next) => ({ title: next.trim() })}",
		"commitFields={(next) => ({ name: next.trim() })}",
		'labels: editLabels("status", t("ui.projects.project_editors.status"))',
	])
		assert.ok(editors.includes(expression), expression);
});
