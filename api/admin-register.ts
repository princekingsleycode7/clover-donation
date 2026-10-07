import { registerPrimaryAdmin } from '../src/admin-auth-service.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }

    const { name, email, password } = body;
    const result = registerPrimaryAdmin(name, email, password);
    return res.status(result.status || 200).json(result);
  } catch (err: any) {
    console.error('[api/admin-register] Error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Registration failed' });
  }
}
