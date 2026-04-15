/**
 * Lifecycle hooks for Zotero FileRenamer plugin.
 */

import { config } from "../package.json";
import { registerMenu, unregisterMenu } from "./modules/menu";
import { startAutoUpdater, stopAutoUpdater } from "./modules/autoUpdater";
import { unregisterFileRenamerColumn } from "./modules/itemTreeColumns";
import {
  consumeInternalLabelUpdate,
  ensureLabelConsistencyBeforeActivation,
  filterItemsEligibleForLabelUpdate,
  numberFromBasics,
  reconcileLabelsOnItems,
} from "./modules/labeler";
import {
  installBasicTitleStyler,
  refreshBasicTitleStyling,
  uninstallBasicTitleStyler,
} from "./modules/titleStyler";

let autoUpdaterPrefObserverIDs: symbol[] = [];
let titleStylingPrefObserverIDs: symbol[] = [];
let itemNotifierID: string | undefined;
let pendingItemUpdateTimer: ReturnType<typeof setTimeout> | undefined;
let itemUpdateFlushInFlight = false;
const pendingAddedItemIDs = new Set<number>();
const pendingModifiedItemIDs = new Set<number>();
const ITEM_UPDATE_DEBOUNCE_MS = 350;

function ensurePendingItemFlush(): void {
  if (pendingItemUpdateTimer) {
    return;
  }

  pendingItemUpdateTimer = setTimeout(() => {
    pendingItemUpdateTimer = undefined;
    void flushPendingItemUpdates();
  }, ITEM_UPDATE_DEBOUNCE_MS);
}

function schedulePendingItemUpdates(
  itemIDs: number[],
  event: "add" | "modify",
): void {
  for (const itemID of itemIDs) {
    if (event === "modify") {
      pendingAddedItemIDs.delete(itemID);
      pendingModifiedItemIDs.add(itemID);
      continue;
    }

    if (!pendingModifiedItemIDs.has(itemID)) {
      pendingAddedItemIDs.add(itemID);
    }
  }

  ensurePendingItemFlush();
}

async function flushPendingItemUpdates(): Promise<void> {
  if (itemUpdateFlushInFlight) {
    if (
      (pendingAddedItemIDs.size > 0 || pendingModifiedItemIDs.size > 0) &&
      !pendingItemUpdateTimer
    ) {
      ensurePendingItemFlush();
    }
    return;
  }

  const modifiedItemIDs = [...pendingModifiedItemIDs];
  const addedItemIDs = [...pendingAddedItemIDs].filter(
    itemID => !pendingModifiedItemIDs.has(itemID),
  );
  pendingModifiedItemIDs.clear();
  pendingAddedItemIDs.clear();

  if (modifiedItemIDs.length === 0 && addedItemIDs.length === 0) {
    return;
  }

  itemUpdateFlushInFlight = true;
  try {
    const modifiedItems = Zotero.Items.get(modifiedItemIDs).filter(
      item => item && item.isRegularItem(),
    );
    if (modifiedItems.length > 0) {
      await reconcileLabelsOnItems(modifiedItems, {
        preferCurrentTitle: true,
        syncBaseFromCurrentTitle: true,
      });
      const itemsToUpdate = filterItemsEligibleForLabelUpdate(modifiedItems);
      if (itemsToUpdate.length > 0) {
        await numberFromBasics(itemsToUpdate, {
          silent: true,
          preferCurrentTitle: true,
        });
      }
    }

    const addedItems = Zotero.Items.get(addedItemIDs).filter(
      item => item && item.isRegularItem(),
    );
    if (addedItems.length > 0) {
      await reconcileLabelsOnItems(addedItems);
      const itemsToUpdate = filterItemsEligibleForLabelUpdate(addedItems);
      if (itemsToUpdate.length > 0) {
        await numberFromBasics(itemsToUpdate, { silent: true });
      }
    }

    refreshBasicTitleStyling();
  } catch (err) {
    Zotero.logError(`[FileRenamer] Failed automatic label refresh: ${err}`);
  } finally {
    itemUpdateFlushInFlight = false;
    if (
      (pendingAddedItemIDs.size > 0 || pendingModifiedItemIDs.size > 0) &&
      !pendingItemUpdateTimer
    ) {
      ensurePendingItemFlush();
    }
  }
}

function registerItemNotifier(): void {
  if (itemNotifierID) {
    return;
  }

  try {
    const callback = {
      notify: async (
        event: string,
        type: string,
        ids: number[] | string[],
      ) => {
        if (type !== "item" || (event !== "add" && event !== "modify")) {
          return;
        }

        const itemIDs: number[] = [];
        for (const id of ids) {
          const itemID = typeof id === "string" ? parseInt(id, 10) : id;
          if (!Number.isFinite(itemID)) {
            continue;
          }
          if (consumeInternalLabelUpdate(itemID)) {
            continue;
          }
          itemIDs.push(itemID);
        }

        if (itemIDs.length === 0) {
          return;
        }

        schedulePendingItemUpdates(itemIDs, event);
      },
    };

    itemNotifierID = Zotero.Notifier.registerObserver(
      callback,
      ["item"],
      "zotero-filerenamer-item-notifier",
    );
  } catch (err) {
    Zotero.logError(`[FileRenamer] Failed to register item notifier: ${err}`);
  }
}

function unregisterItemNotifier(): void {
  if (pendingItemUpdateTimer) {
    clearTimeout(pendingItemUpdateTimer);
    pendingItemUpdateTimer = undefined;
  }
  pendingAddedItemIDs.clear();
  pendingModifiedItemIDs.clear();

  if (!itemNotifierID) {
    return;
  }

  try {
    Zotero.Notifier.unregisterObserver(itemNotifierID);
  } catch {
    //
  }
  itemNotifierID = undefined;
}

export async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  // Register preferences pane.
  try {
    (Zotero.PreferencePanes as any).register({
      pluginID: "zotero-filerenamer@user",
      src: rootURI + "content/preferences.xhtml",
      label: "FileRenamer",
      defaultXUL: true,
    });
    Zotero.debug("[FileRenamer] Preferences pane registered successfully");
  } catch (err) {
    Zotero.logError("[FileRenamer] Failed to register preferences pane: " + err);
  }

  await ensureLabelConsistencyBeforeActivation();
  await onMainWindowLoad(Zotero.getMainWindow());

  Zotero.debug("[FileRenamer] Plugin started");
}

export async function onMainWindowLoad(_win: Window): Promise<void> {
  registerMenu(_win);
  unregisterFileRenamerColumn();
  installBasicTitleStyler();
  refreshBasicTitleStyling();
  startAutoUpdater();
  registerItemNotifier();

  if (
    autoUpdaterPrefObserverIDs.length === 0 &&
    (Zotero.Prefs as any).registerObserver
  ) {
    const prefNames = [
      `${config.prefsPrefix}.autoUpdateEnabled`,
      `${config.prefsPrefix}.autoUpdateFreqHours`,
    ];

    autoUpdaterPrefObserverIDs = prefNames.map((prefName) =>
      Zotero.Prefs.registerObserver(
        prefName,
        () => {
          startAutoUpdater();
        },
        true,
      ),
    );
  }

  if (
    titleStylingPrefObserverIDs.length === 0 &&
    (Zotero.Prefs as any).registerObserver
  ) {
    const prefNames = [
      `${config.prefsPrefix}.highlightBasicTitles`,
      `${config.prefsPrefix}.labelColor`,
      `${config.prefsPrefix}.highlightDerivedTitles`,
      `${config.prefsPrefix}.derivedTitleColor`,
    ];

    titleStylingPrefObserverIDs = prefNames.map((prefName) =>
      Zotero.Prefs.registerObserver(
        prefName,
        () => {
          refreshBasicTitleStyling();
        },
        true,
      ),
    );
  }

  Zotero.debug("[FileRenamer] Menu registered and Auto-Updater started");
}

export async function onMainWindowUnload(_win: Window): Promise<void> {
  unregisterMenu(_win);
}

export function onShutdown(): void {
  unregisterMenu();
  stopAutoUpdater();
  unregisterItemNotifier();
  for (const observerID of autoUpdaterPrefObserverIDs) {
    try {
      Zotero.Prefs.unregisterObserver(observerID);
    } catch {
      //
    }
  }
  autoUpdaterPrefObserverIDs = [];
  for (const observerID of titleStylingPrefObserverIDs) {
    try {
      Zotero.Prefs.unregisterObserver(observerID);
    } catch {
      //
    }
  }
  titleStylingPrefObserverIDs = [];
  uninstallBasicTitleStyler();
  // @ts-ignore
  addon.data.alive = false;
  Zotero.debug("[FileRenamer] Plugin shut down");
}
