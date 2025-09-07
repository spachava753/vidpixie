let ws = null;
let clientId = null;
let currentRoomId = null;
let isConnected = false;
let serverUrl = null;
let reconnectInterval = null;
let pingInterval = null;
let shouldReconnect = false;

async function getServerUrl() {
  const result = await chrome.storage.local.get(['serverUrl']);
  return result.serverUrl || 'ws://localhost:8080';
}

async function connectToSignalingServer(customUrl = null) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  
  serverUrl = customUrl || await getServerUrl();
  
  return new Promise((resolve, reject) => {
    try {
      ws = new WebSocket(serverUrl);
    
      ws.onopen = () => {
        console.log('Connected to signaling server at:', serverUrl);
        isConnected = true;
        shouldReconnect = true;
        
        if (reconnectInterval) {
          clearInterval(reconnectInterval);
          reconnectInterval = null;
        }
        
        startPingInterval();
        resolve();
      };
      
      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        await handleSignalingMessage(data);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        isConnected = false;
        reject(error);
      };
      
      ws.onclose = () => {
        console.log('Disconnected from signaling server');
        isConnected = false;
        ws = null;
        stopPingInterval();
        
        const prevRoomId = currentRoomId;
        currentRoomId = null;
        
        if (shouldReconnect && !reconnectInterval) {
          console.log('Will attempt to reconnect...');
          reconnectInterval = setInterval(async () => {
            try {
              await connectToSignalingServer();
              if (prevRoomId && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'join-room',
                  roomId: prevRoomId
                }));
              }
            } catch (error) {
              console.log('Reconnection failed, will retry...');
            }
          }, 5000);
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      isConnected = false;
      reject(error);
    }
  });
}

function startPingInterval() {
  stopPingInterval();
  
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 25000);
}

function stopPingInterval() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

async function handleSignalingMessage(data) {
  switch(data.type) {
    case 'ping':
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
      break;
      
    case 'pong':
      break;
      
    case 'connected':
      clientId = data.clientId;
      console.log('Assigned client ID:', clientId);
      break;
      
    case 'room-joined':
      currentRoomId = data.roomId;
      console.log('Joined room:', currentRoomId);
      break;
      
    case 'peer-joined':
      console.log('Peer joined:', data.peerId);
      break;
      
    case 'peer-left':
      console.log('Peer left:', data.peerId);
      break;
      
    case 'sync-event':
      if (data.senderId !== clientId) {
        if (data.event.action === 'state-request') {
          await handleStateRequest(data.senderId);
        } else if (data.event.action === 'state-response') {
          await broadcastToTabs({
            action: 'sync-to-state',
            state: data.event.state
          });
        } else {
          await broadcastToTabs(data.event);
        }
      }
      break;
  }
}

async function broadcastToTabs(event) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'sync-event',
      event: event
    }).catch(() => {});
  }
}

async function handleStateRequest(requesterId) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'get-video-state'
    }, (response) => {
      if (!chrome.runtime.lastError && response && response.state) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'sync-event',
            targetId: requesterId,
            event: {
              action: 'state-response',
              state: response.state
            }
          }));
        }
      }
    });
  }
}

function broadcastSyncEvent(event) {
  if (ws && ws.readyState === WebSocket.OPEN && currentRoomId) {
    ws.send(JSON.stringify({
      type: 'sync-event',
      event: event
    }));
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'sync-event' && currentRoomId) {
    broadcastSyncEvent(request.event);
  } else if (request.type === 'connect') {
    const connect = async () => {
      try {
        await connectToSignalingServer(request.serverUrl);
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    };
    connect();
    return true;
  } else if (request.type === 'disconnect') {
    shouldReconnect = false;
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    currentRoomId = null;
    clientId = null;
    stopPingInterval();
    sendResponse({ success: true });
  } else if (request.type === 'join-room') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (currentRoomId && currentRoomId !== request.roomId) {
        ws.send(JSON.stringify({
          type: 'leave-room'
        }));
      }
      
      ws.send(JSON.stringify({
        type: 'join-room',
        roomId: request.roomId
      }));
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Not connected to server' });
    }
  } else if (request.type === 'leave-room') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'leave-room'
      }));
      currentRoomId = null;
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Not connected to server' });
    }
  } else if (request.type === 'get-status') {
    sendResponse({
      isConnected: isConnected,
      roomId: currentRoomId,
      serverUrl: serverUrl,
      clientId: clientId
    });
  } else if (request.type === 'request-state') {
    if (ws && ws.readyState === WebSocket.OPEN && currentRoomId) {
      ws.send(JSON.stringify({
        type: 'sync-event',
        event: {
          action: 'state-request'
        }
      }));
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Not in a room' });
    }
  }
  
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Video Sync Extension installed');
});