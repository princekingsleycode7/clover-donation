import app from '../server.ts';

export default function handler(req: any, res: any) {
  try {
    const rawUrl: string = req.url || '';
    const [pathPart, queryPart] = rawUrl.split('?');

    // 1. Identify target route
    let targetPath = '';
    const rawQueryRoute = req.query?.__route || req.query?.__path || req.query?.path;
    const qRoute = Array.isArray(rawQueryRoute) ? rawQueryRoute[0] : rawQueryRoute;

    if (qRoute && typeof qRoute === 'string') {
      targetPath = qRoute.startsWith('/') ? qRoute : '/' + qRoute;
    } else if (pathPart && pathPart !== '/api' && pathPart !== '/api/' && pathPart !== '/api/index') {
      // The incoming path itself already holds the concrete sub-route (e.g. /api/admin/login)
      targetPath = pathPart;
    } else {
      // Path is generic /api. Inspect system headers passed by Vercel
      const matched = req.headers?.['x-matched-path'] ||
                      req.headers?.['x-vercel-matched-path'] ||
                      req.headers?.['x-forwarded-uri'] ||
                      req.headers?.['x-original-url'];
      if (
        matched &&
        typeof matched === 'string' &&
        matched.startsWith('/') &&
        matched !== '/api' &&
        matched !== '/api/' &&
        !matched.endsWith('/api/index') &&
        !matched.includes('index.ts')
      ) {
        targetPath = matched.split('?')[0];
      } else if (req.headers?.['x-now-route-matches']) {
        const matchesStr = String(req.headers['x-now-route-matches']);
        const m = matchesStr.match(/1=([^&]+)/);
        if (m && m[1]) {
          const sub = decodeURIComponent(m[1]);
          targetPath = sub.startsWith('/') ? sub : '/api/' + sub;
        }
      }
    }

    if (!targetPath) {
      targetPath = pathPart || '/api';
    }

    // Preserve real client query parameters while stripping internal routing helpers
    const searchParams = new URLSearchParams(queryPart || '');
    searchParams.delete('__route');
    searchParams.delete('__path');
    searchParams.delete('path');
    const remainingQuery = searchParams.toString();

    req.url = targetPath + (remainingQuery ? '?' + remainingQuery : '');
    req.originalUrl = req.url;

    if (req.query) {
      delete req.query.__route;
      delete req.query.__path;
      delete req.query.path;
    }
  } catch (err) {
    console.error('[Vercel Handler] Route normalization error:', err);
  }

  return (app as any)(req, res);
}

