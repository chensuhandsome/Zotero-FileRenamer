/* eslint-disable no-undef */

/**
 * Bootstrap file for Zotero FileRenamer plugin.
 * Based on a standard Zotero 7 bootstrap pattern.
 */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  await Zotero.initializationPromise;

  if (!rootURI) {
    rootURI = resourceURI.spec;
  }

  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  const ctx = {
    rootURI,
  };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/__addonRef__.js`,
    ctx,
  );
  try {
    await Zotero.__addonInstance__.hooks.onStartup();
  } catch (e) {
    Zotero.logError(e);
  }
}

async function onMainWindowLoad({ window }, reason) {
  try {
    await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
  } catch (e) {
    Zotero.logError(e);
  }
}

async function onMainWindowUnload({ window }, reason) {
  try {
    await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
  } catch (e) {
    Zotero.logError(e);
  }
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"]
      .getService(Components.interfaces.nsISupports).wrappedJSObject;
  }
  Zotero.__addonInstance__?.hooks.onShutdown();

  Cc["@mozilla.org/intl/stringbundle;1"]
    .getService(Components.interfaces.nsIStringBundleService)
    .flushBundles();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}
