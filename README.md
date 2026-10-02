# secompp-game

 Para simular o ecossistema completo do evento, recomendo abrir o seu navegador e distribuir o ambiente da seguinte forma:

Para iniciar o sistema: rode `npm run dev`

## Aba 1: Jogador 1

1. Acesse http://localhost:5173
2. Coloque seu nome (ex: "Jogador A") e clique em "Criar Sala" (Privada).
3. Você será levado para a tela de espera. Note o código da sala de 4 dígitos (ex: VX9K) e o link compartilhável.

## Aba 2: O Telão do Evento

1. Acesse http://localhost:5173/featured (A tela de destaque).
2. Ele ficará na tela gigante dizendo "Aguardando partida em destaque...". Deixe ele aí aguardando.

## Aba 3: O Painel de Admin

1. Acesse http://localhost:5173/admin
2. Digite a senha que configuramos: secompp_admin e clique em Entrar.
3. Você verá a lista de partidas ao vivo. Encontre a partida do Jogador A e clique em "Destacar".
4. Olhe para a Aba do Telão (Aba 2): Ela instantaneamente se conectará a essa sala, mostrando a interface gigante
esperando o Oponente!

## Aba 4: Jogador 2 

1. Acesse http://localhost:5173
2. Coloque o nome (ex: "Jogador B"), cole o Código da Sala criado pelo Jogador A, e clique em "Entrar na Sala".
3. A partida vai começar. Ambas as abas dos jogadores mudarão para a arena.
4. Jogue alguns turnos.
5. Teste o Telão (Aba 2): Observe como o telão reage em tempo real aos ataques e defesas sem você precisar fazer refresh
em lugar nenhum.
6. Teste de Queda: Feche a Aba do Jogador 1 no meio de um turno de forma repentina. A aba do Jogador 2 mudará para a tela
azul de "Aguardando Reconexão". Abra uma nova aba, acesse a URL da partida novamente (ou preencha o código no Início), e
veja a partida sendo retomada extamente do mesmo milissegundo em que parou!

## Aba 5: Leaderboard

1. Deixe a partida de teste acabar. Um ganhará e o outro perderá (ou empatarão).
2. Acesse http://localhost:5173/leaderboard.
3. Veja os pontos e os Streaks devidamente persistidos através do banco de dados D1!
──────
O deploy será simplesmente executar npx wrangler deploy (backend) e enviar a pasta do frontend (npm run build) para o Cloudflare Pages.