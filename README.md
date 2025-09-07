# Netflix Sync Chrome Extension

Synchronize Netflix playback across multiple browsers using WebSocket connections.

## Setup

### 1. Install and run the signaling server

```bash
cd signaling-server
pnpm install
pnpm start
```

The server will run on `http://localhost:8080`

### 2. Install the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the root directory containing `manifest.json`

### 3. Usage

#### On each browser:

1. Navigate to Netflix and start playing any video
2. Click the extension icon in the toolbar
3. Enter the signaling server URL (default: `ws://localhost:8080`)
   - For remote servers: `ws://your-server-ip:8080`
   - For secure connections: `wss://your-server-domain`
4. Click "Connect to Server" to connect to the signaling server
5. Enter a room ID (or leave blank to generate one) and click "Join Room"
   - All browsers should use the same room ID to sync together
   - **Sync is automatically enabled when joining a room**
   - New joiners automatically sync to the current playback state
6. When any browser pauses/plays/seeks the video, all other browsers in the same room will sync

## Features

- **Automatic Sync**: Sync is automatically enabled when joining a room
- **Auto-sync on Join**: New users automatically sync to the current room's playback state
- **Stable Connection**: Heartbeat mechanism prevents timeout disconnections
- **Auto-reconnect**: Automatically reconnects and rejoins room if connection is lost
- **Configurable Server**: Connect to any WebSocket signaling server
- **Play/Pause Sync**: When one user pauses or plays, all connected browsers follow
- **Seek Sync**: When one user seeks to a different time, all browsers jump to that position
- **Skip Forward/Backward Sync**: Detects and syncs 10s/30s skip actions
- **Netflix Controls Sync**: Syncs skip intro, skip recap, and skip credits actions
- **Keyboard Shortcuts**: Arrow keys for skipping are detected and synced
- **Real-time Sync**: Uses WebSocket for low-latency synchronization
- **Room-based**: Multiple groups can sync independently using different room IDs

## Architecture

- **WebSocket Server**: Handles room management and message relay
- **Background Service Worker**: Manages WebSocket connection and message routing
- **Content Script**: Detects Netflix video events and applies remote commands
- **Popup**: User interface for connection and room management

## Requirements

- Node.js 16+ and pnpm (install with `npm install -g pnpm`)
- Chrome or Chromium-based browser
- Netflix account

## Troubleshooting

- Make sure the signaling server is running before connecting
- Refresh Netflix page after installing the extension
- All browsers must be in the same room ID to sync
- Check browser console for debug messages
- If using npm/yarn instead of pnpm, delete pnpm-lock.yaml and run `npm install` or `yarn install`