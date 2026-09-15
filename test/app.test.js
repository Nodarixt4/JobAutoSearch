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
  let calls = 0;
  const result = await searchJobs({ apiKey: 'test-key', query: { categories: ['frontend', 'security'] }, fetchImpl: async (url, options) => {
    calls++;
    assert.match(url, /models\/gemini-3\.6-flash:generateContent$/);
    assert.ok(!url.includes('test-key'));
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(options.body);
    if (calls === 1) {
      assert.deepEqual(body.tools, [{ google_search: {} }]);
      assert.equal(body.generationConfig.responseMimeType, undefined);
      assert.doesNotMatch(body.contents[0].parts[0].text, /JSON/);
      assert.match(body.contents[0].parts[0].text, /exige o uso da ferramenta Google Search/);
      assert.match(body.contents[0].parts[0].text, /Front-end/);
      assert.match(body.contents[0].parts[0].text, /exclusivamente de TI/);
      assert.match(body.contents[0].parts[0].text, /Seguranca da informacao/);
      assert.match(body.contents[0].parts[0].text, /Mato Grosso do Sul/);
      assert.match(body.contents[0].parts[0].text, /elegibilidade explicita para Brasil/);
    } else {
      assert.equal(body.tools, undefined);
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.equal(body.generationConfig.responseJsonSchema.maxItems, 40);
      const input = JSON.parse(body.contents[0].parts[0].text);
      assert.deepEqual(input.query.categories, ['frontend', 'security']);
      assert.match(input.categoryPolicy, /Somente vagas de TI/);
      assert.match(input.geographicPolicy, /somente Mato Grosso MT, nunca MS/);
    }
    assert.equal(body.generationConfig.maxOutputTokens, 8192);
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'medium' });
    return Response.json(payload());
  } });
  assert.equal(result.jobs.length, 1);
  assert.equal(calls, 2);
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

test('retries missing grounding once using the same deadline', async () => {
  const raw = payload();
  delete raw.candidates[0].groundingMetadata;
  const requests = [];
  const warnings = [];
  const result = await searchJobs({
    apiKey: 'test-key',
    logger: { warn: (...args) => warnings.push(args) },
    fetchImpl: async (_url, options) => {
      requests.push(options);
      return Response.json(requests.length === 1 ? raw : payload());
    }
  });
  assert.equal(result.jobs.length, 1);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].signal, requests[1].signal);
  assert.equal(requests[0].signal, requests[2].signal);
  assert.match(JSON.parse(requests[1].body).contents[0].parts[0].text, /tentativa anterior/);
  assert.deepEqual(warnings, [['Gemini response missing grounding', { model: 'gemini-3.6-flash', attempt: 1 }]]);
});

test('never accepts ungrounded empty results after retry', async () => {
  const raw = payload([]);
  delete raw.candidates[0].groundingMetadata;
  let calls = 0;
  await assert.rejects(searchJobs({
    apiKey: 'test-key', logger: { warn() {} },
    fetchImpl: async () => { calls++; return Response.json(raw); }
  }), error => error.status === 502 && error.code === 'MISSING_GROUNDING');
  assert.equal(calls, 2);
});

test('does not retry malformed extraction or upstream errors', async () => {
  for (const [expectedCalls, response] of [[2, () => {
    const raw = payload();
    raw.candidates[0].content.parts[0].text = 'invalid json';
    return Response.json(raw);
  }], [1, () => new Response('', { status: 429 })]]) {
    let calls = 0;
    await assert.rejects(searchJobs({
      apiKey: 'test-key', logger: { warn() {} },
      fetchImpl: async () => { calls++; return response(); }
    }), SearchError);
    assert.equal(calls, expectedCalls);
  }
});

test('natural research preserves original metadata and ignores extraction grounding', async () => {
  const research = payload();
  research.candidates[0].content.parts = [{ thought: true, text: 'private thought' },
    { text: 'Suporte na Empresa de teste em Cuiaba. Fonte [1].' }];
  const metadata = research.candidates[0].groundingMetadata;
  metadata.searchEntryPoint = { renderedContent: '<div>Google suggestions</div>' };
  metadata.groundingSupports = [{ segment: { text: 'Suporte na Empresa de teste' }, groundingChunkIndices: [0] }];
  let calls = 0;
  const result = await searchJobs({ apiKey: 'test', fetchImpl: async (_url, options) => {
    if (++calls === 1) return Response.json(research);
    const input = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
    assert.doesNotMatch(input.research, /private thought/);
    assert.deepEqual(input.groundingSupports, metadata.groundingSupports);
    const extracted = payload();
    delete extracted.candidates[0].groundingMetadata;
    return Response.json(extracted);
  } });
  assert.deepEqual(result.groundingMetadata, metadata);
  assert.equal(result.searchEntryPoint, metadata.searchEntryPoint.renderedContent);
  assert.match(result.researchText, /Fonte/);
});

test('rejects fabricated links even if extraction supplies its own grounding', () => {
  const invented = { ...job, url: 'https://example.com/jobs/invented' };
  const extracted = payload([invented]);
  extracted.candidates[0].groundingMetadata.groundingChunks[0].web.uri = invented.url;
  assert.throws(() => parseSearch(extracted, payload()), error => error.code === 'UNSUPPORTED_SOURCE');
  const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/test';
  const research = payload();
  research.candidates[0].groundingMetadata.groundingChunks[0].web.uri = redirect;
  assert.equal(parseSearch(payload([{ ...job, url: redirect }]), research).jobs[0].url, redirect);
});

test('query-only research permits only empty extraction', () => {
  const research = payload();
  research.candidates[0].groundingMetadata.groundingChunks = [];
  assert.deepEqual(parseSearch(payload([]), research).jobs, []);
  assert.throws(() => parseSearch(payload(), research), /sem fontes/);
});

test('extraction failures never retry or become empty success', async () => {
  for (const failure of ['SAFETY', 'MAX_TOKENS', 'timeout', '429']) {
    let calls = 0;
    await assert.rejects(searchJobs({ apiKey: 'test', logger: { warn() {} }, fetchImpl: async () => {
      if (++calls === 1) return Response.json(payload());
      if (failure === 'timeout') throw new DOMException('test', 'TimeoutError');
      if (failure === '429') return new Response('', { status: 429 });
      const raw = payload();
      raw.candidates[0].finishReason = failure;
      return Response.json(raw);
    } }), error => error instanceof SearchError && error.status === (failure === 'timeout' ? 504 : failure === '429' ? 429 : 502));
    assert.equal(calls, 2);
  }
});

test('empty research text is an error without extraction', async () => {
  let calls = 0;
  const raw = payload();
  raw.candidates[0].content.parts = [];
  await assert.rejects(searchJobs({ apiKey: 'test', fetchImpl: async () => {
    calls++;
    return Response.json(raw);
  } }), /sem texto/);
  assert.equal(calls, 1);
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
test('upstream failure is not cached and does not globally block retry', async t => {
  const base = await serve(t, { env: {}, search: async () => { throw new SearchError('Falha de teste', 503); } });
  assert.equal((await fetch(`${base}/api/jobs`, post)).status, 503);
  assert.equal((await fetch(`${base}/api/jobs`, post)).status, 503);
});