require('dotenv').config();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const QRCode = require('qrcode');
const path = require('path');
const { setupSocketHandlers } = require('./src/socket-handlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use('/host', express.static(path.join(__dirname, 'public/host')));
app.use('/player', express.static(path.join(__dirname, 'public/player')));
app.use('/shared', express.static(path.join(__dirname, 'public/shared')));

// QR code endpoint — generates QR pointing to player join page
app.get('/qr', async (req, res) => {
  const ip = getLanIp();
  const port = process.env.PORT || 3000;
  const url = `http://${ip}:${port}/player/`;
  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#F8F9FF' }
    });
    res.json({ qrDataUrl, url });
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Wire up all socket events
setupSocketHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLanIp();
  console.log(`\n🎮 DRINK GAME SERVER RUNNING`);
  console.log(`   Host (TV):   http://localhost:${PORT}/host/`);
  console.log(`   Player:      http://localhost:${PORT}/player/`);
  console.log(`   LAN Player:  http://${ip}:${PORT}/player/`);
  console.log(`   QR Code:     http://localhost:${PORT}/qr\n`);
});
