import { isolateLtr, t } from "@shared/i18n";
import type { WorkingActivity } from "./working-line-model";

/**
 * The words for a working-line rung, in the ACTIVE language.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE LADDER. `working-line-model.ts` decides
 * which rung the pane is on and is locale-free by design: its output is compared
 * deeply by the clock logic and by tests, and a value that changed with the
 * language would restart a phase's clock on a language switch. This module is
 * the single place that turns a rung into a sentence, and `WorkingLine` calls it
 * at render under `useI18nLocale()` - `t()` reads the store at call time, so the
 * component's subscription is what repaints a line that is already on screen.
 *
 * The line is the machine-voice column (lower case, no ellipsis); the catalogue
 * keys under `ui.chat.canonical.working_line.*` carry that register and say so in
 * their context notes.
 *
 * Two arms print what is not ours to translate:
 *  - `text` is the model's own stated intent or a subagent relay's progress
 *    string, shown exactly as written;
 *  - `running_tool`'s `tool` is a machine identifier, inserted verbatim (wrapped
 *    in a directional isolate only under an RTL locale, so an identifier does not
 *    reorder the sentence around it).
 */
export const workingActivityText = (activity: WorkingActivity): string => {
	switch (activity.kind) {
		case "thinking":
			return t("ui.chat.canonical.working_line.thinking");
		case "responding":
			return t("ui.chat.canonical.working_line.responding");
		case "waiting_for_agent":
			return t("ui.chat.canonical.working_line.waiting_for_agent");
		case "starting_session":
			return t("ui.chat.canonical.working_line.starting_session");
		case "compacting":
			return t("ui.chat.canonical.working_line.compacting");
		case "stopping":
			return t("ui.chat.canonical.working_line.stopping");
		case "running_tool":
			return t("ui.chat.canonical.working_line.running_tool", {
				tool: isolateLtr(activity.tool),
			});
		case "running_tools":
			return t("ui.chat.canonical.working_line.running_tools", {
				count: activity.count,
				count_display: String(activity.count),
			});
		case "composing":
			return t("ui.chat.canonical.working_line.composing", {
				count: activity.count,
				count_display: String(activity.count),
			});
		case "queued":
			return t("ui.chat.canonical.working_line.queued", {
				count: activity.count,
				count_display: String(activity.count),
			});
		case "text":
			return activity.text;
	}
};
