// English catalog. Structure mirrors de.ts; the satisfies-Assertion below
// TS-errors on missing or extra keys so the two stay in sync.

import type { de } from "./de";

import { shellEn } from "./parts/shell";
import { scriptEn } from "./parts/script";
import { dialogsEn } from "./parts/dialogs";
import { agentEn } from "./parts/agent";
import { agentModeEn } from "./parts/agentMode";

export const en: Record<keyof typeof de, string> = {
  // ---------- units ----------
  "units.scripts_one": "{count} script",
  "units.scripts_other": "{count} scripts",
  "units.pages_one": "1 page",
  "units.pages_other": "{count} pages",
  "units.words": "words",
  "units.word_one": "word",
  "units.word_other": "words",
  "units.ideas_one": "{count} idea",
  "units.ideas_other": "{count} ideas",

  // ---------- block types ----------
  "block.action": "Action",
  "block.character": "Character",
  "block.dialog": "Dialog",
  "block.parenthetical": "Paren.",

  // ---------- script stages (pipeline) ----------
  "stage.idea": "Idea",
  "stage.writing": "Writing",
  "stage.ready": "Ready to shoot",
  "stage.shot": "Shot",
  "stage.online": "Online",

  // ---------- length goal (target range) ----------
  "length.range.both": "{min}-{max}",
  "length.range.maxOnly": "up to {max}",
  "length.range.minOnly": "from {min}",

  // ---------- browser ----------
  "browser.import.title": "Import ScriptZ file",
  "browser.fileType": "ScriptZ file",
  "browser.trash": "Trash",
  "browser.newScript": "New script",
  "browser.empty.search.title": "No results for \"{query}\"",
  "browser.empty.folder.title": "\"{folder}\" is empty.",
  "browser.canvas.newFolder": "New folder",
  "browser.loadMore": "Load {n} more",
  "browser.sort.updated": "Modified",
  "browser.sort.created": "Created",
  "browser.sort.title": "Title",
  "browser.sort.label": "Sort · {value}",
  "browser.rowMore": "More actions",

  // ---------- folders ----------
  "folder.inbox": "No folder",
  "folder.new": "New folder",
  "folder.newDots": "New folder…",
  "folder.none": "No folder",
  "folder.placeholder": "e.g. TikTok",
  "folder.createTitle": "New folder",
  "folder.createSubmit": "Create",
  "folder.renameLabel": "New name",
  "folder.deleteTitle": "Delete \"{name}\"?",
  "folder.deleteBody.empty": "The folder is empty.",
  "folder.deleteBody.one": "The single script inside will be kept and can be found under \"All scripts\" afterwards.",
  "folder.deleteBody.many": "The {count} scripts inside will be kept and can be found under \"All scripts\" afterwards.",
  "folder.menu.rename": "Rename",
  "folder.menu.delete": "Delete folder",
  "folder.toast.created": "Folder \"{name}\" created",
  "folder.toast.renamed": "Folder renamed",
  "folder.toast.deleted": "Folder \"{name}\" deleted",
  "folder.toast.movedTo": "Moved to \"{name}\"",

  // ---------- script ----------
  "script.titleLabel": "New title",
  "script.renameTitle": "Rename",
  "script.renameEmptyHint": "Title can't be empty.",
  "script.menu.open": "Open",
  "script.menu.openPanel": "Open in side panel",
  "script.menu.openNewTab": "Open in new tab",
  "script.menu.rename": "Rename",
  "script.menu.duplicate": "Duplicate",
  "script.menu.move": "Move to folder",
  "script.menu.trash": "Move to trash",
  "script.toast.archived": "\"{title}\" moved to trash",
  "script.toast.duplicated": "Script duplicated",
  "script.toast.renamed": "Renamed",
  "script.toast.imported": "Script imported",
  "script.toast.importFailed": "Import failed: {message}",
  "script.toast.created": "\"{title}\" created",
  "script.duplicateSuffix": " (copy)",
  "script.titleAriaLabel": "Script title",

  // ---------- trash ----------
  "trash.empty": "Trash is empty.",
  "trash.restoreAll": "Restore all",
  "trash.emptyAll": "Empty trash",
  "trash.restoreOne": "Restore",
  "trash.purgeOne": "Delete permanently",
  "trash.deletedAt": "Deleted {when}",
  "trash.confirm.restoreAll.title": "Restore all?",
  "trash.confirm.restoreAll.body_one": "{count} script will be restored from the trash.",
  "trash.confirm.restoreAll.body_other": "All {count} scripts will be restored from the trash.",
  "trash.confirm.empty.title": "Empty trash?",
  "trash.confirm.empty.body_one": "{count} script will be deleted permanently. This action cannot be undone.",
  "trash.confirm.empty.body_other": "All {count} scripts will be deleted permanently. This action cannot be undone.",
  "trash.confirm.purge.title": "Delete permanently?",
  "trash.confirm.purge.body": "\"{title}\" will be deleted permanently.",
  "trash.toast.restoredAll_one": "{count} script restored",
  "trash.toast.restoredAll_other": "{count} scripts restored",
  "trash.toast.emptied": "Trash emptied",
  "trash.toast.restored": "Restored",
  "trash.toast.purged": "Permanently deleted",
  "trash.confirm.empty.button": "Empty",

  // ---------- activity ----------
  "activity.activeDaysNone": "No writing days yet",
  "activity.heatmap.title": "Activity · 365 days",
  "activity.heatmap.activeDays": "{count} active days",
  "activity.heatmap.aria": "Activity history of the last 365 days",
  "activity.heatmap.less": "Less",
  "activity.heatmap.more": "More",
  "activity.heatmap.tooltip.noActivity": "{date} · no activity",
  "activity.heatmap.tooltip.words_one": "{date} · {count} word",
  "activity.heatmap.tooltip.words_other": "{date} · {count} words",

  // ---------- editor (general) ----------
  "editor.empty.hint": "Start typing · {tab} switches block type · {first}–{last} direct",

  // ---------- validation errors (thrown from lib, surfaced as toasts) ----------
  "folder.error.emptyName": "Folder name must not be empty",
  "folder.error.lengthInvalid": "The target time must be a whole number of seconds (0 or more).",
  "folder.error.lengthOrder": "The minimum must be lower than the maximum.",
  "idea.error.emptyTitle": "Idea title must not be empty",

  // ---------- editor toolbar ----------
  "editor.loading": "Loading…",
  "editor.toast.snapshotSaved": "Version saved",
  "editor.toast.snapshotError": "Version error: {message}",
  "editor.toast.renameFailed": "Rename failed: {message}",
  "editor.toast.highlightFailed": "Highlight toggle failed: {message}",
  "editor.toast.resetDone": "Script reset. A version of the old content is saved in history.",
  "editor.toast.resetFailed": "Reset failed: {message}",
  "editor.recovery.title": "Script content unreadable",
  "editor.recovery.body": "The saved structure of this script could not be loaded. To keep your content safe from being overwritten with an empty version, the editor is paused.",
  "editor.recovery.hint": "Recommended: open the version history and restore an earlier version - it holds the content of every previous automatic version.",
  "editor.recovery.openSnapshots": "Open versions",
  "editor.recovery.reset": "Continue empty anyway",
  "editor.recovery.resetting": "Resetting…",
  "editor.recovery.tech": "Technical info",

  // ---------- runtime label format ----------
  "runtime.seconds": "{n} s",
  "runtime.minutes": "{m} min",
  "runtime.minutesSeconds": "{m}:{s} min",

  // ---------- snapshots dialog ----------
  "snapshots.title": "Versions",
  "snapshots.titleWithScript": "Versions - {title}",
  "snapshots.createManual": "Save a version now",
  "snapshots.restore": "Restore",
  "snapshots.delete": "Delete",
  "snapshots.empty": "No versions yet.",
  "snapshots.noneSelected": "No version selected.",
  "snapshots.previewBroken": "This version can't be displayed - its content is damaged.",
  "snapshots.badge.manual": "Manual",
  "snapshots.badge.auto": "Auto",
  "snapshots.toast.created": "Version created",
  "snapshots.toast.createFailed": "Version failed: {message}",
  "snapshots.toast.deleted": "Version deleted",
  "snapshots.toast.deleteFailed": "Delete failed: {message}",
  "snapshots.toast.restored": "Version restored",
  "snapshots.toast.restoreFailed": "Restore failed: {message}",
  "snapshots.confirm.delete.title": "Delete version?",
  "snapshots.confirm.delete.body": "This version will be removed permanently.",
  "snapshots.confirm.restore.title": "Restore version?",
  "snapshots.confirm.restore.body": "Current state will be saved as an automatic version. Continue?",

  // ---------- export ----------
  "export.button": "Export",
  "export.exporting": "Exporting…",
  "export.help.scriptz": "A ScriptZ file contains this script as a container and can be imported on another device (File → Import). Only the current script - no folder assignment, no version history.",
  "export.toast.saved": "Export saved",
  "export.toast.savedAt": "Export saved: {path}",
  "export.toast.downloaded": "File downloaded",
  "export.toast.failed": "Export failed: {message}",
  "export.pdf.characters": "Characters: {names}",
  "export.pdf.runtime": "Runtime {time}",
  "export.pdf.page": "Page {page} of {total}",

  // ---------- selection mode ----------
  "select.enter": "Select",
  "select.exit": "Done",
  "select.count": "{count} selected",
  "select.selectAll": "All",
  "select.all": "Select all",
  "select.group": "Select all in \"{name}\"",
  "select.clear": "Clear selection",
  "select.action.pdf": "As PDF",
  "select.empty": "Nothing selected.",
  "select.pdf.toast_one": "Exported {count} script as PDF",
  "select.pdf.toast_other": "Exported {count} scripts as PDF",
  "select.pdf.failed": "PDF export failed: {message}",

  // ---------- settings ----------
  "settings.characters.colorAria": "Change color for {name}",
  "settings.characters.reset": "Reset",
  "settings.about.sub": "Fast. Local. No account.",
  "settings.about.license": "License: MIT",
  "settings.about.developer.linkText": "AgentZ",
  "settings.about.repository.linkText": "github.com/AgentZ-Media/AgentZ",
  "settings.toast.colorFailed": "Saving color failed: {message}",
  "settings.toast.resetFailed": "Reset failed: {message}",

  // ---------- ideas ----------
  "ideas.card.linked.title": "Open linked script",
  "ideas.card.linked.stale": "Script deleted",
  "ideas.confirm.delete.title": "Delete idea?",
  "ideas.confirm.delete.body": "\"{title}\" will be deleted permanently. Any linked script remains.",
  "ideas.toast.deleted": "\"{title}\" deleted",

  // ---------- IdeaQuickCapture ----------
  "idea.quick.toast.remembered": "Idea \"{title}\" saved",

  // ---------- status strip ----------
  "save.navigationBlocked": "Changes could not be saved. Please try again.",
  "save.error.toast": "Script could not be saved: {message}",

  // ---------- character / color picker ----------
  "charDropdown.colorAria": "Change color for {name}",
  "colorPicker.aria": "Color for {name}",
  "colorPicker.placeholder": "#rrggbb",
  "colorPicker.apply": "OK",
  "colorPicker.reset.title": "Clear the app-wide override - the color falls back to the next free palette slot.",
  "colorPicker.reset.label": "Reset to default",

  // ---------- boot / errors ----------
  "boot.loadingScript": "Loading script…",
  "boot.error.title": "ScriptZ could not start",
  "boot.error.lede": "The database file could not be opened. Your scripts are most likely safe - the file is still in the app data directory untouched. Please copy the error below and send it to us.",

  // ---------- thrown errors ----------
  "error.ideaAlreadyConverted": "Idea has already been converted.",
  "error.scriptz.invalidContent": "content_json is not valid JSON: {message}",
  "error.scriptz.notUtf8": "File is not valid UTF-8: {message}",
  "error.scriptz.notJson": "File is not JSON: {message}",
  "error.scriptz.notObject": "File content is not an object.",
  "error.scriptz.badFormat": "Format marker missing or wrong (expected \"scriptz\", got {value}).",
  "error.scriptz.unsupportedVersion": "Version {version} is not supported - this app only reads version 1.",
  "error.scriptz.missingScript": "Field `script` is missing or not an object.",
  "error.scriptz.missingTitle": "Field `script.title` is missing or not a string.",
  "error.scriptz.missingContent": "Field `script.contentJson` is missing or not an object.",
  "error.scriptz.missingCharacters": "Field `script.characters` is missing or not an array.",
  "error.scriptz.invalidCharacter": "script.characters[{index}] has invalid name/color fields.",

  // ---------- area catalogs (parts/) ----------
  ...shellEn,
  ...scriptEn,
  ...dialogsEn,
  ...agentEn,
  ...agentModeEn,
};
