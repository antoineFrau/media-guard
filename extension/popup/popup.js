const storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;
const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
const tabs = typeof browser !== 'undefined' ? browser.tabs : chrome.tabs;

const YOUTUBE_WATCH = /^https?:\/\/(www\.)?youtube\.com\/watch/i;

function show(el) {
  el.classList.remove('hidden');
}
function hide(el) {
  el.classList.add('hidden');
}

function openSettings() {
  runtime.openOptionsPage?.();
  window.close();
}

document.getElementById('settings-link').addEventListener('click', (e) => {
  e.preventDefault();
  openSettings();
});

async function init() {
  const notYoutube = document.getElementById('not-youtube');
  const youtubePanel = document.getElementById('youtube-panel');
  const loading = document.getElementById('loading');

  try {
    const [tab] = await tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      show(notYoutube);
      hide(youtubePanel);
      hide(loading);
      return;
    }

    const isYouTube = tab.url && YOUTUBE_WATCH.test(tab.url);
    if (!isYouTube) {
      show(notYoutube);
      hide(youtubePanel);
      hide(loading);
      return;
    }

    hide(notYoutube);
    show(youtubePanel);
    hide(loading);

    let state;
    try {
      state = await tabs.sendMessage(tab.id, { action: 'getVideoState' });
    } catch (err) {
      // Content script may not be ready
      state = { error: 'Content script not ready. Refresh the page.' };
    }

    renderYouTubePanel(state, tab.id);
  } catch (err) {
    show(notYoutube);
    hide(youtubePanel);
    hide(loading);
  }
}

function renderYouTubePanel(state, tabId) {
  const videoStatus = document.getElementById('video-status');
  const captureSection = document.getElementById('capture-section');
  const analysisSection = document.getElementById('analysis-section');
  const insightsList = document.getElementById('insights-list');
  const emptyState = document.getElementById('empty-state');
  const captureBtn = document.getElementById('capture-btn');

  videoStatus.innerHTML = '';

  if (state.error) {
    videoStatus.textContent = state.error;
    videoStatus.className = 'status-area error';
    hide(captureSection);
    hide(analysisSection);
    show(emptyState);
    return;
  }

  const { videoId, analysisData, isLoading, loadError, segments } = state;

  if (isLoading) {
    videoStatus.textContent = 'Loading analysis…';
    videoStatus.className = 'status-area';
    hide(captureSection);
    hide(analysisSection);
    hide(emptyState);
    return;
  }

  if (loadError) {
    videoStatus.textContent = loadError;
    videoStatus.className = 'status-area error';
  }

  const hasAnalysis = analysisData && (analysisData.alerts?.length > 0 || analysisData.fact_checks?.length > 0);
  const needsCapture = loadError === 'no_transcript';

  if (hasAnalysis && segments && segments.length > 0) {
    videoStatus.innerHTML = `<strong>${segments.length}</strong> insights`;
    videoStatus.className = 'status-area success';
    show(analysisSection);
    hide(captureSection);
    hide(emptyState);

    insightsList.innerHTML = '';
    segments.forEach((seg, idx) => {
      const item = document.createElement('div');
      item.className = `insight-item ${seg.type}`;
      const label = seg.type === 'manipulation' ? (seg.data.technique || 'Rhetorical technique') : (seg.data.claim || 'Fact check');
      const timeStr = formatTime(seg.start);
      item.innerHTML = `
        <div class="insight-header">
          <span class="insight-type">${seg.type === 'manipulation' ? '◉' : '✓'} ${seg.type === 'manipulation' ? 'Rhetorical technique' : 'Fact check'}</span>
          <button class="seek-btn" data-time="${seg.start}" data-idx="${idx}">Go to ${timeStr}</button>
        </div>
        <div class="insight-label">${truncate(label, 80)}</div>
      `;
      const seekBtn = item.querySelector('.seek-btn');
      seekBtn.addEventListener('click', () => {
        tabs.sendMessage(tabId, { action: 'seekTo', time: seg.start });
        window.close();
      });
      insightsList.appendChild(item);
    });
  } else if (needsCapture) {
    show(captureSection);
    hide(analysisSection);
    hide(emptyState);
    captureBtn.onclick = () => {
      tabs.sendMessage(tabId, { action: 'startCapture' });
      window.close();
    };
  } else {
    hide(captureSection);
    hide(analysisSection);
    show(emptyState);
    if (analysisData && !hasAnalysis) {
      videoStatus.textContent = 'No insights';
      videoStatus.className = 'status-area success';
      emptyState.innerHTML = '<p>This video was analyzed and no insights were found.</p>';
    } else if (loadError) {
      emptyState.innerHTML = '<p>Open <a href="#" id="open-settings">Settings</a> to configure API keys.</p>';
      const settingsLink = emptyState.querySelector('#open-settings');
      if (settingsLink) {
        settingsLink.addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
      }
    } else {
      videoStatus.textContent = 'Ready';
      videoStatus.className = 'status-area';
      emptyState.innerHTML = '<p>Analysis loads automatically. Use capture audio if the video has no captions.</p><button id="empty-capture-btn" class="capture-btn">Capture audio</button>';
      const emptyCaptureBtn = emptyState.querySelector('#empty-capture-btn');
      if (emptyCaptureBtn) {
        emptyCaptureBtn.addEventListener('click', () => {
          tabs.sendMessage(tabId, { action: 'startCapture' });
          window.close();
        });
      }
    }
  }
}

function formatTime(seconds) {
  if (typeof seconds !== 'number' || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length <= len ? str : str.slice(0, len) + '…';
}

init();
