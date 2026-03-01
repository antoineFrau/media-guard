const storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;
const STORAGE_KEYS = { mistralKey: 'mistral_api_key', apiBaseUrl: 'api_base_url', elevenlabsKey: 'elevenlabs_api_key' };
const DEFAULT_API_URL = 'http://localhost:3000';

document.addEventListener('DOMContentLoaded', () => {
  const mistralInput = document.getElementById('mistral-key');
  const apiUrlInput = document.getElementById('api-url');
  const elevenlabsInput = document.getElementById('elevenlabs-key');
  const saveBtn = document.getElementById('save-btn');
  const statusEl = document.getElementById('status');

  storage.local.get([STORAGE_KEYS.mistralKey, STORAGE_KEYS.apiBaseUrl, STORAGE_KEYS.elevenlabsKey]).then((data) => {
    if (data[STORAGE_KEYS.mistralKey]) mistralInput.value = data[STORAGE_KEYS.mistralKey];
    if (data[STORAGE_KEYS.apiBaseUrl]) {
      apiUrlInput.value = data[STORAGE_KEYS.apiBaseUrl];
    } else {
      apiUrlInput.placeholder = DEFAULT_API_URL;
    }
    if (data[STORAGE_KEYS.elevenlabsKey]) elevenlabsInput.value = data[STORAGE_KEYS.elevenlabsKey];
  });

  saveBtn.addEventListener('click', () => {
    const mistralKey = mistralInput.value.trim();
    const apiUrl = apiUrlInput.value.trim();
    const elevenlabsKey = elevenlabsInput.value.trim();

    storage.local.set({
      [STORAGE_KEYS.mistralKey]: mistralKey || '',
      [STORAGE_KEYS.apiBaseUrl]: apiUrl || '',
      [STORAGE_KEYS.elevenlabsKey]: elevenlabsKey || ''
    }).then(() => {
      statusEl.textContent = 'Saved';
      statusEl.className = 'status success';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    }).catch((err) => {
      statusEl.textContent = 'Error: ' + err.message;
      statusEl.className = 'status error';
    });
  });
});
