const storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;
const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
const STORAGE_KEYS = { mistralKey: 'mistral_api_key', apiBaseUrl: 'api_base_url' };
const DEFAULT_API_URL = 'https://media-guard-api.example.workers.dev';

async function getApiConfig() {
  const data = await storage.local.get([STORAGE_KEYS.mistralKey, STORAGE_KEYS.apiBaseUrl]);
  return {
    mistralKey: data[STORAGE_KEYS.mistralKey] || '',
    apiBaseUrl: (data[STORAGE_KEYS.apiBaseUrl] || '').replace(/\/$/, '') || DEFAULT_API_URL
  };
}

async function fetchWithConfig(url, options = {}) {
  const { mistralKey } = await getApiConfig();
  const headers = { ...options.headers };
  if (mistralKey) headers['X-Mistral-API-Key'] = mistralKey;
  return fetch(url, { ...options, headers });
}

runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message || 'Unknown error' });
  });
  return true;
});

async function handleMessage(message) {
  const { action } = message;
  const { apiBaseUrl } = await getApiConfig();

  switch (action) {
    case 'getAnalysis': {
      const { videoId } = message;
      if (!videoId) return { error: 'Missing videoId' };
      const url = `${apiBaseUrl}/video/${videoId}/analysis`;
      const res = await fetchWithConfig(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { error: body.reason || `HTTP ${res.status}`, status: res.status };
      }
      return await res.json();
    }
    case 'getAnnotations': {
      const { videoId } = message;
      if (!videoId) return { error: 'Missing videoId' };
      const url = `${apiBaseUrl}/annotations/${videoId}`;
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
    case 'getApiConfig': {
      return await getApiConfig();
    }
    default:
      return { error: 'Unknown action: ' + action };
  }
}
