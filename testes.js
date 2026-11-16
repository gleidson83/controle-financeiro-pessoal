/* Testes dos cálculos (rode com: node testes.js)
   Não precisa instalar nada: usa só o módulo "assert" do Node. */
const assert = require('assert');
const { Calc, Invest, Assistente, migrarEstado } = require('./calc.js');

let ok = 0;
const teste = (nome, fn) => { fn(); ok++; console.log('OK -', nome); };
const so = txt => txt.replace(/\s/g, ' '); // troca espaço especial do R$ por espaço comum

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

/* ===== Lançamentos, orçamento e projeção ===== */
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
  const mor = r.find(x => x.categoriaId === 'mor');
  assert.deepEqual([mor.diferenca, mor.percentual], [-1000, null]);
  const estourou = Calc.previstoRealizado(cats, { ali: 500 }, tx, '2026-11').find(x => x.categoriaId === 'ali');
  assert.deepEqual([estourou.diferenca, estourou.percentual], [-200, 140]);
});

teste('média ignora meses vazios', () => {
  assert.deepEqual(Calc.mediaMensal(tx, '2026-11', 3), { receitas: 2733.33, despesas: 1066.77, mesesUsados: 3 });
  assert.equal(Calc.mediaMensal(tx, '2026-09', 3).mesesUsados, 1);
});

teste('recorrentes não contam em dobro', () => {
  assert.deepEqual(Calc.recorrentesMensais(tx, '2026-11'), { receitas: 4200, despesas: 1000, saldo: 3200 });
});

teste('projeção por recorrentes (sem e com saldo inicial)', () => {
  const p = Calc.projecao(tx, '2026-11', 3, 'recorrente');
  assert.deepEqual(p.map(x => x.mes), ['2026-12', '2027-01', '2027-02']);
  assert.deepEqual(p.map(x => x.saldoAcumulado), [8199.7, 11399.7, 14599.7]);
  const comBase = Calc.projecao(tx, '2026-11', 1, 'recorrente', 1000);
  assert.equal(comBase[0].saldoAcumulado, 9199.7);
});

teste('projeção por média', () => {
  const p = Calc.projecao(tx, '2026-11', 2, 'media');
  assert.equal(p[0].saldoMes, 1666.56);
  assert.deepEqual(p.map(x => x.saldoAcumulado), [6666.26, 8332.82]);
});

/* ===== Migração de dados antigos ===== */
teste('migração: dados antigos vão para a conta padrão sem perder nada', () => {
  const antigo = { categorias: cats, transacoes: tx.map(t => ({ ...t })), orcamentos: { '2026-09': { ali: 600 } } };
  const novo = migrarEstado(antigo);
  assert.equal(novo.versao, 2);
  assert.equal(novo.contas.length, 1);
  assert.equal(novo.transacoes.length, tx.length);
  assert.ok(novo.transacoes.every(t => t.contaId === novo.contas[0].id));
  assert.deepEqual(novo.orcamentos, antigo.orcamentos);
  assert.deepEqual(novo.transferencias, []);
  assert.equal(antigo.contas, undefined); // o original não foi alterado
  // rodar de novo não muda nada (migração é idempotente)
  assert.deepEqual(migrarEstado(novo), novo);
});

/* ===== Contas e transferências ===== */
const estado = migrarEstado({
  categorias: cats,
  orcamentos: { '2026-11': { ali: 500, mor: 1500 } },
  contas: [
    { id: 'cc', nome: 'Conta corrente', tipo: 'corrente', saldoInicial: 1000 },
    { id: 'cart', nome: 'Carteira', tipo: 'carteira', saldoInicial: 50 },
    { id: 'cred', nome: 'Cartão', tipo: 'cartao', saldoInicial: 0 }
  ],
  transacoes: [
    { data: '2026-11-05', descricao: 'Salário', categoriaId: 'sal', tipo: 'receita', valor: 3000, contaId: 'cc' },
    { data: '2026-11-08', descricao: 'Feira', categoriaId: 'ali', tipo: 'despesa', valor: 120, contaId: 'cart' },
    { data: '2026-11-09', descricao: 'Restaurante', categoriaId: 'ali', tipo: 'despesa', valor: 400, contaId: 'cred' },
    { data: '2026-12-01', descricao: 'Aluguel', categoriaId: 'mor', tipo: 'despesa', valor: 1000, contaId: 'cc' }
  ],
  transferencias: [
    { id: 't1', data: '2026-11-10', origemId: 'cc', destinoId: 'cart', valor: 200, descricao: 'Saque' },
    { id: 't2', data: '2026-11-20', origemId: 'cc', destinoId: 'cred', valor: 400, descricao: 'Fatura' }
  ]
});

teste('saldo por conta e total', () => {
  // corrente: 1000 + 3000 - 200 - 400 = 3400 (até nov); carteira: 50 - 120 + 200 = 130; cartão: -400 + 400 = 0
  const { lista, total } = Calc.saldosContas(estado, '2026-11');
  assert.deepEqual(lista.map(c => c.saldo), [3400, 130, 0]);
  assert.equal(total, 3530);
  assert.equal(Calc.saldoConta(estado, 'cc'), 2400); // sem limite de mês inclui o aluguel de dezembro
});

teste('transferência não conta como receita nem despesa', () => {
  assert.deepEqual(Calc.resumoMes(estado.transacoes, '2026-11'), { receitas: 3000, despesas: 520, saldo: 2480 });
  // total das contas = saldos iniciais + saldo dos lançamentos (transferências se anulam)
  assert.equal(Calc.saldosContas(estado, '2026-11').total, Calc.saldoInicialTotal(estado) + 2480);
});

teste('validação de transferência', () => {
  const base = { data: '2026-11-01', origemId: 'cc', destinoId: 'cart', valor: 10 };
  assert.equal(Calc.validarTransferencia(estado, base), null);
  assert.ok(Calc.validarTransferencia(estado, { ...base, destinoId: 'cc' }));
  assert.ok(Calc.validarTransferencia(estado, { ...base, valor: 0 }));
  assert.ok(Calc.validarTransferencia(estado, { ...base, origemId: 'nao-existe' }));
  assert.equal(Calc.contaEmUso(estado, 'cred'), true);
});

/* ===== Simulador de investimentos ===== */
teste('IR regressivo: limites das faixas', () => {
  assert.deepEqual([6, 7, 12, 13, 24, 25].map(Invest.aliquotaRegressiva), [22.5, 20, 20, 17.5, 17.5, 15]);
});

teste('taxas: % do CDI e IPCA+', () => {
  assert.equal(Invest.taxaAnual('cdi', { cdi: 10, pctCdi: 110 }), 11);
  assert.equal(Invest.taxaAnual('lci', { cdi: 10, pctCdi: 90 }), 9);
  assert.equal(Invest.taxaAnual('ipca', { ipca: 4, jurosReal: 6 }), 10.24);
  assert.equal(Invest.taxaAnual('acoes', { cenario: 'otimista', conservador: 6, moderado: 10, otimista: 14 }), 14);
});

teste('poupança isenta: 12% a.a. por 12 meses', () => {
  const s = Invest.simular({ valorInicial: 1000, aporte: 0, meses: 12, tipo: 'poupanca', campos: { taxaAnual: 12 } });
  assert.deepEqual(s.final, { mes: 12, investido: 1000, bruto: 1120, juros: 120, ir: 0, liquido: 1120 });
  assert.equal(s.evolucao.length, 13); // mês 0 até 12
});

teste('CDB com IR regressivo em 6, 24 e 25 meses', () => {
  const sim = meses => Invest.simular({ valorInicial: 1000, meses, tipo: 'cdi', campos: { cdi: 10, pctCdi: 100 } }).final;
  assert.deepEqual(sim(24), { mes: 24, investido: 1000, bruto: 1210, juros: 210, ir: 36.75, liquido: 1173.25 }); // 17,5%
  const f6 = sim(6);
  assert.equal(f6.ir, Calc.arred(f6.juros * 0.225));
  const f25 = sim(25);
  assert.equal(f25.ir, Calc.arred(f25.juros * 0.15));
});

teste('aportes: cada parcela paga IR pela própria idade', () => {
  const tm = Invest.taxaMensal(10);
  const r = Invest.resgate(1000, 1000, 7, tm, 'regressivo');
  // inicial: 7 meses (20%); aportes dos meses 1..7 ficam 6..0 meses (22,5%)
  let bruto = 1000 * Math.pow(1 + tm, 7), ir = (bruto - 1000) * 0.20;
  for (let k = 1; k <= 7; k++) { const f = 1000 * Math.pow(1 + tm, 7 - k); bruto += f; ir += (f - 1000) * 0.225; }
  assert.equal(r.investido, 8000);
  assert.equal(r.bruto, Calc.arred(bruto));
  assert.equal(r.ir, Calc.arred(ir));
  assert.equal(r.liquido, Calc.arred(bruto - ir));
});

teste('taxa zero: só soma os aportes', () => {
  const r = Invest.resgate(0, 100, 3, 0, 'regressivo');
  assert.deepEqual(r, { investido: 300, bruto: 300, juros: 0, ir: 0, liquido: 300 });
});

/* ===== Assistente local ===== */
teste('assistente: gasto por categoria, saldo e orçamento', () => {
  const r1 = so(Assistente.responder('quanto gastei em alimentação este mês?', estado, '2026-11'));
  assert.ok(r1.includes('520,00') && r1.includes('Alimentação'), r1);
  const r2 = so(Assistente.responder('qual meu saldo?', estado, '2026-11'));
  assert.ok(r2.includes('3.530,00'), r2);
  const r3 = so(Assistente.responder('estou dentro do orçamento?', estado, '2026-11'));
  assert.ok(r3.includes('Acima do previsto') && r3.includes('Alimentação'), r3); // 520 de 500
  const r4 = Assistente.responder('como faço uma transferência?', estado, '2026-11');
  assert.ok(r4.includes('Contas'), r4);
  const r5 = so(Assistente.responder('onde mais gastei?', estado, '2026-11'));
  assert.ok(r5.includes('Alimentação'), r5);
  const r6 = so(Assistente.responder('saldo da carteira', estado, '2026-11'));
  assert.ok(r6.includes('130,00'), r6);
});

teste('resumo para IA não envia descrições dos lançamentos', () => {
  const resumo = Assistente.resumoParaIA(estado, '2026-11');
  assert.ok(resumo.includes('Conta corrente'));
  ['Feira', 'Restaurante', 'Saque', 'Fatura'].forEach(d => assert.ok(!resumo.includes(d), d));
});

console.log(`\n${ok} testes passaram ✔`);
