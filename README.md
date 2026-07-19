# pi-ha-touchscreen-manager

A comprehensive touchscreen management interface for Raspberry Pi devices running Home Assistant dashboards. This application provides a touch-optimized UI for managing your Raspberry Pi without requiring keyboard/mouse access or remote connections—perfect for wall-mounted or dedicated Home Assistant touchscreens.

## Features

### System Management
- **Shutdown & Reboot** - Power management with confirmation dialogs to prevent accidental actions
- **System Updates** - Real-time apt-get update output streamed directly to the UI with status indicators
- **Display Manager Restart** - Restart LightDM when needed
- **Navigate to Home Assistant** - Quick return button to your dashboard

### System Monitoring
- **Real-time System Stats** - View comprehensive system information including:
  - Hardware model and OS version
  - System uptime and load average
  - IP addresses, active WiFi network, and signal percentage
  - CPU temperature
  - Disk space usage
  - Memory usage (displayed in GB)
  - Network statistics via vnstat (today/week/month with automatic MB/GB formatting)
- **System Clock** - Live clock display in the corner showing current time

### Display Control
- **Brightness Control** - Adjust screen brightness with a slider (0-100%)
- **Brightness Scheduling** - Create automated brightness schedules using cron:
  - Set brightness levels for specific times
  - Multiple schedules supported
  - Easy-to-use time picker interface

### WiFi Recovery
- Redirects failed Home Assistant navigations to a local recovery page that works offline
- Checks dashboard reachability every 30 seconds, including when a loaded dashboard becomes stale; two failed checks are required before proactive recovery
- While the recovery page is open, automatically returns to Home Assistant after it remains reachable for 15 seconds
- Scans nearby networks and connects through NetworkManager
- Includes an on-screen keyboard for password entry
- Checks Home Assistant reachability and returns to the dashboard after recovery

### Touch-Optimized UI
- Large, finger-friendly buttons sized for 7" touchscreens
- Professional dashboard layout shared with the WiFi recovery interface
- Live system health, network, brightness, and schedule summaries without opening extra panels
- Custom confirmation, update, schedule, and notification dialogs
- Responsive design optimized for touchscreen interaction

## Prerequisites

- Raspberry Pi (tested on Pi 4 Model B) running Debian/Raspbian
- Node.js and npm installed
- PM2 installed globally (`npm install -g pm2`)
- Touchscreen display (optimized for 7" screens)
- Sudo privileges for system management commands

## Installation

This is meant to be run on the Raspberry Pi itself. You can clone the repository and run the app locally. We can then use PM2 to keep the app running in the background and automatically start it on boot.

1. Clone the repository:

   ```sh
   git clone https://github.com/EthyMoney/pi-ha-touchscreen-manager.git
   cd pi-ha-touchscreen-manager
   ```

2. Install the dependencies:

   ```sh
    sudo npm install
    ```

3. Set `HOME_ASSISTANT_URL` in both environments in `process.json` to your Home Assistant URL.

4. (Optional) Start the app (just to test, use PM2 for normal operation):

   ```sh
   sudo npm start
   ```

5. Configure PM2 to start the app on boot and always keep it running in the background:

   First, edit the `process.json` file to replace the "script" value to your your path to the app.

   ```sh
   sudo pm2 start process.json
   sudo pm2 save
   sudo pm2 startup
   ```

7. Reboot the Raspberry Pi to ensure the app starts on boot:

   ```sh
    sudo reboot
    ```

8. Navigate to the app's URL on the Raspberry Pi's touchscreen. The default URL is `http://localhost:3000`. Make a button on your Home Assistant dashboard that navigates to this URL to easily access the app. Note, this is ONLY accessible on the Raspberry Pi itself, not from other devices on the network, it's locally hosted and only meant to be accessed on the Raspberry Pi.

9. Done! You now have a comprehensive touchscreen management interface for your Raspberry Pi!

## Usage

### Main Interface
The main screen provides a live system overview and touch-friendly controls:
- **Back to Home Assistant** - Returns to your configured Home Assistant URL
- **Shutdown** - Powers down the Pi (with confirmation)
- **Reboot** - Restarts the Pi (with confirmation)
- **Update** - Runs system updates with live output display
- **Restart Display** - Restarts the LightDM display manager
- **WiFi** - Opens the local network recovery interface

### System Stats
The main dashboard refreshes these statistics automatically:
- Hardware model and configuration
- System uptime and load
- Operating system details
- Network information (IP address, WiFi signal)
- CPU temperature
- Storage usage
- Memory usage
- Network statistics from vnstat

### Display Brightness
The **Display** panel allows you to:
- Adjust screen brightness with a slider
- View current brightness percentage
- Set up automated schedules via the schedule button

### Brightness Scheduling
Click the **schedule button** next to brightness control to:
- Add multiple time-based brightness schedules
- Set specific brightness levels for different times of day
- Schedules are managed via cron and persist across reboots
- Delete unwanted schedules easily

## Technical Details

### API Endpoints
- `GET /` - Serves the main UI
- `POST /shutdown` - Initiates system shutdown (`GET` retained for compatibility)
- `POST /reboot` - Initiates system reboot (`GET` retained for compatibility)
- `POST /update` - Starts system update with real-time output (`GET` retained for compatibility)
- `GET /update-status` - SSE endpoint for streaming update output
- `POST /restart-lightdm` - Restarts display manager (`GET` retained for compatibility)
- `GET /brightness` - Returns the detected backlight, current level, hardware range, and percentage
- `POST /brightness/:level` - Sets brightness within the detected hardware range
- `GET /brightness-schedule` - Returns configured brightness schedules
- `POST /brightness-schedule` - Updates brightness schedules
- `GET /system-stats` - Returns comprehensive system information
- `GET /wifi` - Serves the offline WiFi recovery interface
- `GET /api/wifi/status` - Returns current WiFi and Ethernet state
- `GET /api/wifi/networks` - Scans and returns nearby WiFi networks
- `POST /api/wifi/connect` - Connects `wlan0` to the selected network
- `GET /api/config` - Returns the configured Home Assistant URL
- `GET /api/dashboard/status` - Checks Home Assistant reachability

### Technologies Used
- **Backend**: Express.js with Server-Sent Events (SSE) for real-time updates
- **Frontend**: Vanilla HTML5/CSS3/JavaScript - no external frameworks
- **Process Management**: PM2 for service management and auto-start
- **System Integration**: Direct sysfs access and child process execution for system commands
- **Automation**: Crontab integration for brightness scheduling

## Notes

- The app binds to localhost only for security (not accessible from network)
- Requires sudo privileges for system management operations
- Brightness control detects the active device under `/sys/class/backlight`; scheduled cron commands use a device-independent glob
- Network statistics require vnstat to be installed and configured
- WiFi state and signal readings use NetworkManager (`nmcli`)
- WiFi recovery uses `/usr/bin/nmcli`; run `/home/display/sudoers-setup.sh` as root after installation so the local app can manage NetworkManager non-interactively.
- `HOME_ASSISTANT_URL` in `process.json` is the dashboard target used by the manager, startup, and recovery checks. `/home/display/start-chrome.sh` should continue opening the local `/kiosk` bootstrap URL.
