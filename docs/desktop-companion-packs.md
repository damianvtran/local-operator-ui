# Desktop companion

Choose a companion during setup or in **Settings > Appearance**. It stays off until
you enable it; existing saved choices are kept.

Click the pet to say hi; use its chat button or right-click **Chat** to talk in the
same chief-of-staff conversation as Quick send. The **+** menu offers **New chat**
for a separate conversation using your default model, or **Chief of staff** to return.
Switching keeps your unsent draft; a pending send must settle before you can switch.
Showing the pet never enables or resumes the chief of staff.

Drag to move the pet, or use the arrow keys while it has focus. In chat, Enter sends,
Shift+Enter adds a line, and Escape collapses the input. Drafts survive collapsing and
hiding, but not quitting. Right-click to hide, change characters, or open the app.
The alert button opens a task that needs attention. Use **Open app** for approvals,
attachments, model selection, or history.

Companions sleep when quiet; click or move them to wake them. Idle animations and
play give way to chat and work. During play, click or press Enter to interact, and
use Left or Right to choose a side. Escape, dragging, or opening chat ends play.
Reduced motion disables movement and blinking and lets you play at your own pace.

## Custom characters

Choose **Add your own** in **Settings > Appearance**, right-click the pet and choose
**Character > Add character…**, or use
**View > Companion character > Add character…**. Select a transparent PNG, or a JSON
pack for different task states. Use a consistent, tightly framed transparent canvas
for every pose: the pet appears in a 110-pixel square, so large empty margins make it look small.

A pack uses this JSON format:

```json
{
  "version": 1,
  "name": "My companion",
  "pixelated": false,
  "frames": {
    "idle": "idle.png",
    "working": "working.png",
    "attention": "attention.png",
    "complete": "complete.png",
    "error": "error.png",
    "offline": "offline.png",
    "sleeping": "sleeping.png"
  }
}
```

Only `idle` is required; omit missing task poses to use it as the fallback. The optional
`sleeping` pose appears when the companion dozes; without it, your existing image
settles down with a small sleep mark. Waking restores the current task pose. Images must
be still PNGs, at most 2048 × 2048 pixels and 2 MiB each. Paths are relative to the
pack folder and cannot leave it. Names may contain 1–64 characters. Up to 64 custom
characters can be imported. The app copies the files. Select your custom character,
then choose **Replace artwork…** in the character menu to import an edited pack;
**Remove character** removes the app's copy without changing your source files.
Custom images react to pressing, dragging, and affection, but only built-in
characters have separate animated eyes.

To share a character, send its source JSON and referenced PNGs together, keeping
the same relative folders and filenames. A single-image character only needs its PNG.
Include any artist credit or license in a separate text file; the pack JSON accepts
only the fields shown above.

The bundled Sprout, Hoodie, and Pixel artwork and sprite sheets were generated with
Codex image generation on 2026-09-22. Inky was adapted from user-provided artwork
with Codex image generation on 2026-09-23. Artwork keeps its own colors; controls
use the app theme.
