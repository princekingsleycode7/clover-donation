import { fetchAllLedgerDonations } from '../src/admin-auth-service.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const result = await fetchAllLedgerDonations();
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[api/ledger-donations] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch ledger donations' });
  }
}
