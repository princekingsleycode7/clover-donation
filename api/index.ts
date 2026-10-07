import app from '../server.ts';

export default function handler(req: any, res: any) {
  // Normalize incoming URL for Vercel Serverless Function rewrites
  const matched = req.headers?.['x-matched-path'] || req.headers?.['x-now-route-matches'];
  if (matched && typeof matched === 'string' && !matched.includes('index.ts') && !matched.endsWith('/api/index')) {
    const queryIdx = req.url.indexOf('?');
    const queryStr = queryIdx !== -1 ? req.url.substring(queryIdx) : '';
    req.url = matched + (matched.includes('?') ? '' : queryStr);
  } else if (req.headers?.['x-forwarded-uri']) {
    req.url = req.headers['x-forwarded-uri'];
  } else if (req.query?.__path) {
    const queryIdx = req.url.indexOf('?');
    const queryStr = queryIdx !== -1 ? req.url.substring(queryIdx) : '';
    req.url = '/' + req.query.__path + queryStr;
  }

  return (app as any)(req, res);
}

