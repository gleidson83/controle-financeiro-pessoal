/* =====================================================================
   calc.js - REGRAS DE NEGÓCIO (sem tela)
   Tudo aqui é "função pura": recebe dados e devolve resultado.
   Por isso dá para testar no Node (veja testes.js).
   Conteúdo:
   1. Utilitários de formatação (R$, meses, textos)
   2. Calc        -> lançamentos, orçamento, projeção, contas, transferências
   3. Migração    -> atualiza dados antigos sem perder nada
   4. Invest      -> simulador de investimentos com IR
   5. Assistente  -> respostas locais (sem IA) e resumo para a IA
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. UTILITÁRIOS
   --------------------------------------------------------------------- */
const formatoBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = v => formatoBRL.format(v || 0);

// "2026-11" -> "nov/2026"
function nomeMes(mes) {
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [a, m] = mes.split('-');
  return `${nomes[Number(m) - 1]}/${a}`;
}

// "2026-11-16" -> "16/11/2026"
const dataBR = d => d.split('-').reverse().join('/');

// "Alimentação" -> "alimentacao" (sem acento e minúsculo, para comparar textos)
const normalizar = texto => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Formata porcentagem: 12.5 -> "12,5%"
const pct = (v, casas = 1) => `${Number(v).toFixed(casas).replace('.', ',')}%`;

/* ---------------------------------------------------------------------
   2. CALC - lançamentos, orçamento, projeção e contas
   Datas são texto "AAAA-MM-DD" e meses "AAAA-MM" (evita erro de fuso horário).
   --------------------------------------------------------------------- */
const Calc = {
  // Arredonda para 2 casas (evita 0.1 + 0.2 = 0.30000000000000004)
  arred(valor) {
    return Math.round(valor * 100) / 100;
  },

  // "2026-11-16" -> "2026-11"
  mesDe(data) {
    return data.slice(0, 7);
  },

  // somarMeses("2026-11", 2) -> "2027-01"
  somarMeses(mes, n) {
    const [ano, m] = mes.split('-').map(Number);
    const total = ano * 12 + (m - 1) + n; // conta tudo em "meses desde o ano 0"
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  },

  // Só os lançamentos de um mês
  doMes(transacoes, mes) {
    return transacoes.filter(t => Calc.mesDe(t.data) === mes);
  },

  // Soma receitas e despesas de uma lista (transferências NÃO entram aqui)
  totais(lista) {
    let receitas = 0, despesas = 0;
    lista.forEach(t => {
      if (t.tipo === 'receita') receitas += t.valor;
      else despesas += t.valor;
    });
    receitas = Calc.arred(receitas);
    despesas = Calc.arred(despesas);
    return { receitas, despesas, saldo: Calc.arred(receitas - despesas) };
  },

  resumoMes(transacoes, mes) {
    return Calc.totais(Calc.doMes(transacoes, mes));
  },

  // Despesas do mês por categoria, do maior para o menor
  gastosPorCategoria(transacoes, mes, categorias) {
    const soma = {};
    Calc.doMes(transacoes, mes)
      .filter(t => t.tipo === 'despesa')
      .forEach(t => { soma[t.categoriaId] = (soma[t.categoriaId] || 0) + t.valor; });
    return Object.keys(soma)
      .map(id => {
        const cat = categorias.find(c => c.id === id);
        return { categoriaId: id, nome: cat ? cat.nome : '(sem categoria)', valor: Calc.arred(soma[id]) };
      })
      .sort((a, b) => b.valor - a.valor);
  },

  /* Previsto x Realizado
     diferenca = previsto - realizado (despesa: positivo = sobrou; negativo = estourou)
     percentual = realizado / previsto * 100 (null se não houver previsto) */
  previstoRealizado(categorias, orcamentoMes, transacoes, mes) {
    const doMes = Calc.doMes(transacoes, mes);
    return categorias.map(cat => {
      const previsto = Number((orcamentoMes || {})[cat.id]) || 0;
      const realizado = Calc.arred(doMes.filter(t => t.categoriaId === cat.id).reduce((s, t) => s + t.valor, 0));
      return {
        categoriaId: cat.id, nome: cat.nome, tipo: cat.tipo, previsto, realizado,
        diferenca: Calc.arred(previsto - realizado),
        percentual: previsto > 0 ? Calc.arred((realizado / previsto) * 100) : null
      };
    });
  },

  // Os N meses que terminam em "mesFinal"
  evolucao(transacoes, mesFinal, n) {
    const lista = [];
    for (let i = n - 1; i >= 0; i--) {
      const mes = Calc.somarMeses(mesFinal, -i);
      lista.push({ mes, ...Calc.resumoMes(transacoes, mes) });
    }
    return lista;
  },

  // Receitas - despesas de tudo até o fim de "ateMes" (sem saldos iniciais)
  saldoAcumulado(transacoes, ateMes) {
    return Calc.totais(transacoes.filter(t => Calc.mesDe(t.data) <= ateMes)).saldo;
  },

  // Média dos últimos N meses; meses sem lançamento não entram na média
  mediaMensal(transacoes, mesBase, n = 3) {
    const meses = Calc.evolucao(transacoes, mesBase, n).filter(m => m.receitas > 0 || m.despesas > 0);
    if (meses.length === 0) return { receitas: 0, despesas: 0, mesesUsados: 0 };
    const r = meses.reduce((s, m) => s + m.receitas, 0) / meses.length;
    const d = meses.reduce((s, m) => s + m.despesas, 0) / meses.length;
    return { receitas: Calc.arred(r), despesas: Calc.arred(d), mesesUsados: meses.length };
  },

  // Recorrentes: cada item (tipo + categoria + descrição) conta uma vez, pelo valor mais recente
  recorrentesMensais(transacoes, ateMes) {
    const ultimos = {};
    transacoes
      .filter(t => t.recorrente && Calc.mesDe(t.data) <= ateMes)
      .forEach(t => {
        const chave = `${t.tipo}|${t.categoriaId}|${t.descricao.trim().toLowerCase()}`;
        if (!ultimos[chave] || t.data > ultimos[chave].data) ultimos[chave] = t;
      });
    return Calc.totais(Object.values(ultimos));
  },

  /* Projeção dos próximos N meses depois de mesBase.
     saldoBase = soma dos saldos iniciais das contas (padrão 0).
     Começa do saldo real e soma (receitas - despesas estimadas) a cada mês. */
  projecao(transacoes, mesBase, n, metodo, saldoBase = 0) {
    const base = metodo === 'recorrente'
      ? Calc.recorrentesMensais(transacoes, mesBase)
      : Calc.mediaMensal(transacoes, mesBase, 3);
    const saldoMes = Calc.arred(base.receitas - base.despesas);
    let acumulado = Calc.arred(saldoBase + Calc.saldoAcumulado(transacoes, mesBase));
    const lista = [];
    for (let i = 1; i <= n; i++) {
      acumulado = Calc.arred(acumulado + saldoMes);
      lista.push({ mes: Calc.somarMeses(mesBase, i), receitas: base.receitas, despesas: base.despesas, saldoMes, saldoAcumulado: acumulado });
    }
    return lista;
  },

  /* ---- CONTAS ----
     Saldo de uma conta = saldo inicial + receitas - despesas
                          + transferências recebidas - transferências enviadas
     ateMes (opcional): considera só o que aconteceu até o fim desse mês. */
  saldoConta(estado, contaId, ateMes) {
    const conta = estado.contas.find(c => c.id === contaId);
    if (!conta) return 0;
    const dentro = data => !ateMes || Calc.mesDe(data) <= ateMes;
    let saldo = Number(conta.saldoInicial) || 0;
    estado.transacoes.forEach(t => {
      if (t.contaId === contaId && dentro(t.data)) saldo += t.tipo === 'receita' ? t.valor : -t.valor;
    });
    (estado.transferencias || []).forEach(tr => {
      if (!dentro(tr.data)) return;
      if (tr.origemId === contaId) saldo -= tr.valor;
      if (tr.destinoId === contaId) saldo += tr.valor;
    });
    return Calc.arred(saldo);
  },

  // Lista de contas com o saldo de cada uma + total geral
  saldosContas(estado, ateMes) {
    const lista = estado.contas.map(c => ({ ...c, saldo: Calc.saldoConta(estado, c.id, ateMes) }));
    return { lista, total: Calc.arred(lista.reduce((s, c) => s + c.saldo, 0)) };
  },

  // Soma dos saldos iniciais (ponto de partida da projeção)
  saldoInicialTotal(estado) {
    return Calc.arred(estado.contas.reduce((s, c) => s + (Number(c.saldoInicial) || 0), 0));
  },

  // Confere uma transferência. Devolve o texto do erro ou null se estiver tudo certo.
  validarTransferencia(estado, tr) {
    if (!tr.data) return 'Informe a data.';
    if (!(tr.valor > 0)) return 'Informe um valor maior que zero.';
    if (tr.origemId === tr.destinoId) return 'Escolha contas diferentes.';
    const existe = id => estado.contas.some(c => c.id === id);
    if (!existe(tr.origemId) || !existe(tr.destinoId)) return 'Conta inválida.';
    return null;
  },

  // Uma conta só pode ser excluída se nenhum lançamento/transferência usar ela
  contaEmUso(estado, contaId) {
    return estado.transacoes.some(t => t.contaId === contaId) ||
      (estado.transferencias || []).some(tr => tr.origemId === contaId || tr.destinoId === contaId);
  }
};

/* ---------------------------------------------------------------------
   3. MIGRAÇÃO DE DADOS
   Versão 1 (antiga): não tinha contas nem transferências.
   Versão 2 (atual): cada lançamento tem "contaId".
   A função devolve uma CÓPIA atualizada; o objeto original não é alterado.
   --------------------------------------------------------------------- */
const VERSAO_DADOS = 2;
const TIPOS_CONTA = {
  corrente: 'Conta corrente', poupanca: 'Poupança', carteira: 'Carteira',
  cartao: 'Cartão de crédito', investimento: 'Investimento'
};

function migrarEstado(antigo) {
  const e = JSON.parse(JSON.stringify(antigo)); // cópia profunda
  if (!Array.isArray(e.contas) || e.contas.length === 0) {
    e.contas = [{ id: 'conta-principal', nome: 'Conta principal', tipo: 'corrente', saldoInicial: 0 }];
  }
  if (!Array.isArray(e.transferencias)) e.transferencias = [];
  const ids = new Set(e.contas.map(c => c.id));
  // Lançamento sem conta (ou com conta que não existe) vai para a primeira conta
  e.transacoes.forEach(t => { if (!ids.has(t.contaId)) t.contaId = e.contas[0].id; });
  e.versao = VERSAO_DADOS;
  return e;
}

/* ---------------------------------------------------------------------
   4. INVEST - simulador de investimentos
   ATENÇÃO: as taxas abaixo são EXEMPLOS editáveis, não taxas atuais.
   Convenções da simulação:
   - taxa mensal equivalente: (1 + anual)^(1/12) - 1
   - aporte no FIM de cada mês
   - IR sobre o ganho de cada parcela, conforme o tempo que ela ficou aplicada
   --------------------------------------------------------------------- */
const Invest = {
  TIPOS: {
    poupanca: { nome: 'Poupança', ir: 'isento', campos: { taxaAnual: 6.17 } },
    cdi: { nome: 'CDB / Tesouro Selic (% do CDI)', ir: 'regressivo', campos: { cdi: 10, pctCdi: 100 } },
    ipca: { nome: 'Tesouro IPCA+', ir: 'regressivo', campos: { ipca: 4, jurosReal: 6 } },
    lci: { nome: 'LCI / LCA (isento de IR)', ir: 'isento', campos: { cdi: 10, pctCdi: 90 } },
    acoes: { nome: 'Fundos / ações', ir: 'fixo15', campos: { cenario: 'moderado', conservador: 6, moderado: 10, otimista: 14 } }
  },

  // Taxa anual (em %) de acordo com o tipo e os campos digitados
  taxaAnual(tipo, c) {
    switch (tipo) {
      case 'poupanca': return Number(c.taxaAnual) || 0;
      case 'cdi':
      case 'lci': return Calc.arred((Number(c.cdi) || 0) * (Number(c.pctCdi) || 0) / 100);
      // IPCA+: (1 + inflação) x (1 + juro real) - 1
      case 'ipca': return Calc.arred(((1 + (Number(c.ipca) || 0) / 100) * (1 + (Number(c.jurosReal) || 0) / 100) - 1) * 100);
      case 'acoes': return Number(c[c.cenario]) || 0;
      default: return 0;
    }
  },

  // 12% ao ano -> ~0,9489% ao mês (juros compostos)
  taxaMensal(anualPct) {
    return Math.pow(1 + anualPct / 100, 1 / 12) - 1;
  },

  /* Tabela regressiva de IR (renda fixa), usando meses como aproximação dos dias:
     até 6 meses 22,5% | até 12 meses 20% | até 24 meses 17,5% | acima 15% */
  aliquotaRegressiva(meses) {
    if (meses <= 6) return 22.5;
    if (meses <= 12) return 20;
    if (meses <= 24) return 17.5;
    return 15;
  },

  aliquota(modoIR, meses) {
    if (modoIR === 'isento') return 0;
    if (modoIR === 'fixo15') return 15; // simplificação para fundos/ações
    return Invest.aliquotaRegressiva(meses);
  },

  /* Valor se resgatar depois de "m" meses.
     Cada parcela (valor inicial e cada aporte) rende pelo tempo que ficou aplicada
     e paga IR pela sua própria idade. */
  resgate(valorInicial, aporte, m, taxaMes, modoIR) {
    const parcelas = [{ valor: valorInicial, idade: m }];
    for (let k = 1; k <= m; k++) parcelas.push({ valor: aporte, idade: m - k });
    let investido = 0, bruto = 0, ir = 0;
    parcelas.forEach(p => {
      if (!p.valor) return;
      const futuro = p.valor * Math.pow(1 + taxaMes, p.idade);
      investido += p.valor;
      bruto += futuro;
      ir += Math.max(futuro - p.valor, 0) * Invest.aliquota(modoIR, p.idade) / 100;
    });
    return {
      investido: Calc.arred(investido), bruto: Calc.arred(bruto),
      juros: Calc.arred(bruto - investido), ir: Calc.arred(ir), liquido: Calc.arred(bruto - ir)
    };
  },

  // Simulação completa: evolução mês a mês + resultado final
  simular({ valorInicial = 0, aporte = 0, meses = 12, tipo, campos }) {
    const def = Invest.TIPOS[tipo];
    const taxaAnual = Invest.taxaAnual(tipo, campos || def.campos);
    const taxaMes = Invest.taxaMensal(taxaAnual);
    const evolucao = [];
    for (let m = 0; m <= meses; m++) evolucao.push({ mes: m, ...Invest.resgate(valorInicial, aporte, m, taxaMes, def.ir) });
    return { tipo, nome: def.nome, modoIR: def.ir, taxaAnual, taxaMes, evolucao, final: evolucao[meses] };
  }
};

/* ---------------------------------------------------------------------
   5. ASSISTENTE LOCAL (sem IA)
   Entende perguntas por palavras-chave e responde com os dados do app.
   --------------------------------------------------------------------- */
const Assistente = {
  // Explicações de "como usar" (a ordem importa: o primeiro que combinar vence)
  TOPICOS: [
    [/transfer/, 'Para transferir entre contas: aba **Contas** → "Transferência entre contas". Escolha origem, destino, valor e salve. Transferência não conta como receita nem despesa. Ex.: pagar a fatura do cartão = transferir da conta corrente para o cartão.'],
    [/conta/, 'Na aba **Contas** você cadastra contas (corrente, poupança, carteira, cartão, investimento) com saldo inicial. O saldo de cada conta é atualizado pelos lançamentos e transferências.'],
    [/lanc|despesa|receita|registr/, 'Para lançar: aba **Lançamentos** → preencha data, tipo, categoria, conta, valor e descrição → Salvar. Marque "Recorrente" para itens que se repetem todo mês. Use ✏️ para editar e 🗑️ para excluir.'],
    [/categori/, 'Na aba **Categorias** você cria categorias de receita ou despesa. Uma categoria em uso não pode ser excluída.'],
    [/orcament|previst/, 'Na aba **Orçamento** digite o valor previsto de cada categoria. O app mostra o realizado, a diferença e o % atingido (amarelo a partir de 80%, vermelho acima de 100%).'],
    [/proje/, 'A aba **Projeções** estima o saldo dos próximos meses pela média dos últimos 3 meses ou pelos lançamentos recorrentes.'],
    [/invest|simul|cdb|tesouro|poupanca|lci|lca|acoes|rend/, 'A aba **Investimentos** simula até 3 cenários com valor inicial, aporte mensal e prazo. As taxas são exemplos editáveis e é só simulação, não recomendação.'],
    [/backup|export|import|json|perder/, 'Na aba **Dados** use "Exportar JSON" para salvar um backup e "Importar JSON" para restaurar. Os dados ficam só neste navegador.'],
    [/chave|api|\bia\b|config|claude/, 'Na aba **Config** você pode colar sua chave da API da Anthropic para usar IA real. A chave fica só neste navegador e um resumo dos seus dados é enviado à API.'],
    [/grafico|relatorio|painel|resumo/, 'O **Painel** mostra receitas, despesas e saldo do mês, gastos por categoria e a evolução dos últimos 6 meses. Troque o mês no topo da tela.']
  ],

  APRESENTACAO: 'Oi! Posso explicar como usar o app e responder perguntas simples, por exemplo:\n• "quanto gastei em alimentação este mês?"\n• "qual meu saldo?"\n• "estou dentro do orçamento?"\n• "onde mais gastei?"\n• "como faço uma transferência?"',

  // Recebe a pergunta e os dados; devolve o texto da resposta
  responder(pergunta, estado, mes) {
    const p = normalizar(pergunta).trim();
    if (!p) return 'Digite uma pergunta. 🙂';
    const m = /mes passado|mes anterior/.test(p) ? Calc.somarMeses(mes, -1) : mes;
    const rotulo = nomeMes(m);
    const resumo = Calc.resumoMes(estado.transacoes, m);

    // 1) Saudação ou pedido de ajuda geral
    if (/^(oi|ola|bom dia|boa tarde|boa noite)\b/.test(p) || /o que voce (faz|sabe)|^ajuda$/.test(p)) {
      return Assistente.APRESENTACAO;
    }

    // 2) "Como usar" alguma parte do app
    if (/\b(como|onde|para que|pra que|o que e|explica|funciona|ajuda)\b/.test(p) && !/\b(estou|to|tou)\b/.test(p)) {
      const topico = Assistente.TOPICOS.find(([re]) => re.test(p));
      if (topico) return topico[1];
    }

    // 3) Orçamento
    if (/orcament|dentro|estour|limite/.test(p)) {
      const orc = (estado.orcamentos || {})[m];
      if (!orc || Object.keys(orc).length === 0) return `Você ainda não definiu orçamento para ${rotulo}. Vá na aba **Orçamento** e digite os valores previstos.`;
      const linhas = Calc.previstoRealizado(estado.categorias, orc, estado.transacoes, m)
        .filter(l => l.tipo === 'despesa' && l.previsto > 0);
      const estouradas = linhas.filter(l => l.percentual > 100);
      const atencao = linhas.filter(l => l.percentual >= 80 && l.percentual <= 100);
      const partes = [];
      if (estouradas.length) partes.push('Acima do previsto: ' + estouradas.map(l => `${l.nome} (${pct(l.percentual, 0)}, passou ${brl(-l.diferenca)})`).join('; ') + '.');
      if (atencao.length) partes.push('Perto do limite: ' + atencao.map(l => `${l.nome} (${pct(l.percentual, 0)})`).join('; ') + '.');
      const totPrev = linhas.reduce((s, l) => s + l.previsto, 0);
      const totReal = linhas.reduce((s, l) => s + l.realizado, 0);
      partes.push(`Total de despesas orçadas em ${rotulo}: ${brl(totReal)} de ${brl(totPrev)} previstos.`);
      if (!estouradas.length) partes.unshift(`Sim! Nenhuma categoria passou do previsto em ${rotulo}.`);
      return partes.join('\n');
    }

    // 4) Gastos (por categoria, maior gasto ou total)
    if (/gast|despes|paguei|custo/.test(p)) {
      const gastos = Calc.gastosPorCategoria(estado.transacoes, m, estado.categorias);
      if (/maior|mais|principal/.test(p)) {
        if (!gastos.length) return `Não há despesas em ${rotulo}.`;
        return `Seu maior gasto em ${rotulo} foi ${gastos[0].nome}: ${brl(gastos[0].valor)} (${pct(gastos[0].valor / resumo.despesas * 100)} das despesas).`;
      }
      const cat = estado.categorias.find(c => c.tipo === 'despesa' && p.includes(normalizar(c.nome)));
      if (cat) {
        const g = gastos.find(x => x.categoriaId === cat.id);
        return `Em ${rotulo} você gastou ${brl(g ? g.valor : 0)} em ${cat.nome}.`;
      }
      return `Suas despesas em ${rotulo} somam ${brl(resumo.despesas)}.`;
    }

    // 5) Receitas
    if (/receb|receita|ganhei|entrou|renda|salario/.test(p)) {
      return `Suas receitas em ${rotulo} somam ${brl(resumo.receitas)}.`;
    }

    // 6) Projeção
    if (/proje|futuro|proximos meses|vou ter/.test(p)) {
      const proj = Calc.projecao(estado.transacoes, m, 6, 'media', Calc.saldoInicialTotal(estado));
      const fim = proj[proj.length - 1];
      return `Pela média dos últimos 3 meses, seu saldo em contas seria de ${brl(fim.saldoAcumulado)} em ${nomeMes(fim.mes)} (variação de ${brl(fim.saldoMes)} por mês). É só uma estimativa.`;
    }

    // 7) Saldo (de uma conta específica ou total)
    if (/saldo|tenho|sobrou|sobra|dinheiro|patrimonio/.test(p)) {
      const { lista, total } = Calc.saldosContas(estado, m);
      const conta = lista.find(c => p.includes(normalizar(c.nome)));
      if (conta) return `Saldo de ${conta.nome} no fim de ${rotulo}: ${brl(conta.saldo)}.`;
      return `Saldo total nas contas (fim de ${rotulo}): ${brl(total)}.\nSaldo do mês (receitas − despesas): ${brl(resumo.saldo)}.\n` +
        lista.map(c => `• ${c.nome}: ${brl(c.saldo)}`).join('\n');
    }

    // 8) Não entendi
    return 'Não entendi. 🤔 Tente perguntar sobre gastos, saldo, orçamento, projeção ou "como usar" uma aba.\n' +
      'Para respostas mais livres, ative a IA real na aba **Config**.';
  },

  /* Resumo dos dados enviado para a IA (modo opcional).
     Só totais e nomes de categorias/contas: NÃO envia descrições dos lançamentos. */
  resumoParaIA(estado, mes) {
    const r = Calc.resumoMes(estado.transacoes, mes);
    const gastos = Calc.gastosPorCategoria(estado.transacoes, mes, estado.categorias);
    const orc = Calc.previstoRealizado(estado.categorias, (estado.orcamentos || {})[mes], estado.transacoes, mes)
      .filter(l => l.previsto > 0);
    const contas = Calc.saldosContas(estado, mes);
    const evo = Calc.evolucao(estado.transacoes, mes, 3);
    const proj = Calc.projecao(estado.transacoes, mes, 6, 'media', Calc.saldoInicialTotal(estado));
    return [
      `Mês de referência: ${nomeMes(mes)}`,
      `Resumo do mês: receitas ${brl(r.receitas)}, despesas ${brl(r.despesas)}, saldo ${brl(r.saldo)}`,
      `Despesas por categoria: ${gastos.map(g => `${g.nome} ${brl(g.valor)}`).join('; ') || 'nenhuma'}`,
      `Orçamento (previsto / realizado / %): ${orc.map(l => `${l.nome} ${brl(l.previsto)} / ${brl(l.realizado)} / ${l.percentual === null ? '-' : pct(l.percentual, 0)}`).join('; ') || 'não definido'}`,
      `Saldos das contas: ${contas.lista.map(c => `${c.nome} (${TIPOS_CONTA[c.tipo] || c.tipo}) ${brl(c.saldo)}`).join('; ')}; total ${brl(contas.total)}`,
      `Últimos 3 meses (receitas / despesas): ${evo.map(e => `${nomeMes(e.mes)} ${brl(e.receitas)} / ${brl(e.despesas)}`).join('; ')}`,
      `Projeção pela média, em 6 meses: ${brl(proj[proj.length - 1].saldoAcumulado)}`
    ].join('\n');
  }
};

// No Node (testes) exporta tudo; no navegador as constantes ficam globais
if (typeof module !== 'undefined') {
  module.exports = { Calc, Invest, Assistente, migrarEstado, TIPOS_CONTA, VERSAO_DADOS, brl, nomeMes, normalizar };
}
