const RECOVERY_URL = 'http://127.0.0.1:3000/wifi?reason=network-error';
const DASHBOARD_STATUS_URL = 'http://127.0.0.1:3000/api/dashboard/status';
const LOCAL_MANAGER_ORIGINS = new Set([
  'http://127.0.0.1:3000',
  'http://localhost:3000'
]);
const RECOVERABLE_ERRORS = new Set([
  'net::ERR_ADDRESS_UNREACHABLE',
  'net::ERR_CONNECTION_CLOSED',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_TIMED_OUT',
  'net::ERR_INTERNET_DISCONNECTED',
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_NETWORK_CHANGED',
  'net::ERR_NETWORK_IO_SUSPENDED',
  'net::ERR_NETWORK_ACCESS_DENIED',
  'net::ERR_TIMED_OUT'
]);

function isLocalManagerUrl(url) {
  try {
    return LOCAL_MANAGER_ORIGINS.has(new URL(url).origin);
  } catch (error) {
    return false;
  }
}

async function checkConnectivity() {
  try {
    const response = await fetch(DASHBOARD_STATUS_URL, { cache: 'no-store' });
    const status = await response.json();
    const stored = await chrome.storage.session.get('connectivityFailures');
    const previousFailures = Number(stored.connectivityFailures) || 0;

    if (status.reachable) {
      if (previousFailures) await chrome.storage.session.set({ connectivityFailures: 0 });
      return;
    }

    const connectivityFailures = previousFailures + 1;
    await chrome.storage.session.set({ connectivityFailures });
    if (connectivityFailures < 2) return;

    const tabs = await chrome.tabs.query({ active: true });
    await Promise.all(tabs.map((tab) => {
      if (typeof tab.id !== 'number' || !tab.url?.startsWith('http') || isLocalManagerUrl(tab.url)) return undefined;
      return chrome.tabs.update(tab.id, { url: RECOVERY_URL });
    }));
  } catch (error) {
    // If the local manager itself is restarting, leave the current page alone.
  }
}

// After a Home Assistant restart the page can reload before HACS has registered
// /hacsfiles/, so custom card modules 404 and every custom card renders as a
// "Configuration error" until the next reload. Reload once HA is reachable and
// the errors persist, backing off so a genuine config error cannot loop.
const ERROR_CARD_CHECKS_BEFORE_RELOAD = 2;
const RELOAD_BACKOFF_MS = [2, 5, 15, 30].map((minutes) => minutes * 60 * 1000);

function countErrorCards() {
  const tags = new Set(['hui-error-card', 'hui-error-badge', 'hui-error-heading-badge']);
  let count = 0;
  const roots = [document];
  while (roots.length) {
    for (const element of roots.pop().querySelectorAll('*')) {
      if (tags.has(element.localName)) count += 1;
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  return count;
}

async function checkDashboardCards() {
  try {
    const status = await (await fetch(DASHBOARD_STATUS_URL, { cache: 'no-store' })).json();
    if (!status.reachable) return;

    const tabs = await chrome.tabs.query({ active: true });
    for (const tab of tabs) {
      if (typeof tab.id !== 'number' || tab.status !== 'complete' || !tab.url?.startsWith('http') || isLocalManagerUrl(tab.url)) continue;

      const [{ result: errorCards } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: countErrorCards
      });
      const stored = await chrome.storage.session.get(['errorCardChecks', 'cardReloads', 'lastCardReload']);
      if (!errorCards) {
        if (stored.errorCardChecks || stored.cardReloads) {
          await chrome.storage.session.set({ errorCardChecks: 0, cardReloads: 0 });
        }
        continue;
      }

      const errorCardChecks = (Number(stored.errorCardChecks) || 0) + 1;
      const cardReloads = Number(stored.cardReloads) || 0;
      const backoff = RELOAD_BACKOFF_MS[Math.min(cardReloads, RELOAD_BACKOFF_MS.length - 1)];
      const sinceLastReload = Date.now() - (Number(stored.lastCardReload) || 0);
      if (errorCardChecks < ERROR_CARD_CHECKS_BEFORE_RELOAD || (cardReloads && sinceLastReload < backoff)) {
        await chrome.storage.session.set({ errorCardChecks });
        continue;
      }

      await chrome.storage.session.set({ errorCardChecks: 0, cardReloads: cardReloads + 1, lastCardReload: Date.now() });
      await chrome.tabs.reload(tab.id, { bypassCache: true });
    }
  } catch (error) {
    // Pages the extension cannot script, or a restarting local manager; try again next tick.
  }
}

function startConnectivityMonitor() {
  chrome.alarms.create('dashboard-connectivity', { periodInMinutes: 0.5 });
  checkConnectivity();
}

chrome.runtime.onInstalled.addListener(startConnectivityMonitor);
chrome.runtime.onStartup.addListener(startConnectivityMonitor);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dashboard-connectivity') {
    checkConnectivity();
    checkDashboardCards();
  }
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0 || !RECOVERABLE_ERRORS.has(details.error)) return;
  if (isLocalManagerUrl(details.url)) return;

  chrome.tabs.update(details.tabId, { url: RECOVERY_URL });
});
