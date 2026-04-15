import { getLabelsFromItem } from "./labeler";
import { Settings } from "./settings";

const COLUMN_KEY = "filerenamerLabels";
let columnRegistered = false;

/**
 * Pads all numeric segments in a string to 6 digits for correct ASCII sorting.
 * E.g. "A1-2" → "A000001-000002", so A1-2 sorts before A1-10.
 */
function padNumericSegments(s: string): string {
  return s.replace(/\d+/g, m => m.padStart(6, "0"));
}

export async function registerFileRenamerColumn(): Promise<void> {
  if (columnRegistered) return;

  const manager = (Zotero as any).ItemTreeManager;
  if (!manager || !manager.registerColumn) return;

  try {
    manager.unregisterColumn?.(COLUMN_KEY);
  } catch (e) {}

  const result = await manager.registerColumn({
    dataKey: COLUMN_KEY,
    label: "Labels",
    pluginID: "", // empty so it doesn't get a hyphen and break resizing
    enabledTreeIDs: ["main"],
    flex: 0,
    width: "120",
    showInColumnPicker: true,
    columnPickerSubMenu: false,
    dataProvider: (item: Zotero.Item) => {
      const labels = getLabelsFromItem(item);
      if (labels.length === 0) return "";
      return `[${labels.join('][')}]`;
    },
    renderCell: (
      _index: number,
      data: string,
      column: any,
      _isFirstColumn: boolean,
      doc: Document
    ) => {
      const span = doc.createElement("span");
      span.className = `cell ${column.className}`;
      span.textContent = data;
      span.setAttribute("title", data);
      
      const color = Settings.labelColor;
      if (color && color !== "#000000") {
        span.style.setProperty("color", color, "important");
      }
      
      return span;
    },
    zoteroPersist: ["width", "hidden", "sortDirection"],
    sortable: true,
    sort: (a: Zotero.Item, b: Zotero.Item) => {
      const labelsA = getLabelsFromItem(a);
      const labelsB = getLabelsFromItem(b);
      
      // Items with no labels sort last
      if (labelsA.length === 0 && labelsB.length === 0) return 0;
      if (labelsA.length === 0) return 1;
      if (labelsB.length === 0) return -1;
      
      // Compare by padded primary label first
      const keyA = padNumericSegments(labelsA[0]);
      const keyB = padNumericSegments(labelsB[0]);
      const cmp = keyA.localeCompare(keyB);
      if (cmp !== 0) return cmp;
      
      // If primary labels match, compare by number of labels (fewer = higher rank)
      return labelsA.length - labelsB.length;
    }
  });

  if (result) {
    columnRegistered = true;
    manager.refreshColumns?.();
  }
}

export function unregisterFileRenamerColumn(): void {
  const manager = (Zotero as any).ItemTreeManager;
  if (!manager || !manager.unregisterColumn) return;
  
  try {
    manager.unregisterColumn(COLUMN_KEY);
    columnRegistered = false;
  } catch (e) {}
}
