# 💰 Controle Financeiro Pessoal

Aplicativo web para controlar receitas, despesas, contas, orçamento mensal, projeções e simular investimentos.
Feito com **HTML, CSS e JavaScript puro** — sem instalação, sem build. Abre direto no navegador e funciona no celular.

🔗 **Acesse online:** https://gleidson83.github.io/controle-financeiro-pessoal/

## Funcionalidades

- **Lançamentos**: data, descrição, categoria, **conta**, tipo, valor e opção "recorrente". Editar, excluir e filtrar por mês.
- **Categorias** de receitas e despesas (não deixa excluir categoria em uso).
- **Contas** (corrente, poupança, carteira, cartão de crédito, investimento) com saldo inicial, **saldo atual por conta e total**.
  - **Transferência entre contas**: move dinheiro sem contar como receita nem despesa (ex.: pagar a fatura do cartão).
  - Dados antigos (sem contas) são **migrados automaticamente** para a "Conta principal", sem perder nada. Uma cópia dos dados antigos fica guardada no navegador antes da migração.
- **Orçamento mensal** por categoria: previsto x realizado, diferença e % atingido (alerta a partir de 80%).
- **Projeções** do saldo em contas para 3, 6 ou 12 meses, pela média dos últimos 3 meses ou pelos lançamentos recorrentes.
- **Investimentos (simulador)**: valor inicial, aporte mensal, prazo em meses ou anos e até **3 cenários lado a lado**
  (Poupança, CDB/Tesouro Selic em % do CDI, Tesouro IPCA+, LCI/LCA, Fundos/ações conservador/moderado/otimista),
  com gráfico e tabela de total investido, juros, IR e valor líquido.
  > ⚠️ As taxas são **exemplos editáveis**, não taxas atuais. É uma **simulação educativa, não recomendação**. Regras de IR simplificadas.
- **Relatórios**: resumo do mês, total em contas, gastos por categoria e evolução de 6 meses (Chart.js).
- **Assistente (botão 💬)**:
  - **Modo local (padrão, sem chave)**: explica como usar cada aba e responde perguntas como
    "quanto gastei em alimentação este mês?", "qual meu saldo?", "estou dentro do orçamento?", "onde mais gastei?".
  - **Modo IA real (opcional)**: o usuário cola **a própria chave** da API da Anthropic na aba **Config**.
- **Backup**: exportar/importar JSON (a chave da API **não** entra no backup).

## Como rodar

1. Clone o repositório: `git clone https://github.com/gleidson83/controle-financeiro-pessoal.git`
2. Abra `index.html` no navegador. Pronto.

> Os gráficos usam Chart.js via CDN (precisa de internet). Sem internet, o resto funciona.

Testes dos cálculos (precisa do Node.js): `node testes.js`

## Estrutura

| Arquivo | O que faz |
|---|---|
| `index.html` | Estrutura da página (abas, formulários, tabelas, chat) |
| `style.css` | Visual e responsividade |
| `calc.js` | **Regras de negócio** sem tela: cálculos, contas, migração, simulador com IR, assistente local |
| `app.js` | Telas e eventos (render de cada aba, formulários, localStorage) |
| `assistente.js` | Chat: modo local e chamada opcional à API da Anthropic |
| `testes.js` | Testes automáticos dos cálculos |

## Como os cálculos funcionam

- **Diferença do orçamento** = previsto − realizado. **% atingido** = realizado ÷ previsto × 100.
- **Saldo da conta** = saldo inicial + receitas − despesas + transferências recebidas − transferências enviadas.
- **Saldo projetado** = saldo em contas no mês escolhido + (receitas − despesas estimadas) × meses.
- **Simulador**: taxa mensal = (1 + taxa anual)^(1/12) − 1; aporte no fim de cada mês.
  - CDB/Tesouro Selic e LCI/LCA: taxa = CDI × % do CDI. Tesouro IPCA+: (1 + IPCA) × (1 + juro real) − 1.
  - **IR regressivo** (renda fixa) sobre o ganho de **cada aporte**, pelo tempo aplicado: 22,5% (até 6 meses), 20% (até 12), 17,5% (até 24), 15% (acima).
  - Poupança e LCI/LCA: isentos. Fundos/ações: 15% sobre o ganho (simplificação; não considera come-cotas, isenções, taxas ou custos).

## Assistente com IA real (opcional) — segurança

- A chave **nunca** fica no código nem no repositório. Ela é colada pelo usuário na aba **Config** e salva **só no localStorage do navegador**, sem criptografia.
- Não use em computador compartilhado. Prefira chave com validade curta e limite de gastos; apague quando não precisar.
- A cada pergunta no modo IA, um **resumo** dos dados (totais do mês, categorias, orçamento e saldos — **sem descrições dos lançamentos**) é enviado para a API da Anthropic.
- Chamada direta do navegador para `POST https://api.anthropic.com/v1/messages` com os headers `Authorization: Bearer`, `anthropic-version: 2026-10-21`, `content-type` e `anthropic-dangerous-direct-browser-access: true` (conferidos na documentação oficial em nov/2026). Modelos: `claude-haiku-5-5` (padrão) ou `claude-sonnet-5-5`.
- Se a chave não estiver vinculada a um workspace, informe o ID do workspace na Config.
- Organizações com retenção zero de dados (ZDR) ou Compliance API não aceitam chamadas diretas do navegador (a API devolve erro 401 de CORS).

## Observações

- Os dados ficam **só no navegador** usado. Use **Exportar JSON** para guardar um backup.
- Projeções e simulações são estimativas simples (sem inflação, custos ou mudanças de regra).
