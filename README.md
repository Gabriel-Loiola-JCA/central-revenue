# Central Revenue

Portal interno publicado no GitHub Pages a partir da raiz da branch `main`. Esta versão usa Firebase Authentication com Google, Cloud Firestore para conteúdo, permissões e anexos de até 5 MB. O projeto Firebase deve ser exclusivo da Central Revenue.

## Configurar o projeto

1. No console do Firebase, registre um app Web no projeto da Central. Copie o objeto `firebaseConfig` para `firebase` em `config.js`. Esse objeto é público. Credenciais de serviço e a lista de membros ficam fora do repositório.
2. Em Authentication, ative o provedor Google e adicione `gabriel-loiola-jca.github.io` aos domínios autorizados.
3. Crie o banco Firestore padrão em modo de produção.
4. Publique as regras no projeto correto com `firebase deploy --only firestore:rules --project ID_DO_PROJETO_DA_CENTRAL`.
5. No Firestore, crie um documento em `centralMembers` para cada e-mail autorizado, usando o e-mail em minúsculas como ID. Defina o campo de texto `role` como `member` para leitura ou `admin` para edição. Reaproveite a lista de e-mails do Daily Room. Essa coleção não pode ser listada nem editada pelo site.
6. Teste com uma conta administradora, uma conta de leitura e uma conta que não está na lista. Publique a configuração Web na branch `main` para ativar a nova versão no GitHub Pages.

O Firestore da Central começa vazio. Caso existam conteúdos em outra base, importe apenas os registros e anexos da Central com acesso autorizado à origem.
