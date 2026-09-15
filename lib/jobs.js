import { SearchError, safeUrl, searchJobs } from './search.js';

const definitions = [
  ['frontend', 'Front-end', 'front[ -]?end|desenvolvimento web|web developer'],
  ['backend', 'Back-end', 'back[ -]?end'],
  ['fullstack', 'Full stack', 'full[ -]?stack'],
  ['mobile', 'Desenvolvimento mobile', 'mobile developer|mobile engineer|desenvolv\\w* (?:mobile|android|ios)|android developer|ios developer|react native|flutter'],
  ['qa', 'QA e testes de software', 'qa engineer|qa analyst|software test(?:er|ing)|quality assurance engineer|analista de (?:qa|testes)|testes de software|automacao de testes'],
  ['devops', 'DevOps e SRE', 'devops|sre|site reliability'],
  ['cloud', 'Computacao em nuvem', 'cloud (?:engineer|architect|developer)|(?:engenheir[oa]|arquiteto|arquiteta) de (?:nuvem|cloud)|computacao em nuvem'],
  ['data', 'Dados e BI', 'data (?:engineer|analyst|scientist)|(?:engenharia|engenheir[oa]|analista|cientista|ciencia) de dados|business intelligence|analista de bi|database administrator|administrador de banco de dados|dba'],
  ['ai', 'Inteligencia artificial e ML', 'machine learning|deep learning|inteligencia artificial|artificial intelligence|(?:ai|ml) engineer'],
  ['security', 'Seguranca da informacao', 'cybersecurity|cyber security|information security|seguranca (?:da informacao|cibernetica)|ciberseguranca|pentest(?:er|ing)?|security engineer'],
  ['infrastructure', 'Infraestrutura de TI e redes', 'infraestrutura de ti|it infrastructure|network (?:engineer|administrator)|(?:administrador|analista) de (?:redes|sistemas)|systems? administrator|redes de computadores|sysadmin'],
  ['support', 'Suporte tecnico de TI', 'it support|technical support engineer|suporte (?:tecnico de (?:ti|informatica)|de ti|de informatica)|help[ -]?desk|service desk|tecnico de informatica'],
  ['ux', 'UX/UI e produtos digitais', 'ux|ui designer|ui design|user experience|user interface|design de interfaces|designer de produtos digitais'],
  ['management', 'Gestao de TI e produtos digitais', 'gestao de ti|(?:gerente|coordenador|coordenadora) de (?:ti|tecnologia)|it manager|software engineering manager|tech lead|lider tecnico de software|(?:product owner|product manager|scrum master) de (?:software|produtos digitais)|digital product manager'],
  ['software', 'Desenvolvimento de software', 'software (?:developer|engineer|development|architect)|(?:desenvolv\\w*|engenheir[oa]|engenharia|arquitet[oa]) de software|(?:desenvolvedor|desenvolvedora|programador|programadora)(?: (?:java|python|php|javascript|c#|c\\+\\+))?|analista de sistemas']
];
export const categories = definitions.map(([id, label]) => ({ id, label }));
export const fold = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function options(apiKey) {
  return { categories, providers: [
    { id: 'remotive', label: 'Remotive', enabled: true },
    { id: 'arbeitnow', label: 'Arbeitnow', enabled: true },
    { id: 'gemini', label: 'Gemini + Google Search', enabled: Boolean(apiKey) }
  ] };
}
export function normalizeQuery(body = {}) {
  const fail = () => { throw new SearchError('Filtros invalidos ou acima dos limites.', 400); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  if (Object.keys(body).some(key => !['categories', 'keywords', 'location', 'modality', 'seniority', 'providers'].includes(key))) fail();
  const text = (key, max) => {
    const value = body[key] ?? '';
    if (typeof value !== 'string' || value.length > max || /[\x00-\x1f]/.test(value)) fail();
    return fold(value);
  };
  const list = (key, allowed, fallback) => {
    const value = body[key] ?? fallback;
    if (!Array.isArray(value) || value.length > allowed.length || value.some(id => !allowed.includes(id))) fail();
    return [...new Set(value)].sort();
  };
  const query = {
    categories: list('categories', categories.map(c => c.id), []),
    keywords: text('keywords', 200), location: text('location', 120),
    modality: body.modality ?? 'all', seniority: body.seniority ?? 'all',
    providers: list('providers', ['remotive', 'arbeitnow', 'gemini'], ['remotive', 'arbeitnow'])
  };
  if (!['all', 'remote', 'hybrid', 'onsite'].includes(query.modality) ||
      !['all', 'intern', 'junior', 'mid', 'senior'].includes(query.seniority) || !query.providers.length) fail();
  return query;
}

export async function readJson(response, maxBytes = 8 * 1024 * 1024) {
  if (!response.ok) throw new SearchError('Provedor indisponivel.', 502);
  if (Number(response.headers?.get('content-length')) > maxBytes) throw new SearchError('Resposta do provedor excedeu o limite.');
  // Native fetch is streamed so an untrusted response cannot allocate an unlimited body.
  if (!response.body?.getReader) return response.json();
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new SearchError('Resposta do provedor excedeu o limite.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}
const plain = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function matches(item, query) {
  if (!eligibleLocation(item)) return false;
  const text = fold(`${item.job.titulo} ${item.job.descricao} ${item.tags}`);
  const selected = query.categories.length ? query.categories : categories.map(category => category.id);
  if (!selected.some(id => {
    const pattern = definitions.find(d => d[0] === id)[2];
    return new RegExp(`\\b(?:${pattern})(?=$|[^a-z0-9_])`).test(text);
  })) return false;
  if (query.keywords && !query.keywords.split(' ').every(word => fold(`${text} ${item.job.empresa}`).includes(word))) return false;
  if (query.location && !fold(item.job.local).includes(query.location)) return false;
  if (query.modality !== 'all' && item.modality !== query.modality) return false;
  const levels = {
    intern: /\b(intern(ship)?|estagio|estagiario|trainee)\b/,
    junior: /\b(junior|jr|entry.level)\b/, mid: /\b(mid|middle|pleno|intermediate)\b/,
    senior: /\b(senior|sr|lead|principal|staff)\b/
  };
  const known = Object.entries(levels).filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
  return query.seniority === 'all' || !known.length || known.includes(query.seniority);
}
function modality(text) {
  const value = fold(text);
  if (/hybrid|hibrid/.test(value)) return 'hybrid';
  if (/remote|remoto/.test(value)) return 'remote';
  if (/onsite|on-site|presencial/.test(value)) return 'onsite';
  return null;
}

// Location evidence must come from the location field, not company/description keywords.
function eligibleLocation(item) {
  const local = fold(item.job.local);
  if (/\b(ms|mato grosso do sul|campo grande|dourados|tres lagoas)\b/.test(local)) return false;
  if (item.modality === 'remote') {
    if (/\b(except|excluding|not eligible|not available|exceto|exclui|nao aceita)\b/.test(local)) return false;
    return /\b(brasil|brazil|latin america|latin american|america latina|latam|worldwide|world wide|anywhere|mundo todo|todo o mundo)\b/.test(local);
  }
  if (!['onsite', 'hybrid'].includes(item.modality)) return false;
  return /\b(mt|mato grosso|cuiaba|varzea grande|rondonopolis|sinop|sorriso|lucas do rio verde|tangara da serra|alta floresta|primavera do leste)\b/.test(local);
}

function nextPage(value, base, currentPage) {
  try {
    const next = new URL(value, base);
    const expected = new URL(base);
    if (next.origin !== expected.origin || next.pathname !== expected.pathname || next.username || next.password || next.hash) return null;
    if ([...next.searchParams.keys()].some(key => key !== 'page') || next.searchParams.getAll('page').length !== 1) return null;
    return next.searchParams.get('page') === String(currentPage + 1) ? next.href : null;
  } catch { return null; }
}
export async function aggregateJobs({ query = normalizeQuery(), apiKey, model, fetchImpl = fetch, gemini = searchJobs, allowProvider = () => true, feeds = new Map(), now = Date.now } = {}) {
  const available = options(apiKey).providers;
  const results = await Promise.allSettled(query.providers.map(async id => {
    const provider = available.find(p => p.id === id);
    if (!provider.enabled) return { disabled: true, items: [] };
    if (id === 'gemini') {
      if (!allowProvider(id)) throw new SearchError('Limite local do provedor; tente novamente em um minuto.', 429);
      const data = await gemini({ apiKey, model, fetchImpl, query });
      return { ...data, items: data.jobs.map(job => ({ job, tags: '', modality: modality(job.local) })) };
    }
    const url = id === 'remotive' ? 'https://remotive.com/api/remote-jobs' : 'https://www.arbeitnow.com/api/job-board-api';
    let entry = feeds.get(id);
    if (!entry || now() - entry.time >= 15 * 60000) {
      if (!allowProvider(id)) throw new SearchError('Limite local do provedor; tente novamente em um minuto.', 429);
      entry = { time: now(), promise: Promise.resolve().then(async () => {
        const signal = AbortSignal.timeout(15000);
        const rows = []; let endpoint = url; let truncated = false; let warning = '';
        for (let page = 1; page <= 3; page++) {
          try {
            if (page > 1 && !allowProvider(id)) throw new SearchError('Limite local de paginacao atingido.');
            const data = await readJson(await fetchImpl(endpoint, { signal, redirect: 'error', headers: { Accept: 'application/json' } }));
            const batch = id === 'remotive' ? data.jobs : data.data;
            if (!Array.isArray(batch)) throw new SearchError('Formato inesperado do provedor.');
            const remaining = 5000 - rows.length;
            rows.push(...batch.slice(0, remaining));
            truncated = batch.length > remaining || Boolean(id === 'arbeitnow' && data.links?.next);
            if (id === 'remotive' || !data.links?.next || rows.length >= 5000) break;
            endpoint = nextPage(data.links.next, url, page);
            if (!endpoint) break;
          } catch (error) {
            if (page === 1) throw error;
            truncated = true;
            warning = 'Paginacao incompleta por falha, timeout ou limite do provedor.';
            break;
          }
        }
        return { rows, truncated, warning };
      }).catch(error => { feeds.delete(id); throw error; }) };
      feeds.set(id, entry);
    }
    const data = await entry.promise;
    const rows = data.rows;
    if (!Array.isArray(rows)) throw new SearchError('Formato inesperado do provedor.');
    const items = rows.slice(0, 5000).flatMap(row => {
      if (!row || typeof row !== 'object') return [];
      const link = safeUrl(row.url);
      if (!link || !plain(row.title) || !plain(row.company_name)) return [];
      const remote = id === 'remotive' || row.remote === true;
      const local = plain(id === 'remotive' ? row.candidate_required_location : row.location) || 'Local nao informado';
      return [{ job: { titulo: plain(row.title).slice(0, 300), empresa: plain(row.company_name).slice(0, 300),
        local: `${local}${remote ? ' - Remoto' : ''}`.slice(0, 500), descricao: (plain(row.description) || 'Descricao nao informada').slice(0, 12000), url: link },
      tags: plain([row.category, ...(Array.isArray(row.tags) ? row.tags : []), ...(Array.isArray(row.job_types) ? row.job_types : [])].join(' ')),
      modality: modality(`${local} ${row.title}`) || (remote ? 'remote' : null) }];
    });
    return { items, truncated: data.truncated, warning: data.warning, sources: [{ title: provider.label, url }], searchEntryPoint: '' };
  }));
  const providers = []; const items = []; const sources = []; let searchEntryPoint = ''; let truncated = false; let successful = 0; let extra = {};
  results.forEach((result, index) => {
    const { id, label } = available.find(p => p.id === query.providers[index]);
    if (result.status === 'rejected') {
      providers.push({ id, label, status: 'error', count: 0, message: result.reason instanceof SearchError ? result.reason.message : 'Falha ou timeout ao consultar provedor.' });
      return;
    }
    const data = result.value;
    if (data.disabled) { providers.push({ id, label, status: 'disabled', count: 0, message: 'Configure GEMINI_API_KEY no servidor.' }); return; }
    successful++;
    const filtered = data.items.filter(item => matches(item, query));
    items.push(...filtered); sources.push(...(data.sources || []));
    truncated ||= Boolean(data.truncated);
    if (id === 'gemini') { searchEntryPoint = data.searchEntryPoint; extra = { researchText: data.researchText, groundingMetadata: data.groundingMetadata }; }
    providers.push({ id, label, status: 'ok', count: filtered.length, message: data.warning || 'Cobertura limitada: remoto explicitamente elegivel ao Brasil; presencial/hibrido somente MT. Local/modalidade desconhecidos excluidos; senioridade desconhecida mantida.' });
  });
  if (!successful) { const error = new SearchError('Nenhuma fonte selecionada respondeu com sucesso.', 503); error.providers = providers; throw error; }
  const seen = new Set(); const urls = new Set();
  const jobs = items.map(item => item.job).filter(job => {
    const key = fold(`${job.titulo}|${job.empresa}|${job.local}`);
    if (seen.has(key) || urls.has(job.url)) return false;
    seen.add(key); urls.add(job.url); return true;
  });
  return { ...extra, jobs: jobs.slice(0, 200), sources, searchEntryPoint, searchedAt: new Date().toISOString(), providers, truncated: truncated || jobs.length > 200 };
}