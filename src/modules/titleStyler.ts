import { getLabelsFromItem, hasBasicLabel, hasDerivedLabel } from "./labeler";
import { Settings } from "./settings";

let patchedPrototype: any;
let originalRenderPrimaryCell: ((...args: any[]) => HTMLElement) | null = null;

function getItemsViews(): any[] {
  const panes: any[] = [];
  try {
    const activePane = Zotero.getActiveZoteroPane?.();
    if (activePane) panes.push(activePane);
  } catch {
    //
  }
  try {
    const allPanes = Zotero.getZoteroPanes?.() as any[] | undefined;
    if (Array.isArray(allPanes)) panes.push(...allPanes);
  } catch {
    //
  }

  const seen = new Set<any>();
  const views: any[] = [];
  for (const pane of panes) {
    const itemsView = pane?.itemsView as any;
    if (!itemsView || seen.has(itemsView)) continue;
    seen.add(itemsView);
    views.push(itemsView);
  }
  return views;
}

function getItemTitleColor(item: Zotero.Item): string | null {
  const labels = getLabelsFromItem(item);

  if (hasBasicLabel(labels)) {
    const color = Settings.basicTitleColor.trim();
    if (Settings.highlightBasicTitles && color) {
      return color;
    }
    return null;
  }

  if (hasDerivedLabel(labels)) {
    const color = Settings.derivedTitleColor.trim();
    if (Settings.highlightDerivedTitles && color) {
      return color;
    }
  }

  return null;
}

function applyTitleStyle(item: Zotero.Item | undefined, cell: HTMLElement): void {
  const textSpan = cell.querySelector(".cell-text") as HTMLElement | null;
  if (!textSpan || !item) return;

  const color = getItemTitleColor(item);
  if (color) {
    textSpan.style.setProperty("color", color, "important");
  } else {
    textSpan.style.removeProperty("color");
  }
}

export function refreshBasicTitleStyling(): void {
  for (const itemsView of getItemsViews()) {
    try {
      const tree = itemsView?.tree;
      if (typeof tree?.invalidate === "function") {
        tree.invalidate();
      }
    } catch {
      //
    }
  }
}

export function installBasicTitleStyler(): void {
  if (patchedPrototype) return;

  const itemsView = getItemsViews()[0];
  if (!itemsView) return;

  const proto = Object.getPrototypeOf(itemsView);
  if (!proto || typeof proto._renderPrimaryCell !== "function") return;

  patchedPrototype = proto;
  originalRenderPrimaryCell = proto._renderPrimaryCell;

  proto._renderPrimaryCell = function(index: number, data: string, column: any) {
    const cell = originalRenderPrimaryCell!.apply(this, arguments as any);
    try {
      const item = this.getRow?.(index)?.ref as Zotero.Item | undefined;
      applyTitleStyle(item, cell);
    } catch {
      //
    }
    return cell;
  };
}

export function uninstallBasicTitleStyler(): void {
  if (!patchedPrototype || !originalRenderPrimaryCell) return;
  patchedPrototype._renderPrimaryCell = originalRenderPrimaryCell;
  patchedPrototype = null;
  originalRenderPrimaryCell = null;
}
