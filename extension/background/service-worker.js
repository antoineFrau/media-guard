const storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;
const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
const action = typeof browser !== 'undefined' ? browser.action : chrome.action;
const tabs = typeof browser !== 'undefined' ? browser.tabs : chrome.tabs;
const YOUTUBE_WATCH = /^https?:\/\/(www\.)?youtube\.com\/watch\b/;
const STORAGE_KEYS = { mistralKey: 'mistral_api_key', apiBaseUrl: 'api_base_url', elevenlabsKey: 'elevenlabs_api_key', sttProvider: 'stt_provider', clientId: 'mediaguard_client_id' };
const DEFAULT_API_URL = 'http://localhost:3000';

function generateClientId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getClientId() {
  const data = await storage.local.get(STORAGE_KEYS.clientId);
  let id = data[STORAGE_KEYS.clientId];
  if (!id) {
    id = generateClientId();
    await storage.local.set({ [STORAGE_KEYS.clientId]: id });
  }
  return id;
}

async function getApiConfig() {
  const data = await storage.local.get([STORAGE_KEYS.mistralKey, STORAGE_KEYS.apiBaseUrl, STORAGE_KEYS.elevenlabsKey, STORAGE_KEYS.sttProvider]);
  return {
    mistralKey: data[STORAGE_KEYS.mistralKey] || '',
    apiBaseUrl: (data[STORAGE_KEYS.apiBaseUrl] || '').replace(/\/$/, '') || DEFAULT_API_URL,
    elevenlabsKey: data[STORAGE_KEYS.elevenlabsKey] || '',
    sttProvider: data[STORAGE_KEYS.sttProvider] || 'elevenlabs'
  };
}

async function fetchWithConfig(url, options = {}) {
  const { mistralKey } = await getApiConfig();
  const headers = { ...options.headers };
  if (mistralKey) headers['X-Mistral-API-Key'] = mistralKey;
  return fetch(url, { ...options, headers });
}

// Pulse interval for recording badge (red alternating)
let recordingPulseInterval = null;
let recordingTabId = null;
const RECORDING_PULSE_COLORS = ['#F59E0B', '#d97706'];

function stopRecordingPulse() {
  if (recordingPulseInterval) {
    clearInterval(recordingPulseInterval);
    recordingPulseInterval = null;
  }
  recordingTabId = null;
}

runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateIconBadge') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: true });
      return true;
    }
    if (message.recording) {
      if (recordingTabId !== tabId) {
        stopRecordingPulse();
        recordingTabId = tabId;
      }
      action.setBadgeText({ tabId, text: 'REC' });
      action.setBadgeBackgroundColor({ tabId, color: RECORDING_PULSE_COLORS[0] });
      let pulseIdx = 0;
      recordingPulseInterval = setInterval(() => {
        pulseIdx = 1 - pulseIdx;
        action.setBadgeBackgroundColor({ tabId, color: RECORDING_PULSE_COLORS[pulseIdx] });
      }, 600);
    } else {
      if (recordingTabId === tabId) {
        stopRecordingPulse();
      }
      if (message.issueCount !== undefined && message.issueCount > 0) {
        const text = message.issueCount > 99 ? '99+' : String(message.issueCount);
        action.setBadgeText({ tabId, text });
        action.setBadgeBackgroundColor({ tabId, color: '#ea580c' });
      } else {
        action.setBadgeText({ tabId, text: '' });
      }
    }
    sendResponse({ ok: true });
    return true;
  }
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message || 'Unknown error' });
  });
  return true;
});

tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url && !YOUTUBE_WATCH.test(changeInfo.url)) {
    action.setBadgeText({ tabId, text: '' });
    if (recordingTabId === tabId) stopRecordingPulse();
  }
});

tabs.onRemoved.addListener((tabId) => {
  if (recordingTabId === tabId) stopRecordingPulse();
});

async function handleMessage(message) {
  const { action } = message;
  const { apiBaseUrl } = await getApiConfig();

  switch (action) {
    case 'getAnalysis': {
      const { videoId } = message;
      if (!videoId) {
        console.log('[MediaGuard ext] getAnalysis: missing videoId');
        return { error: 'Missing videoId' };
      }
      const url = `${apiBaseUrl}/video/${videoId}/analysis`;
      console.log('[MediaGuard ext] getAnalysis:', videoId, '->', url);
      const res = await fetchWithConfig(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.log('[MediaGuard ext] getAnalysis error:', res.status, body);
        return { error: body.reason || `HTTP ${res.status}`, status: res.status };
      }
      const data = await res.json();
      console.log('[MediaGuard ext] getAnalysis OK:', videoId, 'alerts:', data.alerts?.length, 'fact_checks:', data.fact_checks?.length);
      return data;
    }
    case 'getAnnotations': {
      const { videoId } = message;
      if (!videoId) return { error: 'Missing videoId' };
      const clientId = await getClientId();
      const url = `${apiBaseUrl}/annotations/${videoId}?client_id=${encodeURIComponent(clientId)}`;
      console.log('[MediaGuard ext] getAnnotations:', videoId);
      const res = await fetchWithConfig(url);
      if (!res.ok) return { error: `HTTP ${res.status}`, status: res.status };
      return await res.json();
    }
    case 'submitComment': {
      const { videoId, annotationId, timestampStart, userComment, currentContent } = message;
      if (!videoId || !annotationId || !userComment) {
        return { error: 'Missing required fields: videoId, annotationId, userComment' };
      }
      const url = `${apiBaseUrl}/comment/improve`;
      const res = await fetchWithConfig(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          annotation_id: annotationId,
          timestamp_start: timestampStart,
          user_comment: userComment,
          current_content: currentContent || ''
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { error: body.reason || body.message || `HTTP ${res.status}`, status: res.status };
      }
      return await res.json();
    }
    case 'submitVote': {
      const { annotationId, vote } = message;
      if (!annotationId || !vote || (vote !== 'up' && vote !== 'down')) {
        return { error: 'Missing or invalid: annotationId, vote (up|down)' };
      }
      const clientId = await getClientId();
      const url = `${apiBaseUrl}/annotations/${annotationId}/vote`;
      const res = await fetchWithConfig(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote, client_id: clientId })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { error: body.reason || body.message || `HTTP ${res.status}`, status: res.status };
      }
      return await res.json();
    }
    case 'getApiConfig': {
      return await getApiConfig();
    }
    default:
      return { error: 'Unknown action: ' + action };
  }
}
