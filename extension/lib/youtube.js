(function () {
  'use strict';

  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('v');
    if (v) return v;
    const ytPlayer = window.ytInitialPlayerResponse;
    if (ytPlayer && ytPlayer.videoDetails && ytPlayer.videoDetails.videoId) return ytPlayer.videoDetails.videoId;
    const embedMatch = window.location.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1];
    return null;
  }

  function getVideoElement() {
    return document.querySelector('#movie_player video') ||
           document.querySelector('video.html5-main-video') ||
           document.querySelector('#ytd-player video') ||
           document.querySelector('video');
  }

  function getProgressBar() {
    return document.querySelector('.ytp-progress-bar-container') ||
           document.querySelector('.ytp-progress-bar') ||
           document.querySelector('#progress') ||
           document.querySelector('.html5-video-player .ytp-progress-bar-container');
  }

  function getPlayerContainer() {
    return document.querySelector('#ytd-player') ||
           document.querySelector('#movie_player') ||
           document.querySelector('.html5-video-player');
  }

  function getRightControls() {
    return document.querySelector('.ytp-right-controls') ||
           document.querySelector('.ytp-chrome-controls .ytp-right-controls');
  }

  window.MediaGuardYouTube = {
    getVideoId,
    getVideoElement,
    getProgressBar,
    getPlayerContainer,
    getRightControls
  };
})();
