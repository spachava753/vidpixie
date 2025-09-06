let video = null;
let isLocalAction = false;
let lastKnownTime = 0;
let syncEnabled = false;
let skipDetectionTimeout = null;

function findNetflixVideo() {
  return document.querySelector('video');
}

function setupVideoListeners() {
  video = findNetflixVideo();
  if (!video) {
    setTimeout(setupVideoListeners, 1000);
    return;
  }
  
  console.log('Netflix video found, setting up sync listeners');
  lastKnownTime = video.currentTime;
  
  video.addEventListener('play', handlePlay);
  video.addEventListener('pause', handlePause);
  video.addEventListener('seeked', handleSeek);
  video.addEventListener('timeupdate', updateLastKnownTime);
  
  const observer = new MutationObserver(() => {
    const newVideo = findNetflixVideo();
    if (newVideo && newVideo !== video) {
      console.log('Video element changed, reattaching listeners');
      if (video) {
        video.removeEventListener('play', handlePlay);
        video.removeEventListener('pause', handlePause);
        video.removeEventListener('seeked', handleSeek);
        video.removeEventListener('timeupdate', updateLastKnownTime);
      }
      video = newVideo;
      lastKnownTime = video.currentTime;
      video.addEventListener('play', handlePlay);
      video.addEventListener('pause', handlePause);
      video.addEventListener('seeked', handleSeek);
      video.addEventListener('timeupdate', updateLastKnownTime);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  setupKeyboardShortcuts();
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!syncEnabled || !video) return;
    
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const skipAmount = e.key === 'ArrowRight' ? 10 : -10;
      console.log(`Keyboard skip ${skipAmount > 0 ? 'forward' : 'backward'} detected`);
    }
  });
}

function detectNetflixControls() {
  const skipIntroButton = document.querySelector('[data-uia="player-skip-intro"], .skip-credits a, button[aria-label*="Skip"]');
  const skipRecapButton = document.querySelector('[data-uia="player-skip-recap"]');
  const skipCreditsButton = document.querySelector('[data-uia="next-episode-seamless-button"]');
  
  if (skipIntroButton && !skipIntroButton.hasAttribute('sync-listener')) {
    skipIntroButton.setAttribute('sync-listener', 'true');
    skipIntroButton.addEventListener('click', () => {
      if (syncEnabled) {
        console.log('Skip intro button clicked, will sync after seek');
      }
    });
  }
  
  if (skipRecapButton && !skipRecapButton.hasAttribute('sync-listener')) {
    skipRecapButton.setAttribute('sync-listener', 'true');
    skipRecapButton.addEventListener('click', () => {
      if (syncEnabled) {
        console.log('Skip recap button clicked, will sync after seek');
      }
    });
  }
  
  if (skipCreditsButton && !skipCreditsButton.hasAttribute('sync-listener')) {
    skipCreditsButton.setAttribute('sync-listener', 'true');
    skipCreditsButton.addEventListener('click', () => {
      if (syncEnabled) {
        console.log('Skip credits button clicked, will sync after seek');
      }
    });
  }
}

setInterval(detectNetflixControls, 2000);

function handlePlay() {
  if (isLocalAction) {
    isLocalAction = false;
    return;
  }
  
  if (!syncEnabled) return;
  
  console.log('Local play detected, broadcasting...');
  const currentTime = video.currentTime;
  
  chrome.runtime.sendMessage({
    type: 'local-sync-event',
    event: {
      action: 'play',
      currentTime: currentTime,
      timestamp: Date.now()
    }
  });
}

function handlePause() {
  if (isLocalAction) {
    isLocalAction = false;
    return;
  }
  
  if (!syncEnabled) return;
  
  console.log('Local pause detected, broadcasting...');
  const currentTime = video.currentTime;
  
  chrome.runtime.sendMessage({
    type: 'local-sync-event',
    event: {
      action: 'pause',
      currentTime: currentTime,
      timestamp: Date.now()
    }
  });
}

function handleSeek() {
  if (isLocalAction) {
    isLocalAction = false;
    return;
  }
  
  if (!syncEnabled) return;
  
  const currentTime = video.currentTime;
  const timeDiff = currentTime - lastKnownTime;
  
  let action = 'seek';
  let skipAmount = null;
  
  if (Math.abs(timeDiff - 10) < 0.5) {
    action = 'skip-forward';
    skipAmount = 10;
    console.log('Local skip forward (10s) detected, broadcasting...');
  } else if (Math.abs(timeDiff + 10) < 0.5) {
    action = 'skip-backward';
    skipAmount = -10;
    console.log('Local skip backward (10s) detected, broadcasting...');
  } else if (Math.abs(timeDiff - 30) < 0.5) {
    action = 'skip-forward';
    skipAmount = 30;
    console.log('Local skip forward (30s) detected, broadcasting...');
  } else if (Math.abs(timeDiff + 30) < 0.5) {
    action = 'skip-backward';
    skipAmount = -30;
    console.log('Local skip backward (30s) detected, broadcasting...');
  } else {
    console.log(`Local seek detected (${timeDiff > 0 ? '+' : ''}${timeDiff.toFixed(1)}s), broadcasting...`);
  }
  
  lastKnownTime = currentTime;
  
  chrome.runtime.sendMessage({
    type: 'local-sync-event',
    event: {
      action: action,
      currentTime: currentTime,
      skipAmount: skipAmount,
      timestamp: Date.now()
    }
  });
}

function updateLastKnownTime() {
  if (video && !video.paused) {
    lastKnownTime = video.currentTime;
  }
}

function applyRemoteEvent(event) {
  if (!video) {
    video = findNetflixVideo();
    if (!video) {
      console.log('No video found to apply remote event');
      return;
    }
  }
  
  isLocalAction = true;
  
  switch(event.action) {
    case 'play':
      console.log('Applying remote play');
      if (Math.abs(video.currentTime - event.currentTime) > 0.5) {
        video.currentTime = event.currentTime;
        lastKnownTime = event.currentTime;
      }
      video.play().catch(err => {
        console.error('Failed to play video:', err);
        isLocalAction = false;
      });
      break;
      
    case 'pause':
      console.log('Applying remote pause');
      if (Math.abs(video.currentTime - event.currentTime) > 0.5) {
        video.currentTime = event.currentTime;
        lastKnownTime = event.currentTime;
      }
      video.pause();
      break;
      
    case 'seek':
      console.log('Applying remote seek to', event.currentTime.toFixed(1) + 's');
      video.currentTime = event.currentTime;
      lastKnownTime = event.currentTime;
      break;
      
    case 'skip-forward':
      console.log(`Applying remote skip forward (${event.skipAmount}s)`);
      video.currentTime = event.currentTime;
      lastKnownTime = event.currentTime;
      break;
      
    case 'skip-backward':
      console.log(`Applying remote skip backward (${event.skipAmount}s)`);
      video.currentTime = event.currentTime;
      lastKnownTime = event.currentTime;
      break;
      
    case 'sync-to-state':
      if (event.state) {
        console.log(`Syncing to room state: ${event.state.paused ? 'paused' : 'playing'} at ${event.state.currentTime.toFixed(1)}s`);
        video.currentTime = event.state.currentTime;
        lastKnownTime = event.state.currentTime;
        if (event.state.paused && !video.paused) {
          video.pause();
        } else if (!event.state.paused && video.paused) {
          video.play().catch(err => {
            console.error('Failed to play video:', err);
            isLocalAction = false;
          });
        }
      }
      break;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'sync-event') {
    applyRemoteEvent(request.event);
    sendResponse({ success: true });
  } else if (request.type === 'enable-sync') {
    syncEnabled = request.enabled;
    if (syncEnabled) {
      setupVideoListeners();
    }
    sendResponse({ success: true });
  } else if (request.type === 'get-sync-status') {
    sendResponse({ syncEnabled });
  } else if (request.type === 'get-video-state') {
    const video = findNetflixVideo();
    if (video) {
      sendResponse({
        state: {
          currentTime: video.currentTime,
          paused: video.paused,
          duration: video.duration
        }
      });
    } else {
      sendResponse({ state: null });
    }
  }
  return true;
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupVideoListeners);
} else {
  setupVideoListeners();
}