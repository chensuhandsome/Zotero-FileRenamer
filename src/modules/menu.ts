/**
 * Right-click context menu registration for FileRenamer.
 */

import {
  filterItemsEligibleForLabelUpdate,
  getItemsInCurrentView,
  markAsBasic,
  numberFromBasics,
  clearLabels,
} from "./labeler";

const MENU_ID_PREFIX = "filerenamer-menu";

export function registerMenu(win: Window = Zotero.getMainWindow()): void {
  const doc = win?.document;
  if (!doc) return;

  unregisterMenu(win);

  const itemMenu = doc.getElementById("zotero-itemmenu");
  if (!itemMenu) return;

  const separator = doc.createXULElement("menuseparator");
  separator.id = `${MENU_ID_PREFIX}-separator`;
  itemMenu.appendChild(separator);

  // Main FileRenamer Menu container
  const mainMenu = doc.createXULElement("menu");
  mainMenu.id = `${MENU_ID_PREFIX}-main`;
  mainMenu.setAttribute("label", "FileRenamer");
  itemMenu.appendChild(mainMenu);

  const mainPopup = doc.createXULElement("menupopup");
  mainMenu.appendChild(mainPopup);

  // Update selected items from current basic set
  const numberItem = doc.createXULElement("menuitem");
  numberItem.id = `${MENU_ID_PREFIX}-number`;
  numberItem.setAttribute("label", "Update Labels");
  numberItem.addEventListener("command", async () => {
    const items = ZoteroPane
      .getSelectedItems()
      .filter((item: Zotero.Item) => item?.isRegularItem?.());
    if (items.length > 0) {
      await numberFromBasics(items, { createBasicForUnlabeled: true });
    }
  });
  mainPopup.appendChild(numberItem);

  // Mark selection as first-order/basic
  const markItem = doc.createXULElement("menuitem");
  markItem.id = `${MENU_ID_PREFIX}-mark`;
  markItem.setAttribute("label", "Mark as Basic");
  markItem.addEventListener("command", async () => {
    const items = ZoteroPane.getSelectedItems();
    if (items.length > 0) await markAsBasic(items);
  });
  mainPopup.appendChild(markItem);

  // Clear labels from the current selection only
  const clearItem = doc.createXULElement("menuitem");
  clearItem.id = `${MENU_ID_PREFIX}-clear`;
  clearItem.setAttribute("label", "Clear Labels");
  clearItem.addEventListener("command", async () => {
    const items = ZoteroPane.getSelectedItems();
    if (items.length > 0) await clearLabels(items);
  });
  mainPopup.appendChild(clearItem);

  mainPopup.appendChild(doc.createXULElement("menuseparator"));

  const updateAllItem = doc.createXULElement("menuitem");
  updateAllItem.id = `${MENU_ID_PREFIX}-update-all`;
  updateAllItem.setAttribute("label", "Update All");
  updateAllItem.addEventListener("command", async () => {
    const items = filterItemsEligibleForLabelUpdate(getItemsInCurrentView());

    if (items.length > 0) {
      await numberFromBasics(items);
    }
  });
  mainPopup.appendChild(updateAllItem);
}

export function unregisterMenu(win: Window = Zotero.getMainWindow()): void {
  const doc = win?.document;
  if (!doc) return;

  const sep = doc.getElementById(`${MENU_ID_PREFIX}-separator`);
  if (sep) sep.remove();

  const main = doc.getElementById(`${MENU_ID_PREFIX}-main`);
  if (main) main.remove();
}
