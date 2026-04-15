/**
 * Settings Management for FileRenamer.
 * Reads/writes Zotero preferences using the correct prefsPrefix.
 */

const PREF_PREFIX = "extensions.zotero.filerenamer.";
const GLOBAL_PREF = true;

function getPref(name: string): boolean | string | number | undefined {
  return Zotero.Prefs.get(PREF_PREFIX + name, GLOBAL_PREF);
}

function setPref(name: string, value: boolean | string | number): void {
  Zotero.Prefs.set(PREF_PREFIX + name, value, GLOBAL_PREF);
}

export const Settings = {
  get autoUpdateFreqHours(): number {
    try {
      const val = getPref("autoUpdateFreqHours");
      return typeof val === "number" ? val : 24;
    } catch { return 24; }
  },
  set autoUpdateFreqHours(v: number) {
    setPref("autoUpdateFreqHours", v);
  },

  get autoUpdateEnabled(): boolean {
    try {
      const val = getPref("autoUpdateEnabled");
      return typeof val === "boolean" ? val : true;
    } catch { return true; }
  },
  set autoUpdateEnabled(v: boolean) {
    setPref("autoUpdateEnabled", v);
  },

  get offlineMode(): boolean {
    try {
      const val = getPref("offlineMode");
      return typeof val === "boolean" ? val : false;
    } catch { return false; }
  },
  set offlineMode(v: boolean) {
    setPref("offlineMode", v);
  },

  get maxLabelsShown(): number {
    try {
      const val = getPref("maxLabelsShown");
      return typeof val === "number" ? val : 5;
    } catch { return 5; }
  },
  set maxLabelsShown(v: number) {
    setPref("maxLabelsShown", v);
  },

  get basicTitleColor(): string {
    try {
      const val = getPref("labelColor");
      return typeof val === "string" ? val : "#dc2626";
    } catch { return "#dc2626"; }
  },
  set basicTitleColor(v: string) {
    setPref("labelColor", v);
  },

  get highlightBasicTitles(): boolean {
    try {
      const val = getPref("highlightBasicTitles");
      return typeof val === "boolean" ? val : false;
    } catch { return false; }
  },
  set highlightBasicTitles(v: boolean) {
    setPref("highlightBasicTitles", v);
  },

  get derivedTitleColor(): string {
    try {
      const val = getPref("derivedTitleColor");
      return typeof val === "string" ? val : "#2563eb";
    } catch { return "#2563eb"; }
  },
  set derivedTitleColor(v: string) {
    setPref("derivedTitleColor", v);
  },

  get highlightDerivedTitles(): boolean {
    try {
      const val = getPref("highlightDerivedTitles");
      return typeof val === "boolean" ? val : false;
    } catch { return false; }
  },
  set highlightDerivedTitles(v: boolean) {
    setPref("highlightDerivedTitles", v);
  },

  get labelColor(): string {
    return this.basicTitleColor;
  },
  set labelColor(v: string) {
    this.basicTitleColor = v;
  },

  get basicLabelPrefix(): string {
    try {
      const val = getPref("basicLabelPrefix");
      return typeof val === "string" ? val.trim() : "A";
    } catch { return "A"; }
  },
  set basicLabelPrefix(v: string) {
    setPref("basicLabelPrefix", v.trim());
  },
};
