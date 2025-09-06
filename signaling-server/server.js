const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const rooms = new Map();
const clients = new Map();

const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 60000;

function getTimestamp() {
  return new Date().toLocaleTimeString();
}

console.log(`[${getTimestamp()}] 🚀 Signaling server running on port ${PORT}`);
console.log('----------------------------------------');

wss.on('connection', (ws) => {
  const clientId = uuidv4();
  
  clients.set(ws, {
    id: clientId,
    roomId: null,
    isAlive: true,
    lastActivity: Date.now()
  });
  
  console.log(`[${getTimestamp()}] ✅ Client connected: ${clientId}`);
  
  ws.send(JSON.stringify({
    type: 'connected',
    clientId: clientId
  }));
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const client = clients.get(ws);
      
      if (client) {
        client.lastActivity = Date.now();
        client.isAlive = true;
      }
      
      switch(data.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
          
        case 'pong':
          break;
        case 'join-room':
          handleJoinRoom(ws, client, data.roomId);
          break;
          
        case 'leave-room':
          handleLeaveRoom(ws, client);
          break;
          
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          console.log(`[${getTimestamp()}] 🔄 WebRTC ${data.type} from ${client.id} to ${data.targetId}`);
          forwardSignalingMessage(ws, client, data);
          break;
          
        case 'sync-event':
          let eventDescription = data.event.action;
          if (data.event.action === 'state-request') {
            eventDescription = 'requesting room state';
          } else if (data.event.action === 'state-response') {
            eventDescription = `sharing state (${data.event.state?.paused ? 'paused' : 'playing'} at ${data.event.state?.currentTime?.toFixed(2)}s)`;
          } else if (data.event.action === 'skip-forward' || data.event.action === 'skip-backward') {
            eventDescription = `${data.event.action} ${Math.abs(data.event.skipAmount)}s to ${data.event.currentTime?.toFixed(2)}s`;
          } else if (data.event.action === 'seek') {
            eventDescription = `seek to ${data.event.currentTime?.toFixed(2)}s`;
          } else {
            eventDescription = `${data.event.action} at ${data.event.currentTime?.toFixed(2)}s`;
          }
          console.log(`[${getTimestamp()}] 📺 Sync event in room ${client.roomId}: ${eventDescription} from ${client.id}`);
          
          if (data.event.targetId) {
            for (const [otherWs, otherClient] of clients) {
              if (otherClient.id === data.event.targetId && otherClient.roomId === client.roomId) {
                otherWs.send(JSON.stringify({
                  type: 'sync-event',
                  event: data.event,
                  senderId: client.id
                }));
                break;
              }
            }
          } else {
            broadcastToRoom(ws, client, {
              type: 'sync-event',
              event: data.event,
              senderId: client.id
            });
          }
          break;
      }
    } catch (error) {
      console.error(`[${getTimestamp()}] ❌ Error handling message:`, error);
    }
  });
  
  ws.on('close', () => {
    const client = clients.get(ws);
    if (client) {
      console.log(`[${getTimestamp()}] 👋 Client disconnected: ${client.id}`);
      if (client.roomId) {
        handleLeaveRoom(ws, client);
      }
    }
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    const client = clients.get(ws);
    if (client) {
      console.log(`[${getTimestamp()}] ⚠️ WebSocket error for client ${client.id}: ${error.message}`);
    }
  });
});

function handleJoinRoom(ws, client, roomId) {
  if (client.roomId) {
    handleLeaveRoom(ws, client);
  }
  
  client.roomId = roomId;
  
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
    console.log(`[${getTimestamp()}] 🏠 Room created: ${roomId}`);
  }
  
  const room = rooms.get(roomId);
  const otherClients = Array.from(room).filter(otherId => otherId !== client.id);
  
  room.add(client.id);
  
  console.log(`[${getTimestamp()}] 📥 Client ${client.id} joined room ${roomId}`);
  console.log(`[${getTimestamp()}]    Room ${roomId} now has ${room.size} client(s)`);
  
  ws.send(JSON.stringify({
    type: 'room-joined',
    roomId: roomId,
    otherClients: otherClients
  }));
  
  broadcastToRoom(ws, client, {
    type: 'peer-joined',
    peerId: client.id
  });
}

function handleLeaveRoom(ws, client) {
  if (!client.roomId) return;
  
  const roomId = client.roomId;
  const room = rooms.get(roomId);
  
  if (room) {
    room.delete(client.id);
    console.log(`[${getTimestamp()}] 📤 Client ${client.id} left room ${roomId}`);
    
    if (room.size === 0) {
      rooms.delete(roomId);
      console.log(`[${getTimestamp()}] 🗑️  Room destroyed: ${roomId} (no clients remaining)`);
    } else {
      console.log(`[${getTimestamp()}]    Room ${roomId} now has ${room.size} client(s)`);
    }
  }
  
  broadcastToRoom(ws, client, {
    type: 'peer-left',
    peerId: client.id
  });
  
  client.roomId = null;
}

function forwardSignalingMessage(ws, client, data) {
  if (!client.roomId || !data.targetId) return;
  
  for (const [otherWs, otherClient] of clients) {
    if (otherClient.id === data.targetId && otherClient.roomId === client.roomId) {
      otherWs.send(JSON.stringify({
        ...data,
        senderId: client.id
      }));
      break;
    }
  }
}

function broadcastToRoom(ws, client, message) {
  if (!client.roomId) return;
  
  const room = rooms.get(client.roomId);
  if (!room) return;
  
  for (const [otherWs, otherClient] of clients) {
    if (otherWs !== ws && otherClient.roomId === client.roomId) {
      otherWs.send(JSON.stringify(message));
    }
  }
}

function printServerStatus() {
  console.log(`\n[${getTimestamp()}] 📊 Server Status Report`);
  console.log('----------------------------------------');
  console.log(`Total clients connected: ${clients.size}`);
  console.log(`Active rooms: ${rooms.size}`);
  
  if (rooms.size > 0) {
    console.log('\nRoom details:');
    for (const [roomId, clientIds] of rooms) {
      console.log(`  • Room ${roomId}: ${clientIds.size} client(s)`);
    }
  }
  console.log('----------------------------------------\n');
}

setInterval(printServerStatus, 30000);

const heartbeatInterval = setInterval(() => {
  const now = Date.now();
  
  for (const [ws, client] of clients) {
    if (now - client.lastActivity > HEARTBEAT_TIMEOUT) {
      console.log(`[${getTimestamp()}] ⏰ Client ${client.id} timed out (no activity for ${HEARTBEAT_TIMEOUT/1000}s)`);
      ws.terminate();
      continue;
    }
    
    if (client.isAlive === false) {
      console.log(`[${getTimestamp()}] 💔 Client ${client.id} failed heartbeat check`);
      ws.terminate();
      continue;
    }
    
    client.isAlive = false;
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});