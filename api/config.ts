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

  let pub = cleanEnvString(
    process.env.FLUTTERWAVE_PUBLIC_KEY ||
    process.env.VITE_FLUTTERWAVE_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY ||
    process.env.FLW_PUBLIC_KEY ||
    process.env.FLUTTERWAVE_PUB_KEY ||
    process.env.FLW_PUB_KEY ||
    process.env.PUBLIC_KEY
  );

  let sec = cleanEnvString(
    process.env.FLUTTERWAVE_SECRET_KEY ||
    process.env.FLW_SECRET_KEY
  );

  if ((pub.startsWith('FLWSECK_') || pub.startsWith('FLWSECK-')) &&
      (!sec || sec.startsWith('FLWPUBK_') || sec.startsWith('FLWPUBK-'))) {
    const temp = pub;
    pub = sec;
    sec = temp;
  }

  const isReal = Boolean(pub && !pub.includes('SANDBOXDEMOKEY') && (pub.startsWith('FLWPUBK_') || pub.startsWith('FLWPUBK-')));

  return res.status(200).json({
    flutterwavePublicKey: pub || '',
    hasValidPublicKey: isReal,
    hasSecretKey: Boolean(sec && (sec.startsWith('FLWSECK_') || sec.startsWith('FLWSECK-'))),
    defaultCurrency: 'USD'
  });
}
