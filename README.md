# JobAutoSearch

Radar pessoal de oportunidades de tecnologia em Cuiabá, Várzea Grande, Mato Grosso e trabalho 100% remoto no Brasil. Usa Gemini com Google Search para produzir sugestões acompanhadas de fontes. **Não são vagas verificadas de forma independente:** confirme requisitos, localização, legitimidade e disponibilidade no anúncio original.

O projeto não envia candidaturas, não contorna login ou CAPTCHA e não exige 9Router. A antiga execução com servidor estático Python não atende à arquitetura atual.

## Arquitetura

Um único serviço Node.js/Express serve a interface, o CSS compilado e a API na mesma origem:

- `index.html`: interface, filtros locais e apresentação de fontes.
- `server.js`: servidor, autenticação HTTP Basic opcional, limites, cache e API.
- `lib/search.js`: prompt, chamada ao Gemini com `google_search`, validação e deduplicação.
- `styles/input.css` e `tailwind.config.js`: entrada e configuração do Tailwind.
- `public/styles.css`: arquivo gerado por `npm run build`, servido em `/styles.css`.
- `.env.example`: nomes das variáveis, sem credenciais preenchidas.
- `render.yaml`: blueprint para um único Web Service no Render.

Não há banco de dados nem serviço de frontend separado. O CSS é compilado localmente, sem CDN do Tailwind; as fontes tipográficas são carregadas do Google Fonts.

## Execução local

### Pré-requisitos

- Node.js **22.x**, conforme `package.json`, e npm.
- Navegador atualizado e conexão com a internet.
- Para pesquisar: chave da Gemini API criada no [Google AI Studio](https://aistudio.google.com/apikey), projeto com acesso ao modelo e condições de uso/faturamento compatíveis com Google Search.

### Instalar e iniciar

Na primeira configuração:

```bash
cd /home/gabriel/Documentos/GitHub/JobAutoSearch
node --version
npm install
cp .env.example .env
```

Se `.env` já existir, preserve seu conteúdo em vez de executar a cópia novamente. Abra o arquivo localmente no editor e preencha `GEMINI_API_KEY`. **Nunca envie a chave no chat, coloque-a no HTML/JavaScript ou faça commit dela.**

Depois:

```bash
npm run build
npm start
```

Abra `http://localhost:3000` e clique em **Buscar oportunidades**. Encerre com `Ctrl+C`. Não abra o HTML diretamente nem use Live Server ou `python -m http.server`: a interface depende de `/api/jobs` no Express.

`npm start` carrega `.env`, se existir, pelo suporte nativo do Node. Variáveis já definidas no ambiente têm precedência. Reinicie o processo após mudar a configuração. Reexecute o build após alterações nas classes Tailwind ou nos estilos; o script de inicialização não compila CSS automaticamente.

**Lockfile para deploy:** `package-lock.json` acompanha o projeto. Versione-o junto de `package.json` ao atualizar dependências. O comando de build do Render usa `npm ci`, que exige um lockfile presente e sincronizado. Não versione `node_modules`, `.env` ou credenciais.

### Variáveis de ambiente

| Variável | Uso |
| --- | --- |
| `GEMINI_API_KEY` | Segredo obrigatório para realizar pesquisas. Configure em `.env` localmente ou em **Environment** no Render. |
| `GEMINI_MODEL` | Padrão: `gemini-3.6-flash`. Para trocar, use um identificador disponível no seu projeto e compatível com a ferramenta Google Search na Gemini API. |
| `PORT` | Padrão local: `3000`. No Render, deixe a plataforma fornecer a porta. O servidor escuta em `0.0.0.0`. |
| `APP_USERNAME` | Usuário da autenticação HTTP Basic. Deve ser configurado junto com `APP_PASSWORD`. |
| `APP_PASSWORD` | Senha da aplicação, distinta da chave Gemini. Use uma senha forte e exclusiva. |
| `NODE_ENV` | No Render, use `production`, como no blueprint. |

Sem usuário e senha, a aplicação fica **sem autenticação**. Com apenas um dos dois, o servidor recusa a inicialização. Recomenda-se configurar ambos, especialmente em qualquer publicação na internet. A rota `/healthz` é pública mesmo com autenticação habilitada.

O servidor pode iniciar e exibir a interface sem chave Gemini, mas uma pesquisa retorna erro `503`. Um health check bem-sucedido não valida a chave nem o acesso ao provedor.

## Publicação no Render

Nesta documentação, a referência a “blender” é interpretada como **Render**, a plataforma de hospedagem, não o aplicativo Blender.

Publique este repositório como **um único Web Service**, com frontend e backend juntos. Mesmo tratando-o como um monorepo, ambos são servidos pelo mesmo processo. Use a **raiz do repositório**; não selecione `lib` ou `styles` como diretório raiz e não crie um Static Site separado.

Antes do deploy, envie ao repositório remoto os arquivos da aplicação e o `package-lock.json` gerado por `npm install`, sem enviar `.env`.

### Opção A: Blueprint

1. No Render, escolha **New > Blueprint** e conecte o repositório e a branch desejada.
2. Use o `render.yaml` da raiz. Ele declara apenas um serviço, `job-auto-search`, com runtime Node.
3. Informe `GEMINI_API_KEY` no campo de configuração solicitado pelo Render (`sync: false`). Copie-a diretamente do AI Studio para o painel, nunca por chat ou commit.
4. Confirme a criação. O blueprint define `NODE_ENV=production`, `GEMINI_MODEL=gemini-3.6-flash` e `APP_USERNAME=admin`, além de gerar `APP_PASSWORD` automaticamente.
5. Abra o serviço criado e consulte **Environment** para recuperar o valor gerado de `APP_PASSWORD`. Guarde-o em um gerenciador de senhas. Essa senha não é a chave Gemini.
6. Acesse a URL HTTPS do serviço. No diálogo de autenticação do navegador, use o usuário **admin** e a senha recuperada no painel.

O blueprint solicita `plan: free`. Isso não garante disponibilidade permanente desse plano, ausência de suspensão por inatividade nem gratuidade da Gemini API. Confira as condições atuais de ambos os provedores.

### Opção B: Web Service manual

Em **New > Web Service**, conecte o mesmo repositório e configure:

| Campo | Valor |
| --- | --- |
| Runtime | Node |
| Root Directory | Deixe vazio para usar a raiz do repositório. |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| Instâncias | Uma instância, recomendada para os controles em memória atuais. |

O Tailwind é uma dependência de desenvolvimento; `--include=dev` garante sua instalação durante o build, mesmo com `NODE_ENV=production`. O requisito de Node 22.x está em `package.json`; confira a versão nos logs do build.

Em **Environment**, configure `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.6-flash` e `NODE_ENV=production`. **Recomenda-se definir também as duas variáveis `APP_USERNAME` e `APP_PASSWORD`**, usando um usuário escolhido por você e uma senha forte. A configuração manual não gera automaticamente a senha do blueprint.

Inicie o deploy e acompanhe os logs. Use a URL HTTPS fornecida pelo Render. Não configure CORS ou endpoint externo no HTML: o navegador chama a API na mesma origem. Para trocar segredos ou modelo, atualize **Environment** e aplique a alteração com reinicialização/redeploy.

## Pesquisa, fontes e limites de confiança

O prompt em `lib/search.js` usa um perfil fixo: Engenharia de Computação em formação, front-end na Infocorp UFMT, estágio em redes e infraestrutura na Aptum e suporte avançado. Prioriza front-end, redes, infraestrutura, suporte, DevOps e software júnior/pleno; orienta excluir liderança, sênior e híbrido fora de MT. Para personalizar esse perfil, altere o prompt no servidor e revise também os textos da interface.

Cada chamada solicita pesquisa no Google, com preferência por anúncios individuais recentes e até 8 sugestões. A resposta deve conter exatamente `titulo`, `empresa`, `local`, `descricao` e `url`, todos strings não vazias. O backend valida formato, limites de tamanho e URLs HTTP(S) sem credenciais embutidas. O raciocínio usa nível médio nos modelos Gemini 3, adequado ao planejamento de várias consultas e à filtragem dos resultados.

O backend exige resposta finalizada com `STOP` e consultas não vazias em `groundingMetadata.webSearchQueries` ou fontes web válidas em `groundingChunks`. Uma lista não vazia também exige fontes válidas. Se faltar grounding, realiza uma única nova tentativa com instrução reforçada de pesquisa, dentro do mesmo prazo total de 110 segundos. Essa tentativa pode gerar cobrança adicional e não garante que o modelo utilize a ferramenta. Os logs registram modelo e tentativa, sem chave ou conteúdo da resposta. **Ausência persistente de grounding, resposta interrompida, JSON inválido ou vagas sem fontes são erros, não uma pesquisa com zero resultados.**

As fontes são as referências de grounding retornadas pelo Gemini. Isso não comprova que cada cartão corresponde a uma fonte específica, que a página foi inspecionada integralmente ou que a candidatura continua aberta. A aplicação não realiza verificação independente dos anúncios. Consulte os links originais antes de compartilhar dados ou se candidatar.

### Sugestões do Google e iframe

Quando a resposta inclui `searchEntryPoint.renderedContent`, a interface apresenta esse HTML em um **iframe com sandbox**, separado dos cartões. O iframe não permite scripts nem acesso de mesma origem; permite pop-ups, inclusive fora do sandbox, para navegação nos links. Os demais dados externos são apresentados com `textContent`, e links de cartões/fontes usam `noopener noreferrer`.

Esse conteúdo representa as **Google Search suggestions** fornecidas pelo serviço. Antes de distribuir ou alterar a apresentação, confira os requisitos atuais de exibição, atribuição e uso na [documentação de grounding com Google Search](https://ai.google.dev/gemini-api/docs/google-search) e nos [termos da Gemini API](https://ai.google.dev/gemini-api/terms). O uso de sandbox não constitui certificação de conformidade com esses termos.

## Cache, concorrência e custos

- **Cache de 15 minutos:** resultados válidos, inclusive listas vazias, são compartilhados entre usuários do mesmo processo. Cliques nesse período reutilizam a resposta e exibem a data da pesquisa original; não forçam uma nova consulta ao Gemini.
- **Cooldown de 1 minuto:** contado a partir do início de uma nova tentativa. Se ela falhar e ainda não tiver passado um minuto, outra tentativa é recusada com `429` e `Retry-After`. Falhas não são armazenadas como resultados vazios.
- **Requisições simultâneas:** enquanto há uma pesquisa em andamento, chamadas concorrentes compartilham a mesma promessa, evitando chamadas duplicadas ao provedor dentro do processo.
- **Deduplicação de sugestões:** usa empresa, título e local, ignorando diferenças de maiúsculas/minúsculas. Não é uma comparação semântica; anúncios equivalentes com textos diferentes ainda podem aparecer.
- **Limite HTTP:** até 120 requisições por IP por minuto, incluindo acesso à interface e ao CSS, exceto `/healthz`. É independente das cotas Gemini.

Cache, pesquisa pendente, cooldown e contadores são **somente em memória**. Reinícios, deploys ou retomadas após suspensão perdem esse estado. Múltiplas instâncias não compartilham esses controles e podem gerar pesquisas e custos duplicados. Recomenda-se **uma única instância**; escalar com os mesmos limites exige armazenamento e coordenação compartilhados, ainda não implementados.

O modelo padrão é `gemini-2.5-flash`, mas disponibilidade, suporte a Search, região, quotas e cobrança dependem do projeto e das regras atuais do Google. Trocar `GEMINI_MODEL` não concede acesso automaticamente. Consulte [preços](https://ai.google.dev/gemini-api/docs/pricing), [limites](https://ai.google.dev/gemini-api/docs/rate-limits) e uso/faturamento do projeto. **Não há garantia de uso gratuito.** Cache e cooldown reduzem chamadas, mas não estabelecem um teto financeiro. Configure alertas e controles de quota disponíveis no provedor; alertas de orçamento não equivalem necessariamente a bloqueio de gastos.

## Segurança e migração da versão antiga

- Guarde `GEMINI_API_KEY` apenas no ambiente do servidor. A API usa a chave no cabeçalho `x-goog-api-key`; o navegador não precisa recebê-la.
- Use HTTPS e autenticação no ambiente publicado. HTTP Basic não criptografa credenciais por si só. Sem autenticação, terceiros podem acionar pesquisas e consumir sua quota.
- `/healthz` retorna apenas `{"status":"ok"}` e permanece público para o Render. As demais rotas passam pela autenticação, quando configurada.
- Não coloque senhas em URLs, screenshots, logs, issues ou conversas. O prompt contém o perfil descrito neste README e é enviado ao Google; revise-o antes de incluir dados pessoais adicionais.
- **Se a versão antiga continha um token no HTML, revogue-o no provedor e gere uma nova credencial.** Removê-lo do arquivo atual não elimina cópias no histórico Git, deploys antigos, forks ou caches. Revise o histórico e as publicações; se necessário, coordene a remoção do segredo do histórico com os colaboradores. Limpar o histórico não substitui a revogação.

O modelo de configuração `.env.example` está vazio quanto a segredos. Nenhuma chave utilizável é fornecida nesta documentação; não envie uma chave para solicitar suporte.

## Diagnóstico

| Sintoma | O que conferir |
| --- | --- |
| `npm ci` falha no Render | Gere e versione `package-lock.json` com `npm install`; mantenha-o sincronizado com `package.json`. |
| Tailwind não encontrado no build | Use exatamente `npm ci --include=dev && npm run build`. |
| Página sem os estilos esperados / `/styles.css` retorna 404 | Execute o build e confirme a geração de `public/styles.css`. |
| Servidor recusa iniciar | Configure `APP_USERNAME` e `APP_PASSWORD` juntos, ou deixe ambos ausentes/vazios apenas para uso sem proteção. |
| Navegador solicita login / HTTP 401 | Use as credenciais da aplicação; no blueprint, usuário `admin` e senha gerada em **Environment**. |
| HTTP 503 ao pesquisar | Configure `GEMINI_API_KEY` no servidor e reinicie/republique. |
| Mensagem sobre modelo ou Google Search | Confira `GEMINI_MODEL`, acesso do projeto e compatibilidade com `google_search`. |
| Mensagem de acesso negado pelo Gemini | Confira chave, projeto, região e faturamento. Não divulgue a chave ao investigar. |
| HTTP 429 | Leia a mensagem: pode ser limite HTTP, cooldown local ou quota do Gemini. Aguarde o intervalo indicado ou revise quotas/faturamento. |
| Erro de grounding, fontes ou formato | A resposta não atende ao contrato. Não interprete a falha como ausência de oportunidades. |
| Timeout / HTTP 504 | A chamada ao Gemini tem limite de 110 segundos; o navegador aguarda até 125 segundos. Verifique rede/provedor e tente depois. |
| HTTP 415 ou 403 ao chamar a API | `POST /api/jobs` exige `Content-Type: application/json` e rejeita requisições marcadas pelo navegador como `cross-site`. |

A interface mantém os resultados e as fontes anteriores quando uma atualização falha. Não há repetição automática no navegador; o servidor repete apenas uma resposta sem grounding, no máximo uma vez. O botão desabilitado durante a pesquisa evita cliques repetidos na mesma página, mas não substitui os controles do servidor.

## Verificação após configurar

Os passos a seguir são um roteiro manual, **não uma declaração de testes executados**. Não foi realizada pesquisa real com uma chave Gemini para validar esta documentação.

1. Confira Node 22.x, instalação e build; inicie a aplicação.
2. Acesse `/healthz` e confirme o JSON de saúde. Essa rota não chama o Gemini.
3. Confira layout e filtros no desktop e no celular, além da navegação por teclado.
4. Com autenticação configurada, confirme o desafio de login em uma janela privada e o acesso público apenas ao health check.
5. Com sua própria chave configurada de forma privada, realize uma busca sabendo que ela pode ser cobrada. Confira sugestões, fontes, links e horário; não trate os cartões como anúncios verificados.
6. Repita dentro de 15 minutos e confira a indicação de cache. Os filtros locais não geram chamadas ao provedor.
7. Em ambiente de teste, confira tratamento de chave ausente, resposta inválida, falta de grounding, lista vazia válida e falha após resultados anteriores.

Execute `npm test` para rodar os testes em `test/app.test.js`. Eles usam respostas simuladas, sem chave nem custos: validam grounding, deduplicação, URLs inseguras, requisição ao provedor, cache, autenticação, arquivos privados e erros. Esses testes não comprovam disponibilidade do modelo ou funcionamento da integração real na sua conta.