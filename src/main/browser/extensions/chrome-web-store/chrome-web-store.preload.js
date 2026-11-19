// Vendored from electron-chrome-web-store@0.13.0 dist/chrome-web-store.preload.js
// (MIT, Copyright (c) Samuel Maddock). Two local edits, marked "local-operator edit".
// Provenance and original sha256: ../PROVENANCE.json ("chrome-web-store" entry).
"use strict";
(() => {
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });

  // src/renderer/chrome-web-store.preload.ts
  var import_electron = __require("electron");

  // src/common/constants.ts
  var ExtensionInstallStatus = {
    BLACKLISTED: "blacklisted",
    BLOCKED_BY_POLICY: "blocked_by_policy",
    CAN_REQUEST: "can_request",
    CORRUPTED: "corrupted",
    CUSTODIAN_APPROVAL_REQUIRED: "custodian_approval_required",
    CUSTODIAN_APPROVAL_REQUIRED_FOR_INSTALLATION: "custodian_approval_required_for_installation",
    DEPRECATED_MANIFEST_VERSION: "deprecated_manifest_version",
    DISABLED: "disabled",
    ENABLED: "enabled",
    FORCE_INSTALLED: "force_installed",
    INSTALLABLE: "installable",
    REQUEST_PENDING: "request_pending",
    TERMINATED: "terminated"
  };
  var MV2DeprecationStatus = {
    INACTIVE: "inactive",
    SOFT_DISABLE: "soft_disable",
    WARNING: "warning"
  };
  var Result = {
    ALREADY_INSTALLED: "already_installed",
    BLACKLISTED: "blacklisted",
    BLOCKED_BY_POLICY: "blocked_by_policy",
    BLOCKED_FOR_CHILD_ACCOUNT: "blocked_for_child_account",
    FEATURE_DISABLED: "feature_disabled",
    ICON_ERROR: "icon_error",
    INSTALL_ERROR: "install_error",
    INSTALL_IN_PROGRESS: "install_in_progress",
    INVALID_ICON_URL: "invalid_icon_url",
    INVALID_ID: "invalid_id",
    LAUNCH_IN_PROGRESS: "launch_in_progress",
    MANIFEST_ERROR: "manifest_error",
    MISSING_DEPENDENCIES: "missing_dependencies",
    SUCCESS: "success",
    UNKNOWN_ERROR: "unknown_error",
    UNSUPPORTED_EXTENSION_TYPE: "unsupported_extension_type",
    USER_CANCELLED: "user_cancelled",
    USER_GESTURE_REQUIRED: "user_gesture_required"
  };
  var WebGlStatus = {
    WEBGL_ALLOWED: "webgl_allowed",
    WEBGL_BLOCKED: "webgl_blocked"
  };

  // src/renderer/chrome-web-store.preload.ts
  function updateBranding(appName) {
    const update = () => {
      requestAnimationFrame(() => {
        const chromeButtons = Array.from(document.querySelectorAll("span")).filter(
          (node) => node.innerText.includes("Chrome")
        );
        for (const button of chromeButtons) {
          button.innerText = button.innerText.replace("Chrome", appName);
        }
      });
    };
    update();
    setTimeout(update, 1e3 / 60);
  }
  function getUAProductVersion(userAgent, product) {
    const regex = new RegExp(`${product}/([\\d.]+)`);
    return userAgent.match(regex)?.[1];
  }
  function overrideUserAgent() {
    const chromeVersion = getUAProductVersion(navigator.userAgent, "Chrome") || "133.0.6920.0";
    const userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    import_electron.webFrame.executeJavaScript(
      `(${function(userAgent2) {
        Object.defineProperty(navigator, "userAgent", { value: userAgent2 });
      }})(${JSON.stringify(userAgent)});`
    );
  }
  // local-operator edit 1: never log install details/results into the page console.
  var DEBUG = false;
  function log(...args) {
    if (!DEBUG) return;
    console.debug(...args);
  }
  function setupChromeWebStoreApi() {
    let appName;
    const setAppName = (name) => {
      appName = name;
      updateBranding(appName);
    };
    const maybeUpdateBranding = () => {
      if (appName) updateBranding(appName);
    };
    const setExtensionError = (message) => {
      import_electron.webFrame.executeJavaScript(`
      if (typeof chrome !== 'undefined') {
        if (!chrome.extension) chrome.extension = {};
        chrome.extension.lastError = ${JSON.stringify(message ? { message } : null)};
      }
    `);
    };
    const electronWebstore = {
      ExtensionInstallStatus,
      MV2DeprecationStatus,
      Result,
      WebGlStatus,
      beginInstallWithManifest3: async (details, callback) => {
        log("webstorePrivate.beginInstallWithManifest3", details);
        const { result, message } = await import_electron.ipcRenderer.invoke("chromeWebstore.beginInstall", details);
        log("webstorePrivate.beginInstallWithManifest3 result:", result);
        setExtensionError(result === Result.SUCCESS ? null : message);
        if (callback) callback(result);
        return result;
      },
      completeInstall: async (id, callback) => {
        log("webstorePrivate.completeInstall", id);
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.completeInstall", id);
        log("webstorePrivate.completeInstall result:", result);
        if (callback) callback(result);
        maybeUpdateBranding();
        return result;
      },
      enableAppLauncher: async (enable, callback) => {
        log("webstorePrivate.enableAppLauncher", enable);
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.enableAppLauncher", enable);
        log("webstorePrivate.enableAppLauncher result:", result);
        if (callback) callback(result);
        return result;
      },
      getBrowserLogin: async (callback) => {
        log("webstorePrivate.getBrowserLogin called");
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.getBrowserLogin");
        log("webstorePrivate.getBrowserLogin result:", result);
        if (callback) callback(result);
        return result;
      },
      getExtensionStatus: async (id, manifestJson, callback) => {
        log("webstorePrivate.getExtensionStatus", id, { id, manifestJson, callback });
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.getExtensionStatus", id, manifestJson);
        log("webstorePrivate.getExtensionStatus result:", id, result);
        if (callback) callback(result);
        maybeUpdateBranding();
        return result;
      },
      getFullChromeVersion: async (callback) => {
        log("webstorePrivate.getFullChromeVersion called");
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.getFullChromeVersion");
        log("webstorePrivate.getFullChromeVersion result:", result);
        if (result.app_name) {
          setAppName(result.app_name);
          delete result.app_name;
        }
        if (callback) callback(result);
        return result;
      },
      getIsLauncherEnabled: async (callback) => {
        log("webstorePrivate.getIsLauncherEnabled called");
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.getIsLauncherEnabled");
        log("webstorePrivate.getIsLauncherEnabled result:", result);
        if (callback) callback(result);
        return result;
      },
      getMV2DeprecationStatus: async (callback) => {
        log("webstorePrivate.getMV2DeprecationStatus called");
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.getMV2DeprecationStatus");
        log("webstorePrivate.getMV2DeprecationStatus result:", result);
        if (callback) callback(result);
        return result;
      },
      getReferrerChain: async (callback) => {
        log("webstorePrivate.getReferrerChain called");
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.getReferrerChain");
        log("webstorePrivate.getReferrerChain result:", result);
        if (callback) callback(result);
        return result;
      },
      getStoreLogin: async (callback) => {
        log("webstorePrivate.getStoreLogin called");
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.getStoreLogin");
        log("webstorePrivate.getStoreLogin result:", result);
        if (callback) callback(result);
        return result;
      },
      getWebGLStatus: async (callback) => {
        log("webstorePrivate.getWebGLStatus called");
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.getWebGLStatus");
        log("webstorePrivate.getWebGLStatus result:", result);
        if (callback) callback(result);
        return result;
      },
      install: async (id, silentInstall, callback) => {
        log("webstorePrivate.install", { id, silentInstall });
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.install", id, silentInstall);
        log("webstorePrivate.install result:", result);
        if (callback) callback(result);
        return result;
      },
      isInIncognitoMode: async (callback) => {
        log("webstorePrivate.isInIncognitoMode called");
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.isInIncognitoMode");
        log("webstorePrivate.isInIncognitoMode result:", result);
        if (callback) callback(result);
        return result;
      },
      isPendingCustodianApproval: async (id, callback) => {
        log("webstorePrivate.isPendingCustodianApproval", id);
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.isPendingCustodianApproval", id);
        log("webstorePrivate.isPendingCustodianApproval result:", result);
        if (callback) callback(result);
        return result;
      },
      setStoreLogin: async (login, callback) => {
        log("webstorePrivate.setStoreLogin", login);
        const result = await import_electron.ipcRenderer.invoke("chromeWebstore.setStoreLogin", login);
        log("webstorePrivate.setStoreLogin result:", result);
        if (callback) callback(result);
        return result;
      }
    };
    import_electron.contextBridge.exposeInMainWorld("electronWebstore", electronWebstore);
    const runtime = {
      lastError: null,
      getManifest: async () => {
        log("chrome.runtime.getManifest called");
        return {};
      }
    };
    import_electron.contextBridge.exposeInMainWorld("electronRuntime", runtime);
    const management = {
      onInstalled: {
        addListener: (callback) => {
          log("chrome.management.onInstalled.addListener called");
          import_electron.ipcRenderer.on("chrome.management.onInstalled", callback);
        },
        removeListener: (callback) => {
          log("chrome.management.onInstalled.removeListener called");
          import_electron.ipcRenderer.removeListener("chrome.management.onInstalled", callback);
        }
      },
      onUninstalled: {
        addListener: (callback) => {
          log("chrome.management.onUninstalled.addListener called");
          import_electron.ipcRenderer.on("chrome.management.onUninstalled", callback);
        },
        removeListener: (callback) => {
          log("chrome.management.onUninstalled.removeListener called");
          import_electron.ipcRenderer.removeListener("chrome.management.onUninstalled", callback);
        }
      },
      getAll: (callback) => {
        log("chrome.management.getAll called");
        import_electron.ipcRenderer.invoke("chrome.management.getAll").then((result) => {
          log("chrome.management.getAll result:", result);
          callback(result);
        });
      },
      setEnabled: async (id, enabled) => {
        log("chrome.management.setEnabled", { id, enabled });
        const result = await import_electron.ipcRenderer.invoke("chrome.management.setEnabled", id, enabled);
        log("chrome.management.setEnabled result:", result);
        return result;
      },
      uninstall: (id, options, callback) => {
        log("chrome.management.uninstall", { id, options });
        import_electron.ipcRenderer.invoke("chrome.management.uninstall", id, options).then((result) => {
          log("chrome.management.uninstall result:", result);
          setExtensionError(result && typeof result.error === "string" ? result.error : null);
          if (callback) callback();
        });
      }
    };
    import_electron.contextBridge.exposeInMainWorld("electronManagement", management);
    import_electron.webFrame.executeJavaScript(`
    (function () {
      chrome.webstorePrivate = globalThis.electronWebstore;
      Object.assign(chrome.runtime, electronRuntime);
      Object.assign(chrome.management, electronManagement);
      void 0;
    }());
  `);
    electronWebstore.getFullChromeVersion();
    overrideUserAgent();
    process.once("document-start", maybeUpdateBranding);
    if ("navigation" in window) {
      ;
      window.navigation.addEventListener("navigate", maybeUpdateBranding);
    }
  }
  // local-operator edit 2: EXACT origin, top-level frame only. Upstream used a
  // href prefix, which `https://chromewebstore.google.com.evil.example` passes.
  if (location.origin === "https://chromewebstore.google.com" && window === window.top) {
    log("Injecting Chrome Web Store API");
    setupChromeWebStoreApi();
  }
})();
