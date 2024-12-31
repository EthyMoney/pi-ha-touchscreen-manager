# pi-ha-touchscreen-manager

This is a basic app to manage a Raspberry Pi running a Home Assistant dashboard on a connected touchscreen. On the dashboard, you can add a button that has a URL action to go to the app's local URL and open the webpage right on the touchscreen. This app provides a few basic functions to manage the Raspberry Pi without needing to connect a keyboard or mouse, like updating, rebooting, or shutting down the Pi. It also provides a button to navigate back to the Home Assistant dashboard.

This is useful to have a dedicated touchscreen for Home Assistant that can be managed without needing to connect a keyboard or mouse to the Raspberry Pi or remote in. This is especially useful for wall-mounted touchscreens that are not easily accessible.

## Features

- Shutdown the Raspberry Pi
- Reboot the Raspberry Pi
- Update the Raspberry Pi
- Restart the LightDM display manager
- Navigate back to Home Assistant

## Prerequisites

- Node.js and npm installed on your Raspberry Pi
- PM2 installed globally (`npm install -g pm2`)

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

9. Done! Now you have an easy device management app for your dedicated Home Assistant touchscreen Pi!
