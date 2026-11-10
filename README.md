# Status do Samba

A página que diz se o Samba está funcionando: https://status.sambachat.app (enquanto o domínio não aponta para cá,
https://gstvgms.github.io/samba-status).

Fica fora do Railway de propósito: se o Samba cair, esta página continua no ar.

## Como funciona

- `.github/workflows/status.yml` roda a cada 5 minutos (o GitHub às vezes atrasa alguns minutos) e chama `check.mjs`.
- `check.mjs` confere quatro coisas, de fora, como o app faz:
  - **Site e app:** `/api/health`
  - **Mensagens e calls:** abre a ligação ao vivo e espera o "hello"
  - **Voz e live:** o servidor de voz
  - **Download e atualizações:** o `latest.yml`
- Uma falha é tentada de novo depois de 20 segundos antes de contar como queda.
- O histórico (90 dias por dia, 24 horas de checagens e as quedas) fica no branch `state`. É um commit só, trocado a
  cada rodada, para o repositório não crescer. A página publicada lê uma cópia em `data/state.json`.
- `public/` é a página (HTML, CSS e JS sem build), publicada pelo GitHub Pages via Actions.

## Escrever sobre uma queda

Edite `public/avisos.json` e faça push no `main` (a página atualiza na hora):

```json
[
  {
    "inicio": "2026-11-10T03:10:00-03:00",
    "fim": "2026-11-10T03:45:00-03:00",
    "titulo": "Calls não conectavam",
    "texto": "Explicação curta, para quem usa o Samba."
  }
]
```

Sem `fim`, a queda aparece como ainda aberta.

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
