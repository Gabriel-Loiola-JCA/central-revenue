# Central Revenue

Portal interno da área Revenue, publicado no GitHub Pages. Reúne avisos com validade, links, arquivos, frases e referências em uma home e em um repositório pesquisável.

## Publicação

- Endereço: <https://gabriel-loiola-jca.github.io/central-revenue/>
- O GitHub Pages publica a raiz da branch `main`.
- `config.js` aponta para a API protegida do Daily Room; a lista de pessoas e os papéis vêm das variáveis `GOOGLE_ALLOWED_EMAILS` e `GOOGLE_ADMIN_EMAILS` que já existem lá.
- O conteúdo usa tabelas próprias `central_revenue_*` no D1 do Daily Room; anexos usam a mesma conta R2, em uma pasta `central-revenue/`. Nenhuma tabela nem arquivo do Daily Room é substituído.
- O cliente Google Identity Services permanece o mesmo. A autorização é validada no servidor a cada chamada. E-mails de `GOOGLE_ADMIN_EMAILS` podem publicar, editar, remover e enviar arquivos; as demais pessoas autorizadas podem consultar e baixar.

## Primeira publicação da API

O código da API compartilhada fica em `app/api/v1/[...segments]/route.ts` no repositório Revenue Daily Room. O schema é criado sem apagar dados existentes quando a rota inicia. Depois de publicar a atualização do Daily Room, a API atende a Central em `https://revenue-daily-room.gabrielmelokopi.chatgpt.site/api/v1/`.

No cliente OAuth Web existente, acrescente às **Origens JavaScript autorizadas** a origem abaixo (somente protocolo e domínio, sem caminho):

```text
https://gabriel-loiola-jca.github.io
```

Não crie um cliente OAuth novo e não adicione redirect URI; o login usa Google Identity Services. A configuração do Google precisa ser salva para que o botão de login do GitHub Pages seja autorizado.

## Pastas e arquivos

- `index.html` — home.
- `area.html` — repositório.
- `app.js`, `styles.css` — interface e interações.
- `config.js` — Client ID público e endereço da API (não contém segredos).
- `assets/` — logos Revenue fornecidos pelo usuário.
