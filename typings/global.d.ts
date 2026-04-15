/**
 * Global type declarations for the Zotero FileRenamer plugin sandbox.
 *
 * In Zotero 7 bootstrap plugins, the code runs in a sandboxed context
 * where `_globalThis` is the root object, and Zotero globals like
 * `Zotero`, `ZoteroPane`, `window`, `document` are injected at runtime.
 */

/* eslint-disable no-var */

// The sandbox root object
declare var _globalThis: any;

// Plugin addon instance (set in index.ts)
declare var addon: import("../src/addon").default;

// Zotero globals injected by defineGlobal() in index.ts
declare var ZoteroPane: any;
declare var Zotero_Tabs: any;

// Zotero core is provided by zotero-types, but we add a fallback
declare namespace Zotero {
  const initializationPromise: Promise<void>;
  const unlockPromise: Promise<void>;
  const uiReadyPromise: Promise<void>;
  function getMainWindow(): Window & { alert: (msg: string) => void };
  function debug(msg: string): void;
  function logError(e: any): void;
  const Items: {
    get(ids: number | number[]): Zotero.Item[];
    getAll(libraryID: number): Promise<Zotero.Item[]>;
  };
  const ItemFields: {
    getID(field: string): number | false;
  };
  const DB: {
    valueQueryAsync(sql: string, params: any[]): Promise<any>;
    queryAsync(sql: string, params: any[]): Promise<any[]>;
  };
  const Prefs: {
    get(pref: string, global?: boolean): string | number | boolean;
    set(pref: string, value: string | number | boolean, global?: boolean): void;
    registerObserver(pref: string, cb: () => void, immediate: boolean): symbol;
    unregisterObserver(id: symbol): void;
  };
  const HTTP: {
    request(method: string, url: string, options?: any): Promise<{status: number, responseText: string}>;
  };
  const Utilities: {
    Internal: {
      copyTextToClipboard?: (text: string) => void;
    };
  };

  interface Item {
    isRegularItem(): boolean;
    getField(field: string): string | number | undefined;
    setField(field: string, value: string | number): void;
    saveTx(): Promise<void>;
  }
}

// Mozilla/Zotero bootstrap globals
declare var Components: any;
declare var Services: any;
declare var Cc: any;
declare const APP_SHUTDOWN: number;
declare var rootURI: string;

declare namespace Zotero {
  const PreferencePanes: {
    register(options: {
      pluginID: string;
      src: string;
      label: string;
      image?: string;
    }): Promise<string>;
  };
  const Libraries: {
    getAll(): Array<{ libraryID: number }>;
  };
  const File: {
    getContents(file: any): any;
    putContents(file: any, contents: string): void;
    pathToFile(path: string): any;
  };
}
