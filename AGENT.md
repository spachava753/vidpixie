# Netflix Sync Extension - Agent Documentation

## Project Overview

A Chrome extension that synchronizes Netflix video playback across multiple browsers using WebRTC for peer-to-peer communication and WebSocket for signaling. Users can join rooms and watch Netflix content in perfect sync with automatic play/pause/seek synchronization.

## Project Structure and Organization

```
.
├── manifest.json           # Chrome extension manifest (v3)
├── background.js          # Service worker handling WebRTC and WebSocket connections
├── content.js            # Content script for Netflix video detection and control
├── popup.html           # Extension popup UI
├── popup.js            # Popup interaction logic
├── icon.png           # Extension icon
├── icon.svg          # Extension icon source
├── signaling-server/
│   ├── package.json   # Node.js dependencies
│   ├── pnpm-lock.yaml # pnpm lock file
│   ├── server.js     # WebSocket signaling server
│   ├── fly.toml      # Fly.io deployment configuration
│   ├── Dockerfile    # Docker container for Fly.io deployment
│   └── node_modules/ # Dependencies (gitignored)
└── README.md        # User documentation
```

### Key Components

- **Chrome Extension**: Handles video synchronization and peer connections
- **Signaling Server**: WebSocket server for peer discovery and WebRTC negotiation
- **Content Script**: Monitors Netflix video events and applies remote commands
- **Background Service Worker**: Manages WebRTC connections and message routing

## Build, Test, and Development Commands

### Signaling Server

```bash
# Install dependencies
cd signaling-server
pnpm install

# Start server locally (default port 8080)
pnpm start

# Start with custom port
PORT=3000 pnpm start
```

### Fly.io Deployment

**Fly.io** is a platform for running full-stack apps and databases close to users globally. The signaling server is configured for deployment on Fly.io to provide a production WebSocket server with automatic SSL/TLS, global distribution, and auto-scaling.

**IMPORTANT**: Never deploy to Fly.io unless the user explicitly requests deployment. Always ask for confirmation before running any deployment commands.

#### Fly CLI Commands

```bash
# Install fly CLI (if not installed)
curl -L https://fly.io/install.sh | sh

# Login to Fly.io (if not logged in)
fly auth login

# Deploy the signaling server (from signaling-server directory)
cd signaling-server
fly deploy

# Check deployment status
fly status

# View logs
fly logs

# Scale the application
fly scale count 2  # Run 2 instances

# Open deployed app in browser
fly open

# SSH into running instance
fly ssh console

# View app configuration
fly config show

# Destroy deployment (careful!)
fly apps destroy vidpixe-signaling-server
```

#### Deployment Configuration

- **App Name**: `vidpixe-signaling-server`
- **Primary Region**: `iad` (US East - Ashburn, Virginia)
- **Internal Port**: 8080 (WebSocket server port)
- **Auto-scaling**: Configured with auto start/stop, min 0 machines
- **Resources**: 1GB RAM, 1 shared CPU
- **Force HTTPS**: Enabled for WSS connections
- **Dockerfile**: Multi-stage build with pnpm for optimized image size

### Chrome Extension

```bash
# Load extension in Chrome
1. Open chrome://extensions/
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select project root directory

# Reload extension after changes
1. Click refresh icon in chrome://extensions/
2. Refresh Netflix tabs
```

### Development Workflow

```bash
# Watch server logs
cd signaling-server && pnpm start

# Test WebSocket connection
wscat -c ws://localhost:8080

# Monitor extension logs
1. Open Chrome DevTools on Netflix tab
2. Check Console for content script logs
3. Open chrome://extensions/ → Details → Service Worker for background logs
```

## Code Style and Conventions

### JavaScript Style

- **NO COMMENTS**: Do not add code comments unless specifically requested
- **Async/Await**: Prefer async/await over promises for readability
- **Error Handling**: Always handle WebSocket and WebRTC errors gracefully
- **Logging**: Use descriptive console.log with emojis in server, minimal logging in extension

### Naming Conventions

- **Functions**: camelCase (e.g., `handleJoinRoom`, `setupVideoListeners`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `ICE_SERVERS`, `HEARTBEAT_INTERVAL`)
- **Event Types**: kebab-case (e.g., `join-room`, `sync-event`, `skip-forward`)
- **WebSocket Messages**: JSON with `type` field for message routing

### Message Protocol

```javascript
// Client to Server
{ type: 'join-room', roomId: 'ROOM123' }
{ type: 'leave-room' }
{ type: 'ping' }

// Server to Client  
{ type: 'connected', clientId: 'uuid' }
{ type: 'room-joined', roomId: 'ROOM123', otherClients: [] }
{ type: 'pong' }

// Sync Events
{ type: 'sync-event', event: { action: 'play', currentTime: 123.45 } }
```

## Architecture and Design Patterns

### Communication Flow

```
Netflix Tab ← Content Script ← → Background Service Worker ← → WebSocket Server
                                            ↓ ↑
                                     WebRTC Data Channel
                                            ↓ ↑
                                      Other Peers
```

### Connection Management

1. **WebSocket Connection**: Persistent connection to signaling server with auto-reconnect
2. **Heartbeat Mechanism**: Ping/pong every 25-30 seconds to prevent timeout
3. **Room-based Isolation**: Each room ID creates isolated sync group
4. **State Synchronization**: New joiners request and sync to current room state

### Event Detection Strategy

- **Video Events**: Listen for `play`, `pause`, `seeked` events
- **Skip Detection**: Calculate time differences to identify 10s/30s skips
- **Time Tracking**: Maintain `lastKnownTime` for accurate skip detection
- **Local Action Flag**: Prevent feedback loops with `isLocalAction` flag

### WebRTC Implementation

- **STUN Servers**: Google's public STUN servers for NAT traversal
- **Data Channels**: Ordered, reliable channels for sync events
- **Fallback**: WebSocket relay when P2P connection fails
- **Peer Management**: Map of peer connections per room

## Testing Guidelines

### Manual Testing Checklist

```markdown
- [ ] Extension loads without errors
- [ ] Can connect to signaling server
- [ ] Can join/leave rooms
- [ ] Play/pause syncs across browsers
- [ ] Seek syncs to correct position
- [ ] Skip forward/backward (10s) syncs
- [ ] New joiner syncs to current state
- [ ] Reconnects after network interruption
- [ ] Handles Netflix navigation between titles
```

### Test Scenarios

1. **Two Browser Sync**: Open two profiles/browsers, join same room
2. **Network Interruption**: Disable/enable network, verify reconnection
3. **Late Joiner**: Start video, have second user join mid-playback
4. **Rapid Actions**: Quick play/pause/seek to test race conditions
5. **Room Isolation**: Verify multiple rooms don't interfere

### Debug Commands

```javascript
// In Chrome DevTools Console (Netflix tab)
chrome.runtime.sendMessage({type: 'get-status'}, console.log)

// Check video state
document.querySelector('video').currentTime
document.querySelector('video').paused
```

## Security Considerations

### Chrome Extension Permissions

- **Minimal Permissions**: Only `storage` and `tabs` permissions
- **Host Permissions**: Limited to `*.netflix.com`
- **Content Script Isolation**: Runs in isolated world
- **No External Scripts**: All code bundled with extension

### WebSocket Security

- **Server URL Validation**: Must start with `ws://` or `wss://`
- **Room ID**: Use random strings, no personal data
- **No Authentication**: Consider adding auth for production
- **Rate Limiting**: Not implemented, add for production

### Data Privacy

- **No Video Content**: Only sync timing data, no actual video
- **No User Data**: No personal information collected
- **Local Storage Only**: Server URL stored locally
- **P2P When Possible**: Direct connections reduce server exposure

### Production Recommendations

```javascript
// Add to server.js for production
const rateLimit = new Map(); // Implement rate limiting
const AUTH_TOKEN = process.env.AUTH_TOKEN; // Add authentication

// Use WSS in production (automatic with Fly.io)
wss://vidpixe-signaling-server.fly.dev

// Add CORS headers if needed
app.use(cors({ origin: 'chrome-extension://YOUR_EXTENSION_ID' }));
```

### Fly.io Production URL

Once deployed, the WebSocket server will be available at:
- **WebSocket URL**: `wss://vidpixe-signaling-server.fly.dev`
- **HTTPS forced**: Automatically upgrades to WSS for secure connections
- **Auto-SSL**: Fly.io provides automatic SSL certificates

## Configuration

### Environment Variables

```bash
# Server (local development)
PORT=8080                    # WebSocket server port
NODE_ENV=development        # Environment mode

# Server (Fly.io production)
PORT=8080                    # Internal port (configured in fly.toml)
NODE_ENV=production         # Set automatically by Dockerfile

# Extension (in popup.js)
DEFAULT_SERVER_URL=ws://localhost:8080  # Development
# DEFAULT_SERVER_URL=wss://vidpixe-signaling-server.fly.dev  # Production
```

### Chrome Storage

```javascript
// Stored settings
{
  serverUrl: 'ws://localhost:8080'  // User's preferred server
}
```

### Constants to Adjust

```javascript
// background.js
const ICE_SERVERS = [...];           // STUN/TURN servers
const RECONNECT_INTERVAL = 5000;     // Reconnection delay
const PING_INTERVAL = 25000;         // Client ping frequency

// signaling-server/server.js
const HEARTBEAT_INTERVAL = 30000;    // Server ping frequency
const HEARTBEAT_TIMEOUT = 60000;     // Disconnect timeout
```

## Development Tips

1. **Package Manager**: Use `pnpm` for faster installs and disk efficiency
2. **Server First**: Always start signaling server before testing
3. **Fresh Reload**: Reload extension AND Netflix tab after changes
4. **Multiple Profiles**: Use Chrome profiles for testing multiple users
5. **Network Tab**: Monitor WebSocket frames in DevTools Network tab
6. **Service Worker**: Check background script logs for connection issues

## Common Issues and Solutions

| Issue | Solution |
|-------|----------|
| Extension not connecting | Check server is running, verify URL format |
| Sync not working | Ensure both users in same room, check console |
| Disconnections | Verify heartbeat working, check network stability |
| Video won't sync | Refresh Netflix page, rejoin room |
| Can't find video | Wait for Netflix to fully load before joining |

## References

- @README.md - User documentation and setup instructions
- @manifest.json - Extension configuration and permissions
- Chrome Extension Docs: https://developer.chrome.com/docs/extensions/mv3/
- WebRTC Guide: https://webrtc.org/getting-started/overview