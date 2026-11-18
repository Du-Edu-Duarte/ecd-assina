# ECD Assina

Assinatura digital de documentos pelo celular. Você envia um **Word ou PDF**, marca onde cada pessoa assina e quais dados entram sozinhos, e manda um link individual pelo WhatsApp. No final sai um **PDF assinado com página de verificação**.

**Demonstração:** https://du-edu-duarte.github.io/ecd-assina/

> Versão de demonstração com dados fictícios. Tudo fica salvo apenas no navegador de quem está usando.

## O que ele faz

- **Envia Word (.docx) ou PDF.** O Word é convertido em PDF dentro do próprio navegador, sem enviar o arquivo para nenhum servidor.
- **Campos automáticos com `{{ }}`.** Escreva no documento `{{nome}}`, `{{cpf}}`, `{{data}}`, `{{assinatura}}` ou qualquer outro campo, como `{{cargo}}`. O sistema encontra e cria o campo naquele lugar. Para a 2ª pessoa use `{{assinatura2}}`, `{{nome2}}`…
- **Arrastar e posicionar.** Adicione assinatura, nome, data, CPF, campo de texto ou texto fixo clicando no documento. Arraste para mover e redimensione pelo canto.
- **Várias pessoas, na ordem.** Cada pessoa tem uma cor, um link próprio e só assina quando chega a vez dela (opcional).
- **Link por WhatsApp.** Botão que já abre a conversa com a mensagem e o link.
- **Assinatura com o dedo.** Tela de assinatura em tela cheia no celular. Nome e data são preenchidos sozinhos.
- **PDF final com verificação.** Inclui as assinaturas no lugar certo e uma página final com código de verificação, data, hora e aparelho de cada assinatura, a impressão digital SHA-256 do original e o histórico.
- **Modelo de termo de ferramentas e EPIs.** Preencha colaborador, gestor e itens, e o termo é gerado já com os campos de assinatura. Depois da assinatura, registre a **devolução** de cada item (data e estado).
- **Acesso só para clientes.** O cadastro exige um **código de convite** gerado pelo administrador. O convite pode valer para um e-mail específico, ter prazo e número de usos, e ser enviado pelo WhatsApp. Também dá para bloquear o acesso de uma pessoa.
- **Cadastro e login por código.** A pessoa se cadastra com nome, setor e e-mail e entra com um código de 6 números enviado por e-mail, sem senha para decorar. Na demonstração, o e-mail aparece na própria tela.
- **Cadastro configurável por empresa.** O administrador inclui campos extras, como CPF, matrícula, cargo, telefone, data ou lista de opções, e define quais são obrigatórios. Também cadastra os setores, pode aceitar só e-mails do domínio da empresa e escolhe quem é administrador.
- **Painel.** Mostra documentos, pendentes, concluídos e ferramentas em uso, com filtros e busca.

## Tecnologias

| | |
| --- | --- |
| Interface | HTML, CSS e JavaScript puro (sem framework) |
| PDF | [pdf.js](https://mozilla.github.io/pdf.js/) para exibir e [pdf-lib](https://pdf-lib.js.org/) para gerar e assinar |
| Word | Leitura do .docx com [JSZip](https://stuk.github.io/jszip/) e conversão própria em páginas A4 |
| Dados | IndexedDB (no navegador) |
| Hospedagem | GitHub Pages |

## Estrutura

```
index.html   # estrutura da página
style.css    # visual (marca ECD Tecnologia)
app.js       # telas, conversão do Word, campos, assinatura e PDF final
vendor/      # pdf.js, pdf-lib e JSZip
```

## Rodar localmente

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

## Versão para empresas

Na demonstração, tudo fica no navegador: o código de acesso aparece na tela e o link de assinatura abre no mesmo aparelho. Na versão para empresas, contas e documentos ficam num servidor (por exemplo, Supabase). O código chega de verdade no e-mail, o link abre em qualquer celular e o gestor é avisado quando alguém assina.

Para testar sem cadastro, use **"Entrar na demonstração"**: você entra como administrador e pode abrir as **Configurações da empresa**.

## Autor

**Eduardo Costa Duarte** · [ECD Tecnologia](https://www.instagram.com/ecdtecnologia/) · [LinkedIn](https://www.linkedin.com/in/eduardo-costa-0a0b462a8)
