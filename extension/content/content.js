(function () {
  'use strict';

  const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
  const storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;

  let videoId = null;
  let userVotes = {};
  let video = null;
  let analysisData = null;
  let annotationsData = [];
  let isLoading = false;
  let loadError = null;
  let overlayRoot = null;
  let lastVideoId = null;
  let toolbarButton = null;
  let isRecording = false;
  let recordingTimerId = null;
  let captureStoppedHideTimeoutId = null;
  let captureStopCallback = null;
  let recordingUpdateMsg = null;

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
    setupToolbarButton();
    video.addEventListener('play', onPlay);
    video.addEventListener('timeupdate', onTimeUpdate);
    watchForVideoChange();

    // Load analysis immediately when we have the video (no need to wait for play)
    if (!analysisData && !isLoading) loadAnalysis();
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
    updateIconBadge({});
  }

  function setupToolbarButton() {
    const existing = document.getElementById('mediaguard-toolbar-button');
    if (existing) existing.remove();
    toolbarButton = null;

    function inject() {
      const rightControls = MediaGuardYouTube.getRightControls();
      if (!rightControls) return false;
      if (document.getElementById('mediaguard-toolbar-button')) return true;

      const settingsBtn = rightControls.querySelector('.ytp-settings-button') ||
        rightControls.querySelector('.ytp-button.ytp-settings-button');
      const btn = document.createElement('button');
      btn.id = 'mediaguard-toolbar-button';
      btn.className = 'ytp-button mediaguard-toolbar-button';
      btn.title = 'MediaGuard';
      btn.setAttribute('aria-label', 'MediaGuard');

      const icon = document.createElement('img');
      icon.src = runtime.getURL('icons/icon32.png');
      icon.alt = '';
      icon.className = 'mediaguard-toolbar-icon';

      const badge = document.createElement('span');
      badge.className = 'mediaguard-toolbar-badge mediaguard-badge-pulse-blue';

      btn.appendChild(icon);
      btn.appendChild(badge);
      toolbarButton = btn;

      // insertBefore requires the reference node to be a direct child of the parent.
      // querySelector returns any descendant; YouTube's DOM may nest buttons.
      const ref = (settingsBtn && settingsBtn.parentNode === rightControls)
        ? settingsBtn
        : rightControls.firstChild;
      if (ref) {
        rightControls.insertBefore(btn, ref);
      } else {
        rightControls.appendChild(btn);
      }

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isRecording) return;
        startAudioCapture();
      });

      updateToolbarBadge();
      return true;
    }

    if (!inject()) {
      const interval = setInterval(() => {
        if (inject()) clearInterval(interval);
      }, 300);
      setTimeout(() => clearInterval(interval), 10000);
    }
  }

  function updateToolbarBadge() {
    if (!toolbarButton) return;
    const badge = toolbarButton.querySelector('.mediaguard-toolbar-badge');
    if (!badge) return;

    badge.className = 'mediaguard-toolbar-badge';
    badge.textContent = '';

    if (isRecording) {
      badge.classList.add('mediaguard-badge-pulse-red');
    } else {
      badge.classList.add('mediaguard-badge-pulse-blue');
    }
  }

  function updateIconBadge(opts) {
    runtime.sendMessage({ action: 'updateIconBadge', ...opts }).catch(() => {});
  }

  function hidePlaceholder() {
    if (!overlayRoot) return;
    const area = overlayRoot.querySelector('.mediaguard-placeholder-area');
    if (area) {
      area.innerHTML = '';
      area.style.display = 'none';
    }
  }

  function showPlaceholder(message, isError = false) {
    if (!overlayRoot) return;
    let area = overlayRoot.querySelector('.mediaguard-placeholder-area');
    if (!area) {
      area = document.createElement('div');
      area.className = 'mediaguard-placeholder-area';
      overlayRoot.appendChild(area);
    }
    area.style.display = '';
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
    if (!overlayRoot) return () => {};
    let area = overlayRoot.querySelector('.mediaguard-placeholder-area');
    if (!area) {
      area = document.createElement('div');
      area.className = 'mediaguard-placeholder-area';
      overlayRoot.appendChild(area);
    }
    const div = document.createElement('div');
    div.className = 'mediaguard-placeholder';
    const msgNode = document.createTextNode(message + ' ');
    div.appendChild(msgNode);
    const btn = document.createElement('button');
    btn.className = 'mediaguard-retry';
    btn.style.cssText = 'background:#78716c;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;margin-left:8px;';
    btn.textContent = 'Stop';
    btn.addEventListener('click', (e) => { e.preventDefault(); onStop(); });
    div.appendChild(btn);
    area.innerHTML = '';
    area.appendChild(div);
    return (newMsg) => { msgNode.textContent = newMsg + ' '; };
  }

  async function startAudioCapture() {
    if (!window.MediaGuardCapture) {
      showPlaceholder('Capture not available.', true);
      return;
    }
    const videoEl = MediaGuardYouTube.getVideoElement();
    if (!videoEl) {
      showPlaceholder('Video element not found.', true);
      return;
    }
    if (videoEl.paused) {
      showPlaceholder('Starting video…');
      try {
        await videoEl.play();
      } catch (err) {
        showPlaceholder('Could not play video. Try playing it manually.', true);
        return;
      }
    }

    const config = await runtime.sendMessage({ action: 'getApiConfig' });
    isRecording = true;
    updateIconBadge({ recording: true });
    updateToolbarBadge();
    showPlaceholder('Capturing… Select this tab and check "Share tab audio".');
    window.MediaGuardCapture.startCapture({
      videoId,
      videoElement: videoEl,
      apiBaseUrl: config.apiBaseUrl,
      mistralKey: config.mistralKey,
      elevenlabsKey: config.elevenlabsKey || undefined,
      sttProvider: config.sttProvider || 'elevenlabs',
      onStatus: (msg) => {
        if (isRecording && captureStopCallback) {
          const updateMsg = showPlaceholderWithStop(msg, captureStopCallback);
          recordingUpdateMsg = updateMsg;
        } else {
          showPlaceholder(msg);
        }
      },
      onTranscript: () => {},
      onComplete: (data, opts = {}) => {
        if (!opts.continueRecording) {
          if (recordingTimerId) clearInterval(recordingTimerId);
          recordingTimerId = null;
          isRecording = false;
          const count = data ? (data.alerts?.length || 0) + (data.fact_checks?.length || 0) : undefined;
          updateIconBadge({ recording: false, issueCount: count });
          updateToolbarBadge();
        }
        analysisData = data;
        loadAnnotations().then(() => {
          renderOverlay();
          if (opts.continueRecording && captureStopCallback) {
            const newUpdateMsg = showPlaceholderWithStop('Analysis sent. Still recording…', captureStopCallback);
            recordingUpdateMsg = (msg) => {
              const m = msg.match(/(\d+):(\d{2})/);
              const time = m ? `${m[1]}:${m[2]}` : '0:00';
              newUpdateMsg(`Still recording… ${time} — Click Stop when done`);
            };
          }
        });
      },
      onError: (msg) => {
        if (recordingTimerId) clearInterval(recordingTimerId);
        recordingTimerId = null;
        isRecording = false;
        updateIconBadge({ recording: false });
        updateToolbarBadge();
        showPlaceholder(msg, true);
      },
      onCaptureStart: (stopFn) => {
        const startTime = Date.now();
        captureStopCallback = () => {
          console.log('[MediaGuard] Stop clicked, calling stopFn');
          if (recordingTimerId) {
            clearInterval(recordingTimerId);
            recordingTimerId = null;
          }
          if (typeof stopFn === 'function') stopFn();
          isRecording = false;
          const count = analysisData
            ? (analysisData.alerts?.length || 0) + (analysisData.fact_checks?.length || 0)
            : undefined;
          updateIconBadge({ recording: false, issueCount: count });
          updateToolbarBadge();
          showPlaceholder('Capture stopped.');
          if (captureStoppedHideTimeoutId) clearTimeout(captureStoppedHideTimeoutId);
          captureStoppedHideTimeoutId = setTimeout(() => {
            captureStoppedHideTimeoutId = null;
            hidePlaceholder();
          }, 10000);
        };
        const updateMsg = showPlaceholderWithStop('Capturing audio… 0:00 — Auto-analyze at 10s', captureStopCallback);
        recordingUpdateMsg = updateMsg;
        recordingTimerId = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const m = Math.floor(elapsed / 60);
          const s = elapsed % 60;
          const msg = `Capturing audio… ${m}:${String(s).padStart(2, '0')} — Auto-analyze at 10s`;
          if (recordingUpdateMsg) recordingUpdateMsg(msg);
        }, 1000);
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
    // Note: We still attempt getAnalysis even without Mistral key — API may return cached data

    isLoading = true;
    loadError = null;
    updateIconBadge({});
    updateToolbarBadge();
    showPlaceholder('Loading analysis...');

    const response = await runtime.sendMessage({ action: 'getAnalysis', videoId });
    isLoading = false;
    console.log('[MediaGuard ext] loadAnalysis response', videoId, response?.error ? { error: response.error, status: response.status } : 'OK');

    if (response && response.error) {
      loadError = response.error;
      const status = response.status;
      const errMsg = response.error || 'Analysis failed';
      updateIconBadge({});
      updateToolbarBadge();
      // Always try to load annotations — they may exist even when analysis fails (e.g. no transcript)
      await loadAnnotations();
      if (analysisData && (analysisData.alerts?.length > 0 || analysisData.fact_checks?.length > 0)) {
        // Got insights from annotations, show them (loadAnnotations already called renderOverlay)
        updateToolbarBadge();
        return;
      }
      if (status === 404) {
        if (response.error === 'no_transcript') {
          showPlaceholder('No captions — use extension popup to capture audio.');
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
    updateToolbarBadge();
  }

  function renderOverlay() {
    if (!overlayRoot || !analysisData) return;

    const alerts = analysisData.alerts || [];
    const factChecks = analysisData.fact_checks || [];
    const hasAlerts = alerts.length > 0;
    const hasFactChecks = factChecks.length > 0;

    if (!hasAlerts && !hasFactChecks) {
      updateIconBadge({ issueCount: 0 });
      updateToolbarBadge();
      const area = overlayRoot.querySelector('.mediaguard-placeholder-area');
      if (area) area.innerHTML = '';
      return;
    }

    const issueCount = alerts.length + factChecks.length;
    updateIconBadge({ issueCount });
    updateToolbarBadge();
    const area = overlayRoot.querySelector('.mediaguard-placeholder-area');
    if (area) area.innerHTML = '';
    renderSegmentMarkers();
    renderFloatingPanel();
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
      const panel = overlayRoot && overlayRoot.querySelector('.mediaguard-floating-panel');
      if (panel && !panel.classList.contains('mediaguard-hidden') && panel._mediaguardSegments) {
        const rect = panel.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          return;
        }
      }
      if (hoverPanelTimeout) clearTimeout(hoverPanelTimeout);
      hoverPanelTimeout = null;
      const segs = getSegmentsAtMouseX(e.clientX);
      if (segs && segs.length > 0) {
        const anchor = getSegmentAnchorRect(segs[0]);
        let idx = 0;
        if (panel && !panel.classList.contains('mediaguard-hidden') && panel._mediaguardSegments && panel._mediaguardSegments.length === segs.length) {
          const a = panel._mediaguardSegments[0];
          const b = segs[0];
          if (Math.abs((a?.start ?? 0) - (b?.start ?? 0)) < 1) {
            idx = Math.min(panel._mediaguardSegIndex ?? 0, segs.length - 1);
          }
        }
        updateFloatingPanel(segs, idx, anchor);
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
      const up = seg.data?.upvotes ?? 0;
      const down = seg.data?.downvotes ?? 0;
      const isProblematic = down > up;
      bar.className = `mediaguard-segment-bar mediaguard-${seg.type}` + (isProblematic ? ' mediaguard-deprecated' : '');
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
    function resolveType(data, defaultType) {
      if (data.type === 'fact_check' || data.type === 'fact-check') return 'fact-check';
      if (data.type === 'manipulation') return 'manipulation';
      return defaultType;
    }
    (analysisData.alerts || []).forEach((a) => {
      segments.push({
        type: resolveType(a, 'manipulation'),
        label: a.technique,
        start: a.start,
        end: a.end,
        data: a
      });
    });
    (analysisData.fact_checks || []).forEach((f) => {
      segments.push({
        type: resolveType(f, 'fact-check'),
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
    const up = d.upvotes ?? 0;
    const down = d.downvotes ?? 0;
    const isProblematic = down > up;
    if (isProblematic) container.classList.add('mediaguard-deprecated');
    else container.classList.remove('mediaguard-deprecated');

    const header = document.createElement('div');
    header.className = 'mediaguard-panel-header';

    const typeSpan = document.createElement('span');
    typeSpan.className = 'mediaguard-panel-type ' + segment.type;
    typeSpan.textContent = segment.type === 'manipulation' ? 'Rhetorical technique' : 'Fact Check';

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

    const annotationId = d.id || d.annotation_id;
    const hasId = !!annotationId;
    const userVote = hasId ? (d.user_vote || userVotes[annotationId]) : null;

    const voteRow = document.createElement('div');
    voteRow.className = 'mediaguard-vote-row';
    const upvotes = d.upvotes ?? 0;
    const downvotes = d.downvotes ?? 0;

    const upBtn = document.createElement('button');
    upBtn.className = 'mediaguard-vote-btn mediaguard-vote-up' + (userVote === 'up' ? ' active' : '');
    upBtn.type = 'button';
    upBtn.title = !hasId ? 'Vote when annotation is saved' : 'Helpful';
    upBtn.disabled = !hasId;
    upBtn.innerHTML = '&#9650; <span class="mediaguard-vote-count">' + upvotes + '</span>';
    upBtn.addEventListener('click', async (e) => {
      if (!hasId) return;
      e.preventDefault();
      const resp = await runtime.sendMessage({ action: 'submitVote', annotationId, vote: 'up' });
      if (resp && !resp.error) {
        userVotes[annotationId] = 'up';
        mergeAnnotation(segment, resp);
        renderOverlay();
        const panel = overlayRoot && overlayRoot.querySelector('.mediaguard-floating-panel');
        if (panel && panel._mediaguardSegments) {
          const idx = panel._mediaguardSegments.indexOf(segment);
          if (idx >= 0) updateFloatingPanel(panel._mediaguardSegments, idx, null);
        }
      }
    });

    const downBtn = document.createElement('button');
    downBtn.className = 'mediaguard-vote-btn mediaguard-vote-down' + (userVote === 'down' ? ' active' : '');
    downBtn.type = 'button';
    downBtn.title = !hasId ? 'Vote when annotation is saved' : 'Not helpful';
    downBtn.disabled = !hasId;
    downBtn.innerHTML = '&#9660; <span class="mediaguard-vote-count">' + downvotes + '</span>';
    downBtn.addEventListener('click', async (e) => {
      if (!hasId) return;
      e.preventDefault();
      const resp = await runtime.sendMessage({ action: 'submitVote', annotationId, vote: 'down' });
      if (resp && !resp.error) {
        userVotes[annotationId] = 'down';
        mergeAnnotation(segment, resp);
        renderOverlay();
        const panel = overlayRoot && overlayRoot.querySelector('.mediaguard-floating-panel');
        if (panel && panel._mediaguardSegments) {
          const idx = panel._mediaguardSegments.indexOf(segment);
          if (idx >= 0) updateFloatingPanel(panel._mediaguardSegments, idx, null);
        }
      }
    });

    voteRow.appendChild(upBtn);
    voteRow.appendChild(downBtn);
    container.appendChild(voteRow);

    const commentCount = d.comment_count ?? 0;
    const commentRow = document.createElement('div');
    commentRow.className = 'mediaguard-comment-row';
    const btn = document.createElement('button');
    btn.className = 'mediaguard-comment-btn';
    btn.textContent = 'Add context';
    btn.addEventListener('click', () => openCommentModal(segment));
    commentRow.appendChild(btn);
    if (commentCount > 0) {
      const countSpan = document.createElement('span');
      countSpan.className = 'mediaguard-comment-count';
      countSpan.textContent = commentCount + ' comment' + (commentCount === 1 ? '' : 's');
      commentRow.appendChild(countSpan);
    }
    container.appendChild(commentRow);
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
      panel._mediaguardSegIndex = segIndex;
      panel._mediaguardAnchor = barElementOrAnchor ?? panel._mediaguardAnchor;
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
    panel._mediaguardSegIndex = segIndex;
    panel._mediaguardAnchor = barElementOrAnchor;

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
        const idx = panel._mediaguardSegIndex ?? 0;
        if (idx > 0) updateFloatingPanel(panel._mediaguardSegments, idx - 1, panel._mediaguardAnchor);
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
        const idx = panel._mediaguardSegIndex ?? 0;
        if (idx < (panel._mediaguardSegments?.length ?? 0) - 1) updateFloatingPanel(panel._mediaguardSegments, idx + 1, panel._mediaguardAnchor);
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
          (a) => !a.id && Math.abs((a.start ?? 0) - ann.timestamp_start) < 1
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
          id: ann.id,
          upvotes: ann.upvotes ?? 0,
          downvotes: ann.downvotes ?? 0,
          user_vote: ann.user_vote,
          comment_count: ann.comment_count ?? 0
        });
      } else {
        const existing = (analysisData.fact_checks || []).find(
          (f) => !f.id && Math.abs((f.start ?? 0) - ann.timestamp_start) < 1
        );
        if (existing) Object.assign(existing, ann);
        else (analysisData.fact_checks || (analysisData.fact_checks = [])).push({
          claim: ann.content,
          verdict: 'info',
          context: ann.explanation,
          sources: ann.sources || [],
          start: ann.timestamp_start,
          end: ann.timestamp_end,
          id: ann.id,
          upvotes: ann.upvotes ?? 0,
          downvotes: ann.downvotes ?? 0,
          user_vote: ann.user_vote,
          comment_count: ann.comment_count ?? 0
        });
      }
    });
  }

  runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getVideoState') {
      const segments = collectSegments();
      sendResponse({
        videoId,
        analysisData,
        isLoading,
        loadError,
        segments,
        hasOverlay: !!overlayRoot
      });
    } else if (message.action === 'startCapture') {
      startAudioCapture();
      sendResponse({ ok: true });
    } else if (message.action === 'seekTo') {
      const { time } = message;
      if (video && typeof time === 'number' && time >= 0) {
        video.currentTime = time;
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: 'Invalid time or no video' });
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
