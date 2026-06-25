# Backend Apps Script

1. Crie uma Google Sheet vazia.
2. Abra Extensoes > Apps Script.
3. Cole `Code.gs`.
4. Ajuste `CONFIG`:
   - `SPREADSHEET_ID`: ID da planilha, ou deixe vazio se o script estiver vinculado a ela.
   - `SETUP_KEY`: troque por uma chave forte.
   - `EVIDENCE_FOLDER_ID`: opcional; se vazio, o setup cria uma pasta no Drive.
5. Execute `setupManual` uma vez no editor, ou use a acao `setup` pelo frontend.
6. Publique como Web App.

