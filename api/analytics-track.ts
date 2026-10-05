import { extractClientIP, resolveGeoLocation, recordVisitorSession } from '../src/analytics-engine.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }

    const ip = extractClientIP(req);
    const geo = resolveGeoLocation(req, body.timezone);

    const session = recordVisitorSession({
      visitor_id: body.visitor_id,
      session_id: body.session_id,
      path: body.path || '/',
      page_title: body.page_title,
      referrer: body.referrer,
      traffic_source: body.traffic_source,
      utm_source: body.utm_source,
      utm_medium: body.utm_medium,
      utm_campaign: body.utm_campaign,
      device: body.device,
      browser: body.browser,
      os: body.os,
      screen_res: body.screen_res,
      max_scroll_pct: body.max_scroll_pct,
      stop_location: body.stop_location,
      time_on_page: body.time_on_page,
      stage: body.stage,
      converted: body.converted,
      donation: body.donation,
      ip,
      geo
    });

    return res.status(200).json({
      success: true,
      recorded: true,
      session_id: session.session_id,
      location: `${session.city}, ${session.country} ${session.flag}`,
      ip: session.ip
    });
  } catch (err: any) {
    console.error('[api/analytics-track] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
