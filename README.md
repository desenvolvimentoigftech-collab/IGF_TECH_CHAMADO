# Sistema de Chamados - GitHub Pages + Apps Script

Esta versao roda com:

- Frontend estatico no GitHub Pages.
- Backend em Google Apps Script Web App.
- Dados em Google Sheets.
- Evidencias/fotos no Google Drive, gravando na planilha apenas o link.

## Publicacao

1. Suba os arquivos desta pasta para um repositorio GitHub.
2. Ative GitHub Pages apontando para a branch/pasta publicada.
3. Crie uma planilha Google para os dados.
4. No Apps Script, cole o conteudo de `../apps-script/Code.gs`.
5. Ajuste `CONFIG` no Apps Script.
6. Rode a funcao `setup` pelo editor ou pela tela inicial usando a chave definida.
7. Publique como Web App:
   - Execute as: Me
   - Who has access: Anyone with the link
8. Abra o GitHub Pages e informe a URL do Web App.

## Migração futura

Os dados usam IDs UUID, timestamps ISO e abas normalizadas para facilitar exportacao para MySQL/PostgreSQL.
O backend tambem possui a acao administrativa `exportAll`, que retorna JSON com todas as abas.

## Limites práticos desta versao

- Cada foto enviada pelo frontend fica limitada a 4 MB para evitar estouro de payload do Apps Script.
- Para volume alto de usuarios simultaneos, migrar para VPS/PHP+MySQL ou outro backend dedicado.
- Para 50 equipamentos e uso moderado, Sheets + Drive deve atender como fase inicial.
