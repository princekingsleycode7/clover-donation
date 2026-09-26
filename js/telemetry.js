/**
 * ==============================================================================
 * TURKANA WELLSPRING INITIATIVE — ERROR LOGGING & TELEMETRY (js/telemetry.js)
 * Sentry-compatible monitoring across client and server edge pipelines.
 * Captures unhandled runtime errors, API network failures, and payment anomalies.
 * ==============================================================================
 */

(function (window) {
  'use strict';

  class TelemetryMonitor {
    constructor() {
      this.dsn = window.SENTRY_DSN || localStorage.getItem('twp_sentry_dsn') || null;
      this.environment = window.location.hostname.includes('dev') || window.location.hostname === 'localhost' 
        ? 'staging' 
        : 'production';
      this.initialized = false;
      this.breadcrumbs = [];
    }

    init() {
      // Global error listener
      window.addEventListener('error', (event) => {
        this.captureException(event.error || new Error(event.message), {
          source: 'window.onerror',
          lineno: event.lineno,
          filename: event.filename
        });
      });

      // Unhandled Promise rejection listener
      window.addEventListener('unhandledrejection', (event) => {
        this.captureException(event.reason || new Error('Unhandled Promise Rejection'), {
          source: 'unhandledrejection'
        });
      });

      console.log(`[Telemetry] Initialized in ${this.environment} mode.`);
      this.initialized = true;
    }

    addBreadcrumb(category, message, data = {}) {
      const crumb = {
        timestamp: new Date().toISOString(),
        category,
        message,
        data
      };
      this.breadcrumbs.push(crumb);
      if (this.breadcrumbs.length > 30) this.breadcrumbs.shift();
    }

    captureException(error, context = {}) {
      const errorPayload = {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack || null,
        context: {
          ...context,
          url: window.location.href,
          userAgent: navigator.userAgent,
          language: document.documentElement.lang,
          breadcrumbs: this.breadcrumbs.slice(-10)
        },
        timestamp: new Date().toISOString(),
        environment: this.environment
      };

      console.warn('[Telemetry Caught Exception]', errorPayload);

      // Forward to Sentry if DSN is configured
      if (this.dsn && window.Sentry && typeof window.Sentry.captureException === 'function') {
        window.Sentry.captureException(error, { extra: context });
      }
    }

    captureMessage(message, level = 'info', context = {}) {
      this.addBreadcrumb(level, message, context);
      console.log(`[Telemetry ${level.toUpperCase()}]`, message, context);
    }

    trackEvent(eventName, data = {}) {
      this.addBreadcrumb('event', eventName, data);
    }
  }

  window.telemetry = new TelemetryMonitor();
  window.telemetry.init();

})(window);
