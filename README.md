# 💰 Controle Financeiro Pessoal

Aplicativo web simples para controlar receitas, despesas, orçamento mensal e projeções de saldo.
Feito com **HTML, CSS e JavaScript puro** — sem instalação, sem build. Abre direto no navegador.

🔗 **Acesse online:** https://gleidson83.github.io/controle-financeiro-pessoal/

## Funcionalidades

- **Categorias** de receitas e despesas (criar e excluir; não deixa excluir categoria em uso).
- **Lançamentos**: data, descrição, categoria, tipo, valor e opção "recorrente". Editar, excluir e filtrar por mês.
- **Orçamento mensal** por categoria: previsto x realizado, diferença e % atingido (com barra de alerta a partir de 80%).
  Botão para copiar o orçamento do mês anterior.
- **Projeções** do saldo acumulado para os próximos 3, 6 ou 12 meses, por dois métodos:
  - *Média*: média de receitas e despesas dos últimos 3 meses (meses sem lançamento são ignorados);
  - *Recorrentes*: soma dos lançamentos marcados como recorrentes (cada item conta uma vez só).
- **Relatórios**: resumo do mês (receitas, despesas, saldo), gastos por categoria (gráfico de rosca + tabela) e evolução dos últimos 6 meses (Chart.js).
- **Persistência** no `localStorage` do navegador, com **exportar/importar JSON** e dados de exemplo para demonstração.
- Visual minimalista, responsivo (celular), em português e valores em R$.

## Como rodar

1. Baixe ou clone o repositório:
   ```bash
   git clone https://github.com/gleidson83/controle-financeiro-pessoal.git
   ```
2. Abra o arquivo `index.html` no navegador (duplo clique). Pronto.

> Os gráficos usam o Chart.js via CDN, então precisam de internet. Sem internet, o resto do app funciona.

Para testar os cálculos (opcional, precisa do Node.js):
```bash
node testes.js
```

## Estrutura

| Arquivo | O que faz |
|---|---|
| `index.html` | Estrutura da página (abas, formulários, tabelas, gráficos) |
| `style.css` | Visual e responsividade |
| `app.js` | Lógica: cálculos (`Calc`), dados (localStorage), telas e eventos |
| `testes.js` | Testes automáticos dos cálculos |

## Como os cálculos funcionam

- **Diferença** = previsto − realizado. Em despesas, positivo = sobrou; negativo = estourou.
- **% atingido** = realizado ÷ previsto × 100.
- **Saldo projetado** = saldo acumulado até o mês escolhido + (receitas − despesas estimadas) × número de meses.

## Observações

- Os dados ficam **só no navegador** usado. Trocar de navegador/computador ou limpar o cache apaga os dados — use **Exportar JSON** para guardar um backup.
- Projeção é uma estimativa simples, não considera inflação, juros ou gastos sazonais.
