const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const app = express();
const port = 3000;
const host = '127.0.0.1';
const execFileAsync = promisify(execFile);
const nmcliPath = '/usr/bin/nmcli';
const homeAssistantUrl = process.env.HOME_ASSISTANT_URL || 'http://192.168.1.216:8123';
let updateInProgress = false;
let updateClients = [];
let updateOutput = [];
let updateResult = null;
let cachedBacklight = null;

app.use(express.json({ limit: '16kb' }));
app.use(express.static('public'));

function splitNmcliLine(line) {
  const fields = [];
  let field = '';
  let escaped = false;

  for (const character of line) {
    if (escaped) {
      field += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === ':') {
      fields.push(field);
      field = '';
    } else {
      field += character;
    }
  }

  if (escaped) field += '\\';
  fields.push(field);
  return fields;
}

async function runNmcli(args, timeout = 20000) {
  return execFileAsync('sudo', ['-n', nmcliPath, ...args], {
    timeout,
    maxBuffer: 1024 * 1024,
    encoding: 'utf8'
  });
}

function checkDashboard(timeout = 5000) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(homeAssistantUrl);
    } catch (error) {
      resolve(false);
      return;
    }

    const client = target.protocol === 'https:' ? https : http;
    const request = client.get(target, { timeout }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function getBacklight() {
  if (cachedBacklight) {
    try {
      await fs.promises.access(cachedBacklight.brightnessPath, fs.constants.R_OK);
      return cachedBacklight;
    } catch (error) {
      cachedBacklight = null;
    }
  }

  const root = '/sys/class/backlight';
  const names = await fs.promises.readdir(root);
  for (const name of names.sort()) {
    const directory = path.join(root, name);
    const brightnessPath = path.join(directory, 'brightness');
    const maxBrightnessPath = path.join(directory, 'max_brightness');
    try {
      const maxBrightness = Number.parseInt(await fs.promises.readFile(maxBrightnessPath, 'utf8'), 10);
      if (Number.isInteger(maxBrightness) && maxBrightness > 0) {
        cachedBacklight = { name, directory, brightnessPath, maxBrightness };
        return cachedBacklight;
      }
    } catch (error) {
      // Try the next backlight exposed by the kernel.
    }
  }
  throw new Error('No controllable backlight was found');
}

async function readBrightness() {
  const backlight = await getBacklight();
  const brightness = Number.parseInt(await fs.promises.readFile(backlight.brightnessPath, 'utf8'), 10);
  if (!Number.isInteger(brightness)) throw new Error('Backlight returned an invalid brightness value');
  return {
    brightness,
    maxBrightness: backlight.maxBrightness,
    percentage: Math.round((brightness / backlight.maxBrightness) * 100),
    device: backlight.name
  };
}

function spawnWithInput(command, args, input, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
    child.stdin.end(input);
  });
}

async function setBrightness(level) {
  const backlight = await getBacklight();
  if (!Number.isInteger(level) || level < 0 || level > backlight.maxBrightness) {
    throw new RangeError(`Brightness must be between 0 and ${backlight.maxBrightness}`);
  }
  await spawnWithInput('sudo', ['-n', '/usr/bin/tee', backlight.brightnessPath], `${level}\n`);
  return readBrightness();
}

async function readCrontab() {
  try {
    const { stdout } = await execFileAsync('/usr/bin/crontab', ['-l'], { encoding: 'utf8' });
    return stdout;
  } catch (error) {
    if (error.code === 1) return '';
    throw error;
  }
}

async function writeCrontab(content) {
  const normalized = content.trim() ? `${content.trimEnd()}\n` : '';
  await spawnWithInput('/usr/bin/crontab', ['-'], normalized);
}

function parseBrightnessSchedules(crontab, maxBrightness) {
  return crontab.split('\n').filter((line) => line.includes('# brightness-schedule')).map((line) => {
    const timeMatch = line.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*/);
    const brightnessMatch = line.match(/(?:^|\s)(?:\/usr\/bin\/)?echo\s+(\d+)/);
    if (!timeMatch || !brightnessMatch) return null;
    const minute = Number.parseInt(timeMatch[1], 10);
    const hour = Number.parseInt(timeMatch[2], 10);
    const brightness = Number.parseInt(brightnessMatch[1], 10);
    if (hour > 23 || minute > 59 || brightness < 0) return null;
    return {
      hour,
      minute,
      brightness,
      percentage: Math.round((Math.min(brightness, maxBrightness) / maxBrightness) * 100)
    };
  }).filter(Boolean).sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
}

function formatDuration(totalSeconds) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1073741824) return `${(value / 1073741824).toFixed(1)} GB`;
  if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

async function getSystemStats() {
  const safeRead = async (file, fallback = 'N/A') => {
    try { return (await fs.promises.readFile(file, 'utf8')).replaceAll('\0', '').trim(); }
    catch (error) { return fallback; }
  };
  const [hardwareModel, osRelease, meminfo, temperatureRaw, diskResult, wifiResult, vnstatDaysResult, vnstatMonthResult] = await Promise.all([
    safeRead('/proc/device-tree/model'),
    safeRead('/etc/os-release'),
    safeRead('/proc/meminfo', ''),
    safeRead('/sys/class/thermal/thermal_zone0/temp', ''),
    execFileAsync('/usr/bin/df', ['-kP', '/'], { encoding: 'utf8' }).catch(() => ({ stdout: '' })),
    execFileAsync(nmcliPath, ['-t', '-e', 'yes', '-f', 'IN-USE,SSID,SIGNAL', 'device', 'wifi', 'list', '--rescan', 'no', 'ifname', 'wlan0'], { encoding: 'utf8' }).catch(() => ({ stdout: '' })),
    execFileAsync('/usr/bin/vnstat', ['-i', 'wlan0', '--json', 'd', '7'], { encoding: 'utf8' }).catch(() => ({ stdout: '' })),
    execFileAsync('/usr/bin/vnstat', ['-i', 'wlan0', '--json', 'm', '1'], { encoding: 'utf8' }).catch(() => ({ stdout: '' }))
  ]);

  const prettyName = osRelease.match(/^PRETTY_NAME=(?:"([^"]+)"|(.*))$/m)?.slice(1).find(Boolean) || 'N/A';
  const memTotalKb = Number.parseInt(meminfo.match(/^MemTotal:\s+(\d+)/m)?.[1], 10) || 0;
  const memAvailableKb = Number.parseInt(meminfo.match(/^MemAvailable:\s+(\d+)/m)?.[1], 10) || 0;
  const memUsedKb = Math.max(0, memTotalKb - memAvailableKb);
  const memoryPercent = memTotalKb ? Math.round((memUsedKb / memTotalKb) * 100) : 0;

  const diskLine = diskResult.stdout.trim().split('\n')[1]?.trim().split(/\s+/) || [];
  const diskTotal = (Number.parseInt(diskLine[1], 10) || 0) * 1024;
  const diskUsed = (Number.parseInt(diskLine[2], 10) || 0) * 1024;
  const diskPercent = Number.parseInt(diskLine[4], 10) || 0;

  const activeWifi = wifiResult.stdout.trim().split('\n').map(splitNmcliLine).find((fields) => fields[0] === '*');
  const wifiConnection = activeWifi?.[1] || 'Disconnected';
  const wifiSignalNumber = Number.parseInt(activeWifi?.[2], 10);

  const interfaces = os.networkInterfaces();
  const addresses = Object.entries(interfaces).flatMap(([name, entries]) =>
    (entries || []).filter((entry) => entry.family === 'IPv4' && !entry.internal).map((entry) => ({ name, address: entry.address }))
  );
  const preferredAddress = addresses.find((item) => item.name === 'wlan0') || addresses.find((item) => item.name === 'eth0') || addresses[0];

  let vnstatToday = 'N/A';
  let vnstatWeek = 'N/A';
  let vnstatMonth = 'N/A';
  try {
    const days = JSON.parse(vnstatDaysResult.stdout).interfaces[0].traffic.day || [];
    const currentDay = days.at(-1);
    const lastSevenDays = days.slice(-7).reduce((total, day) => ({ rx: total.rx + day.rx, tx: total.tx + day.tx }), { rx: 0, tx: 0 });
    const currentMonth = (JSON.parse(vnstatMonthResult.stdout).interfaces[0].traffic.month || []).at(-1);
    const formatTraffic = (item) => item ? `↓ ${formatBytes(item.rx)}  ↑ ${formatBytes(item.tx)}` : 'N/A';
    vnstatToday = formatTraffic(currentDay);
    vnstatWeek = formatTraffic(lastSevenDays);
    vnstatMonth = formatTraffic(currentMonth);
  } catch (error) {
    // vnStat is optional.
  }

  const temperatureC = temperatureRaw ? Number.parseInt(temperatureRaw, 10) / 1000 : null;
  return {
    hardwareModel,
    uptime: formatDuration(os.uptime()),
    uptimeSeconds: Math.floor(os.uptime()),
    loadAverage: os.loadavg().map((value) => value.toFixed(2)).join(', '),
    loadOne: Number(os.loadavg()[0].toFixed(2)),
    cpuCores: os.cpus().length,
    osVersion: prettyName,
    ipAddress: preferredAddress?.address || 'N/A',
    ipAddresses: addresses,
    wifiConnection,
    wifiSignal: Number.isInteger(wifiSignalNumber) ? wifiSignalNumber : 'N/A',
    diskSpace: `${formatBytes(diskUsed)} / ${formatBytes(diskTotal)}`,
    diskRoot: diskPercent,
    memory: `${formatBytes(memUsedKb * 1024)} / ${formatBytes(memTotalKb * 1024)}`,
    memoryPercent,
    temperature: temperatureC === null ? 'N/A' : `${temperatureC.toFixed(1)}°C`,
    temperatureC,
    vnstatToday,
    vnstatWeek,
    vnstatMonth
  };
}

app.get('/wifi', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wifi.html'));
});

app.get('/kiosk', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kiosk.html'));
});

app.get('/api/config', (req, res) => {
  res.json({ homeAssistantUrl });
});

app.get('/api/dashboard/status', async (req, res) => {
  res.json({ reachable: await checkDashboard(), homeAssistantUrl });
});

app.get('/api/wifi/status', async (req, res) => {
  try {
    const { stdout } = await runNmcli([
      '-t', '-e', 'yes', '-f', 'DEVICE,TYPE,STATE,CONNECTION',
      'device', 'status'
    ]);
    const devices = stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [device, type, state, connection] = splitNmcliLine(line);
      return { device, type, state, connection };
    });
    const wifi = devices.find((device) => device.type === 'wifi' && device.device !== 'p2p-dev-wlan0');
    const ethernet = devices.find((device) => device.type === 'ethernet');

    res.json({
      wifi: wifi || { device: 'wlan0', type: 'wifi', state: 'unavailable', connection: '' },
      ethernetConnected: ethernet?.state === 'connected'
    });
  } catch (error) {
    console.error(`Failed to read WiFi status: ${error.message}`);
    res.status(500).json({ error: 'Unable to read network status' });
  }
});

app.get('/api/wifi/networks', async (req, res) => {
  try {
    if (req.query.rescan !== 'false') {
      try {
        await runNmcli(['--wait', '12', 'device', 'wifi', 'rescan', 'ifname', 'wlan0'], 15000);
      } catch (error) {
        // NetworkManager may rate-limit scans; the cached list is still useful.
        console.warn(`WiFi rescan failed, using cached results: ${error.message}`);
      }
    }

    const { stdout } = await runNmcli([
      '-t', '-e', 'yes', '-f', 'IN-USE,SSID,BSSID,SIGNAL,SECURITY,FREQ',
      'device', 'wifi', 'list', '--rescan', 'no', 'ifname', 'wlan0'
    ]);
    const bySsid = new Map();

    stdout.trim().split('\n').filter(Boolean).forEach((line) => {
      const [inUse, ssid, bssid, signal, security, frequency] = splitNmcliLine(line);
      if (!ssid) return;

      const network = {
        ssid,
        bssid,
        signal: Number.parseInt(signal, 10) || 0,
        security: security || 'Open',
        frequency: Number.parseInt(frequency, 10) || 0,
        connected: inUse === '*'
      };
      const existing = bySsid.get(ssid);
      if (!existing || network.connected || network.signal > existing.signal) {
        bySsid.set(ssid, network);
      }
    });

    const networks = [...bySsid.values()].sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return b.signal - a.signal;
    });
    res.json({ networks });
  } catch (error) {
    console.error(`Failed to list WiFi networks: ${error.message}`);
    res.status(500).json({ error: 'Unable to scan for WiFi networks' });
  }
});

app.post('/api/wifi/connect', async (req, res) => {
  const ssid = typeof req.body.ssid === 'string' ? req.body.ssid.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!ssid || Buffer.byteLength(ssid, 'utf8') > 32 || ssid.includes('\0')) {
    return res.status(400).json({ error: 'Choose a valid WiFi network' });
  }
  const validHexPsk = /^[0-9a-fA-F]{64}$/.test(password);
  if (password && !validHexPsk && (password.length < 8 || password.length > 63)) {
    return res.status(400).json({ error: 'WiFi passwords must be 8 to 63 characters (or a 64-digit hex key)' });
  }

  const args = [
    '--wait', '35', 'device', 'wifi', 'connect', ssid,
    'ifname', 'wlan0'
  ];
  if (password) args.push('password', password);

  try {
    const { stdout } = await runNmcli(args, 45000);
    console.log(`Connected wlan0 to WiFi network ${JSON.stringify(ssid)}`);
    res.json({ connected: true, ssid, message: stdout.trim() || `Connected to ${ssid}` });
  } catch (error) {
    const rawDetails = String(error.stderr || error.message || '');
    const details = (password ? rawDetails.replaceAll(password, '[redacted]') : rawDetails).trim();
    console.error(`Failed to connect wlan0 to ${JSON.stringify(ssid)}: ${details}`);
    res.status(400).json({
      connected: false,
      error: 'Connection failed. Check the password and try again.',
      details
    });
  }
});

function scheduleSystemAction(res, label, command, args) {
  console.log(`Request received to ${label}`);
  res.json({ message: `${label[0].toUpperCase()}${label.slice(1)} requested` });
  setTimeout(() => {
    const child = spawn('sudo', ['-n', command, ...args], { detached: true, stdio: 'ignore' });
    child.on('error', (error) => console.error(`Failed to ${label}: ${error.message}`));
    child.unref();
  }, 350);
}

function shutdownHandler(req, res) {
  scheduleSystemAction(res, 'power off', '/usr/sbin/shutdown', ['now']);
}

function rebootHandler(req, res) {
  scheduleSystemAction(res, 'reboot', '/usr/sbin/reboot', []);
}

function restartDisplayHandler(req, res) {
  scheduleSystemAction(res, 'restart the display', '/usr/bin/systemctl', ['restart', 'lightdm']);
}

app.post('/shutdown', shutdownHandler);
app.get('/shutdown', shutdownHandler);
app.post('/reboot', rebootHandler);
app.get('/reboot', rebootHandler);
app.post('/restart-lightdm', restartDisplayHandler);
app.get('/restart-lightdm', restartDisplayHandler);

function broadcastUpdate(payload) {
  const event = `data: ${JSON.stringify(payload)}\n\n`;
  updateClients.forEach((client) => client.write(event));
}

function appendUpdateOutput(message) {
  updateOutput.push(message);
  if (updateOutput.length > 2000) updateOutput.shift();
  broadcastUpdate({ message, done: false });
}

function runUpdateCommand(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', '/usr/bin/apt-get', ...args], {
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' }
    });
    child.stdout.on('data', (data) => appendUpdateOutput(data.toString()));
    child.stderr.on('data', (data) => appendUpdateOutput(data.toString()));
    child.on('error', reject);
    child.on('close', resolve);
  });
}

async function runSystemUpdate() {
  let code = 1;
  try {
    appendUpdateOutput('=== Refreshing package lists ===\n');
    code = await runUpdateCommand(['update']);
    if (code === 0) {
      appendUpdateOutput('\n=== Installing available upgrades ===\n');
      code = await runUpdateCommand(['upgrade', '-y']);
    }
  } catch (error) {
    appendUpdateOutput(`\n${error.message}\n`);
    code = 1;
  }

  updateInProgress = false;
  const message = code === 0
    ? '\n=== Update completed successfully ===\n'
    : `\n=== Update failed with exit code ${code} ===\n`;
  updateResult = { message, done: true, success: code === 0 };
  broadcastUpdate(updateResult);
  updateClients.forEach((client) => client.end());
  updateClients = [];
}

function startUpdateHandler(req, res) {
  if (updateInProgress) return res.status(409).json({ error: 'A system update is already running' });
  console.log('Request received to update the system');
  updateInProgress = true;
  updateOutput = [];
  updateResult = null;
  res.json({ message: 'System update started' });
  runSystemUpdate();
}

app.post('/update', startUpdateHandler);
app.get('/update', startUpdateHandler);

app.get('/update-status', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  updateOutput.forEach((message) => res.write(`data: ${JSON.stringify({ message, done: false })}\n\n`));
  if (updateResult) {
    res.write(`data: ${JSON.stringify(updateResult)}\n\n`);
    return res.end();
  }
  updateClients.push(res);
  req.on('close', () => { updateClients = updateClients.filter((client) => client !== res); });
});

app.get('/brightness', async (req, res) => {
  try {
    res.json(await readBrightness());
  } catch (error) {
    console.error(`Failed to read brightness: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.post('/brightness/:level', async (req, res) => {
  const level = Number(req.params.level);
  try {
    res.json(await setBrightness(level));
  } catch (error) {
    console.error(`Failed to set brightness: ${error.message}`);
    res.status(error instanceof RangeError ? 400 : 500).json({ error: error.message });
  }
});

app.get('/brightness-schedule', async (req, res) => {
  try {
    const backlight = await getBacklight();
    const schedules = parseBrightnessSchedules(await readCrontab(), backlight.maxBrightness);
    res.json({ schedules, maxBrightness: backlight.maxBrightness, device: backlight.name });
  } catch (error) {
    console.error(`Failed to read brightness schedule: ${error.message}`);
    res.status(500).json({ error: 'Unable to read the brightness schedule' });
  }
});

app.post('/brightness-schedule', async (req, res) => {
  const requested = req.body.schedules;
  if (!Array.isArray(requested) || requested.length > 24) {
    return res.status(400).json({ error: 'Schedules must be an array with at most 24 entries' });
  }

  try {
    const backlight = await getBacklight();
    const schedules = requested.map((schedule) => ({
      hour: Number(schedule.hour),
      minute: Number(schedule.minute),
      brightness: Number(schedule.brightness)
    }));
    const invalid = schedules.some((schedule) =>
      !Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23 ||
      !Number.isInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59 ||
      !Number.isInteger(schedule.brightness) || schedule.brightness < 0 || schedule.brightness > backlight.maxBrightness
    );
    if (invalid) return res.status(400).json({ error: 'Each schedule needs a valid time and brightness' });

    schedules.sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
    const existingLines = (await readCrontab()).split('\n').filter((line) => !line.includes('# brightness-schedule'));
    const cronLines = schedules.map((schedule) =>
      `${schedule.minute} ${schedule.hour} * * * /usr/bin/echo ${schedule.brightness} | /usr/bin/sudo -n /usr/bin/tee /sys/class/backlight/*/brightness >/dev/null # brightness-schedule`
    );
    await writeCrontab([...existingLines, ...cronLines].join('\n'));
    const saved = parseBrightnessSchedules(await readCrontab(), backlight.maxBrightness);
    res.json({ message: saved.length ? 'Brightness schedule saved' : 'Brightness schedule cleared', schedules: saved });
  } catch (error) {
    console.error(`Failed to save brightness schedule: ${error.message}`);
    res.status(500).json({ error: 'Unable to save the brightness schedule' });
  }
});

app.get('/system-stats', async (req, res) => {
  try {
    res.json(await getSystemStats());
  } catch (error) {
    console.error(`Failed to read system stats: ${error.message}`);
    res.status(500).json({ error: 'Unable to load system statistics' });
  }
});

app.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}/`);
});
