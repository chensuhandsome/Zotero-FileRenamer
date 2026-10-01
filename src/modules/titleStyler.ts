import { getLabelsFromItem, hasBasicLabel, hasDerivedLabel } from "./labeler";
import { Settings } from "./settings";

type RenderMethodName = "_renderPrimaryCell" | "_renderCell";

let patchedPrototype: any;
let patchedMethodName: RenderMethodName | null = null;
let originalRenderMethod: ((...args: any[]) => HTMLElement) | null = null;
let patchedOwnMethod = false;

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
  // Zotero 10 item lists can also contain collection, search and library-header rows.
  if (!textSpan || !item || typeof item.isRegularItem !== "function") return;

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
  // Zotero 7-9 render titles in ItemTree#_renderPrimaryCell; Zotero 10 renders
  // every cell through ItemTree#_renderCell.
  const methodName: RenderMethodName | null =
    typeof proto?._renderPrimaryCell === "function"
      ? "_renderPrimaryCell"
      : typeof proto?._renderCell === "function"
        ? "_renderCell"
        : null;
  if (!methodName) return;

  const originalRender = proto[methodName] as (...args: any[]) => HTMLElement;
  patchedPrototype = proto;
  patchedMethodName = methodName;
  originalRenderMethod = originalRender;
  patchedOwnMethod = Object.prototype.hasOwnProperty.call(proto, methodName);

  proto[methodName] = function(index: number, data: string, column: any) {
    const cell = originalRender.apply(this, arguments as any);
    if (methodName === "_renderCell" && !column?.primary) {
      return cell;
    }
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
  if (!patchedPrototype || !patchedMethodName || !originalRenderMethod) return;
  if (patchedOwnMethod) {
    patchedPrototype[patchedMethodName] = originalRenderMethod;
  } else {
    delete patchedPrototype[patchedMethodName];
  }
  patchedPrototype = null;
  patchedMethodName = null;
  originalRenderMethod = null;
  patchedOwnMethod = false;
}
