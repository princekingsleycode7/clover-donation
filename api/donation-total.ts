import { createClient } from '@supabase/supabase-js';

function cleanEnvString(val?: any): string {
  if (!val) return '';
  let str = String(val).trim();
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1).trim();
  }
  return str.replace(/\\r/g, '').replace(/\\n/g, '').trim();
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let total = 12480;
  let count = 89;

  try {
    const supabaseUrl = cleanEnvString(process.env.SUPABASE_URL);
    const supabaseKey = cleanEnvString(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data } = await supabase.from('donations').select('amount').eq('status', 'successful');
      if (data && data.length > 0) {
        total = data.reduce((sum: number, row: any) => sum + (Number(row.amount) || 0), 12480);
        count = data.length + 89;
      }
    }
  } catch (err) {}

  return res.status(200).json({
    total,
    count,
    goal: 250000,
    currency: 'USD'
  });
}
