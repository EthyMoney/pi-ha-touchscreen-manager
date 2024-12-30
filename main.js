const express = require('express');
const { exec } = require('child_process');
const app = express();
const port = 3000;

app.use(express.static('public'));

app.get('/shutdown', (req, res) => {
  exec('sudo shutdown now', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send('Error powering off');
    }
    res.send('Powering off');
  });
});

app.get('/reboot', (req, res) => {
  exec('sudo reboot', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send('Error rebooting');
    }
    res.send('Rebooting');
  });
});

app.get('/update', (req, res) => {
  exec('sudo apt-get update && sudo apt-get upgrade -y', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send('Error updating');
    }
    res.send('Updating');
  });
});

app.get('/restart-lightdm', (req, res) => {
  exec('sudo systemctl restart lightdm', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send('Error restarting lightdm');
    }
    res.send('Restarting lightdm');
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
