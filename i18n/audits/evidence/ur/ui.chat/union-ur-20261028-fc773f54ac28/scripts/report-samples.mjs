import { readFileSync } from "node:fs";
import IntlMessageFormat from "intl-messageformat";
const ur = JSON.parse(readFileSync("src/i18n/catalogues/ur/ui.chat.json", "utf8"));
const show = (key, args) =>
  console.log(`${key} ${JSON.stringify(args)} => ${JSON.stringify(new IntlMessageFormat(ur[key], "ur").format(args))}`);
show("ui.chat.composer.status.loop_progress_turns", { count: 1 });
show("ui.chat.composer.status.loop_progress_turns", { count: 2 });
show("ui.chat.composer.status.loop_progress_of_turns", { completed: 1, total: 10 });
show("ui.chat.checkpoint.turn", { turn: 3, total: 7 });
show("ui.chat.checkpoint.jump_user", { turn: 3, total: 7, clock: "15:42" });
show("ui.chat.header_identity.loading", { kind: "teams" });
show("ui.chat.hub_update.update_all", { count: 1234 });
show("ui.chat.hub_update.update_all_label", { kind: "agents", count: 3 });
show("ui.chat.question_dock.hint.prefix", { index: 2, total: 5 });
show("ui.chat.provider_error.headline.out_of_credits", { status: " (HTTP 402)", body: "Top up to continue." });
show("ui.chat.session_status.not_signed_in", { label: "Radient" });
show("ui.chat.session_status.not_signed_in_description", { label: "Radient" });
