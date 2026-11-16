/* Testes dos cálculos (rode com: node testes.js)
   Não precisa instalar nada: usa só o módulo "assert" do Node. */
const assert = require('assert');
const { Calc } = require('./app.js');

let ok = 0;
const teste = (nome, fn) => { fn(); ok++; console.log('OK -', nome); };

const cats = [
  { id: 'sal', nome: 'Salário', tipo: 'receita' },
  { id: 'ali', nome: 'Alimentação', tipo: 'despesa' },
  { id: 'mor', nome: 'Moradia', tipo: 'despesa' }
];
const tx = [
  { data: '2026-09-05', descricao: 'Salário', categoriaId: 'sal', tipo: 'receita', valor: 4000, recorrente: true },
  { data: '2026-09-10', descricao: 'Aluguel', categoriaId: 'mor', tipo: 'despesa', valor: 1000, recorrente: true },
  { data: '2026-09-12', descricao: 'Mercado', categoriaId: 'ali', tipo: 'despesa', valor: 500 },
  { data: '2026-10-05', descricao: 'Salário', categoriaId: 'sal', tipo: 'receita', valor: 4200, recorrente: true },
  { data: '2026-10-10', descricao: 'aluguel ', categoriaId: 'mor', tipo: 'despesa', valor: 1000, recorrente: true },
  { data: '2026-10-12', descricao: 'Mercado', categoriaId: 'ali', tipo: 'despesa', valor: 0.1 },
  { data: '2026-10-13', descricao: 'Mercado', categoriaId: 'ali', tipo: 'despesa', valor: 0.2 },
  { data: '2026-11-12', descricao: 'Mercado', categoriaId: 'ali', tipo: 'despesa', valor: 700 }
];

teste('somarMeses vira o ano', () => {
  assert.equal(Calc.somarMeses('2026-11', 2), '2027-01');
  assert.equal(Calc.somarMeses('2026-01', -1), '2025-12');
});

teste('resumo do mês (sem erro de centavos)', () => {
  assert.deepEqual(Calc.resumoMes(tx, '2026-09'), { receitas: 4000, despesas: 1500, saldo: 2500 });
  assert.deepEqual(Calc.resumoMes(tx, '2026-10'), { receitas: 4200, despesas: 1000.3, saldo: 3199.7 });
});

teste('previsto x realizado', () => {
  const r = Calc.previstoRealizado(cats, { sal: 4000, ali: 600 }, tx, '2026-09');
  const ali = r.find(x => x.categoriaId === 'ali');
  assert.deepEqual([ali.previsto, ali.realizado, ali.diferenca, ali.percentual], [600, 500, 100, 83.33]);
  const mor = r.find(x => x.categoriaId === 'mor'); // sem previsto -> % é null
  assert.deepEqual([mor.diferenca, mor.percentual], [-1000, null]);
  const estourou = Calc.previstoRealizado(cats, { ali: 500 }, tx, '2026-11').find(x => x.categoriaId === 'ali');
  assert.deepEqual([estourou.diferenca, estourou.percentual], [-200, 140]);
});

teste('média ignora meses vazios', () => {
  const m = Calc.mediaMensal(tx, '2026-11', 3);
  assert.deepEqual(m, { receitas: 2733.33, despesas: 1066.77, mesesUsados: 3 });
  assert.equal(Calc.mediaMensal(tx, '2026-09', 3).mesesUsados, 1);
});

teste('recorrentes não contam em dobro', () => {
  assert.deepEqual(Calc.recorrentesMensais(tx, '2026-11'), { receitas: 4200, despesas: 1000, saldo: 3200 });
});

teste('projeção por recorrentes', () => {
  const p = Calc.projecao(tx, '2026-11', 3, 'recorrente');
  assert.deepEqual(p.map(x => x.mes), ['2026-12', '2027-01', '2027-02']);
  assert.deepEqual(p.map(x => x.saldoAcumulado), [8199.7, 11399.7, 14599.7]);
});

teste('projeção por média', () => {
  const p = Calc.projecao(tx, '2026-11', 2, 'media');
  assert.equal(p[0].saldoMes, 1666.56);
  assert.deepEqual(p.map(x => x.saldoAcumulado), [6666.26, 8332.82]);
});

console.log(`\n${ok} testes passaram ✔`);
