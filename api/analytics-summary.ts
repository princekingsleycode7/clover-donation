import { getAnalyticsSummary } from '../src/analytics-engine.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const range = (req.query?.range || 'all').toString();
    const summary = getAnalyticsSummary(range);
    return res.status(200).json(summary);
  } catch (err: any) {
    console.error('[api/analytics-summary] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
