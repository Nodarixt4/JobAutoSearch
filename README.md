# JobAutoSearch

Mostruário pessoal de vagas em HTML, Tailwind CSS via CDN e JavaScript nativo. Sem instalação de dependências ou build. Nenhuma vaga de exemplo é apresentada como real.

## Configuração

1. Abra `index.html` e edite `CONFIG`: `endpoint` (URL completa do 9Router), `bearerToken` e `model` (identificador real aceito pelo seu gateway).
2. Esta implementação assume uma API compatível com **OpenAI Chat Completions**, usando POST, `messages`, `stream: false` e resposta em `choices[0].message.content`. Um array JSON direto também é aceito. Se sua instalação usar outro contrato, adapte a requisição e a extração da resposta.
3. Habilite busca web/navegação no provedor utilizado pelo 9Router. Se necessário, configure `providerOptions` com os parâmetros documentados por esse provedor. Não existe um parâmetro universal de busca para todos os modelos/gateways. O nome comercial do modelo não garante browsing; use o ID informado pela instalação.
4. Abra a página com um servidor estático local, por exemplo a extensão Live Server do VS Code. A abertura direta como arquivo pode ser bloqueada pelo CORS do gateway.
5. Clique em **Buscar oportunidades**. Cada clique solicita uma nova pesquisa e pode gerar custos no provedor. Os filtros operam localmente, sem novas chamadas.

## Prompt e contrato

O System Prompt completo está em `SYSTEM_PROMPT`, dentro de `index.html`, e já é enviado pela página. Solicita pesquisa em LinkedIn, Gupy, Catho, InfoJobs, sites locais e páginas oficiais, priorizando Cuiabá, Mato Grosso e trabalho totalmente remoto no Brasil.

A saída exigida é um array JSON. Cada objeto contém exatamente cinco strings não vazias: `titulo`, `empresa`, `local`, `descricao`, `url`. Sem Markdown ou explicações. Ausência de vagas verificáveis ou indisponibilidade de ferramentas deve resultar em `[]`.

O prompt orienta verificação das páginas e descarte de anúncios inacessíveis/encerrados. Isso não garante correção factual: a validação no navegador verifica o formato e URLs HTTP/HTTPS, não a existência nem a disponibilidade das vagas. Confira a fonte original. Uma lista vazia não permite distinguir ausência de vagas de ausência de browsing.

## Busca web e segurança

- Um prompt **não concede acesso à web**. A pesquisa só ocorre se o modelo/provedor tiver ferramentas disponíveis e executadas. Não foi implementado um executor de ferramentas no navegador. Respostas com `tool_calls` mostram uma mensagem orientando a configuração no servidor.
- O token no JavaScript fica visível para quem tiver acesso à página e aos scripts carregados. Use esta versão somente em ambiente pessoal/local com credencial limitada. Não publique nem faça commit de um token real. Para hospedagem pública, use um backend/proxy que guarde o segredo e autentique as requisições.
- Tailwind e fontes são carregados de terceiros e exigem internet. O CDN do Tailwind é adequado para protótipo; para publicação, gere o CSS e prefira assets locais.
- Configure o CORS do 9Router para a origem exata do servidor estático, método POST e cabeçalhos `Authorization` e `Content-Type`, incluindo preflight OPTIONS. Não use `no-cors`: a resposta ficaria ilegível para JavaScript.
- Uma página HTTPS pode bloquear um endpoint HTTP por conteúdo misto. Use origens compatíveis, HTTPS ou um proxy de mesma origem.
- A página usa `textContent` para dados externos, rejeita esquemas de URL não HTTP/HTTPS e abre links com `noopener noreferrer`. Não coleta dados pessoais nem envia candidaturas.

## Tratamento de erros

A interface trata configuração ausente, falha de conexão/CORS, erros HTTP, JSON inválido, formato incorreto, resposta truncada, chamadas de ferramentas não executadas e timeout de três minutos. Uma pesquisa que falha preserva os resultados anteriores. Não há repetição automática para evitar cobrança duplicada.

## Verificação manual

- Sem configurar as credenciais, clicar em buscar deve mostrar a orientação de configuração, sem chamar a API.
- Com um gateway de teste, retorne um array com os cinco campos para conferir cards e filtros (`Cidade/MT - Presencial`, `Cidade/MT - Híbrido`, `Remoto - Brasil`).
- Confira resposta vazia, JSON inválido, URL `javascript:`, HTTP 401/429 e timeout.
- Valide a tela em celular e desktop e a navegação por teclado.
- O teste real de pesquisa depende de um endpoint, credencial e modelo com browsing válidos; eles não acompanham o projeto.