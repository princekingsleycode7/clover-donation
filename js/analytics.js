/**
 * ==============================================================================
 * TURKANA WELLSPRING INITIATIVE — VISITOR & CONVERSION ANALYTICS (js/analytics.js)
 * Tracks user journeys, page views, scroll depth ("where they stopped"),
 * geographic location & IP data, and conversion funnels for audience targeting.
 * ==============================================================================
 */

(function (window, document) {
  'use strict';

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Persistent Visitor ID (stored across visits)
  var visitorId = '';
  try {
    visitorId = localStorage.getItem('twp_visitor_id');
    if (!visitorId) {
      visitorId = 'vis_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('twp_visitor_id', visitorId);
    }
  } catch (e) {
    visitorId = 'vis_tmp_' + Date.now().toString(36);
  }

  // Session ID (per browser session)
  var sessionId = '';
  try {
    sessionId = sessionStorage.getItem('twp_session_id');
    if (!sessionId) {
      sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('twp_session_id', sessionId);
    }
  } catch (e) {
    sessionId = 'sess_tmp_' + Date.now().toString(36);
  }

  // Detect Device
  function getDeviceType() {
    var ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'Tablet';
    if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua)) return 'Mobile';
    return 'Desktop';
  }

  // Detect Browser
  function getBrowserName() {
    var ua = navigator.userAgent;
    if (ua.indexOf('Chrome') > -1 && ua.indexOf('Edg') === -1 && ua.indexOf('OPR') === -1) return 'Chrome';
    if (ua.indexOf('Safari') > -1 && ua.indexOf('Chrome') === -1) return 'Safari';
    if (ua.indexOf('Firefox') > -1) return 'Firefox';
    if (ua.indexOf('Edg') > -1) return 'Edge';
    if (ua.indexOf('OPR') > -1 || ua.indexOf('Opera') > -1) return 'Opera';
    return 'Other';
  }

  // Detect OS
  function getOSName() {
    var ua = navigator.userAgent;
    if (ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) return 'iOS';
    if (ua.indexOf('Android') > -1) return 'Android';
    if (ua.indexOf('Mac') > -1) return 'macOS';
    if (ua.indexOf('Win') > -1) return 'Windows';
    if (ua.indexOf('Linux') > -1) return 'Linux';
    return 'Unknown';
  }

  // Extract UTM / Traffic Source
  function getTrafficSource() {
    var params = new URLSearchParams(window.location.search);
    var utmSource = params.get('utm_source');
    var utmMedium = params.get('utm_medium');
    var utmCampaign = params.get('utm_campaign');

    if (utmSource) {
      return {
        source: utmSource + (utmMedium ? ' / ' + utmMedium : ''),
        campaign: utmCampaign || 'none',
        utm_source: utmSource,
        utm_medium: utmMedium || '',
        utm_campaign: utmCampaign || ''
      };
    }

    var ref = document.referrer;
    if (!ref) return { source: 'Direct / Bookmark', campaign: 'none' };

    try {
      var refHost = new URL(ref).hostname;
      if (refHost.includes(window.location.hostname)) return { source: 'Internal Navigation', campaign: 'none' };
      if (refHost.includes('google')) return { source: 'Google Search (Organic)', campaign: 'organic_search' };
      if (refHost.includes('facebook') || refHost.includes('fb.com')) return { source: 'Facebook', campaign: 'social' };
      if (refHost.includes('instagram')) return { source: 'Instagram', campaign: 'social' };
      if (refHost.includes('twitter') || refHost.includes('t.co') || refHost.includes('x.com')) return { source: 'Twitter / X', campaign: 'social' };
      if (refHost.includes('linkedin')) return { source: 'LinkedIn', campaign: 'social' };
      if (refHost.includes('youtube')) return { source: 'YouTube', campaign: 'social' };
      if (refHost.includes('reddit')) return { source: 'Reddit', campaign: 'community' };
      return { source: refHost, campaign: 'referral' };
    } catch (e) {
      return { source: 'External Referral', campaign: 'referral' };
    }
  }

  var startTime = Date.now();
  var maxScrollPct = 0;
  var currentStage = 'pageview';
  var lastStopSection = 'Hero Section (0-25%)';
  var isConverted = false;
  var donationDetails = null;

  function calculateScroll() {
    var docHeight = Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight,
      document.body.offsetHeight, document.documentElement.offsetHeight,
      document.body.clientHeight, document.documentElement.clientHeight
    );
    var winHeight = window.innerHeight || document.documentElement.clientHeight;
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    var trackable = docHeight - winHeight;
    var pct = 0;
    if (trackable <= 0) {
      pct = 100;
    } else {
      pct = Math.min(100, Math.round((scrollTop / trackable) * 100));
    }

    if (pct > maxScrollPct) {
      maxScrollPct = pct;

      // Determine where they are stopped currently
      if (maxScrollPct >= 85) {
        lastStopSection = 'Footer & Community Impact (85-100%)';
      } else if (maxScrollPct >= 60) {
        lastStopSection = 'Donation Card & Medical Needs (60-85%)';
      } else if (maxScrollPct >= 30) {
        lastStopSection = 'Patient Story & Healthcare Crisis (30-60%)';
      } else {
        lastStopSection = 'Hero Section & Overview (0-30%)';
      }
    }
  }

  // Send Analytics Beacon/Ping
  function sendAnalyticsPing(stage, extra) {
    calculateScroll();
    var durationSec = Math.round((Date.now() - startTime) / 1000);
    var traffic = getTrafficSource();

    var payload = {
      visitor_id: visitorId,
      session_id: sessionId,
      path: window.location.pathname || '/',
      page_title: document.title || 'Wellspring',
      referrer: document.referrer || '',
      traffic_source: traffic.source,
      utm_source: traffic.utm_source || '',
      utm_medium: traffic.utm_medium || '',
      utm_campaign: traffic.utm_campaign || '',
      device: getDeviceType(),
      browser: getBrowserName(),
      os: getOSName(),
      screen_res: (window.screen ? window.screen.width + 'x' + window.screen.height : 'unknown'),
      time_on_page: durationSec,
      max_scroll_pct: maxScrollPct,
      stop_location: (isConverted ? 'Completed Donation' : (extra && extra.stage_label ? extra.stage_label : lastStopSection)),
      stage: stage || currentStage,
      converted: isConverted,
      donation: donationDetails,
      timezone: Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : '',
      timestamp: new Date().toISOString()
    };

    if (extra) {
      Object.assign(payload, extra);
    }

    var jsonStr = JSON.stringify(payload);

    // Try modern sendBeacon first (unobtrusive & guarantees delivery on unload)
    var endpoint = '/api/analytics/track';
    if (typeof navigator.sendBeacon === 'function') {
      var blob = new Blob([jsonStr], { type: 'application/json' });
      var sent = navigator.sendBeacon(endpoint, blob);
      if (sent) return;
    }

    // Fallback to fetch with keepalive
    try {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonStr,
        keepalive: true
      }).catch(function () {});
    } catch (err) {}
  }

  // Throttle scroll listener
  var scrollTimeout;
  window.addEventListener('scroll', function () {
    if (!scrollTimeout) {
      scrollTimeout = setTimeout(function () {
        scrollTimeout = null;
        calculateScroll();
      }, 250);
    }
  }, { passive: true });

  // Initial pageview tracking after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(function () {
        sendAnalyticsPing('pageview');
      }, 500);
    });
  } else {
    setTimeout(function () {
      sendAnalyticsPing('pageview');
    }, 500);
  }

  // Heartbeat ping at 15s and 45s to capture reading time
  setTimeout(function () { sendAnalyticsPing('reading_15s'); }, 15000);
  setTimeout(function () { sendAnalyticsPing('reading_45s'); }, 45000);

  // Send final beacon on page leave
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      sendAnalyticsPing('exit');
    }
  });
  window.addEventListener('pagehide', function () {
    sendAnalyticsPing('exit');
  });

  // Global helper to track high-value conversion stages from donation forms & buttons
  window.trackDonationAnalytics = function (stage, details) {
    if (stage === 'amount_selected') {
      currentStage = 'amount_selected';
      lastStopSection = 'Selected Amount (' + (details?.currency || '$') + (details?.amount || '') + ')';
    } else if (stage === 'form_filled') {
      currentStage = 'form_filled';
      lastStopSection = 'Filled Donor Details';
    } else if (stage === 'modal_opened') {
      currentStage = 'modal_opened';
      lastStopSection = 'Payment Modal Opened';
    } else if (stage === 'donation_completed') {
      isConverted = true;
      currentStage = 'donation_completed';
      donationDetails = details;
      lastStopSection = 'Completed Donation (' + (details?.currency || '$') + (details?.amount || '') + ')';
    }

    sendAnalyticsPing(stage, {
      stage_label: lastStopSection,
      donation: details
    });
  };

})(window, document);
