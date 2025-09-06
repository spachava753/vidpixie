const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const roomInput = document.getElementById('roomInput');
const serverUrlInput = document.getElementById('serverUrl');
const connectionStatus = document.getElementById('connectionStatus');
const syncStatus = document.getElementById('syncStatus');
const peerCount = document.getElementById('peerCount');
const roomDisplay = document.getElementById('roomDisplay');

let isConnected = false;
let currentRoom = null;

async function loadServerUrl() {
  const result = await chrome.storage.local.get(['serverUrl']);
  serverUrlInput.value = result.serverUrl || 'ws://localhost:8080';
}

async function saveServerUrl(url) {
  await chrome.storage.local.set({ serverUrl: url });
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function updateStatus() {
  const response = await chrome.runtime.sendMessage({ type: 'get-status' });
  
  isConnected = response.isConnected;
  currentRoom = response.roomId;
  
  if (isConnected) {
    connectionStatus.textContent = 'Connected';
    connectionStatus.className = 'status connected';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'block';
    serverUrlInput.disabled = true;
    joinRoomBtn.disabled = !roomInput.value.trim();
    
    if (currentRoom) {
      roomDisplay.textContent = `Room: ${currentRoom}`;
      peerCount.textContent = `${response.peersCount} peer(s) connected`;
      leaveRoomBtn.disabled = false;
      syncStatus.textContent = 'Syncing enabled';
      syncStatus.className = 'status connected';
    } else {
      roomDisplay.textContent = '';
      peerCount.textContent = '';
      leaveRoomBtn.disabled = true;
      syncStatus.textContent = 'Not in room';
      syncStatus.className = 'status';
    }
  } else {
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.className = 'status disconnected';
    connectBtn.style.display = 'block';
    connectBtn.textContent = 'Connect to Server';
    connectBtn.disabled = false;
    disconnectBtn.style.display = 'none';
    serverUrlInput.disabled = false;
    joinRoomBtn.disabled = true;
    leaveRoomBtn.disabled = true;
    roomDisplay.textContent = '';
    peerCount.textContent = '';
    syncStatus.textContent = 'Not in room';
    syncStatus.className = 'status';
  }
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

connectBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim() || 'ws://localhost:8080';
  
  if (!serverUrl.startsWith('ws://') && !serverUrl.startsWith('wss://')) {
    alert('Server URL must start with ws:// or wss://');
    return;
  }
  
  await saveServerUrl(serverUrl);
  
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';
  
  const response = await chrome.runtime.sendMessage({ 
    type: 'connect',
    serverUrl: serverUrl
  });
  
  if (response.success) {
    await updateStatus();
  } else {
    connectionStatus.textContent = 'Connection failed';
    connectBtn.disabled = false;
    connectBtn.textContent = 'Retry Connection';
  }
});

disconnectBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'disconnect' });
  roomInput.value = '';
  await updateStatus();
});

joinRoomBtn.addEventListener('click', async () => {
  const tab = await getCurrentTab();
  
  if (!tab.url || !tab.url.includes('netflix.com')) {
    alert('Please navigate to Netflix first');
    return;
  }
  
  const roomId = roomInput.value.trim() || generateRoomId();
  
  if (!roomId) {
    return;
  }
  
  roomInput.value = roomId;
  joinRoomBtn.disabled = true;
  syncStatus.textContent = 'Joining room...';
  
  const response = await chrome.runtime.sendMessage({
    type: 'join-room',
    roomId: roomId
  });
  
  if (response.success) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'enable-sync',
      enabled: true
    }, async () => {
      if (!chrome.runtime.lastError) {
        await updateStatus();
        
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'request-room-state'
          });
        }, 500);
      }
    });
  } else {
    alert('Failed to join room: ' + response.error);
    joinRoomBtn.disabled = false;
    syncStatus.textContent = 'Failed to join';
  }
});

leaveRoomBtn.addEventListener('click', async () => {
  const tab = await getCurrentTab();
  
  if (tab.url && tab.url.includes('netflix.com')) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'enable-sync',
      enabled: false
    });
  }
  
  await chrome.runtime.sendMessage({ type: 'leave-room' });
  roomInput.value = '';
  await updateStatus();
});

roomInput.addEventListener('input', () => {
  if (isConnected && !currentRoom) {
    joinRoomBtn.disabled = !roomInput.value.trim();
  }
});

roomInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !joinRoomBtn.disabled) {
    joinRoomBtn.click();
  }
});

loadServerUrl();
updateStatus();
setInterval(updateStatus, 2000);