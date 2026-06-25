# Sistema de Chamados IGF Tech

Interface web para abertura, atendimento e rastreabilidade de chamados tecnicos.

## Recursos

- Login por perfil de usuario.
- Separacao por empresa.
- Cadastro de empresas, usuarios, falhas e locais.
- Abertura de chamados com numero de serie, falha, local, descricao e evidencias.
- Atendimento com status, responsavel, comentarios e historico.
- Status paliativo com motivo, plano de conclusao e prazo obrigatorios.
- Painel com indicadores, Pareto de falhas e ocorrencias por periodo.

## Operacao

A estrutura de dados deve ser preparada pelo administrador tecnico antes do primeiro uso.
Depois disso, os usuarios acessam apenas a tela de login e os modulos permitidos pelo perfil.

## Migracao futura

Os registros usam identificadores estaveis e datas em formato padronizado para facilitar exportacao e migracao futura.
