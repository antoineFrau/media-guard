(function () {
  'use strict';

  const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;

  let videoId = null;
  let video = null;
  let analysisData = null;
  let annotationsData = [];
  let isLoading = false;
  let loadError = null;
  let overlayRoot = null;
  let lastVideoId = null;

  function init() {
    const currentId = MediaGuardYouTube.getVideoId();
    if (currentId !== lastVideoId) {
      lastVideoId = currentId;
      videoId = currentId;
      analysisData = null;
      annotationsData = [];
      loadError = null;
    }
    video = MediaGuardYouTube.getVideoElement();

    if (!videoId || !video) {
      waitForElement();
      return;
    }

    setupOverlay();
    video.addEventListener('play', onPlay);
    video.addEventListener('timeupdate', onTimeUpdate);
    watchForVideoChange();
  }

  function waitForElement() {
    const interval = setInterval(() => {
      videoId = MediaGuardYouTube.getVideoId();
      video = MediaGuardYouTube.getVideoElement();
      if (videoId && video) {
        clearInterval(interval);
        init();
      }
    }, 500);
  }

  function watchForVideoChange() {
    setInterval(() => {
      const currentId = MediaGuardYouTube.getVideoId();
      if (currentId && currentId !== lastVideoId) {
        video = MediaGuardYouTube.getVideoElement();
        if (video) {
          lastVideoId = null;
          init();
        }
      }
    }, 2000);
  }

  function setupOverlay() {
    const container = MediaGuardYouTube.getPlayerContainer();
    if (!container) return;

    overlayRoot = document.createElement('div');
    overlayRoot.id = 'mediaguard-overlay-root';
    container.style.position = 'relative';
    container.appendChild(overlayRoot);
  }

  function showPlaceholder(message, isError = false) {
    if (!overlayRoot) return;
    const div = document.createElement('div');
    div.className = 'mediaguard-placeholder' + (isError ? ' mediaguard-error' : '');
    div.textContent = message;
    overlayRoot.innerHTML = '';
    overlayRoot.appendChild(div);
  }

  function showPlaceholderWithRetry(message, onRetry) {
    if (!overlayRoot) return;
    const div = document.createElement('div');
    div.className = 'mediaguard-placeholder mediaguard-error';
    div.appendChild(document.createTextNode(message + ' '));
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'mediaguard-retry';
    link.textContent = 'Retry';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      onRetry();
    });
    div.appendChild(link);
    overlayRoot.innerHTML = '';
    overlayRoot.appendChild(div);
  }

  function onPlay() {
    if (isLoading || analysisData) return;
    loadAnalysis();
  }

  async function loadAnalysis() {
    const config = await runtime.sendMessage({ action: 'getApiConfig' });
    if (!config.mistralKey) {
      showPlaceholder('Configure Mistral key in extension settings.', true);
      return;
    }

    isLoading = true;
    loadError = null;
    showPlaceholder('Loading analysis...');

    const response = await runtime.sendMessage({ action: 'getAnalysis', videoId });
    isLoading = false;

    if (response && response.error) {
      loadError = response.error;
      const status = response.status;
      if (status === 404) {
        if (response.error === 'no_transcript') {
          showPlaceholder('No captions available for this video.', true);
        } else {
          showPlaceholder('Analysis failed. Configure Mistral key in extension.', true);
        }
      } else if (status === 429) {
        showPlaceholder('Rate limited. Please try again later.', true);
      } else {
        const msg = response.error || 'Failed to load analysis.';
        showPlaceholderWithRetry(msg, loadAnalysis);
      }
      return;
    }

    analysisData = response;
    await loadAnnotations();
    renderOverlay();
  }

  function renderOverlay() {
    if (!overlayRoot || !analysisData) return;

    const hasAlerts = analysisData.alerts && analysisData.alerts.length > 0;
    const hasFactChecks = analysisData.fact_checks && analysisData.fact_checks.length > 0;

    if (!hasAlerts && !hasFactChecks) {
      showPlaceholder('No issues detected in this video.');
      return;
    }

    renderSegmentMarkers();
    renderFloatingPanel();
  }

  function renderSegmentMarkers() {
    const progressBar = MediaGuardYouTube.getProgressBar();
    if (!progressBar || !video || !video.duration || video.duration <= 0) return;

    let markersContainer = progressBar.querySelector('.mediaguard-segment-markers');
    if (markersContainer) markersContainer.remove();

    const segments = collectSegments();
    if (segments.length === 0) return;

    markersContainer = document.createElement('div');
    markersContainer.className = 'mediaguard-segment-markers';

    segments.forEach((seg) => {
      const bar = document.createElement('div');
      bar.className = `mediaguard-segment-bar mediaguard-${seg.type}`;
      bar.style.left = `${(seg.start / video.duration) * 100}%`;
      bar.style.width = `${((seg.end - seg.start) / video.duration) * 100}%`;
      bar.title = seg.label || seg.type;
      markersContainer.appendChild(bar);
    });

    progressBar.style.position = 'relative';
    progressBar.appendChild(markersContainer);
  }

  function collectSegments() {
    const segments = [];
    (analysisData.alerts || []).forEach((a) => {
      segments.push({
        type: 'manipulation',
        label: a.technique,
        start: a.start,
        end: a.end,
        data: a
      });
    });
    (analysisData.fact_checks || []).forEach((f) => {
      segments.push({
        type: 'fact-check',
        label: f.claim,
        start: f.start,
        end: f.end,
        data: f
      });
    });
    return segments.sort((a, b) => a.start - b.start);
  }

  function getCurrentSegment(segments, currentTime) {
    return segments.find((s) => currentTime >= s.start && currentTime <= s.end);
  }

  function onTimeUpdate() {
    const segments = collectSegments();
    const current = getCurrentSegment(segments, video.currentTime);
    updateFloatingPanel(current);
  }

  function renderFloatingPanel() {
    let panel = overlayRoot.querySelector('.mediaguard-floating-panel');
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.className = 'mediaguard-floating-panel mediaguard-hidden';
    panel.id = 'mediaguard-panel';
    overlayRoot.appendChild(panel);
  }

  function updateFloatingPanel(segment) {
    const panel = overlayRoot && overlayRoot.querySelector('.mediaguard-floating-panel');
    if (!panel) return;

    if (!segment) {
      panel.classList.add('mediaguard-hidden');
      return;
    }

    panel.classList.remove('mediaguard-hidden');
    panel.innerHTML = '';
    const d = segment.data;

    const header = document.createElement('div');
    header.className = 'mediaguard-panel-header';

    const typeSpan = document.createElement('span');
    typeSpan.className = 'mediaguard-panel-type ' + segment.type;
    typeSpan.textContent = segment.type === 'manipulation' ? 'Manipulation' : 'Fact Check';

    const badge = document.createElement('span');
    badge.className = segment.type === 'manipulation'
      ? 'mediaguard-panel-severity ' + (d.severity || 'medium')
      : 'mediaguard-panel-verdict ' + (d.verdict || '').toLowerCase();
    badge.textContent = segment.type === 'manipulation' ? (d.severity || 'medium') : (d.verdict || '');

    header.appendChild(typeSpan);
    header.appendChild(badge);
    panel.appendChild(header);

    if (segment.type === 'manipulation') {
      const technique = document.createElement('div');
      technique.className = 'mediaguard-panel-technique';
      technique.textContent = d.technique || '';
      panel.appendChild(technique);
      if (d.quote) {
        const quote = document.createElement('blockquote');
        quote.className = 'mediaguard-panel-quote';
        quote.textContent = d.quote;
        panel.appendChild(quote);
      }
      const explanation = document.createElement('div');
      explanation.className = 'mediaguard-panel-explanation';
      explanation.textContent = d.explanation || '';
      panel.appendChild(explanation);
    } else {
      const claim = document.createElement('div');
      claim.className = 'mediaguard-panel-claim';
      claim.textContent = d.claim || '';
      panel.appendChild(claim);
      if (d.context) {
        const ctx = document.createElement('div');
        ctx.className = 'mediaguard-panel-context';
        ctx.textContent = d.context;
        panel.appendChild(ctx);
      }
      if (d.sources && d.sources.length) {
        const sourcesDiv = document.createElement('div');
        sourcesDiv.className = 'mediaguard-panel-sources';
        const strong = document.createElement('strong');
        strong.textContent = 'Sources:';
        sourcesDiv.appendChild(strong);
        const ul = document.createElement('ul');
        d.sources.forEach((s) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = s;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = s;
          li.appendChild(a);
          ul.appendChild(li);
        });
        sourcesDiv.appendChild(ul);
        panel.appendChild(sourcesDiv);
      }
    }

    const btn = document.createElement('button');
    btn.className = 'mediaguard-comment-btn';
    btn.textContent = 'Add context / Report';
    btn.addEventListener('click', () => openCommentModal(segment));
    panel.appendChild(btn);
  }

  function openCommentModal(segment) {
    const existing = document.getElementById('mediaguard-comment-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'mediaguard-comment-modal';
    modal.className = 'mediaguard-modal';

    const backdrop = document.createElement('div');
    backdrop.className = 'mediaguard-modal-backdrop';

    const content = document.createElement('div');
    content.className = 'mediaguard-modal-content';

    const h3 = document.createElement('h3');
    h3.textContent = 'Add context or report';

    const textarea = document.createElement('textarea');
    textarea.id = 'mediaguard-comment-input';
    textarea.rows = 4;
    textarea.placeholder = 'Add a source, correction, or additional context...';

    const actions = document.createElement('div');
    actions.className = 'mediaguard-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'mediaguard-modal-cancel';
    cancelBtn.textContent = 'Cancel';

    const submitBtn = document.createElement('button');
    submitBtn.className = 'mediaguard-modal-submit';
    submitBtn.textContent = 'Submit';

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    content.appendChild(h3);
    content.appendChild(textarea);
    content.appendChild(actions);
    modal.appendChild(backdrop);
    modal.appendChild(content);
    document.body.appendChild(modal);

    const cancel = cancelBtn;
    const submit = submitBtn;
    const input = textarea;

    const close = () => modal.remove();

    cancel.addEventListener('click', close);
    backdrop.addEventListener('click', close);

    submit.addEventListener('click', async () => {
      const userComment = input.value.trim();
      if (!userComment) return;

      submit.disabled = true;
      const response = await runtime.sendMessage({
        action: 'submitComment',
        videoId,
        annotationId: segment.data.id || segment.data.annotation_id || '',
        timestampStart: segment.start,
        userComment,
        currentContent: segment.data.content || segment.data.explanation || segment.data.claim || ''
      });

      submit.disabled = false;

      if (response && response.error) {
        alert('Error: ' + response.error);
        return;
      }

      close();
      if (response) {
        mergeAnnotation(segment, response);
      }
      loadAnnotations();
    });
  }

  function mergeAnnotation(segment, updated) {
    if (!analysisData) return;
    const idx = (analysisData.fact_checks || []).findIndex(
      (f) => Math.abs(f.start - segment.start) < 1
    );
    if (idx >= 0 && analysisData.fact_checks) {
      Object.assign(analysisData.fact_checks[idx], updated);
    } else {
      const aIdx = (analysisData.alerts || []).findIndex(
        (a) => Math.abs(a.start - segment.start) < 1
      );
      if (aIdx >= 0 && analysisData.alerts) {
        Object.assign(analysisData.alerts[aIdx], updated);
      }
    }
    renderOverlay();
  }

  async function loadAnnotations() {
    const response = await runtime.sendMessage({ action: 'getAnnotations', videoId });
    if (!response || response.error) return;
    if (Array.isArray(response)) {
      annotationsData = response;
    } else if (response.annotations) {
      annotationsData = response.annotations;
    } else {
      annotationsData = [];
    }
    if (annotationsData && annotationsData.length > 0) {
      mergeAnnotationsIntoAnalysis();
      renderOverlay();
    }
  }

  function mergeAnnotationsIntoAnalysis() {
    if (!analysisData) analysisData = { alerts: [], fact_checks: [] };
    annotationsData.forEach((ann) => {
      if (ann.type === 'manipulation') {
        const existing = (analysisData.alerts || []).find(
          (a) => Math.abs(a.start - ann.timestamp_start) < 1
        );
        if (existing) Object.assign(existing, ann);
        else (analysisData.alerts || (analysisData.alerts = [])).push({
          type: 'rhetorical_manipulation',
          technique: ann.content,
          quote: '',
          explanation: ann.explanation,
          severity: 'medium',
          start: ann.timestamp_start,
          end: ann.timestamp_end,
          id: ann.id
        });
      } else {
        const existing = (analysisData.fact_checks || []).find(
          (f) => Math.abs(f.start - ann.timestamp_start) < 1
        );
        if (existing) Object.assign(existing, ann);
        else (analysisData.fact_checks || (analysisData.fact_checks = [])).push({
          claim: ann.content,
          verdict: 'info',
          context: ann.explanation,
          sources: ann.sources || [],
          start: ann.timestamp_start,
          end: ann.timestamp_end,
          id: ann.id
        });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
