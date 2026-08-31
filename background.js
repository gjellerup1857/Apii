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
    console.warn("[Apii] persist failed", e);
  }
}

function broadcast(type, data) {
  // broadcast to all extension contexts (popup, sidepanel, fullpage)
  chrome.runtime.sendMessage({ type, data }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;
  const tabUrl = sender.tab ? sender.tab.url : null;
  const frameId = sender.frameId !== undefined ? sender.frameId : 0;

  if (msg.type === "API_LOG") {
    if (!enabled) {
      sendResponse({ ok: true, ignored: true });
      return true;
    }
    // 僅保留主框架，避免 iframe 大量噪音與 DevTools 對齊
    if (frameId !== 0) {
      sendResponse({ ok: true, ignored: true, reason: "not_main_frame" });
      return true;
    }
    const payload = msg.payload;
    // Add tab info
    payload.tabId = tabId;
    payload.tabUrl = tabUrl || payload.pageUrl || "";
    payload.frameId = frameId;
    payload.id = payload.id || Math.random().toString(36).slice(2);
    // Avoid huge objects exceeding storage quota - truncate responseBody if needed
    // Already truncated in injected, but ensure storage size
    logs.push(payload);
    if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
    persist();
    // Notify listeners
    broadcast("NEW_LOG", payload);
    updateBadgeForTab(tabId);
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
    updateBadge();
    // 同時清除所有分頁的獨立 badge
    chrome.tabs.query({}).then(tabs => tabs.forEach(t => updateBadgeForTab(t.id))).catch(()=>{});
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "CLEAR_LOGS_FOR_TAB") {
    const tid = msg.tabId;
    if (tid !== undefined && tid !== null) {
      const before = logs.length;
      logs = logs.filter(l => l.tabId !== tid);
      if (logs.length !== before) {
        if (logs.length === 0) chrome.storage.local.remove(STORAGE_KEY).catch(() => {});
        else persist();
        broadcast("LOGS_CLEARED_FOR_TAB", { tabId: tid });
        broadcast("LOGS_UPDATED", logs);
        updateBadgeForTab(tid);
      }
    } else {
      logs = [];
      chrome.storage.local.remove(STORAGE_KEY).catch(() => {});
      broadcast("LOGS_CLEARED", null);
      updateBadge();
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "DELETE_LOG") {
    const target = logs.find(l => l.id === msg.id);
    const tid = target ? target.tabId : null;
    logs = logs.filter(l => l.id !== msg.id);
    persist();
    broadcast("LOGS_UPDATED", logs);
    if (tid !== null) updateBadgeForTab(tid);
    else updateBadge();
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

  if (msg.type === "CLOSE_SIDEPANEL" || msg.type === "CLOSE_SIDEPANEL_ROBUST") {
    (async () => {
      try {
        if (chrome.sidePanel) {
          // 盡量帶 windowId 精準關閉
          let wid = msg.windowId;
          if (!wid && sender.tab) wid = sender.tab.windowId;
          if (!wid) {
            try {
              const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
              if (tabs[0]) wid = tabs[0].windowId;
            } catch {}
          }
          // 嘗試 close API（若存在）
          if (wid !== undefined && typeof chrome.sidePanel.close === "function") {
            try { await chrome.sidePanel.close({ windowId: wid }); } catch {}
          }
          // 再嘗試 disable
          try {
            if (wid !== undefined) await chrome.sidePanel.setOptions({ enabled: false, windowId: wid });
            else await chrome.sidePanel.setOptions({ enabled: false });
          } catch {}
          try { await chrome.sidePanel.setOptions({ enabled: false }); } catch {}
          setTimeout(async () => {
            try {
              if (wid !== undefined) await chrome.sidePanel.setOptions({ enabled: true, path: "sidepanel.html", windowId: wid });
              else await chrome.sidePanel.setOptions({ enabled: true, path: "sidepanel.html" });
            } catch {}
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

// 導航自動清空（按 tabId，僅主框架）：與 DevTools 對齊，跳轉後不保留舊日誌
function clearLogsForTab(tabId, reason) {
  if (tabId === undefined || tabId === null) return;
  const before = logs.length;
  logs = logs.filter(l => l.tabId !== tabId);
  if (logs.length !== before) {
    persist();
    // 通知所有 UI 更新
    broadcast("LOGS_UPDATED", logs);
    broadcast("LOGS_CLEARED_FOR_TAB", { tabId, reason });
    updateBadgeForTab(tabId);
  }
}

try {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // 任何主框架導航（含重整、同 URL 重載、status loading）都清空，與 DevTools 保持一致
    if (changeInfo.status === "loading") {
      // 避免對 chrome-extension:// 自身頁面的 loading 誤清
      const url = changeInfo.url || (tab && tab.url) || "";
      if (url && (url.startsWith("chrome-extension://") || url.startsWith("chrome://") || url.startsWith("about:"))) return;
      clearLogsForTab(tabId, "tabsLoading");
    } else if (changeInfo.url) {
      clearLogsForTab(tabId, "tabsUpdated");
    }
  });
} catch {}
try {
  if (chrome.webNavigation) {
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId === 0) {
        clearLogsForTab(details.tabId, "webNavCommitted");
      }
    });
    // 前進/重整等
    chrome.webNavigation.onBeforeNavigate.addListener((details) => {
      if (details.frameId === 0) {
        // 可選：導航前即清，避免舊日誌閃現
        // clearLogsForTab(details.tabId, "beforeNavigate");
      }
    });
  }
} catch {}
try {
  chrome.tabs.onRemoved.addListener((tabId) => {
    clearLogsForTab(tabId, "tabRemoved");
  });
} catch {}

// Handle sidePanel behavior on action click if needed
// Allow sidePanel to be opened via clicking action when configured
if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

// Optional: clear logs on extension install/update? keep them

// Badge 僅顯示當前活躍分頁的主框架數量，與 DevTools 對齊（按 tabId）
async function updateBadgeForTab(tabId) {
  try {
    const count = logs.filter(l => l.tabId === tabId && (l.frameId === 0 || l.frameId === undefined)).length;
    const text = count > 0 ? (count > 999 ? "999+" : String(count)) : "";
    if (tabId !== null && tabId !== undefined) {
      await chrome.action.setBadgeText({ text, tabId });
      await chrome.action.setBadgeBackgroundColor({ color: enabled ? "#0ea5e9" : "#94a3b8", tabId });
    } else {
      await chrome.action.setBadgeText({ text });
      await chrome.action.setBadgeBackgroundColor({ color: enabled ? "#0ea5e9" : "#94a3b8" });
    }
  } catch {}
}
function updateBadge() {
  // 全局兜底：顯示總主框架數
  const count = logs.filter(l => l.frameId === 0 || l.frameId === undefined).length;
  const text = count > 0 ? (count > 999 ? "999+" : String(count)) : "";
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: enabled ? "#0ea5e9" : "#94a3b8" });
  chrome.action.setTitle({ title: `Apii ${enabled ? "(已啟用)" : "(已暫停)"} - ${count} 條主框架記錄（僅當前分頁顯示）` });
  // 同步更新活躍分頁的獨立 badge
  chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    if (tabs[0]) updateBadgeForTab(tabs[0].id);
  }).catch(() => {});
}
try {
  chrome.tabs.onActivated.addListener(activeInfo => updateBadgeForTab(activeInfo.tabId));
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete" || changeInfo.url) updateBadgeForTab(tabId);
  });
} catch {}

// Periodically update badge or on storage change
setInterval(updateBadge, 1500);
chrome.storage.onChanged.addListener(() => updateBadge());
chrome.runtime.onStartup.addListener(updateBadge);
