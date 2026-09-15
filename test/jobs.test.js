import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateJobs, normalizeQuery, options, readJson } from '../lib/jobs.js';
import { createApp } from '../server.js';

const row = { title: 'Junior Software Developer', company_name: 'Example', candidate_required_location: 'Brazil', description: '<p>Desenvolvimento de software</p>', url: 'https://example.com/job' };
const mock = async url => Response.json(url.includes('remotive') ? { jobs: [row] } : { data: [{ ...row, location: 'Berlin', remote: false, title: 'Senior Marketing', url: 'https://example.com/2' }] });
test('normalization, defaults, invalid enums, shapes and limits', () => {
  assert.deepEqual(normalizeQuery().providers, ['arbeitnow', 'remotive']);
  assert.equal(normalizeQuery({ keywords: '  SÊNIOR  Java ' }).keywords, 'senior java');
  assert.deepEqual(normalizeQuery({ categories: ['software', 'frontend', 'software'] }).categories, ['frontend', 'software']);
  for (const body of [null, [], { providers: [] }, { categories: ['invalid'] }, { keywords: 3 }, { location: 'a'.repeat(121) }, { modality: 'office' }, { seniority: 'expert' }, { key: 'secret' }]) {
    assert.throws(() => normalizeQuery(body), error => error.status === 400);
  }
  assert.equal(options('').providers.find(p => p.id === 'gemini').enabled, false);
});
test('real provider schemas map exact job contract and PT/EN filters', async () => {
  const result = await aggregateJobs({ fetchImpl: mock, query: normalizeQuery({ categories: ['software'], keywords: 'software', location: 'brazil', modality: 'remote', seniority: 'junior' }) });
  assert.equal(result.jobs.length, 1);
  assert.deepEqual(Object.keys(result.jobs[0]), ['titulo', 'empresa', 'local', 'descricao', 'url']);
  assert.doesNotMatch(result.jobs[0].descricao, /<p>/);
  assert.equal(result.providers.length, 2);
  assert.equal(result.providers.every(p => p.status === 'ok'), true);
});
test('unknown modality excluded even when seniority is unknown', async () => {
  const fetchImpl = async () => Response.json({ data: [{ ...row, candidate_required_location: '', location: 'Berlin', title: 'Designer', remote: false }] });
  const result = await aggregateJobs({ fetchImpl, query: normalizeQuery({ providers: ['arbeitnow'], modality: 'hybrid', seniority: 'senior' }) });
  assert.equal(result.jobs.length, 0);
  const mismatch = await aggregateJobs({ fetchImpl: mock, query: normalizeQuery({ providers: ['remotive'], modality: 'onsite' }) });
  assert.equal(mismatch.jobs.length, 0);
});
test('partial errors, disabled provider and total failure are distinguishable', async () => {
  const fetchImpl = async url => { if (url.includes('arbeitnow')) throw new Error('secret upstream detail'); return mock(url); };
  const result = await aggregateJobs({ fetchImpl, query: normalizeQuery({ providers: ['remotive', 'arbeitnow', 'gemini'] }) });
  assert.equal(result.jobs.length, 1);
  assert.deepEqual(result.providers.map(p => p.status), ['error', 'disabled', 'ok']);
  assert.ok(!JSON.stringify(result).includes('secret upstream detail'));
  await assert.rejects(aggregateJobs({ fetchImpl, query: normalizeQuery({ providers: ['arbeitnow'] }) }), error => error.status === 503 && error.providers[0].status === 'error');
  await assert.rejects(aggregateJobs({ query: normalizeQuery({ providers: ['gemini'] }) }), error => error.providers[0].status === 'disabled');
});
test('deduplication, 200 cap, source pagination and bounded external body', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ ...row, title: `Developer ${i}`, url: `https://example.com/${i}` }));
  const result = await aggregateJobs({ fetchImpl: async () => Response.json({ jobs: [...rows, rows[0]] }), query: normalizeQuery({ providers: ['remotive'] }) });
  assert.equal(result.jobs.length, 200);
  assert.equal(result.truncated, true);
  const paged = await aggregateJobs({ fetchImpl: async () => Response.json({ data: [], links: { next: 'https://example.com/page2' } }), query: normalizeQuery({ providers: ['arbeitnow'] }) });
  assert.equal(paged.truncated, true);
  await assert.rejects(readJson(new Response('x'.repeat(100)), 10), /limite/);
});
test('public feeds shared across filters; provider budget and failure cleanup', async () => {
  let calls = 0; const feeds = new Map();
  const args = { feeds, fetchImpl: async url => { calls++; return mock(url); } };
  await Promise.all([aggregateJobs(args), aggregateJobs({ ...args, query: normalizeQuery({ keywords: 'marketing' }) })]);
  assert.equal(calls, 2);
  await aggregateJobs({ ...args, allowProvider: () => false });
  assert.equal(calls, 2);
  await assert.rejects(aggregateJobs({ allowProvider: () => false }), error => error.providers.every(p => p.status === 'error'));
});
async function serve(t, args) {
  const server = createApp(args).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('geographic policy applies without filters and cannot be relaxed', async () => {
  const allowed = ['Brazil', 'Brasil', 'Latin America', 'LATAM', 'Worldwide'];
  const denied = ['Remote', '', 'Europe', 'US only', 'Global company', 'Worldwide excluding Brazil', 'MS', 'Mato Grosso do Sul'];
  for (const location of [...allowed, ...denied]) {
    const result = await aggregateJobs({ query: normalizeQuery({ providers: ['remotive'] }),
      fetchImpl: async () => Response.json({ jobs: [{ ...row, candidate_required_location: location }] }) });
    assert.equal(result.jobs.length, Number(allowed.includes(location)), location);
  }
  for (const [location, expected] of [['Cuiaba - MT - Presencial', 1], ['Sinop - Hibrido', 1],
    ['Mato Grosso - Presencial', 1], ['Mato Grosso do Sul - Presencial', 0], ['Campo Grande MS - Hibrido', 0],
    ['Berlin - Presencial', 0], ['Cuiaba', 0], ['', 0]]) {
    const result = await aggregateJobs({ query: normalizeQuery({ providers: ['arbeitnow'], seniority: 'senior' }),
      fetchImpl: async () => Response.json({ data: [{ ...row, title: 'Designer', location, remote: false }] }) });
    assert.equal(result.jobs.length, expected, location);
  }
});
const specialties = [
  ['frontend', 'Front-end Developer', 'Desenvolvedor frontend'],
  ['backend', 'Backend Engineer', 'Desenvolvedora back-end'],
  ['fullstack', 'Full Stack Developer', 'Desenvolvedor fullstack'],
  ['mobile', 'Mobile Developer', 'Desenvolvedora Android'],
  ['qa', 'QA Engineer', 'Analista de testes'],
  ['devops', 'Site Reliability Engineer', 'Especialista DevOps'],
  ['cloud', 'Cloud Architect', 'Engenheira de nuvem'],
  ['data', 'Data Scientist', 'Analista de dados'],
  ['ai', 'Machine Learning Engineer', 'Especialista em inteligencia artificial'],
  ['security', 'Information Security Analyst', 'Analista de seguranca da informacao'],
  ['infrastructure', 'Network Administrator', 'Analista de redes'],
  ['support', 'IT Support', 'Suporte tecnico de informatica'],
  ['ux', 'UX Designer', 'Designer de produtos digitais'],
  ['management', 'IT Manager', 'Gerente de tecnologia'],
  ['software', 'Software Engineer', 'Desenvolvimento de software']
];
test('TI catalog matches PT/EN specialties with explicit and empty selection', async () => {
  assert.deepEqual(options().categories.map(c => c.id), specialties.map(([id]) => id));
  assert.equal(normalizeQuery({ categories: options().categories.map(c => c.id) }).categories.length, 15);
  for (const [category, ...titles] of specialties) {
    for (const title of titles) {
      for (const categories of [[category], []]) {
        const result = await aggregateJobs({ query: normalizeQuery({ categories, providers: ['remotive'] }),
          fetchImpl: async () => Response.json({ jobs: [{ ...row, title, description: '', tags: [] }] }) });
        assert.equal(result.jobs.length, 1, `${category}: ${title}`);
      }
    }
  }
});
test('empty or omitted selection rejects non-TI jobs and generic words', async () => {
  const titles = ['Sales Representative', 'Customer Support', 'Civil Engineer', 'Vigilante', 'Security Guard',
    'Advogado', 'Agronomo', 'Marketing', 'Business Developer', 'Professor', 'Enfermeiro', 'Designer grafico',
    'Suporte ao cliente', 'Gerente de loja', 'Auxiliar administrativo', 'Maintenance Engineer', 'Food Scientist'];
  for (const filter of [{}, { categories: [] }, { categories: options().categories.map(c => c.id) }]) {
    const result = await aggregateJobs({ query: normalizeQuery({ ...filter, providers: ['remotive'] }),
      fetchImpl: async () => Response.json({ jobs: titles.map((title, i) => ({ ...row, title,
        description: title, category: '', tags: [], company_name: 'Software Developer Inc', url: `https://example.com/${i}` })) }) });
    assert.deepEqual(result.jobs, []);
  }
  for (const id of ['technology', 'design', 'sales', 'agro', 'legal', 'other']) {
    assert.throws(() => normalizeQuery({ categories: [id] }), error => error.status === 400);
  }
});
test('specialty selection restricts results and honors description and tags', async () => {
  const result = await aggregateJobs({ query: normalizeQuery({ categories: ['backend'], providers: ['remotive'] }),
    fetchImpl: async () => Response.json({ jobs: [
      { ...row, title: 'Frontend Developer', description: '', url: 'https://example.com/front' },
      { ...row, title: 'Especialista', description: 'Desenvolvimento back-end', url: 'https://example.com/back' },
      { ...row, title: 'Especialista', description: '', tags: ['backend'], url: 'https://example.com/tag', company_name: 'Other' }
    ] }) });
  assert.deepEqual(result.jobs.map(job => job.url), ['https://example.com/back', 'https://example.com/tag']);
});
test('Arbeitnow pagination is bounded, cached and counts each request against budget', async () => {
  let calls = 0; let budgets = 0; const feeds = new Map();
  const args = { feeds, query: normalizeQuery({ providers: ['arbeitnow'] }), allowProvider: () => { budgets++; return true; },
    fetchImpl: async url => {
      const page = Number(new URL(url).searchParams.get('page') || 1);
      calls++;
      return Response.json({ data: [{ ...row, title: `Developer ${page}`, location: 'Brazil', remote: true, url: `https://example.com/${page}` }],
        links: { next: `https://www.arbeitnow.com/api/job-board-api?page=${page + 1}` } });
    } };
  const result = await aggregateJobs(args);
  assert.equal(result.jobs.length, 3);
  assert.equal(result.truncated, true);
  await aggregateJobs(args);
  assert.equal(calls, 3);
  assert.equal(budgets, 3);
});
test('pagination refuses foreign links and retains earlier pages on failure', async () => {
  for (const next of ['https://evil.example/?page=2', '?page=1', '?page=2&token=x', '?page=2']) {
    let calls = 0;
    const result = await aggregateJobs({ query: normalizeQuery({ providers: ['arbeitnow'] }), fetchImpl: async () => {
      if (++calls > 1) throw new Error('private failure');
      return Response.json({ data: [{ ...row, location: 'Brazil', remote: true }], links: { next } });
    } });
    assert.equal(calls, next === '?page=2' ? 2 : 1);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.truncated, true);
    assert.doesNotMatch(JSON.stringify(result), /private failure/);
  }
});
test('pagination ends cleanly and budget exhaustion preserves first page', async () => {
  for (const budget of [1, 4]) {
    let calls = 0; let attempts = 0;
    const result = await aggregateJobs({ query: normalizeQuery({ providers: ['arbeitnow'] }),
      allowProvider: () => ++attempts <= budget,
      fetchImpl: async (_url, request) => {
        assert.equal(request.redirect, 'error');
        calls++;
        return Response.json({ data: [], links: { next: calls === 1 ? '?page=2' : null } });
      } });
    assert.equal(calls, budget === 1 ? 1 : 2);
    assert.equal(result.truncated, budget === 1);
    if (budget === 1) assert.match(result.providers[0].message, /Paginacao incompleta/);
  }
});
test('Gemini results also pass geographic policy and receive selected categories', async () => {
  const result = await aggregateJobs({ apiKey: 'test', query: normalizeQuery({ providers: ['gemini'], categories: ['security'] }),
    gemini: async ({ query }) => {
      assert.deepEqual(query.categories, ['security']);
      return { jobs: ['Brazil - Remoto', 'US only - Remoto', 'Cuiaba MT - Presencial', 'Campo Grande MS - Presencial'].map((local, i) =>
        ({ titulo: 'Analista de seguranca da informacao', empresa: 'Example', descricao: '', local, url: `https://example.com/${i}` })) };
    } });
  assert.equal(result.jobs.length, 2);
});
test('empty selection applies TI filtering to Arbeitnow and Gemini too', async () => {
  for (const provider of ['arbeitnow', 'gemini']) {
    const titles = ['Sales Representative', 'Customer Support', 'Security Guard', 'Software Engineer'];
    const result = await aggregateJobs({ apiKey: 'test', query: normalizeQuery({ providers: [provider] }),
      fetchImpl: async () => Response.json({ data: titles.map((title, i) => ({ ...row, title, description: '',
        location: 'Brazil', remote: true, url: `https://example.com/${i}` })) }),
      gemini: async () => ({ jobs: titles.map((titulo, i) => ({ titulo, empresa: 'Example', descricao: '',
        local: 'Brazil - Remoto', url: `https://example.com/${i}` })) }) });
    assert.deepEqual(result.jobs.map(job => job.titulo), ['Software Engineer'], provider);
  }
});
test('HTTP options, normalized cache, distinct filters and bad JSON', async t => {
  let calls = 0;
  const base = await serve(t, { env: {}, search: async () => { calls++; return { jobs: [], providers: [], truncated: false }; } });
  assert.equal((await (await fetch(base + '/api/options')).json()).providers[2].enabled, false);
  for (const keywords of ['Java', ' java ', 'design']) assert.equal((await fetch(base + '/api/jobs', post({ keywords }))).status, 200);
  assert.equal(calls, 2);
  assert.equal((await fetch(base + '/api/jobs', post({ providers: ['bogus'] }))).status, 400);
  assert.equal((await fetch(base + '/api/jobs', { ...post({}), body: '{' })).status, 400);
  assert.equal((await fetch(base + '/api/jobs', post({ keywords: 'a'.repeat(5000) }))).status, 413);
});
test('global concurrent distinct queries capped; identical query single flight', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; }); let started = 0; let ready;
  const four = new Promise(resolve => { ready = resolve; });
  const base = await serve(t, { env: {}, search: async () => { if (++started === 4) ready(); await gate; return { jobs: [] }; } });
  const requests = Array.from({ length: 4 }, (_, i) => fetch(base + '/api/jobs', post({ keywords: String(i) })));
  await four;
  try { assert.equal((await fetch(base + '/api/jobs', post({ keywords: 'fifth' }))).status, 429); }
  finally { release(); }
  assert.equal((await Promise.all(requests)).every(r => r.status === 200), true);
});