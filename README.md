# Status do Samba

A página que diz se o Samba está funcionando: https://status.sambachat.app (enquanto o domínio não aponta para cá,
https://gstvgms.github.io/samba-status).

Fica fora do Railway de propósito: se o Samba cair, esta página continua no ar.

## Como funciona

- `.github/workflows/status.yml` chama `check.mjs` a cada 5 minutos. O agendamento do GitHub roda só a cada poucas horas
  na prática (13/11/2026: 5 a 8 h entre rodadas), então cada execução fica 5 h 40 conferindo de 5 em 5 minutos e no fim
  começa a próxima sozinha. O agendamento de 30 min fica de reserva se essa corrente quebrar.
- `check.mjs` confere quatro coisas, de fora, como o app faz:
  - **Site e app:** `/api/health`
  - **Mensagens e calls:** abre a ligação ao vivo e espera o "hello"
  - **Voz e live:** o servidor de voz
  - **Download e atualizações:** o `latest.yml`
- Uma falha é tentada de novo depois de 20 segundos antes de contar como queda.
- O histórico (90 dias por dia, 24 horas de checagens e as quedas) fica no branch `state`. É um commit só, trocado a
  cada rodada, para o repositório não crescer. A página lê esse arquivo direto do branch (raw.githubusercontent.com),
  então uma checagem não precisa publicar o Pages; o Pages só é publicado num push no `main`.
- `public/` é a página (HTML, CSS e JS sem build), publicada pelo GitHub Pages via Actions.

## Escrever sobre uma queda, uma instabilidade ou uma manutenção

Edite `public/avisos.json` e faça push no `main`. A página atualiza em 1 ou 2 minutos.

```json
[
  {
    "tipo": "queda",
    "servicos": ["gateway"],
    "titulo": "Calls não conectavam",
    "texto": "Resumo opcional, para quem usa o Samba.",
    "inicio": "2026-11-10T03:10:00-03:00",
    "fim": "2026-11-10T03:45:00-03:00",
    "atualizacoes": [
      { "quando": "2026-11-10T03:15:00-03:00", "estado": "investigando", "texto": "Estamos vendo." },
      { "quando": "2026-11-10T03:45:00-03:00", "estado": "resolvido", "texto": "Voltou depois de um reinício." }
    ]
  }
]
```

- `tipo`:
  - `queda` (barra vermelha);
  - `parcial`: funcionando com instabilidade (barra ocre);
  - `manutencao` (barra azul). Com `inicio` no futuro, aparece em "Manutenção marcada" no topo.
- `servicos`: `site`, `gateway` (mensagens e calls), `voz`, `updates`. Sem ele, vale para todos.
- `fim`: sem ele, o aviso fica aberto e aparece no resumo do topo e na etiqueta do serviço.
- `estado` das atualizações: `investigando`, `identificado`, `monitorando`, `resolvido`, `agendada`, `andamento`, `concluida`. Aparecem da mais nova para a mais velha.
- Uma queda que a verificação automática viu e que já tem aviso escrito no mesmo horário e serviço aparece uma vez só, como o aviso.

## Domínio

1. Na Hostinger (DNS do `sambachat.app`), crie o registro CNAME `status` apontando para `gstvgms.github.io`.
2. Depois que ele responder, ligue o domínio no repositório:
   `gh api -X PUT repos/gstvgms/samba-status/pages -f cname=status.sambachat.app`.
3. Quando o certificado sair (alguns minutos), force o HTTPS:
   `gh api -X PUT repos/gstvgms/samba-status/pages -F https_enforced=true`.

Ligar o domínio antes do DNS faz o endereço do github.io redirecionar para um lugar que ainda não existe.

## Testar

```
node --test
node check.mjs /tmp/state.json
```
