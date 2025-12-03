const express = require('express');
const { exec, spawn } = require('child_process');
const app = express();
const port = 3000;
let updateInProgress = false;
let updateClients = [];
let updateOutput = [];

app.use(express.static('public'));

app.get('/shutdown', (req, res) => {
  console.log('Request received to power off system');
  exec('sudo shutdown now', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send('Error powering off');
    }
    res.send('Powering off');
  });
});

app.get('/reboot', (req, res) => {
  console.log('Request received to reboot system');
  exec('sudo reboot', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send('Error rebooting');
    }
    res.send('Rebooting');
  });
});

app.get('/update', (req, res) => {
  console.log('Request received to do system update');
  if (updateInProgress) {
    return res.status(400).send('Update already in progress');
  }
  updateInProgress = true;
  updateOutput = [];
  res.send('Update started');
  
  // Broadcast start message
  const startMsg = '=== Starting system update ===\n';
  updateOutput.push(startMsg);
  updateClients.forEach(client => client.write(`data: ${JSON.stringify({ message: startMsg, done: false })}\n\n`));
  
  // Use spawn for real-time output
  const updateProcess = spawn('bash', ['-c', 'sudo apt-get update && sudo apt-get upgrade -y']);
  
  updateProcess.stdout.on('data', (data) => {
    const message = data.toString();
    updateOutput.push(message);
    console.log(message);
    updateClients.forEach(client => client.write(`data: ${JSON.stringify({ message, done: false })}\n\n`));
  });
  
  updateProcess.stderr.on('data', (data) => {
    const message = data.toString();
    updateOutput.push(message);
    console.error(message);
    updateClients.forEach(client => client.write(`data: ${JSON.stringify({ message, done: false })}\n\n`));
  });
  
  updateProcess.on('close', (code) => {
    updateInProgress = false;
    const finishMsg = code === 0 
      ? '\n=== Update completed successfully ===\n' 
      : `\n=== Update failed with exit code ${code} ===\n`;
    updateOutput.push(finishMsg);
    console.log(finishMsg);
    updateClients.forEach(client => {
      client.write(`data: ${JSON.stringify({ message: finishMsg, done: true, success: code === 0 })}\n\n`);
    });
  });
});

app.get('/update-status', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send existing output
  updateOutput.forEach(line => {
    res.write(`data: ${JSON.stringify({ message: line, done: false })}\n\n`);
  });
  
  // Add client to list for future updates
  updateClients.push(res);
  
  // Remove client when connection closes
  req.on('close', () => {
    updateClients = updateClients.filter(client => client !== res);
  });
});

app.get('/restart-lightdm', (req, res) => {
  console.log('Request received to restart lightdm');
  exec('sudo systemctl restart lightdm', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send('Error restarting lightdm');
    }
    res.send('Restarting lightdm');
  });
});

app.get('/brightness', (req, res) => {
  console.log('Request received to get brightness');
  exec('cat /sys/class/backlight/10-0045/brightness', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).json({ error: 'Failed to get brightness' });
    }
    const brightness = parseInt(stdout.trim());
    res.json({ brightness });
  });
});

app.post('/brightness/:level', (req, res) => {
  const level = parseInt(req.params.level);
  console.log(`Request received to set brightness to ${level}`);
  
  if (isNaN(level) || level < 0 || level > 31) {
    return res.status(400).send('Brightness level must be between 0 and 31');
  }
  
  exec(`echo ${level} | sudo tee /sys/class/backlight/10-0045/brightness`, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send('Error setting brightness');
    }
    res.send(`Brightness set to ${level}`);
  });
});

app.get('/brightness-schedule', (req, res) => {
  console.log('Request received to get brightness schedule');
  exec('crontab -l 2>/dev/null | grep "brightness-schedule"', (error, stdout, stderr) => {
    if (error) {
      // No crontab or no matching entries
      return res.json({ schedules: [] });
    }
    
    const lines = stdout.trim().split('\n').filter(line => line.includes('brightness-schedule'));
    const schedules = lines.map(line => {
      const match = line.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*\s+.*brightness-schedule.*?(\d+)$/);
      if (match) {
        return { hour: match[2], minute: match[1], brightness: match[3] };
      }
      return null;
    }).filter(s => s !== null);
    
    res.json({ schedules });
  });
});

app.post('/brightness-schedule', express.json(), (req, res) => {
  console.log('Request received to update brightness schedule');
  const { schedules } = req.body;
  
  if (!Array.isArray(schedules)) {
    return res.status(400).send('Invalid schedule format');
  }
  
  // Remove existing brightness schedule entries
  exec('(crontab -l 2>/dev/null | grep -v "brightness-schedule" || true) | crontab -', (error) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send('Error updating schedule');
    }
    
    if (schedules.length === 0) {
      return res.send('Schedule cleared');
    }
    
    // Add new schedule entries
    const cronEntries = schedules.map(s => 
      `${s.minute} ${s.hour} * * * echo ${s.brightness} | sudo tee /sys/class/backlight/10-0045/brightness # brightness-schedule`
    ).join('\n');
    
    exec(`(crontab -l 2>/dev/null || true; echo "${cronEntries}") | crontab -`, (error) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return res.status(500).send('Error adding schedule');
      }
      res.send('Schedule updated');
    });
  });
});

app.get('/system-stats', (req, res) => {
  console.log('Request received for system stats');
  
  const commands = {
    hardwareModel: "cat /proc/device-tree/model 2>/dev/null | tr -d '\\0' || echo 'N/A'",
    uptime: "uptime -p",
    loadAverage: "uptime | awk -F'load average:' '{print $2}' | xargs",
    osVersion: "cat /etc/os-release | grep PRETTY_NAME | cut -d '=' -f2 | tr -d '\"'",
    ipAddress: "hostname -I | awk '{print $1}'",
    wifiSignal: "iwconfig wlan0 2>/dev/null | grep 'Signal level' | awk '{print $4}' | cut -d '=' -f2 || echo 'N/A'",
    diskSpace: "df -h / | awk 'NR==2 {print $3 \" / \" $2 \" (\" $5 \" used)\"}'",
    diskRoot: "df -h / | awk 'NR==2 {print $5}' | tr -d '%'",
    memory: "free -m | awk 'NR==2 {printf \"%.1fG / %.1fG\", $3/1024, $2/1024}'",
    temperature: "vcgencmd measure_temp 2>/dev/null | cut -d '=' -f2 || echo 'N/A'",
    vnstatToday: "vnstat -i wlan0 -d --json 2>/dev/null | jq -r '.interfaces[0].traffic.day[0] | \"↓ \" + (if .rx >= 1073741824 then (.rx / 1073741824 | tostring | .[0:4]) + \"G\" else (.rx / 1048576 | tostring | .[0:4]) + \"M\" end) + \"  ↑ \" + (if .tx >= 1073741824 then (.tx / 1073741824 | tostring | .[0:4]) + \"G\" else (.tx / 1048576 | tostring | .[0:4]) + \"M\" end)' || echo 'N/A'",
    vnstatWeek: "vnstat -i wlan0 -w --json 2>/dev/null | jq -r '.interfaces[0].traffic.week[0] | \"↓ \" + (if .rx >= 1073741824 then (.rx / 1073741824 | tostring | .[0:5]) + \"G\" else (.rx / 1048576 | tostring | .[0:5]) + \"M\" end) + \"  ↑ \" + (if .tx >= 1073741824 then (.tx / 1073741824 | tostring | .[0:5]) + \"G\" else (.tx / 1048576 | tostring | .[0:5]) + \"M\" end)' || echo 'N/A'",
    vnstatMonth: "vnstat -i wlan0 -m --json 2>/dev/null | jq -r '.interfaces[0].traffic.month[0] | \"↓ \" + (if .rx >= 1073741824 then (.rx / 1073741824 | tostring | .[0:5]) + \"G\" else (.rx / 1048576 | tostring | .[0:5]) + \"M\" end) + \"  ↑ \" + (if .tx >= 1073741824 then (.tx / 1073741824 | tostring | .[0:5]) + \"G\" else (.tx / 1048576 | tostring | .[0:5]) + \"M\" end)' || echo 'N/A'"
  };

  const stats = {};
  let completed = 0;
  const total = Object.keys(commands).length;

  Object.entries(commands).forEach(([key, command]) => {
    exec(command, (error, stdout, stderr) => {
      stats[key] = error ? 'N/A' : stdout.trim();
      completed++;
      
      if (completed === total) {
        res.json(stats);
      }
    });
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
