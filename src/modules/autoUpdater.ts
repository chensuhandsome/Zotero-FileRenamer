import { Settings } from "./settings";
import { filterItemsEligibleForLabelUpdate, numberFromBasics } from "./labeler";

let intervalId: ReturnType<typeof setInterval> | null = null;
const ADDON_NAME = "FileRenamer";

export function startAutoUpdater(): void {
  // Clear any existing interval
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  if (!Settings.autoUpdateEnabled) return;

  const freqMs = Settings.autoUpdateFreqHours * 60 * 60 * 1000;
  
  Zotero.debug(`[${ADDON_NAME}] Starting Auto-Updater background task (Frequency: ${Settings.autoUpdateFreqHours}h)`);

  intervalId = setInterval(async () => {
    if (Settings.offlineMode || !Settings.autoUpdateEnabled) return;

    try {
      Zotero.debug(`[${ADDON_NAME}] Running silent auto-update loop...`);
      // Update all items in all libraries silently
      const libIDs = Zotero.Libraries.getAll().map(l => l.libraryID);
      for (const libID of libIDs) {
        const items = filterItemsEligibleForLabelUpdate(await Zotero.Items.getAll(libID));
        if (items.length > 0) {
          await numberFromBasics(items, { silent: true });
        }
      }
      Zotero.debug(`[${ADDON_NAME}] Silent auto-update loop finished successfully.`);
    } catch (err) {
      Zotero.logError(`[${ADDON_NAME}] Error in silent auto-update loop: ${err}`);
    }
  }, freqMs);
}

export function stopAutoUpdater(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    Zotero.debug(`[${ADDON_NAME}] Stopped Auto-Updater background task.`);
  }
}
