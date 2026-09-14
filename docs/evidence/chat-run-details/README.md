# Run details

Frames: the run-details popover (`docs/run-details.md`), ten story states in
the two brand themes — twenty frames.

The set's own record — the exact capture commands and port, what each frame
shows, the geometry measured off the pixels, and what these frames do not prove
— lives in [`../run-details/README.md`](../run-details/README.md).

**These frames were NOT re-taken by the change that swapped the trigger's glyph, and this note is the record of that rather than an omission.** The twenty frames here show the header trigger wearing `Activity`; the app now ships `Info` (`docs/composer-status-tabs.md` § 6), and the trigger's own frames were re-taken in the set that carries them (`../chat-run-panel/`). This set cannot be re-taken at all, and its own `supplementary` entry in `manifest.json` is the reason: it is a **preserved record of the retired popover**, swept while those stories existed, and its story ids are gone from `capture-evidence.mjs`'s `STORIES` — so no sweep can regenerate it, and it describes a surface the tree no longer has rather than making a claim about the one it does. Left as it stands on purpose: a preserved record that gets partially refreshed stops being one.
