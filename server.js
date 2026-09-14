import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { searchJobs } from './lib/search.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

export function createApp({ env = process.env, search = searchJobs, now = Date.now } = {}) {
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
  let cached;
  let pending;
  let nextAttempt = 0;
  app.post('/api/jobs', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Origem nao permitida.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'Envie Content-Type application/json.' });
    if (cached && now() - cached.time < 15 * 60000) return res.json({ ...cached.data, cached: true });
    try {
      if (!pending) {
        if (now() < nextAttempt) {
          res.set('Retry-After', String(Math.ceil((nextAttempt - now()) / 1000)));
          return res.status(429).json({ error: 'Aguarde um minuto antes de iniciar outra pesquisa.' });
        }
        nextAttempt = now() + 60000;
        // Share one upstream request across all users to avoid duplicate charges.
        pending = Promise.resolve().then(() => search({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }))
          .then(data => { cached = { data, time: now() }; return data; })
          .finally(() => { pending = undefined; });
      }
      res.json({ ...await pending, cached: false });
    } catch (error) {
      res.status(error.status || 502).json({ error: error.status ? error.message : 'Falha ao pesquisar. Tente novamente mais tarde.' });
    }
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