import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { parseSearch, searchJobs, SearchError } from '../lib/search.js';

const job = { titulo: 'Suporte', empresa: 'Empresa de teste', local: 'Cuiaba/MT - Presencial', descricao: 'Fixture, nao e vaga real.', url: 'https://example.com/jobs/1' };
const payload = (jobs = [job]) => ({ candidates: [{ finishReason: 'STOP',
  content: { parts: [{ text: JSON.stringify(jobs) }] },
  groundingMetadata: { webSearchQueries: ['suporte Cuiaba'], groundingChunks: [{ web: { uri: job.url, title: 'Fonte de teste' } }] }
}] });

test('parse grounded jobs, duplicates and empty search', () => {
  assert.equal(parseSearch(payload([job, job])).jobs.length, 1);
  assert.deepEqual(parseSearch(payload([])).jobs, []);
});
test('accepts web grounding chunks when search queries are omitted', () => {
  const grounded = payload();
  delete grounded.candidates[0].groundingMetadata.webSearchQueries;
  assert.equal(parseSearch(grounded).jobs.length, 1);
});
test('reject ungrounded results, unsafe URLs and truncated output', () => {
  const raw = payload([]);
  delete raw.candidates[0].groundingMetadata;
  assert.throws(() => parseSearch(raw), /confirmou pesquisa/);
  assert.throws(() => parseSearch(payload([{ ...job, url: 'javascript:alert(1)' }])), /inseguro/);
  const truncated = payload();
  truncated.candidates[0].finishReason = 'MAX_TOKENS';
  assert.throws(() => parseSearch(truncated), /limite de resposta/);
});
test('request actually enables Google Search and keeps key in header', async () => {
  const result = await searchJobs({ apiKey: 'test-key', fetchImpl: async (url, options) => {
    assert.ok(!url.includes('test-key'));
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.tools, [{ google_search: {} }]);
    assert.equal(body.generationConfig.maxOutputTokens, 8192);
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
    return Response.json(payload());
  } });
  assert.equal(result.jobs.length, 1);
  await assert.rejects(searchJobs({}), error => error.status === 503);
  await assert.rejects(searchJobs({ apiKey: 'test', fetchImpl: async () => new Response('', { status: 429 }) }), error => error.status === 429);
});
test('logs unfinished response reason without exposing response content', async () => {
  const warnings = [];
  const unfinished = payload();
  unfinished.candidates[0].finishReason = 'SAFETY';
  unfinished.candidates[0].safetyRatings = [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', blocked: true }];
  await assert.rejects(searchJobs({
    apiKey: 'test-key',
    logger: { warn: (...args) => warnings.push(args) },
    fetchImpl: async () => Response.json(unfinished)
  }), /filtros de seguranca/);
  assert.deepEqual(warnings[0], ['Gemini response unfinished', {
    model: 'gemini-3.6-flash',
    finishReason: 'SAFETY',
    blockReason: undefined,
    safetyCategories: ['HARM_CATEGORY_DANGEROUS_CONTENT']
  }]);
});

async function serve(t, options) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };

test('single-flight, cache, expiry, no exposed project files', async t => {
  let calls = 0;
  let clock = 0;
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const base = await serve(t, { env: {}, now: () => clock, search: async () => {
    calls++;
    await wait;
    return parseSearch(payload());
  } });
  const first = fetch(`${base}/api/jobs`, post);
  const second = fetch(`${base}/api/jobs`, post);
  release();
  const responses = await Promise.all([first, second]);
  assert.ok(responses.every(response => response.ok));
  assert.equal(calls, 1);
  assert.equal((await (await fetch(`${base}/api/jobs`, post)).json()).cached, true);
  clock = 16 * 60000;
  await fetch(`${base}/api/jobs`, post);
  assert.equal(calls, 2);
  for (const path of ['/.env', '/server.js', '/package.json', '/.git/config']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal((await fetch(base)).status, 200);
});
test('authentication, health and cross-site guard', async t => {
  const base = await serve(t, { env: { APP_USERNAME: 'admin', APP_PASSWORD: 'test' } });
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(base)).status, 401);
  const authorization = `Basic ${Buffer.from('admin:test').toString('base64')}`;
  assert.equal((await fetch(base, { headers: { authorization } })).status, 200);
  assert.equal((await fetch(`${base}/api/jobs`, { ...post, headers: { ...post.headers, authorization, 'sec-fetch-site': 'cross-site' } })).status, 403);
});
test('upstream failure is not cached and cooldown blocks immediate retry', async t => {
  const base = await serve(t, { env: {}, search: async () => { throw new SearchError('Falha de teste', 503); } });
  assert.equal((await fetch(`${base}/api/jobs`, post)).status, 503);
  assert.equal((await fetch(`${base}/api/jobs`, post)).status, 429);
});