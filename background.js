const MAX_LOGS = 1000;
const STORAGE_KEY = "apiInspectorLogs";
const ENABLED_KEY = "apiInspectorEnabled";

let logs = [];
let enabled = true;

// Load from storage on startup
chrome.storage.local.get([STORAGE_KEY, ENABLED_KEY], (res) => {
  if (Array.isArray(res[STORAGE_KEY])) logs = res[STORAGE_KEY];
  if (typeof res[ENABLED_KEY] === "boolean") enabled = res[ENABLED_KEY];
  else chrome.storage.local.set({ [ENABLED_KEY]: true });
});

async function persist() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: logs });
  } catch (e) {
    // if quota exceeded, trim and retry
    if (logs.length > 100) {
      logs = logs.slice(-500);
      try { await chrome.storage.local.set({ [STORAGE_KEY]: logs }); } catch {}
    }
    console.warn("[API Inspector] persist failed", e);
  }
}

function broadcast(type, data) {
  // broadcast to all extension contexts (popup, sidepanel, fullpage)
  chrome.runtime.sendMessage({ type, data }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;
  const tabUrl = sender.tab ? sender.tab.url : null;

  if (msg.type === "API_LOG") {
    if (!enabled) {
      sendResponse({ ok: true, ignored: true });
      return true;
    }
    const payload = msg.payload;
    // Add tab info
    payload.tabId = tabId;
    payload.tabUrl = tabUrl || payload.pageUrl || "";
    payload.id = payload.id || Math.random().toString(36).slice(2);
    // Avoid huge objects exceeding storage quota - truncate responseBody if needed
    // Already truncated in injected, but ensure storage size
    logs.push(payload);
    if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
    persist();
    // Notify listeners
    broadcast("NEW_LOG", payload);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "GET_LOGS") {
    sendResponse({ logs, enabled });
    return true;
  }

  if (msg.type === "CLEAR_LOGS") {
    logs = [];
    chrome.storage.local.remove(STORAGE_KEY).catch(() => {});
    broadcast("LOGS_CLEARED", null);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "DELETE_LOG") {
    logs = logs.filter(l => l.id !== msg.id);
    persist();
    broadcast("LOGS_UPDATED", logs);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "TOGGLE_ENABLED") {
    enabled = msg.enabled !== undefined ? !!msg.enabled : !enabled;
    chrome.storage.local.set({ [ENABLED_KEY]: enabled });
    // Notify content scripts
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: "SET_ENABLED", enabled }).catch(() => {});
      });
    });
    broadcast("ENABLED_CHANGED", enabled);
    sendResponse({ enabled });
    return true;
  }

  if (msg.type === "GET_ENABLED") {
    sendResponse({ enabled });
    return true;
  }

  if (msg.type === "EXPORT_LOGS") {
    sendResponse({ logs });
    return true;
  }

  if (msg.type === "OPEN_FULLPAGE") {
    const url = chrome.runtime.getURL("fullpage.html");
    chrome.tabs.create({ url });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "OPEN_SIDEPANEL") {
    // For Chrome sidePanel, we need to open it via chrome.sidePanel.open
    // Requires user gesture; called from popup/fullpage
    if (chrome.sidePanel && sender.tab) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
      chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true }).catch(() => {});
    } else if (msg.windowId) {
      // fallback when called from popup without sender.tab
      if (chrome.sidePanel) {
        chrome.sidePanel.open({ windowId: msg.windowId }).catch(() => {});
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "SHOW_FLOATING") {
    // Try to show floating panel in sender tab or active tab
    (async () => {
      try {
        let targetTabId = sender.tab ? sender.tab.id : null;
        if (!targetTabId) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs[0]) targetTabId = tabs[0].id;
        }
        if (targetTabId) {
          try {
            await chrome.tabs.sendMessage(targetTabId, { type: "SHOW_FLOATING" });
            sendResponse({ ok: true, via: "content" });
            return;
          } catch (e) {
            // content not ready, try to inject via scripting
            try {
              await chrome.scripting.executeScript({ target: { tabId: targetTabId }, files: ["floating-panel.js"] });
              await chrome.scripting.insertCSS({ target: { tabId: targetTabId }, files: ["floating-panel.css"] });
              // retry
              setTimeout(async () => {
                try { await chrome.tabs.sendMessage(targetTabId, { type: "SHOW_FLOATING" }); } catch {}
              }, 300);
              sendResponse({ ok: true, via: "injected" });
              return;
            } catch (err) {
              console.warn("inject floating failed", err);
            }
          }
        }
        // fallback: open as popup window
        const url = chrome.runtime.getURL("popup.html");
        try {
          await chrome.windows.create({ url, type: "popup", width: 420, height: 640, focused: true });
          sendResponse({ ok: true, via: "window" });
        } catch (e2) {
          sendResponse({ ok: false, error: String(e2) });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.type === "HIDE_FLOATING") {
    (async () => {
      try {
        let targetTabId = sender.tab ? sender.tab.id : null;
        if (!targetTabId) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs[0]) targetTabId = tabs[0].id;
        }
        if (targetTabId) {
          try { await chrome.tabs.sendMessage(targetTabId, { type: "HIDE_FLOATING" }); } catch {}
        }
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false }); }
    })();
    return true;
  }

  if (msg.type === "CLOSE_SIDEPANEL") {
    (async () => {
      try {
        if (chrome.sidePanel) {
          // try to disable to hide
          try { await chrome.sidePanel.setOptions({ enabled: false }); } catch {}
          setTimeout(async () => {
            try { await chrome.sidePanel.setOptions({ enabled: true, path: "sidepanel.html" }); } catch {}
          }, 800);
        }
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false }); }
    })();
    return true;
  }

  if (msg.type === "OPEN_FLOATING_WINDOW") {
    const url = chrome.runtime.getURL(msg.page || "popup.html");
    const w = msg.width || 420;
    const h = msg.height || 640;
    chrome.windows.create({ url, type: "popup", width: w, height: h, focused: true });
    sendResponse({ ok: true });
    return true;
  }
});

// Handle sidePanel behavior on action click if needed
// Allow sidePanel to be opened via clicking action when configured
if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

// Optional: clear logs on extension install/update? keep them

// Badge to show count
function updateBadge() {
  const count = logs.length;
  const text = count > 0 ? (count > 999 ? "999+" : String(count)) : "";
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: enabled ? "#0ea5e9" : "#94a3b8" });
  // also set title
  chrome.action.setTitle({ title: `API Inspector ${enabled ? "(已啟用)" : "(已暫停)"} - ${count} 條記錄` });
}

// Periodically update badge or on storage change
setInterval(updateBadge, 1000);
chrome.storage.onChanged.addListener(() => updateBadge());
chrome.runtime.onStartup.addListener(updateBadge);
