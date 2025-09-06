let ws = null;
let peers = new Map();
let clientId = null;
let currentRoomId = null;
let isConnected = false;
let serverUrl = null;
let reconnectInterval = null;
let pingInterval = null;
let shouldReconnect = false;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

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
      
      ws.onclose = (event) => {
        console.log('Disconnected from signaling server. Code:', event.code, 'Reason:', event.reason);
        isConnected = false;
        clientId = null;
        const prevRoomId = currentRoomId;
        currentRoomId = null;
        cleanupPeers();
        stopPingInterval();
        
        if (shouldReconnect && !reconnectInterval) {
          console.log('Will attempt to reconnect...');
          reconnectInterval = setInterval(async () => {
            console.log('Attempting to reconnect...');
            try {
              await connectToSignalingServer();
              if (prevRoomId && isConnected) {
                console.log('Reconnected! Rejoining room:', prevRoomId);
                setTimeout(() => {
                  if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                      type: 'join-room',
                      roomId: prevRoomId
                    }));
                  }
                }, 500);
              }
            } catch (error) {
              console.log('Reconnection failed, will retry...');
            }
          }, 5000);
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
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
      for (const peerId of data.otherClients) {
        await createPeerConnection(peerId, true);
      }
      break;
      
    case 'peer-joined':
      if (data.peerId !== clientId) {
        await createPeerConnection(data.peerId, false);
      }
      break;
      
    case 'peer-left':
      closePeerConnection(data.peerId);
      break;
      
    case 'offer':
      await handleOffer(data);
      break;
      
    case 'answer':
      await handleAnswer(data);
      break;
      
    case 'ice-candidate':
      await handleIceCandidate(data);
      break;
      
    case 'sync-event':
      if (data.senderId !== clientId) {
        await broadcastToTabs(data.event);
      }
      break;
      
    case 'state-request':
      if (data.senderId !== clientId) {
        await handleStateRequest(data.senderId);
      }
      break;
      
    case 'state-response':
      if (data.senderId !== clientId) {
        await broadcastToTabs({
          action: 'sync-to-state',
          state: data.state
        });
      }
      break;
  }
}

async function createPeerConnection(peerId, isInitiator) {
  if (peers.has(peerId)) {
    return peers.get(peerId);
  }
  
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const dataChannel = isInitiator 
    ? pc.createDataChannel('sync', { ordered: true })
    : null;
  
  const peer = {
    id: peerId,
    connection: pc,
    dataChannel: dataChannel,
    isConnected: false
  };
  
  pc.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'ice-candidate',
        targetId: peerId,
        candidate: event.candidate
      }));
    }
  };
  
  pc.ondatachannel = (event) => {
    if (!isInitiator) {
      peer.dataChannel = event.channel;
      setupDataChannel(peer);
    }
  };
  
  if (isInitiator) {
    setupDataChannel(peer);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    ws.send(JSON.stringify({
      type: 'offer',
      targetId: peerId,
      offer: offer
    }));
  }
  
  peers.set(peerId, peer);
  return peer;
}

function setupDataChannel(peer) {
  if (!peer.dataChannel) return;
  
  peer.dataChannel.onopen = () => {
    peer.isConnected = true;
    console.log(`Data channel opened with peer ${peer.id}`);
  };
  
  peer.dataChannel.onclose = () => {
    peer.isConnected = false;
    console.log(`Data channel closed with peer ${peer.id}`);
  };
  
  peer.dataChannel.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'sync-event') {
      await broadcastToTabs(data.event);
    }
  };
}

async function handleOffer(data) {
  const peer = await createPeerConnection(data.senderId, false);
  await peer.connection.setRemoteDescription(data.offer);
  const answer = await peer.connection.createAnswer();
  await peer.connection.setLocalDescription(answer);
  
  ws.send(JSON.stringify({
    type: 'answer',
    targetId: data.senderId,
    answer: answer
  }));
}

async function handleAnswer(data) {
  const peer = peers.get(data.senderId);
  if (peer) {
    await peer.connection.setRemoteDescription(data.answer);
  }
}

async function handleIceCandidate(data) {
  const peer = peers.get(data.senderId);
  if (peer) {
    await peer.connection.addIceCandidate(data.candidate);
  }
}

function closePeerConnection(peerId) {
  const peer = peers.get(peerId);
  if (peer) {
    if (peer.dataChannel) {
      peer.dataChannel.close();
    }
    peer.connection.close();
    peers.delete(peerId);
  }
}

function cleanupPeers() {
  for (const [peerId, peer] of peers) {
    closePeerConnection(peerId);
  }
  peers.clear();
}

async function broadcastToTabs(event) {
  const tabs = await chrome.tabs.query({ url: 'https://*.netflix.com/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'sync-event',
      event: event
    }).catch(() => {});
  }
}

async function handleStateRequest(requesterId) {
  const tabs = await chrome.tabs.query({ url: 'https://*.netflix.com/*' });
  if (tabs.length > 0) {
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'get-video-state'
    }, (response) => {
      if (!chrome.runtime.lastError && response && response.state) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'sync-event',
            event: {
              action: 'state-response',
              targetId: requesterId,
              state: response.state
            }
          }));
        }
      }
    });
  }
}

function broadcastToPeers(event) {
  if (ws && ws.readyState === WebSocket.OPEN && currentRoomId) {
    ws.send(JSON.stringify({
      type: 'sync-event',
      event: event
    }));
  }
  
  for (const [peerId, peer] of peers) {
    if (peer.isConnected && peer.dataChannel && peer.dataChannel.readyState === 'open') {
      peer.dataChannel.send(JSON.stringify({
        type: 'sync-event',
        event: event
      }));
    }
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch(request.type) {
        case 'connect':
          await connectToSignalingServer(request.serverUrl);
          sendResponse({ success: true, isConnected });
          break;
          
        case 'disconnect':
          shouldReconnect = false;
          if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
          }
          stopPingInterval();
          if (ws) {
            ws.close();
            ws = null;
          }
          cleanupPeers();
          isConnected = false;
          currentRoomId = null;
          sendResponse({ success: true });
          break;
          
        case 'join-room':
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'join-room',
              roomId: request.roomId
            }));
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Not connected' });
          }
          break;
          
        case 'leave-room':
          if (ws && ws.readyState === WebSocket.OPEN && currentRoomId) {
            ws.send(JSON.stringify({
              type: 'leave-room'
            }));
            currentRoomId = null;
            cleanupPeers();
          }
          sendResponse({ success: true });
          break;
          
        case 'local-sync-event':
          broadcastToPeers(request.event);
          sendResponse({ success: true });
          break;
          
        case 'get-status':
          sendResponse({
            isConnected,
            roomId: currentRoomId,
            peersCount: peers.size
          });
          break;
          
        case 'request-room-state':
          if (ws && ws.readyState === WebSocket.OPEN && currentRoomId) {
            ws.send(JSON.stringify({
              type: 'sync-event',
              event: {
                action: 'state-request'
              }
            }));
          }
          sendResponse({ success: true });
          break;
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true;
});