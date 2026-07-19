# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

**pi-ha-touchscreen-manager** is a small Express.js web app that runs locally on a Raspberry Pi to provide a touchscreen-friendly UI for managing the device (reboot, shutdown, system updates, brightness, stats). It is intended to be embedded in a Home Assistant dashboard via an iframe / link button.

- **Runtime**: Node.js + Express 5
- **Frontend**: Vanilla HTML/CSS/JS in `public/index.html` (single page, no framework)
- **Backend**: `main.js` (single file, all routes)
- **Process manager**: PM2 (app name: `raspberry-pi-control`, config: `process.json`)
- **Bind address**: `localhost:3000` only (not network-exposed)

## Repository Layout

```
main.js              # Express server, all API routes
process.json         # PM2 app config (script path, env)
package.json         # Deps: express, pm2
public/index.html    # Single-page touch UI
public/wifi.html     # Offline WiFi recovery UI
kiosk-extension/    # Chromium navigation/connectivity recovery extension
README.md            # User-facing setup instructions
```

There is no build step, no tests, no TypeScript, no bundler. Edits to `main.js` or `public/index.html` take effect on PM2 restart (the process is configured with `watch: true` in [process.json](process.json), so file changes typically auto-reload).

## How the App Runs in Production

Critical context for debugging — the app is **not** managed by the developer's PM2 instance:

- The app runs under the **`display` system user** (not `pi`, not the SSH user)
- It is managed by the `display` user's PM2 daemon (`/home/display/.pm2`)
- Working directory: `/home/display/pi-ha-touchscreen-manager`
- To list/restart it from another user: `sudo su - display -c "pm2 list"` / `sudo su - display -c "pm2 restart all"`
- Logs: `sudo su - display -c "pm2 logs raspberry-pi-control"`

Running `pm2 list` as the SSH user will show an empty list — that is expected and does not mean the app is down.

## Privileged Commands & Sudoers

Many routes in `main.js` shell out to `sudo` for system operations (`apt-get`, `shutdown`, `reboot`, `systemctl restart lightdm`, `tee` to backlight sysfs). Because the app runs non-interactively under PM2, **sudo must never prompt for a password**.

This is achieved with a sudoers drop-in at `/etc/sudoers.d/display-pi-ha`. A setup script lives at `/home/display/sudoers-setup.sh` and is the source of truth — re-run it with `sudo bash /home/display/sudoers-setup.sh` to reinstall.

The current expected contents:

```
Defaults:display !use_pty
display ALL=(ALL) NOPASSWD: /usr/bin/apt-get update, /usr/bin/apt-get upgrade *, /usr/bin/apt-get upgrade, /usr/bin/apt-get install *, /usr/bin/apt-get dist-upgrade *, /usr/bin/apt-get dist-upgrade
display ALL=(ALL) NOPASSWD: /usr/sbin/shutdown *, /usr/sbin/shutdown
display ALL=(ALL) NOPASSWD: /usr/sbin/reboot
display ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart lightdm, /usr/bin/systemctl restart lightdm.service
display ALL=(ALL) NOPASSWD: /usr/bin/tee /sys/class/backlight/*/brightness
display ALL=(root) NOPASSWD: /usr/bin/nmcli *
```

Note also `/etc/sudoers.d/display-user` exists with overlapping (older) rules. Sudoers is the **union** of all matching rules across all files in `/etc/sudoers.d/`, so leftover rules in either file can mask the intended ones. When fixing sudoers issues, audit **both** files.

In `main.js`, all sudo invocations use the `-n` (non-interactive) flag so that any misconfiguration fails fast with `sudo: a password is required` instead of hanging.

## API Endpoints (in `main.js`)

| Method | Path | Purpose |
|--------|------|---------|
| POST/GET | `/shutdown` | Schedules `sudo -n shutdown now` after sending the response |
| POST/GET | `/reboot` | Schedules `sudo -n reboot` after sending the response |
| POST/GET | `/update` | Runs `apt-get update` then `apt-get upgrade -y`, streaming output |
| GET | `/update-status` | SSE stream of update output (replays buffered output to late subscribers) |
| POST/GET | `/restart-lightdm` | Schedules `sudo -n systemctl restart lightdm` after sending the response |
| GET | `/brightness` | Detects and reads the active kernel backlight |
| POST | `/brightness/:level` | Writes within the detected hardware range via `sudo -n tee` |
| GET | `/brightness-schedule` | Parses display user's crontab for `# brightness-schedule` lines |
| POST | `/brightness-schedule` | Rewrites those crontab entries |
| GET | `/system-stats` | Runs many shell commands in parallel, returns JSON |
| GET | `/wifi` | Local touch-friendly WiFi recovery page |
| GET | `/kiosk` | Local startup bootstrap that checks Home Assistant before navigating |
| GET | `/api/wifi/status` | Current WiFi and Ethernet state from NetworkManager |
| GET | `/api/wifi/networks` | Scan and list nearby WiFi networks |
| POST | `/api/wifi/connect` | Connect `wlan0` to an open or WPA personal network |
| GET | `/api/config` | Return the configured Home Assistant URL to local pages |
| GET | `/api/dashboard/status` | Check whether the configured Home Assistant URL is reachable |

Brightness device names are detected under `/sys/class/backlight`. Schedule cron lines intentionally use `/sys/class/backlight/*/brightness`, while API responses include the detected raw hardware range and a calculated percentage.

## Conventions

- Keep `main.js` as a single file. The project deliberately avoids splitting into modules.
- All shell commands that need root use `sudo -n ...`. Never drop the `-n`.
- When adding a new sudo command, also add it to [sudoers-setup.sh](../../sudoers-setup.sh) with a wildcard for arguments where appropriate (e.g. `apt-get install *`).
- No build/lint/test pipeline exists — do not add one unless asked.
- Frontend is plain DOM manipulation; do not introduce frameworks.

## Common Tasks

### Restart the running app after editing
```sh
sudo su - display -c "pm2 restart all"
```

### Tail logs
```sh
sudo su - display -c "pm2 logs raspberry-pi-control --lines 100"
```

### Test a sudo rule as the display user
```sh
sudo -u display sudo -n <command>
```
Exit code 0 = rule works. `sudo: a password is required` = rule does not match the exact command/args.

## Troubleshooting Playbook

### "System Update" in the UI fails with `sudo: a password is required`

Root causes seen in this repo, in order of likelihood:

1. **Sudoers rule does not match arguments.** `apt-get upgrade` in sudoers does NOT match `apt-get upgrade -y`. Sudoers requires either the exact command line or an explicit wildcard. Fix by adding `apt-get upgrade *` (and similar) to the sudoers file.
2. **Wrong binary path.** `which shutdown` is `/usr/sbin/shutdown` on Debian Trixie, not `/sbin/shutdown`. Sudoers rules must use the path that `sudo` will actually resolve via `secure_path`. Verify with `which <cmd>`.
3. **Conflicting/duplicate sudoers files.** Check `ls /etc/sudoers.d/` — both `display-pi-ha` and `display-user` exist here and have overlapping rules. Older incorrect paths in either file won't break things, but they're noise; ensure at least one file has the correct rules.
4. **App not restarted after sudoers change.** Sudoers changes apply immediately to new `sudo` invocations, but if you also edited `main.js` you must run `sudo su - display -c "pm2 restart all"`. (PM2's `watch: true` usually handles this, but not always.)
5. **`use_pty` forces a tty.** The system default `Defaults use_pty` causes `sudo: a terminal is required to read the password` even when NOPASSWD rules exist, in some sudo versions / non-interactive contexts. Mitigated with `Defaults:display !use_pty` in the drop-in.

**Diagnostic sequence:**
```sh
# 1. What rules are actually active?
sudo -u display sudo -l

# 2. Does the exact command the app runs work non-interactively?
sudo -u display sudo -n apt-get upgrade -y --dry-run | tail -5

# 3. What does the app actually invoke? (grep main.js)
grep -n 'sudo' main.js

# 4. Are paths right?
which apt-get systemctl shutdown reboot tee
```

If step 2 succeeds but the UI still fails, the app needs a restart (step from "Common Tasks" above).

### `pm2 list` shows nothing

You're running it as the wrong user. Use `sudo su - display -c "pm2 list"`.

### Brightness slider does nothing

- Confirm a backlight is exposed: `ls /sys/class/backlight/`.
- Confirm sudoers allows the device-independent path: `sudo -u display sh -c 'cat /sys/class/backlight/*/brightness | head -1 | sudo -n tee /sys/class/backlight/*/brightness'`.

### Stats endpoint shows `N/A` everywhere

`/system-stats` uses built-in Node/Linux sources plus `nmcli`, `df`, and optional `vnstat`. Missing optional traffic data falls back to `N/A`.

## Don'ts

- Don't remove `-n` from sudo calls in `main.js`.
- Don't add new shell-out calls without a corresponding sudoers entry (with arg wildcard if needed).
- Don't expose the server beyond `localhost`. There is no auth.
- Don't reformat `public/index.html` wholesale — it's hand-tuned for the 7" touchscreen.
- Don't add a build step, framework, or test runner without explicit user request.
