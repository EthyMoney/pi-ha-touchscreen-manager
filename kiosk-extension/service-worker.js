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

function startConnectivityMonitor() {
  chrome.alarms.create('dashboard-connectivity', { periodInMinutes: 0.5 });
  checkConnectivity();
}

chrome.runtime.onInstalled.addListener(startConnectivityMonitor);
chrome.runtime.onStartup.addListener(startConnectivityMonitor);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dashboard-connectivity') checkConnectivity();
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0 || !RECOVERABLE_ERRORS.has(details.error)) return;
  if (isLocalManagerUrl(details.url)) return;

  chrome.tabs.update(details.tabId, { url: RECOVERY_URL });
});
