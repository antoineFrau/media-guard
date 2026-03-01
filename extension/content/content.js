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
    console.log('[MediaGuard ext] init', { currentId, lastVideoId });
    if (currentId !== lastVideoId) {
      detachProgressBarHoverListeners();
      progressBarHoverListenersAttached = false;
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
    updateStatusBadge('ready');
  }

  function updateStatusBadge(status, detail) {
    if (!overlayRoot) return;
    let badge = overlayRoot.querySelector('.mediaguard-status-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'mediaguard-status-badge';
      overlayRoot.appendChild(badge);
    }
    const labels = {
      ready: 'MediaGuard — Press play',
      loading: 'MediaGuard — Loading analysis...',
      issues: detail ? `MediaGuard — ${detail}` : 'MediaGuard — Issues found',
      clean: 'MediaGuard — No issues detected',
      error: detail ? `MediaGuard — ${detail}` : 'MediaGuard — Error'
    };
    badge.textContent = labels[status] || labels.ready;
    badge.className = 'mediaguard-status-badge mediaguard-status-' + status;
  }

  function showPlaceholder(message, isError = false) {
    if (!overlayRoot) return;
    let area = overlayRoot.querySelector('.mediaguard-placeholder-area');
    if (!area) {
      area = document.createElement('div');
      area.className = 'mediaguard-placeholder-area';
      overlayRoot.appendChild(area);
    }
    const div = document.createElement('div');
    div.className = 'mediaguard-placeholder' + (isError ? ' mediaguard-error' : '');
    div.textContent = message;
    area.innerHTML = '';
    area.appendChild(div);
  }

  function showPlaceholderWithRetry(message, onRetry) {
    if (!overlayRoot) return;
    let area = overlayRoot.querySelector('.mediaguard-placeholder-area');
    if (!area) {
      area = document.createElement('div');
      area.className = 'mediaguard-placeholder-area';
      overlayRoot.appendChild(area);
    }
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
    area.innerHTML = '';
    area.appendChild(div);
  }

  function showPlaceholderWithStop(message, onStop) {
    if (!overlayRoot) return;
    let area = overlayRoot.querySelector('.mediaguard-placeholder-area');
    if (!area) {
      area = document.createElement('div');
      area.className = 'mediaguard-placeholder-area';
      overlayRoot.appendChild(area);
    }
    const div = document.createElement('div');
    div.className = 'mediaguard-placeholder';
    div.appendChild(document.createTextNode(message + ' '));
    const btn = document.createElement('button');
    btn.className = 'mediaguard-retry';
    btn.style.cssText = 'background:#dc2626;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;margin-left:8px;';
    btn.textContent = 'Stop';
    btn.addEventListener('click', (e) => { e.preventDefault(); onStop(); });
    div.appendChild(btn);
    area.innerHTML = '';
    area.appendChild(div);
  }

  function showPlaceholderWithCapture(message, onCapture) {
    if (!overlayRoot) return;
    let area = overlayRoot.querySelector('.mediaguard-placeholder-area');
    if (!area) {
      area = document.createElement('div');
      area.className = 'mediaguard-placeholder-area';
      overlayRoot.appendChild(area);
    }
    const div = document.createElement('div');
    div.className = 'mediaguard-placeholder';
    div.appendChild(document.createTextNode(message + ' '));
    const btn = document.createElement('button');
    btn.className = 'mediaguard-retry';
    btn.style.cssText = 'background:#3b82f6;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;';
    btn.textContent = 'Capture audio';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      onCapture();
    });
    div.appendChild(btn);
    area.innerHTML = '';
    area.appendChild(div);
  }

  async function startAudioCapture() {
    if (!window.MediaGuardCapture) {
      showPlaceholder('Capture not available.', true);
      return;
    }
    const config = await runtime.sendMessage({ action: 'getApiConfig' });
    updateStatusBadge('loading');
    showPlaceholder('Capturing… Select this tab and check "Share tab audio".');

    const videoEl = MediaGuardYouTube.getVideoElement();
    window.MediaGuardCapture.startCapture({
      videoId,
      videoElement: videoEl,
      apiBaseUrl: config.apiBaseUrl,
      mistralKey: config.mistralKey,
      elevenlabsKey: config.elevenlabsKey || undefined,
      onStatus: (msg) => {
        updateStatusBadge('loading');
        showPlaceholder(msg);
      },
      onTranscript: () => {},
      onComplete: (data) => {
        analysisData = data;
        loadAnnotations().then(() => renderOverlay());
      },
      onError: (msg) => {
        updateStatusBadge('error', msg);
        showPlaceholder(msg, true);
      },
      onCaptureStart: (cleanup) => {
        showPlaceholderWithStop('Capturing audio… Wait 1 min for auto-analyze.', () => {
          if (typeof cleanup === 'function') cleanup();
          updateStatusBadge('ready');
          showPlaceholder('Capture stopped.');
        });
      }
    });
  }

  function onPlay() {
    console.log('[MediaGuard ext] onPlay', { videoId, isLoading, hasAnalysisData: !!analysisData });
    if (isLoading || analysisData) return;
    loadAnalysis();
  }

  async function loadAnalysis() {
    console.log('[MediaGuard ext] loadAnalysis start', videoId);
    const config = await runtime.sendMessage({ action: 'getApiConfig' });
    if (!config.mistralKey) {
      updateStatusBadge('error', 'Configure Mistral key in extension settings');
      showPlaceholder('Configure Mistral key in extension settings.', true);
      return;
    }

    isLoading = true;
    loadError = null;
    updateStatusBadge('loading');
    showPlaceholder('Loading analysis...');

    const response = await runtime.sendMessage({ action: 'getAnalysis', videoId });
    isLoading = false;
    console.log('[MediaGuard ext] loadAnalysis response', videoId, response?.error ? { error: response.error, status: response.status } : 'OK');

    if (response && response.error) {
      loadError = response.error;
      const status = response.status;
      const errMsg = response.error || 'Analysis failed';
      updateStatusBadge('error', errMsg);
      if (status === 404) {
        if (response.error === 'no_transcript') {
          showPlaceholderWithCapture(
            'No captions. Capture this tab\'s audio with ElevenLabs instead?',
            startAudioCapture
          );
        } else {
          showPlaceholder('Analysis failed. Configure Mistral key in extension.', true);
        }
      } else if (status === 429) {
        showPlaceholder('Rate limited. Please try again later.', true);
      } else {
        showPlaceholderWithRetry(errMsg, loadAnalysis);
      }
      return;
    }

    analysisData = response;
    await loadAnnotations();
    renderOverlay();
  }

  function renderOverlay() {
    if (!overlayRoot || !analysisData) return;

    const alerts = analysisData.alerts || [];
    const factChecks = analysisData.fact_checks || [];
    const hasAlerts = alerts.length > 0;
    const hasFactChecks = factChecks.length > 0;

    if (!hasAlerts && !hasFactChecks) {
      updateStatusBadge('clean');
      showPlaceholder('No issues detected in this video.');
      return;
    }

    const parts = [];
    if (hasAlerts) parts.push(alerts.length + ' manipulation');
    if (hasFactChecks) parts.push(factChecks.length + ' fact-check');
    updateStatusBadge('issues', parts.join(', '));
    const area = overlayRoot.querySelector('.mediaguard-placeholder-area');
    if (area) area.innerHTML = '';
    renderSegmentMarkers();
    renderFloatingPanel();
    if (hasUncoveredDuration()) {
      const coveredEnd = getCoveredEndTime();
      const remaining = Math.round(video.duration - coveredEnd);
      const mins = Math.floor(remaining / 60);
      const secs = Math.round(remaining % 60);
      const remainingStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      showPlaceholderWithCapture(
        `Video partially analyzed (${remainingStr} remaining). Capture remaining audio?`,
        startAudioCapture
      );
    }
  }

  let progressBarHoverListenersAttached = false;

  function attachProgressBarHoverListeners() {
    const progressBar = MediaGuardYouTube.getProgressBar();
    const chromeBottom = document.querySelector('.ytp-chrome-bottom') || progressBar;
    const hoverRoot = chromeBottom || progressBar;
    if (!progressBar || !video || !video.duration || video.duration <= 0 || progressBarHoverListenersAttached) return;

    const segments = collectSegments();
    if (segments.length === 0) return;

    function getSegmentsAtMouseX(clientX) {
      const segs = collectSegments();
      if (segs.length === 0) return null;
      const rect = progressBar.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const time = progress * video.duration;
      const matches = segs.filter((s) => time >= s.start && time <= s.end);
      return matches.length > 0 ? matches : null;
    }

    function isOverProgressArea(clientX, clientY) {
      const rect = progressBar.getBoundingClientRect();
      const expandY = 80;
      return clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top - expandY && clientY <= rect.bottom + expandY;
    }

    function getSegmentAnchorRect(seg) {
      const rect = progressBar.getBoundingClientRect();
      const leftPct = seg.start / video.duration;
      const rightPct = seg.end / video.duration;
      const centerPct = (leftPct + rightPct) / 2;
      return {
        left: rect.left + rect.width * leftPct,
        right: rect.left + rect.width * rightPct,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width * (rightPct - leftPct),
        height: rect.height,
        centerX: rect.left + rect.width * centerPct,
        centerY: rect.top
      };
    }

    const onMouseMove = (e) => {
      if (!isOverProgressArea(e.clientX, e.clientY)) {
        updateFloatingPanel(null);
        return;
      }
      if (hoverPanelTimeout) clearTimeout(hoverPanelTimeout);
      hoverPanelTimeout = null;
      const segs = getSegmentsAtMouseX(e.clientX);
      if (segs && segs.length > 0) {
        const anchor = getSegmentAnchorRect(segs[0]);
        updateFloatingPanel(segs, 0, anchor);
      } else {
        updateFloatingPanel(null);
      }
    };

    const onMouseLeave = (e) => {
      const panel = overlayRoot && overlayRoot.querySelector('.mediaguard-floating-panel');
      const enteringPanel = panel && panel.contains(e.relatedTarget);
      const enteringHoverRoot = hoverRoot && hoverRoot.contains(e.relatedTarget);
      if (!enteringPanel && !enteringHoverRoot) {
        hoverPanelTimeout = setTimeout(() => updateFloatingPanel(null), 150);
      }
    };

    hoverRoot.addEventListener('mousemove', onMouseMove, { passive: true, capture: true });
    hoverRoot.addEventListener('mouseleave', onMouseLeave, { capture: true });
    progressBarHoverListenersAttached = true;

    progressBar._mediaguardHoverCleanup = () => {
      hoverRoot.removeEventListener('mousemove', onMouseMove, { capture: true });
      hoverRoot.removeEventListener('mouseleave', onMouseLeave, { capture: true });
      progressBarHoverListenersAttached = false;
    };
  }

  function detachProgressBarHoverListeners() {
    const progressBar = MediaGuardYouTube.getProgressBar();
    if (progressBar && progressBar._mediaguardHoverCleanup) {
      progressBar._mediaguardHoverCleanup();
      delete progressBar._mediaguardHoverCleanup;
    }
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
    attachProgressBarHoverListeners();
  }

  function collectSegments() {
    if (!analysisData) return [];
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

  function getCoveredEndTime() {
    const segments = collectSegments();
    if (segments.length === 0) return 0;
    return Math.max(...segments.map((s) => s.end ?? 0));
  }

  function hasUncoveredDuration() {
    if (!video || !video.duration || video.duration <= 0) return false;
    const coveredEnd = getCoveredEndTime();
    const GAP_THRESHOLD = 30;
    return video.duration - coveredEnd > GAP_THRESHOLD;
  }

  function getCurrentSegment(segments, currentTime) {
    return segments.find((s) => currentTime >= s.start && currentTime <= s.end);
  }

  let hoverPanelTimeout = null;

  function onTimeUpdate() {
    // Panel is now hover-only; no auto-show on playback
  }

  function renderFloatingPanel() {
    let panel = overlayRoot.querySelector('.mediaguard-floating-panel');
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.className = 'mediaguard-floating-panel mediaguard-hidden';
    panel.id = 'mediaguard-panel';
    panel.addEventListener('mouseenter', () => {
      if (hoverPanelTimeout) clearTimeout(hoverPanelTimeout);
      hoverPanelTimeout = null;
    });
    panel.addEventListener('mouseleave', (e) => {
      const progressBar = MediaGuardYouTube.getProgressBar();
      const enteringProgressBar = progressBar && progressBar.contains(e.relatedTarget);
      if (!enteringProgressBar) {
        updateFloatingPanel(null);
      }
    });
    overlayRoot.appendChild(panel);
  }

  function renderSegmentContent(container, segment) {
    container.innerHTML = '';
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
    container.appendChild(header);

    if (segment.type === 'manipulation') {
      const technique = document.createElement('div');
      technique.className = 'mediaguard-panel-technique';
      technique.textContent = d.technique || '';
      container.appendChild(technique);
      if (d.quote) {
        const quote = document.createElement('blockquote');
        quote.className = 'mediaguard-panel-quote';
        quote.textContent = d.quote;
        container.appendChild(quote);
      }
      const explanation = document.createElement('div');
      explanation.className = 'mediaguard-panel-explanation';
      explanation.textContent = d.explanation || '';
      container.appendChild(explanation);
    } else {
      const claim = document.createElement('div');
      claim.className = 'mediaguard-panel-claim';
      claim.textContent = d.claim || '';
      container.appendChild(claim);
      if (d.context) {
        const ctx = document.createElement('div');
        ctx.className = 'mediaguard-panel-context';
        ctx.textContent = d.context;
        container.appendChild(ctx);
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
        container.appendChild(sourcesDiv);
      }
    }

    const btn = document.createElement('button');
    btn.className = 'mediaguard-comment-btn';
    btn.textContent = 'Add context / Report';
    btn.addEventListener('click', () => openCommentModal(segment));
    container.appendChild(btn);
  }

  function updateFloatingPanel(segments, index, barElementOrAnchor) {
    const panel = overlayRoot && overlayRoot.querySelector('.mediaguard-floating-panel');
    if (!panel) return;

    if (!segments || segments.length === 0) {
      panel.classList.add('mediaguard-hidden');
      panel.style.left = '';
      panel.style.top = '';
      panel._mediaguardSegments = null;
      return;
    }

    const segIndex = Math.max(0, Math.min(index || 0, segments.length - 1));
    const segment = segments[segIndex];
    const hasMultiple = segments.length > 1;

    const isNavigating = hasMultiple && panel._mediaguardSegments === segments;
    if (isNavigating) {
      const contentWrap = panel.querySelector('.mediaguard-panel-content');
      const countSpan = panel.querySelector('.mediaguard-slider-count');
      const prevBtn = panel.querySelector('.mediaguard-slider-btn');
      const nextBtn = panel.querySelectorAll('.mediaguard-slider-btn')[1];
      if (contentWrap) {
        renderSegmentContent(contentWrap, segment);
      }
      if (countSpan) countSpan.textContent = `${segIndex + 1} / ${segments.length}`;
      if (prevBtn) prevBtn.disabled = segIndex === 0;
      if (nextBtn) nextBtn.disabled = segIndex === segments.length - 1;
      return;
    }

    panel.classList.remove('mediaguard-hidden');
    panel.innerHTML = '';
    panel._mediaguardSegments = segments;

    if (hasMultiple) {
      const sliderRow = document.createElement('div');
      sliderRow.className = 'mediaguard-panel-slider';

      const prevBtn = document.createElement('button');
      prevBtn.className = 'mediaguard-slider-btn';
      prevBtn.innerHTML = '&#9664;';
      prevBtn.title = 'Previous';
      prevBtn.disabled = segIndex === 0;
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (segIndex > 0) updateFloatingPanel(segments, segIndex - 1, barElementOrAnchor);
      });

      const countSpan = document.createElement('span');
      countSpan.className = 'mediaguard-slider-count';
      countSpan.textContent = `${segIndex + 1} / ${segments.length}`;

      const nextBtn = document.createElement('button');
      nextBtn.className = 'mediaguard-slider-btn';
      nextBtn.innerHTML = '&#9654;';
      nextBtn.title = 'Next';
      nextBtn.disabled = segIndex === segments.length - 1;
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (segIndex < segments.length - 1) updateFloatingPanel(segments, segIndex + 1, barElementOrAnchor);
      });

      sliderRow.appendChild(prevBtn);
      sliderRow.appendChild(countSpan);
      sliderRow.appendChild(nextBtn);
      panel.appendChild(sliderRow);
    }

    const contentWrap = document.createElement('div');
    contentWrap.className = 'mediaguard-panel-content';
    renderSegmentContent(contentWrap, segment);
    panel.appendChild(contentWrap);

    if (barElementOrAnchor) {
      const barRect = barElementOrAnchor.getBoundingClientRect
        ? barElementOrAnchor.getBoundingClientRect()
        : barElementOrAnchor;
      const gap = 8;
      const padding = 12;
      const centerX = barRect.centerX ?? (barRect.left + barRect.width / 2);
      const barTop = barRect.top;
      const barBottom = barRect.bottom ?? barRect.top + (barRect.height || 0);
      let left = centerX - (panel.offsetWidth / 2);
      left = Math.max(padding, Math.min(left, window.innerWidth - panel.offsetWidth - padding));
      let top = barTop - panel.offsetHeight - gap;
      if (top < padding) top = barBottom + gap;
      panel.style.position = 'fixed';
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
    }
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
