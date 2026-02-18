# Arena Battle — Cross-Device Multiplayer Setup

## Files
- `server.js` — Node.js WebSocket game server
- `arena-online.html` — Game client (open on any device)
- `package.json` — Node dependencies

---

## Quick Start (Local Network)

### 1. Install & Run the Server
```bash
npm install
node server.js
```
You'll see:
```
🎮 Arena Battle Server
   WebSocket: ws://localhost:3000
   Status:    http://localhost:3000
```

### 2. Find Your Local IP
- **Mac/Linux:** `ifconfig | grep "inet "` → look for 192.168.x.x
- **Windows:** `ipconfig` → look for IPv4 Address

### 3. Open the Game
- Open `arena-online.html` in a browser on **each device**
- In the "Server Address" field, enter:
  - On the **same machine**: `ws://localhost:3000`
  - On **other devices**: `ws://192.168.x.x:3000` (your local IP)
- Click **Connect**

### 4. Play
1. Player 1 clicks **Host Game** → gets a 4-letter room code
2. Player 2 enters the code and clicks **Join Game**
3. Game starts automatically!

---

## Deploy Online (Play Anywhere in the World)

### Option A — Railway (free, easy)
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```
Your server gets a public URL like `wss://arena-battle.railway.app`

### Option B — Render (free tier)
1. Push to GitHub
2. Go to render.com → New Web Service
3. Build command: `npm install`
4. Start command: `node server.js`
5. Your URL: `wss://your-app.onrender.com`

### Option C — VPS (DigitalOcean, Linode, etc.)
```bash
# On your VPS:
git clone your-repo
npm install
node server.js

# Or with PM2 for auto-restart:
npm install -g pm2
pm2 start server.js --name arena
pm2 save
```

Then open port 3000 in your firewall:
```bash
ufw allow 3000
```

### Using WSS (HTTPS servers require wss://)
If your server uses HTTPS, wrap with nginx:
```nginx
location /ws {
  proxy_pass http://localhost:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

---

## Server Status Page
Visit `http://your-server:3000` to see active rooms.
