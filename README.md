# Central Revenue

Portal interno da área Revenue: comunicados com prazo, repositório de materiais, links e princípios da equipe. O visual segue a referência Apollo com animações discretas, modo claro/escuro e layout responsivo.

## Estrutura

- `index.html` — página inicial.
- `area.html` — repositório da área.
- `app.js`, `styles.css` — interface e interações.
- `config.js` — ID público do cliente Google e URL da API.
- `functions/` — API para login, conteúdo e anexos privados no Google Cloud.
- GitHub Pages publica a raiz da branch `main`.

O repositório não contém a lista de e-mails liberados nem o conteúdo do portal. O site estático pode ser público; os dados e arquivos ficam no Firestore e em um bucket privado. A API exige login Google e valida a conta em cada chamada.

## Publicar a interface

O Pages está configurado para publicar a raiz da branch `main`. Endereço do portal:

`https://gabriel-loiola-jca.github.io/central-revenue/`

## Preparar o Google Cloud

O login usa o cliente OAuth Web já existente no app Consulta Revenue. O navegador recebe apenas o ID público do cliente; a API verifica a credencial assinada pelo Google e autoriza os mesmos e-mails configurados para o app de consulta.

1. No OAuth Client ID, adicione em **Origens JavaScript autorizadas** a origem exata `https://gabriel-loiola-jca.github.io` (somente protocolo e domínio, sem `/central-revenue/`). Para login GIS em janela popup não é necessário adicionar URI de redirecionamento.
2. Crie um banco Firestore em modo nativo e um bucket Cloud Storage na região `southamerica-east1`. No bucket, mantenha o acesso público bloqueado e o acesso uniforme ativado.
3. Crie os segredos `central-revenue-allowed-emails` e `central-revenue-admin-emails` no Secret Manager. O primeiro recebe os e-mails atualmente liberados no app de consulta; o segundo recebe os administradores. Use uma conta por linha ou uma lista separada por vírgulas. Não coloque essas listas em `config.js`, no Git ou em páginas públicas.
4. Dê à conta de serviço de execução da função os papéis `Cloud Datastore User`, `Storage Object Creator` e `Storage Object Viewer`; dê a ela também `Secret Manager Secret Accessor` para os dois segredos.
5. Implante `functions/` como função HTTP de 2ª geração, com entrada `main`, runtime Python 3.12 e região `southamerica-east1`. Configure:

   - `GOOGLE_CLIENT_ID`: o mesmo ID público já usado no `config.js`.
   - `UPLOAD_BUCKET`: nome do bucket privado.
   - `ALLOWED_ORIGINS`: `https://gabriel-loiola-jca.github.io,http://localhost:3000`.
   - `ALLOWED_EMAILS` e `ADMIN_EMAILS`: montados como variáveis de ambiente a partir dos segredos correspondentes.
   - A função precisa aceitar chamadas HTTP públicas para que o navegador consiga enviar a credencial Google; o próprio código exige token Google válido e aplica a lista de e-mails em cada rota.

Exemplo de implantação com `gcloud` (ajuste o projeto, o nome do bucket e a conta de serviço):

```powershell
gcloud config set project SEU_PROJETO
gcloud functions deploy central-revenue-api `
  --gen2 --runtime python312 --region southamerica-east1 `
  --source functions --entry-point main --trigger-http --allow-unauthenticated `
  --service-account CONTA_DE_SERVICO `
  --set-env-vars "GOOGLE_CLIENT_ID=612420902354-ie6tjol1igcruldt0i4ij3cv8vepn9ot.apps.googleusercontent.com,UPLOAD_BUCKET=SEU_BUCKET,ALLOWED_ORIGINS=https://gabriel-loiola-jca.github.io,http://localhost:3000" `
  --set-secrets "ALLOWED_EMAILS=central-revenue-allowed-emails:latest,ADMIN_EMAILS=central-revenue-admin-emails:latest"
```

Copie a URL HTTPS exibida pelo deploy para `apiBaseUrl` em `config.js`, sem acrescentar uma barra final. Faça commit e push; o workflow publica a configuração atualizada. Não adicione a URL a um arquivo de segredos: a URL da API não é uma credencial.

## Autenticação e publicação de conteúdo

O Google Identity Services fornece a credencial, mas a autorização acontece somente no servidor. `ALLOWED_EMAILS` define quem entra; `ADMIN_EMAILS` define quem pode publicar, editar, remover e enviar anexos. O código exige que todo administrador também conste na lista de acesso. Avisos vencidos deixam de ser retornados pela API. Anexos são limitados a 12 MB e ficam em bucket privado; o download é autenticado.

Enquanto a API não for implantada e a URL não estiver em `config.js`, a interface mostra o estado de configuração pendente. O site estático não publica nem guarda anexos por conta própria.
