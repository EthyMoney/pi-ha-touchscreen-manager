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
  - IP address and WiFi signal strength (dBm)
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

### Touch-Optimized UI
- Large, finger-friendly buttons sized for 7" touchscreens
- Animated background with floating color orbs
- Modal dialogs for detailed information and settings
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

3. Change the Home Assistant URL in the goBack() function at the bottom of the `public/index.html` file to your Home Assistant URL. This is where the "Back to Home Assistant" button will navigate to and needs to point to your Home Assistant instance.

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
The main screen provides large, touch-friendly buttons for common tasks:
- **Back to Home Assistant** - Returns to your configured Home Assistant URL
- **Shutdown** - Powers down the Pi (with confirmation)
- **Reboot** - Restarts the Pi (with confirmation)
- **Update** - Runs system updates with live output display
- **Restart Display** - Restarts the LightDM display manager

### System Stats
Click the **ℹ️ info button** in the top-right corner to view:
- Hardware model and configuration
- System uptime and load
- Operating system details
- Network information (IP address, WiFi signal)
- CPU temperature
- Storage usage
- Memory usage
- Network statistics from vnstat

### Display Brightness
The **brightness control** in the bottom-left corner allows you to:
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
- `GET /shutdown` - Initiates system shutdown
- `GET /reboot` - Initiates system reboot
- `GET /update` - Starts system update with real-time output
- `GET /update-status` - SSE endpoint for streaming update output
- `GET /restart-lightdm` - Restarts display manager
- `GET /brightness` - Returns current brightness level
- `POST /brightness/:level` - Sets brightness (0-31 range)
- `GET /brightness-schedule` - Returns configured brightness schedules
- `POST /brightness-schedule` - Updates brightness schedules
- `GET /system-stats` - Returns comprehensive system information

### Technologies Used
- **Backend**: Express.js with Server-Sent Events (SSE) for real-time updates
- **Frontend**: Vanilla HTML5/CSS3/JavaScript - no external frameworks
- **Process Management**: PM2 for service management and auto-start
- **System Integration**: Direct sysfs access and child process execution for system commands
- **Automation**: Crontab integration for brightness scheduling

## Notes

- The app binds to localhost only for security (not accessible from network)
- Requires sudo privileges for system management operations
- Brightness control uses the `/sys/class/backlight/10-0045/brightness` path (adjust if your hardware differs)
- Network statistics require vnstat to be installed and configured
- WiFi signal strength readings require wireless-tools (iwconfig)
