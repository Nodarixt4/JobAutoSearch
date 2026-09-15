# JobAutoSearch

Agregador de oportunidades exclusivamente de TI com Node.js/Express. Remotive e Arbeitnow funcionam sem chave; Gemini com Google Search e opcional. Nao envia candidaturas nem contorna login ou CAPTCHA. Confirme disponibilidade e legitimidade no anuncio original.

## Execucao

Requer Node 22.x e npm. Instale com `npm install`, compile CSS com `npm run build` e inicie com `npm start`. Abra http://localhost:3000. `npm test` executa testes com mocks, sem Gemini real ou credenciais. Nao use Live Server: a interface depende do backend na mesma origem.

`npm start` carrega `.env` se existir. Variaveis do ambiente prevalecem. Nunca publique `.env` ou chaves. Variaveis opcionais:

| Variavel | Descricao |
| --- | --- |
| GEMINI_API_KEY | Habilita Gemini, exclusivamente no servidor; nao e necessario para APIs publicas. |
| GEMINI_MODEL | Padrao gemini-3.6-flash; disponibilidade e Google Search dependem da conta. |
| PORT | Padrao 3000, escuta em 0.0.0.0. |
| APP_USERNAME / APP_PASSWORD | HTTP Basic opcional; configure ambos ou nenhum. Use HTTPS. |
| NODE_ENV | production no deploy. |

No Render, use um Web Service na raiz, build `npm ci --include=dev && npm run build`, inicio `npm start`, health check `/healthz`. `npm ci` exige lockfile sincronizado. O blueprint existente pode solicitar Gemini mesmo sendo agora opcional no backend; para operar sem chave, use configuracao manual. Recomenda-se autenticar qualquer deploy publico e usar uma unica instancia.

## Contrato HTTP

`GET /api/options` retorna `{categories:[{id,label}], providers:[{id,label,enabled}]}`. IDs de categorias TI: frontend, backend, fullstack, mobile, qa, devops, cloud, data, ai, security, infrastructure, support, ux, management, software. Software cobre desenvolvimento generico; support significa suporte tecnico de TI e security significa seguranca da informacao, nunca atendimento generico ou seguranca patrimonial. Provedores: remotive, arbeitnow, gemini. Gemini sem chave aparece desabilitado; presenca de chave nao comprova acesso ou quota.

`POST /api/jobs` exige Content-Type application/json. Corpo opcional `{}` e compativel:

| Campo | Valores e limites | Padrao |
| --- | --- | --- |
| categories | Array de IDs de /api/options, ate 15 entradas | [] (todas as especialidades TI) |
| keywords | String livre, ate 200 caracteres | vazio |
| location | String livre opcional, ate 120 caracteres | vazio |
| modality | all, remote, hybrid, onsite | all |
| seniority | all, intern, junior, mid, senior | all |
| providers | Array nao vazio de IDs, ate 3 entradas | arbeitnow + remotive |

Valores desconhecidos, tipos invalidos, caracteres de controle e campos extras retornam 400. JSON invalido retorna 400, corpo acima de 4 KB retorna 413, Content-Type incorreto retorna 415, requisicao marcada cross-site retorna 403. Arrays sao ordenados/deduplicados e textos normalizados por caixa, acentos e espacos para cache e pesquisa.

Resposta: `jobs` (ate 200), `sources:[{title,url}]`, `searchEntryPoint` (string HTML ou vazia), `searchedAt` (ISO), `cached` (boolean), `providers:[{id,label,status,count,message}]`, `truncated` (boolean). Cada job tem **exatamente** cinco strings: titulo, empresa, local, descricao, url. Nao ha chave de API na resposta.

`providers` descreve as fontes selecionadas; status e ok, error ou disabled. Count e o numero de correspondencias antes da deduplicacao global e do corte em 200. Mensagens trazem avisos. Sucesso vazio e valido. Falha parcial retorna 200 com avisos; nenhuma fonte selecionada bem-sucedida retorna 503 com error e providers. Fontes desabilitadas nao fazem chamadas. `truncated` indica corte local ou paginacao incompleta do Arbeitnow, nao garante cobertura completa quando false.

Gemini preserva ainda researchText e groundingMetadata originais; os indices de grounding referem-se ao texto original, nao aos cartoes. Fontes publicas incluem o endpoint de origem; URLs individuais ficam nos jobs. Sugestoes Google em searchEntryPoint precisam ser exibidas conforme termos do provedor, em iframe sandbox; nunca injete HTML externo no documento principal.

## Filtros e limitacoes

- Categorias combinam com OR e padroes especificos PT/EN no titulo, descricao e tags. Selecao vazia ou omitida aplica todo o catalogo TI, nunca vagas generalistas. IDs antigos removidos retornam 400. Palavras isoladas como sales, support e engineer nao qualificam uma vaga como TI. Termos livres combinam com AND por palavra (substrings) em titulo, descricao, tags e empresa; nao executam expressoes ou instrucoes nem ampliam o catalogo. A classificacao textual pode gerar falsos positivos por mencoes incidentais a TI na descricao e falsos negativos por nomenclaturas nao reconhecidas; nao ha garantia semantica.
- Politica geografica obrigatoria inclusive com `{}`: remoto exige Brasil/Brazil, America Latina/Latin America/LATAM ou alcance mundial explicito no campo local. Apenas remoto nao basta. Presencial/hibrido exige MT/Mato Grosso ou cidade reconhecida: Cuiaba, Varzea Grande, Rondonopolis, Sinop, Sorriso, Lucas do Rio Verde, Tangara da Serra, Alta Floresta, Primavera do Leste. MS/Mato Grosso do Sul, Campo Grande, Dourados e Tres Lagoas sao excluidos. O filtro local adicional restringe por substring normalizada, nunca amplia essa politica.
- Remotive e remoto. Arbeitnow remote=false **nao** prova presencial: exige modalidade explicita no local/titulo. Local/modalidade desconhecidos sao excluidos; senioridade desconhecida permanece. Descricao nao comprova localidade nem modalidade. Nao ha geocodificacao, verificacao de visto ou garantia legal de elegibilidade. Inferencias textuais e lista conservadora de cidades podem causar falsos positivos/negativos; confira restricoes no anuncio original.
- Remotive usa https://remotive.com/api/remote-jobs ([documentacao](https://github.com/remotive-com/remote-jobs-api)). Arbeitnow usa https://www.arbeitnow.com/api/job-board-api ([documentacao](https://www.arbeitnow.com/blog/job-board-api)). Sao feeds internacionais com forte foco remoto/Europa, nao uma cobertura exaustiva de vagas brasileiras. Vagas remotas podem restringir pais ou fuso.
- Arbeitnow consulta ate tres paginas sequenciais: mesma origem/caminho e somente parametro page consecutivo. Cada pagina consome o limite local; prazo compartilhado de 15 segundos, ate 8 MB por pagina e 5000 registros totais. Falha posterior preserva paginas anteriores com aviso e truncated=true; esse feed parcial fica no cache por 15 minutos. Remotive usa o feed existente sem paginacao nao verificada. Registros sem titulo, empresa ou URL HTTP(S) segura sao descartados. HTML da descricao e removido. Descricoes limitadas a 12000 caracteres; titulo/empresa a 300 e local a 500. Deduplicacao por URL ou titulo/empresa/local normalizados; nao e semantica. Ordem segue provedores e feeds, sem ranking global.
- Gemini recebe filtros, sem perfil pessoal fixo. Pesquisa com google_search e extracao separada, ate 40 anuncios. Exige STOP, evidencia de grounding e URLs presentes nas fontes originais. No maximo duas pesquisas (retry apenas por grounding ausente) e uma extracao, prazo total 110 segundos; resposta ate 2 MB. Grounding nao comprova todos os campos nem candidatura aberta. Nao ha fallback silencioso de modelo. Sem teste real de Gemini nesta implementacao.
- APIs publicas tem timeout de 15 segundos por feed, corpo ate 8 MB e validacao de schema. Chamadas independentes usam allSettled, preservando sucesso parcial. Respostas publicas podem estar atrasadas; confira termos, atribuicao e limites de cada servico antes de redistribuir.

## Cache, seguranca e custos

Gemini recebe os IDs e nomes das categorias selecionadas (todo o catalogo TI quando vazias) e a politica Brasil/MT na pesquisa; pesquisa e extracao exigem exclusivamente TI. A extracao recebe novamente filtros e politica. O backend filtra tambem seus resultados. Seu limite individual continua em 40 anuncios/8192 tokens, independente do teto agregado de 200. Nenhuma API externa nova foi adicionada ou validada ao vivo.

Cache por consulta normalizada: 15 minutos, ate 100 entradas, expulsao da mais antiga. Mesma chave em andamento compartilha promessa. Falhas totais e respostas parciais com erro nao entram no cache de consultas. Feeds publicos tem cache/promessa separado por provedor por 15 minutos (no maximo dois feeds), permitindo mudar filtros sem repetir downloads ou impor cooldown global. Dados podem ter a idade desse cache; searchedAt indica agregacao, nao publicacao/verificacao da vaga.

Ate quatro consultas distintas simultaneas; excedente recebe 429 e Retry-After. Limite por IP: 120 requisicoes/minuto geral e 30 pesquisas/minuto. Por provedor: ate quatro downloads/minuto por API publica, duas pesquisas Gemini/minuto; chamadas internas de retry/extracao cabem nessa pesquisa, mas podem aumentar custo. Limites de provedor aparecem em providers como erro, com instrução de aguardar um minuto. Cache nao constitui teto financeiro; configure quotas e controles na conta Google. Cache e contadores sao por processo e reiniciam no deploy; varias instancias exigem coordenacao externa.

Chaves Gemini ficam em cabecalho x-goog-api-key no servidor, nunca no HTML, URL ou logs. API nao serve arquivos do projeto: somente index.html e CSS explicitos. Health check publico nao valida provedores. Se alguma versao antiga expôs segredos, revogue-os; remover do arquivo nao remove historico.

## Arquivos e testes

`lib/jobs.js`: contrato, filtros, adaptadores, agregacao e feeds. `lib/search.js`: Gemini e grounding. `server.js`: HTTP, autenticacao e controles. `test/app.test.js` e `test/jobs.test.js`: mocks de grounding, schemas, falhas parciais, validacao, filtros, limites, cache, concorrencia e seguranca HTTP, incluindo as 15 especialidades PT/EN e rejeicao de areas alheias a TI. Testes nao garantem disponibilidade externa. Frontend explica a selecao vazia e mantem descricoes dos cartoes limitadas a 300 caracteres. Cliente que envia {} continua funcionando, agora restrito ao catalogo TI; deve consumir /api/options e os avisos para expor o contrato completo.