import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { aggregateJobs, normalizeQuery, options } from './lib/jobs.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

export function createApp({ env = process.env, search = aggregateJobs, now = Date.now } = {}) {
  if (Boolean(env.APP_USERNAME) !== Boolean(env.APP_PASSWORD)) throw new Error('Configure APP_USERNAME e APP_PASSWORD juntos.');
  const app = express();
  app.disable('x-powered-by');
  if (env.RENDER) app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    next();
  });
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Muitas requisicoes. Aguarde um minuto.' } }));
  app.use((req, res, next) => {
    if (!env.APP_PASSWORD) return next();
    const header = req.get('authorization') || '';
    const credentials = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : '';
    if (equal(credentials, `${env.APP_USERNAME}:${env.APP_PASSWORD}`)) return next();
    res.set('WWW-Authenticate', 'Basic realm="JobAutoSearch", charset="UTF-8"');
    res.status(401).json({ error: 'Autenticacao necessaria.' });
  });
  const cache = new Map();
  const pending = new Map();
  const feeds = new Map();
  const budgets = new Map();
  function allowProvider(id) {
    const current = budgets.get(id);
    const entry = current && now() - current.start < 60000 ? current : { start: now(), count: 0 };
    budgets.set(id, entry);
    return ++entry.count <= (id === 'gemini' ? 2 : 4);
  }
  app.get('/api/options', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(options(env.GEMINI_API_KEY));
  });
  const jobsLimit = rateLimit({ windowMs: 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Limite de pesquisas por IP. Aguarde um minuto.' } });
  app.post('/api/jobs', jobsLimit, express.json({ limit: '4kb', strict: true }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Origem nao permitida.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'Envie Content-Type application/json.' });
    try {
      const query = normalizeQuery(req.body);
      const key = JSON.stringify(query);
      for (const [id, entry] of cache) if (now() - entry.time >= 15 * 60000) cache.delete(id);
      const cached = cache.get(key);
      if (cached) return res.json({ ...cached.data, cached: true });
      if (!pending.has(key)) {
        if (pending.size >= 4) {
          res.set('Retry-After', '5');
          return res.status(429).json({ error: 'Limite global de pesquisas simultaneas. Tente em alguns segundos.' });
        }
        pending.set(key, Promise.resolve().then(() => search({ query, apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, allowProvider, feeds, now }))
          .then(data => {
            // Partial failures stay retryable; successful empty searches are cacheable.
            if (!data.providers?.some(provider => provider.status === 'error')) {
              if (cache.size >= 100) cache.delete(cache.keys().next().value);
              cache.set(key, { data, time: now() });
            }
            return data;
          }).finally(() => { pending.delete(key); }));
      }
      res.json({ ...await pending.get(key), cached: false });
    } catch (error) {
      res.status(error.status || 502).json({ error: error.status ? error.message : 'Falha ao pesquisar. Tente novamente mais tarde.', ...(error.providers && { providers: error.providers }) });
    }
  });
  app.use((error, _req, res, _next) => {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Corpo JSON invalido ou acima de 4 KB.' });
  });
  app.get(['/', '/index.html'], (_req, res) => res.sendFile(resolve(root, 'index.html')));
  app.get('/styles.css', (_req, res) => res.sendFile(resolve(root, 'public/styles.css')));
  app.use((_req, res) => res.status(404).json({ error: 'Pagina nao encontrada.' }));
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '0.0.0.0', () => console.log(`JobAutoSearch iniciado na porta ${port}`));
}