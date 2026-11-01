# File tree actions

Date: 2026-11-01. Status: design, awaiting approval.

## Why

The writer wants to manage the project's files from the left column the way they would in VS Code or Cursor, without switching to Finder. Today, right-clicking a row offers only "Protect from AI edits" / "Stop protecting".

## What the writer asked for (their decisions)

- Right-click a **file**: rename, copy, and similar actions.
- Right-click a **folder**: also **New File** and **New Folder**.
- **Copy** means copy a file or folder and **paste it into another folder**. It does not mean copying a path or text to the clipboard.
- **Drag and drop**, **undo for file actions**, and **multi-select** are all included.
- **Undo depends on focus:** Cmd+Z in the editor undoes typing, as today. Cmd+Z when the file tree was the last thing clicked undoes the last file action.

## Menus

All menus are native, like the existing tree and spell-check menus. Items that don't apply are left out, not greyed.

| Where | Items, in order (separators shown as ·) |
|---|---|
| A file | Rename · Duplicate · Cut, Copy · Reveal in Finder · Move to Trash · Protect from AI edits / Stop protecting |
| A folder | New File, New Folder · Rename · Cut, Copy, Paste · Reveal in Finder · Move to Trash · Protect from AI edits / Stop protecting |
| Empty space in either tree section | New File, New Folder · Paste (all at the top level of the project) |
| A multi-selection (right-click on a selected row) | Cut, Copy · Move to Trash · Protect from AI edits / Stop protecting |

- Protect and Stop protecting keep today's rules. Protect shows in the Project section; Stop protecting shows only on a Protected root. A multi-selection shows Protect only when every selected item is in Project, and Stop protecting only when every selected item is a Protected root. It shows neither for a mix.
- Paste appears only when the app's clipboard holds something.
- Rows inside a protected folder now get a menu too. It has the same file or folder items, minus Protect/Stop protecting. *(Claude's call: the writer manages chapters inside `drafts/`, so a menu there is needed.)*

## Keyboard shortcuts (tree focused only)

| Keys | Action |
|---|---|
| Return | Rename the selected item (Finder's convention) |
| Cmd+C / Cmd+X / Cmd+V | Copy / Cut / Paste into the selected folder, or into the selected file's folder |
| Cmd+D | Duplicate |
| Cmd+Backspace | Move to Trash |
| Cmd+Z / Cmd+Shift+Z | Undo / Redo the last file action |
| Up / Down arrows, Shift+arrows | Move the selection / extend it |

"Tree focused" means the last click or keyboard focus was inside the left column. These keys keep their normal meaning everywhere else: the editor, the chat box and text fields. *(Claude's call: Return to rename and Cmd+D to duplicate follow Finder.)*

## Multi-select

- Cmd-click toggles a row in or out of the selection. Shift-click selects the range of visible rows from the last clicked row. Clicking a row with no modifier selects just that row, and opens it if it's a file.
- Selection can span the Protected and Project sections.
- Right-clicking a row that is in the selection acts on the whole selection. Right-clicking a row outside it selects only that row first.
- If a selection holds both a folder and something inside that folder, actions apply to the folder only. Its contents go with it.

## Each action

All file-system work happens in the main process, behind new `window.canonball` calls. Every path goes through `resolveInside`, and nothing outside the project root is ever touched. These are the writer's own actions, so there are no Accept/Reject cards and the AI is not involved.

**Names.** A name typed by the writer must not be empty, must not contain `/` or `:`, must not start with `.`, and must not be `node_modules`. *(Claude's call: `:` because Finder shows `/` as `:`. A leading `.` would make the item vanish, because the tree hides dot-names.)* Invalid names show a short inline error and keep the edit box open.

- **New File** opens an inline name box in the target folder. Return creates `<name>.md`, never adding `.md` twice, as an empty file, and opens it in the editor. Escape cancels. *(Claude's call: always `.md`, because the tree only shows `.md` files and anything else would disappear.)*
- **New Folder:** an inline name box, then an empty folder. The new folder is expanded.
- **Rename:** an inline edit box over the row, pre-filled with the current name. For a file, the box excludes `.md` and only the name is selected. Return confirms, and Escape or clicking away cancels. Renaming to an existing name in the same folder is refused with an inline error. A change of case only (`chapter` to `Chapter`) must work on case-insensitive disks.
- **Duplicate:** creates `<name> copy.md`, then `<name> copy 2.md` and so on, next to the original. Folders are copied recursively as `<name> copy`.
- **Cut / Copy** put the selected paths on the app's own clipboard. This is not the Mac clipboard. Cut rows are shown faded until pasted.
- **Paste** into a folder, or into the top level:
  - Copy: copies each item, renaming on a name clash with the Duplicate rule. It never overwrites.
  - Cut: moves each item. On a name clash it uses the Duplicate naming rule too. Pasting a cut item back into its own folder does nothing.
  - Cut items leave the clipboard after one paste, and copied items stay.
  - Refused: pasting a folder into itself or into one of its own subfolders.
- **Drag and drop:** dragging rows (or the selection) onto a folder moves them there. Dropping on empty space in a section moves them to the top level. Holding Option while dropping copies instead of moving, as in Finder. The folder under the pointer is highlighted, and a folder hovered for about 1 second during a drag expands. Drop targets follow the same rules as Paste.
- **Reveal in Finder** uses `shell.showItemInFolder`.
- **Move to Trash:**
  - It asks first, as a native dialog: "Move "Chapter 3" to the Trash?" or "Move 4 items to the Trash?" For a folder it adds "and everything in it".
  - The item then moves into a holding area, `.canonball/trash/`. That area is hidden from the tree and from the AI, because dot-paths are already off limits.
  - When the project closes, the app quits, or the project is next opened (for leftovers), everything in the holding area moves to the Mac Trash with `shell.trashItem`, so it can still be recovered from there.
  - New projects' `.gitignore` gets `.canonball/trash/`.
- **Protect / Stop protecting:** same as today, extended to multi-selections.

## Things that move with a file

- **Protection follows the item.** Renaming or moving a protected entry (or one of its parent folders) rewrites that entry in `.canonball/project.json` to the new path. Main does the rewrite with the move, inside the same serialized settings queue, so the AI is never left with a gap where the item is unprotected. Anything copied or moved into a protected folder is protected because of where it now lives. A copy of a protected root pasted elsewhere is not protected unless it lands in a protected folder. *(Claude's call: a copy is a new thing, and the writer can protect it in one click.)* Moving a protected root into another protected folder folds it into that folder (`normalizeProtected`).
- **The open file follows.**
  - Before any action that touches the open file or one of its parent folders, the editor's pending save is flushed.
  - After a rename or move, the editor shows the file at its new path, without reloading or losing the cursor if possible.
  - After it's trashed, the editor closes the file.
- **Expanded folders stay expanded** after a rename or move.
- **Proposals:** an AI proposal card for a file that has since moved or been trashed will be refused on Accept by the existing checks. No change is needed. The card's existing error text is enough.

## Undo and redo

- One history per open project, for this session only. It is cleared when the project closes or switches. *(Writer agreed.)*
- Undoable actions: new file, new folder, rename, duplicate, paste (copy or cut), drag and drop, move to trash, protect and stop protecting. A multi-item action undoes as one step.
- How each one undoes:
  - Rename and move go back to the old path, protection included.
  - Copy, duplicate, new file and new folder move what they created into the holding area. If a new file has had text typed into it, undoing it still works but asks first: "Undo New File? "Chapter 4" has text in it. It will go to the Trash."
  - Trash restores from the holding area to the original path.
  - Protect and stop protecting restore the previous entry.
- **If the disk has changed** (the original path is now taken, or the item is gone), undo stops and shows the app error line, for example "Can't undo: "Chapter 3" already exists." The history entry is dropped. Undo never overwrites.
- Redo re-applies an undone step, with the same checks. Any new action clears the redo history.
- A small "Undo <action>" item is also added to the Edit menu, routed by focus. *(Claude's call: the existing Edit-menu Undo is the editor's `role: 'undo'`. Main must route Cmd+Z to the tree when the tree has focus, and the builder decides how.)*
- **The renderer decides focus.** Main forwards Undo and Redo, and the renderer sends each one to the tree or the editor. When the tree isn't focused, the editor's undo works exactly as it does today, from the keyboard and from the menu. *(Claude's call.)*
- **Nothing to undo in the tree** means Cmd+Z does nothing. It never falls through to the editor. *(Claude's call: undoing typing in a document you aren't looking at would be a surprise.)*
- **Trash steps remember their item in the holding area.** Each trashed item gets its own ID there. If that item is already gone, for example because the holding area was emptied to the Mac Trash after a crash and reopen, undo shows "Can't undo: it's already in the Trash" and drops the step. *(Claude's call.)*
- **Protection steps store a change, not a snapshot.** A step records which entries it added, removed or renamed. Undo applies the reverse change to the settings file as it is on disk, inside main's serialized queue, the same way right-click protection works today. It never restores a whole saved list, so it can't overwrite an outside change. If the reverse change no longer applies, the step is dropped with the "Can't undo" error. *(Claude's call.)*

## Clipboard scope

The app clipboard belongs to the open project. Switching or closing the project clears it. *(Claude's call.)*

## Constraints

- The AI never edits protected files (CLAUDE.md). Nothing here gives the AI new abilities, and the main-process guard is unchanged.
- The renderer touches the disk only through `window.canonball`, and every path is resolved inside the project root.
- The app never writes a file the writer didn't change. Every action here is a writer action. The settings file is written only when a protected entry actually moves or changes.
- Folder actions carry everything inside the folder, including files the tree doesn't show (images, `.txt`). The trash confirmation's "and everything in it" covers this.
- No emoji or symbol characters as icons. Any new icons are inline SVG.

## Non-goals

- Dragging files in from Finder, or out of the app to Finder.
- Using the Mac clipboard for files.
- Undo across app restarts.
- Opening a file in a new window or tab, "Open With", and "Copy Path".
- Showing non-`.md` files in the tree.

## Anti-goals

- Never overwrite or lose a file. Every clash renames, every delete is recoverable until the holding area moves to the Mac Trash, and from there the Mac Trash still has it.
- Never leave a protected item briefly unprotected during a rename or move.
- Never lose unsaved typing because the open file moved.

## Left to the builder

- How the inline name box looks and how it's positioned, matching existing row styles.
- How keyboard focus and the tree's "last focused" state are tracked.
- How the Edit menu's Undo is routed between the editor and the tree.
- The exact drag-and-drop mechanics (HTML5 drag events are fine) and the hover-to-expand timing.
- How the main-process file operations are split into modules.
