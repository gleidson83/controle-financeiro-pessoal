/* =====================================================================
   CONTROLE FINANCEIRO PESSOAL - app.js
   Organização do arquivo:
   1. Calc     -> funções de cálculo "puras" (sem tela). Fáceis de testar.
   2. Estado   -> dados do app + salvar/carregar no localStorage.
   3. Tela     -> funções que desenham cada aba (render).
   4. Eventos  -> o que acontece quando o usuário clica/digita.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. CALC - regras de negócio
   Datas são strings "AAAA-MM-DD" e meses são "AAAA-MM".
   Trabalhar com texto evita problemas de fuso horário do objeto Date.
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

  // Soma (ou subtrai) meses: somarMeses("2026-11", 2) -> "2027-01"
  somarMeses(mes, n) {
    const [ano, m] = mes.split('-').map(Number);
    const total = ano * 12 + (m - 1) + n; // conta tudo em "meses desde o ano 0"
    const novoAno = Math.floor(total / 12);
    const novoMes = (total % 12) + 1;
    return `${novoAno}-${String(novoMes).padStart(2, '0')}`;
  },

  // Só os lançamentos de um mês
  doMes(transacoes, mes) {
    return transacoes.filter(t => Calc.mesDe(t.data) === mes);
  },

  // Soma receitas e despesas de uma lista
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

  // Resumo do mês: { receitas, despesas, saldo }
  resumoMes(transacoes, mes) {
    return Calc.totais(Calc.doMes(transacoes, mes));
  },

  // Despesas do mês agrupadas por categoria, do maior para o menor
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
     - previsto: valor que o usuário planejou para a categoria no mês
     - realizado: soma dos lançamentos da categoria no mês
     - diferenca = previsto - realizado
         despesa: positivo = sobrou dinheiro; negativo = estourou
         receita: negativo = recebeu MAIS que o previsto
     - percentual = realizado / previsto * 100 (null se não houver previsto) */
  previstoRealizado(categorias, orcamentoMes, transacoes, mes) {
    const doMes = Calc.doMes(transacoes, mes);
    return categorias.map(cat => {
      const previsto = Number((orcamentoMes || {})[cat.id]) || 0;
      const realizado = Calc.arred(
        doMes.filter(t => t.categoriaId === cat.id).reduce((s, t) => s + t.valor, 0)
      );
      return {
        categoriaId: cat.id,
        nome: cat.nome,
        tipo: cat.tipo,
        previsto,
        realizado,
        diferenca: Calc.arred(previsto - realizado),
        percentual: previsto > 0 ? Calc.arred((realizado / previsto) * 100) : null
      };
    });
  },

  // Evolução: os N meses que terminam em "mesFinal"
  evolucao(transacoes, mesFinal, n) {
    const lista = [];
    for (let i = n - 1; i >= 0; i--) {
      const mes = Calc.somarMeses(mesFinal, -i);
      lista.push({ mes, ...Calc.resumoMes(transacoes, mes) });
    }
    return lista;
  },

  // Saldo acumulado de tudo que aconteceu até o fim de "ateMes"
  saldoAcumulado(transacoes, ateMes) {
    return Calc.totais(transacoes.filter(t => Calc.mesDe(t.data) <= ateMes)).saldo;
  },

  /* Média mensal dos últimos N meses (terminando em mesBase).
     Só entram na média os meses que têm algum lançamento,
     para um mês vazio não "puxar" a média para baixo. */
  mediaMensal(transacoes, mesBase, n = 3) {
    const meses = Calc.evolucao(transacoes, mesBase, n)
      .filter(m => m.receitas > 0 || m.despesas > 0);
    if (meses.length === 0) return { receitas: 0, despesas: 0, mesesUsados: 0 };
    const r = meses.reduce((s, m) => s + m.receitas, 0) / meses.length;
    const d = meses.reduce((s, m) => s + m.despesas, 0) / meses.length;
    return { receitas: Calc.arred(r), despesas: Calc.arred(d), mesesUsados: meses.length };
  },

  /* Recorrentes: lançamentos marcados como "recorrente".
     Se o mesmo item foi lançado em vários meses (mesmo tipo, categoria e
     descrição), vale só o mais recente — assim não contamos em dobro. */
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
     Começa do saldo acumulado real e soma, a cada mês, (receitas - despesas)
     estimadas pelo método escolhido: 'media' ou 'recorrente'. */
  projecao(transacoes, mesBase, n, metodo) {
    const base = metodo === 'recorrente'
      ? Calc.recorrentesMensais(transacoes, mesBase)
      : Calc.mediaMensal(transacoes, mesBase, 3);

    const saldoMes = Calc.arred(base.receitas - base.despesas);
    let acumulado = Calc.saldoAcumulado(transacoes, mesBase);
    const lista = [];
    for (let i = 1; i <= n; i++) {
      acumulado = Calc.arred(acumulado + saldoMes);
      lista.push({
        mes: Calc.somarMeses(mesBase, i),
        receitas: base.receitas,
        despesas: base.despesas,
        saldoMes,
        saldoAcumulado: acumulado
      });
    }
    return lista;
  }
};

/* ---------------------------------------------------------------------
   Utilitários de formatação (pt-BR)
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

// Protege contra HTML malicioso em textos digitados ou importados
function esc(texto) {
  return String(texto).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Gera um id único simples
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Mês de hoje no formato "AAAA-MM" (usando a data local)
function mesHoje() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
}

// Data de hoje no formato "AAAA-MM-DD"
function hojeISO() {
  const h = new Date();
  return `${mesHoje()}-${String(h.getDate()).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------------
   2. ESTADO - todos os dados ficam neste objeto
   --------------------------------------------------------------------- */
const CHAVE_STORAGE = 'controle-financeiro-v1';

function estadoInicial() {
  return {
    categorias: [
      { id: 'salario', nome: 'Salário', tipo: 'receita' },
      { id: 'extra', nome: 'Renda extra', tipo: 'receita' },
      { id: 'moradia', nome: 'Moradia', tipo: 'despesa' },
      { id: 'alimentacao', nome: 'Alimentação', tipo: 'despesa' },
      { id: 'transporte', nome: 'Transporte', tipo: 'despesa' },
      { id: 'lazer', nome: 'Lazer', tipo: 'despesa' },
      { id: 'saude', nome: 'Saúde', tipo: 'despesa' }
    ],
    transacoes: [],   // { id, data, descricao, categoriaId, tipo, valor, recorrente }
    orcamentos: {}    // { "AAAA-MM": { categoriaId: valorPrevisto } }
  };
}

// Confere se um objeto tem o formato esperado (usado no carregar e importar)
function estadoValido(e) {
  return e && Array.isArray(e.categorias) && Array.isArray(e.transacoes) &&
    typeof e.orcamentos === 'object' && e.orcamentos !== null;
}

function carregar() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_STORAGE));
    return estadoValido(salvo) ? salvo : estadoInicial();
  } catch (erro) {
    return estadoInicial();
  }
}

function salvar() {
  try {
    localStorage.setItem(CHAVE_STORAGE, JSON.stringify(estado));
  } catch (erro) {
    avisar('Não foi possível salvar neste navegador.');
  }
}

let estado = null;         // preenchido ao iniciar
let mesSelecionado = null; // "AAAA-MM"
const graficos = {};       // guarda os gráficos para poder destruí-los e redesenhar

/* ---------------------------------------------------------------------
   3. TELA - funções de desenho
   --------------------------------------------------------------------- */
const $ = id => document.getElementById(id);

function avisar(msg) {
  const el = $('aviso');
  el.textContent = msg;
  el.classList.add('mostrar');
  setTimeout(() => el.classList.remove('mostrar'), 2200);
}

const nomeCategoria = id => (estado.categorias.find(c => c.id === id) || { nome: '(removida)' }).nome;

// Desenha (ou redesenha) um gráfico Chart.js
function desenharGrafico(idCanvas, config) {
  if (typeof Chart === 'undefined') return; // sem internet: o app funciona sem gráficos
  if (graficos[idCanvas]) graficos[idCanvas].destroy();
  graficos[idCanvas] = new Chart($(idCanvas), config);
}

// Redesenha tudo (simples e suficiente para um app pequeno)
function renderTudo() {
  renderPainel();
  renderLancamentos();
  renderOrcamento();
  renderProjecoes();
  renderCategorias();
}

// ---- Painel / Relatórios ----
function renderPainel() {
  const r = Calc.resumoMes(estado.transacoes, mesSelecionado);
  $('totReceitas').textContent = brl(r.receitas);
  $('totDespesas').textContent = brl(r.despesas);
  $('totSaldo').textContent = brl(r.saldo);
  $('totSaldo').className = r.saldo >= 0 ? 'positivo' : 'negativo';

  // Gastos por categoria (rosca + tabela)
  const gastos = Calc.gastosPorCategoria(estado.transacoes, mesSelecionado, estado.categorias);
  const total = gastos.reduce((s, g) => s + g.valor, 0);
  $('semGastos').style.display = gastos.length ? 'none' : 'block';
  desenharGrafico('graficoCategorias', {
    type: 'doughnut',
    data: { labels: gastos.map(g => g.nome), datasets: [{ data: gastos.map(g => g.valor) }] },
    options: { plugins: { legend: { position: 'bottom' } } }
  });
  $('tabelaCategoriasMes').innerHTML = gastos.map(g => `
    <tr><td>${esc(g.nome)}</td><td class="num">${brl(g.valor)}</td>
    <td class="num">${(g.valor / total * 100).toFixed(1).replace('.', ',')}%</td></tr>`).join('')
    || '<tr><td colspan="3" class="vazio">Sem despesas.</td></tr>';

  // Evolução mensal (barras de receitas x despesas + linha de saldo)
  const evo = Calc.evolucao(estado.transacoes, mesSelecionado, 6);
  desenharGrafico('graficoEvolucao', {
    type: 'bar',
    data: {
      labels: evo.map(e => nomeMes(e.mes)),
      datasets: [
        { label: 'Receitas', data: evo.map(e => e.receitas), backgroundColor: '#16a34a' },
        { label: 'Despesas', data: evo.map(e => e.despesas), backgroundColor: '#dc2626' },
        { label: 'Saldo', data: evo.map(e => e.saldo), type: 'line', borderColor: '#4f46e5' }
      ]
    },
    options: { plugins: { legend: { position: 'bottom' } } }
  });
}

// ---- Lançamentos ----
function renderLancamentos() {
  const lista = Calc.doMes(estado.transacoes, mesSelecionado)
    .sort((a, b) => b.data.localeCompare(a.data));
  $('semLanc').style.display = lista.length ? 'none' : 'block';
  $('tabelaLanc').innerHTML = lista.map(t => `
    <tr>
      <td>${dataBR(t.data)}</td>
      <td>${esc(t.descricao)}${t.recorrente ? ' 🔁' : ''}</td>
      <td>${esc(nomeCategoria(t.categoriaId))}</td>
      <td class="num ${t.tipo === 'receita' ? 'positivo' : 'negativo'}">
        ${t.tipo === 'receita' ? '+' : '-'} ${brl(t.valor)}</td>
      <td class="num">
        <button class="btn-mini" data-editar="${t.id}" title="Editar">✏️</button>
        <button class="btn-mini" data-excluir="${t.id}" title="Excluir">🗑️</button>
      </td>
    </tr>`).join('');
  preencherSelectCategorias();
}

// Mostra no select só as categorias do tipo escolhido (receita/despesa)
function preencherSelectCategorias(selecionada) {
  const tipo = $('lancTipo').value;
  const atual = selecionada || $('lancCategoria').value;
  $('lancCategoria').innerHTML = estado.categorias
    .filter(c => c.tipo === tipo)
    .map(c => `<option value="${c.id}" ${c.id === atual ? 'selected' : ''}>${esc(c.nome)}</option>`)
    .join('');
}

function limparFormLanc() {
  $('formLanc').reset();
  $('lancId').value = '';
  // Data sugerida: hoje (se for o mês atual) ou dia 01 do mês escolhido
  $('lancData').value = mesSelecionado === mesHoje() ? hojeISO() : `${mesSelecionado}-01`;
  $('tituloFormLanc').textContent = 'Novo lançamento';
  preencherSelectCategorias();
}

// ---- Orçamento ----
function renderOrcamento() {
  const orc = estado.orcamentos[mesSelecionado] || {};
  const linhas = Calc.previstoRealizado(estado.categorias, orc, estado.transacoes, mesSelecionado);

  $('tabelaOrc').innerHTML = ['receita', 'despesa'].map(tipo => {
    const doTipo = linhas.filter(l => l.tipo === tipo);
    const titulo = `<tr><th colspan="5">${tipo === 'receita' ? 'Receitas' : 'Despesas'}</th></tr>`;
    return titulo + doTipo.map(l => {
      // Para despesa, gastar menos que o previsto é bom; para receita, receber mais é bom
      const bom = tipo === 'despesa' ? l.diferenca >= 0 : l.diferenca <= 0;
      const pct = l.percentual === null ? '—' : `${l.percentual.toFixed(0)}%`;
      const largura = Math.min(l.percentual || 0, 100);
      let classe = '';
      if (tipo === 'despesa' && l.percentual > 100) classe = 'estourou';
      else if (tipo === 'despesa' && l.percentual >= 80) classe = 'alerta';
      return `<tr>
        <td>${esc(l.nome)}</td>
        <td class="num"><input type="number" min="0" step="0.01" inputmode="decimal" value="${l.previsto || ''}"
             data-orc="${l.categoriaId}" placeholder="0,00"></td>
        <td class="num">${brl(l.realizado)}</td>
        <td class="num ${l.previsto ? (bom ? 'positivo' : 'negativo') : ''}">${brl(l.diferenca)}</td>
        <td><div class="barra"><div class="${classe}" style="width:${largura}%"></div></div>${pct}</td>
      </tr>`;
    }).join('');
  }).join('');
}

// ---- Projeções ----
function renderProjecoes() {
  const metodo = $('projMetodo').value;
  const n = Number($('projMeses').value);
  const proj = Calc.projecao(estado.transacoes, mesSelecionado, n, metodo);
  const saldoHoje = Calc.saldoAcumulado(estado.transacoes, mesSelecionado);

  $('projExplicacao').textContent = metodo === 'media'
    ? `Usa a média de receitas e despesas dos últimos 3 meses (até ${nomeMes(mesSelecionado)}). Saldo acumulado atual: ${brl(saldoHoje)}.`
    : `Soma os lançamentos marcados como recorrentes (🔁). Saldo acumulado atual: ${brl(saldoHoje)}.`;

  $('tabelaProj').innerHTML = proj.map(p => `
    <tr><td>${nomeMes(p.mes)}</td><td class="num">${brl(p.receitas)}</td><td class="num">${brl(p.despesas)}</td>
    <td class="num ${p.saldoMes >= 0 ? 'positivo' : 'negativo'}">${brl(p.saldoMes)}</td>
    <td class="num ${p.saldoAcumulado >= 0 ? 'positivo' : 'negativo'}"><strong>${brl(p.saldoAcumulado)}</strong></td></tr>`).join('');

  desenharGrafico('graficoProjecao', {
    type: 'line',
    data: {
      labels: [nomeMes(mesSelecionado) + ' (atual)', ...proj.map(p => nomeMes(p.mes))],
      datasets: [{ label: 'Saldo acumulado projetado', data: [saldoHoje, ...proj.map(p => p.saldoAcumulado)],
        borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,.1)', fill: true, tension: 0.3 }]
    },
    options: { plugins: { legend: { display: false } } }
  });
}

// ---- Categorias ----
function renderCategorias() {
  const item = c => `<li>${esc(c.nome)}
    <button class="btn-mini" data-excluir-cat="${c.id}" title="Excluir">🗑️</button></li>`;
  $('listaCatReceita').innerHTML = estado.categorias.filter(c => c.tipo === 'receita').map(item).join('');
  $('listaCatDespesa').innerHTML = estado.categorias.filter(c => c.tipo === 'despesa').map(item).join('');
}

/* ---------------------------------------------------------------------
   Dados de exemplo (para a apresentação em sala)
   Gera 4 meses de lançamentos terminando no mês selecionado.
   --------------------------------------------------------------------- */
function gerarExemplo() {
  const e = estadoInicial();
  for (let i = 3; i >= 0; i--) {
    const mes = Calc.somarMeses(mesSelecionado, -i);
    const add = (dia, descricao, categoriaId, tipo, valor, recorrente = false) =>
      e.transacoes.push({ id: novoId(), data: `${mes}-${dia}`, descricao, categoriaId, tipo, valor, recorrente });
    add('05', 'Salário', 'salario', 'receita', 4500, true);
    add('10', 'Aluguel', 'moradia', 'despesa', 1400, true);
    add('12', 'Mercado', 'alimentacao', 'despesa', 650 + i * 40);
    add('15', 'Combustível', 'transporte', 'despesa', 300 + i * 15);
    add('20', 'Cinema', 'lazer', 'despesa', 80 + i * 20);
    if (i % 2 === 0) add('22', 'Freela', 'extra', 'receita', 800);
    e.orcamentos[mes] = { salario: 4500, moradia: 1400, alimentacao: 700, transporte: 300, lazer: 150, saude: 100 };
  }
  return e;
}

/* ---------------------------------------------------------------------
   4. EVENTOS
   --------------------------------------------------------------------- */
function iniciar() {
  estado = carregar();
  mesSelecionado = mesHoje();
  $('mesAtual').value = mesSelecionado;

  // Troca de aba
  document.querySelectorAll('.aba').forEach(botao => {
    botao.addEventListener('click', () => {
      document.querySelectorAll('.aba').forEach(b => b.classList.remove('ativa'));
      document.querySelectorAll('.secao').forEach(s => s.classList.remove('ativa'));
      botao.classList.add('ativa');
      $(botao.dataset.aba).classList.add('ativa');
    });
  });

  // Troca de mês (filtro geral)
  $('mesAtual').addEventListener('change', e => {
    if (!e.target.value) return;
    mesSelecionado = e.target.value;
    limparFormLanc();
    renderTudo();
  });

  // --- Lançamentos: salvar (novo ou edição) ---
  $('lancTipo').addEventListener('change', () => preencherSelectCategorias());
  $('formLanc').addEventListener('submit', e => {
    e.preventDefault();
    const dados = {
      data: $('lancData').value,
      descricao: $('lancDescricao').value.trim(),
      categoriaId: $('lancCategoria').value,
      tipo: $('lancTipo').value,
      valor: Calc.arred(Number($('lancValor').value)),
      recorrente: $('lancRecorrente').checked
    };
    if (!dados.categoriaId) return avisar('Cadastre uma categoria antes.');
    if (!(dados.valor > 0)) return avisar('Informe um valor maior que zero.');

    const id = $('lancId').value;
    if (id) {
      const t = estado.transacoes.find(x => x.id === id);
      Object.assign(t, dados);
      avisar('Lançamento atualizado!');
    } else {
      estado.transacoes.push({ id: novoId(), ...dados });
      avisar('Lançamento adicionado!');
    }
    salvar();
    limparFormLanc();
    renderTudo();
  });
  $('btnCancelarLanc').addEventListener('click', limparFormLanc);

  // Editar / excluir lançamento (um único "ouvinte" na tabela)
  $('tabelaLanc').addEventListener('click', e => {
    const editar = e.target.closest('[data-editar]');
    const excluir = e.target.closest('[data-excluir]');
    if (editar) {
      const t = estado.transacoes.find(x => x.id === editar.dataset.editar);
      $('lancId').value = t.id;
      $('lancData').value = t.data;
      $('lancTipo').value = t.tipo;
      preencherSelectCategorias(t.categoriaId);
      $('lancValor').value = t.valor;
      $('lancDescricao').value = t.descricao;
      $('lancRecorrente').checked = !!t.recorrente;
      $('tituloFormLanc').textContent = 'Editando lançamento';
      $('formLanc').scrollIntoView({ behavior: 'smooth' });
    }
    if (excluir && confirm('Excluir este lançamento?')) {
      estado.transacoes = estado.transacoes.filter(x => x.id !== excluir.dataset.excluir);
      salvar();
      renderTudo();
      avisar('Lançamento excluído.');
    }
  });

  // --- Orçamento: salva ao sair do campo ---
  $('tabelaOrc').addEventListener('change', e => {
    const catId = e.target.dataset.orc;
    if (!catId) return;
    const valor = Calc.arred(Number(e.target.value) || 0);
    estado.orcamentos[mesSelecionado] = estado.orcamentos[mesSelecionado] || {};
    if (valor > 0) estado.orcamentos[mesSelecionado][catId] = valor;
    else delete estado.orcamentos[mesSelecionado][catId];
    salvar();
    renderOrcamento();
  });
  $('btnCopiarOrc').addEventListener('click', () => {
    const anterior = estado.orcamentos[Calc.somarMeses(mesSelecionado, -1)];
    if (!anterior) return avisar('Mês anterior não tem orçamento.');
    estado.orcamentos[mesSelecionado] = { ...anterior };
    salvar();
    renderOrcamento();
    avisar('Orçamento copiado!');
  });

  // --- Projeções ---
  $('projMetodo').addEventListener('change', renderProjecoes);
  $('projMeses').addEventListener('change', renderProjecoes);

  // --- Categorias ---
  $('formCat').addEventListener('submit', e => {
    e.preventDefault();
    const nome = $('catNome').value.trim();
    const tipo = $('catTipo').value;
    const existe = estado.categorias.some(c => c.tipo === tipo && c.nome.toLowerCase() === nome.toLowerCase());
    if (!nome || existe) return avisar('Nome vazio ou categoria já existe.');
    estado.categorias.push({ id: novoId(), nome, tipo });
    salvar();
    $('formCat').reset();
    renderTudo();
    avisar('Categoria criada!');
  });
  $('categorias').addEventListener('click', e => {
    const botao = e.target.closest('[data-excluir-cat]');
    if (!botao) return;
    const id = botao.dataset.excluirCat;
    // Não deixa apagar categoria em uso (evita lançamentos "órfãos")
    if (estado.transacoes.some(t => t.categoriaId === id)) {
      return avisar('Categoria em uso por lançamentos. Não pode excluir.');
    }
    if (!confirm('Excluir esta categoria?')) return;
    estado.categorias = estado.categorias.filter(c => c.id !== id);
    Object.values(estado.orcamentos).forEach(orc => delete orc[id]);
    salvar();
    renderTudo();
  });

  // --- Dados: exportar / importar / exemplo / limpar ---
  $('btnExportar').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(estado, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `financas-${hojeISO()}.json`;
    document.body.appendChild(link); // alguns celulares exigem o link na página
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  $('inputImportar').addEventListener('change', e => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const dados = JSON.parse(leitor.result);
        if (!estadoValido(dados)) throw new Error('formato');
        if (!confirm('Importar vai substituir os dados atuais. Continuar?')) return;
        estado = dados;
        salvar();
        renderTudo();
        avisar('Dados importados!');
      } catch (erro) {
        avisar('Arquivo inválido.');
      } finally {
        e.target.value = ''; // permite importar o mesmo arquivo de novo
      }
    };
    leitor.readAsText(arquivo);
  });
  $('btnExemplo').addEventListener('click', () => {
    if (!confirm('Substituir os dados atuais pelos dados de exemplo?')) return;
    estado = gerarExemplo();
    salvar();
    renderTudo();
    avisar('Exemplo carregado!');
  });
  $('btnLimpar').addEventListener('click', () => {
    if (!confirm('Apagar TODOS os dados? Exporte antes se quiser guardar.')) return;
    estado = estadoInicial();
    salvar();
    renderTudo();
    avisar('Dados apagados.');
  });

  limparFormLanc();
  renderTudo();
}

/* ---------------------------------------------------------------------
   Ponto de partida
   No navegador: inicia a tela. No Node (testes): só exporta o Calc.
   --------------------------------------------------------------------- */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', iniciar);
}
if (typeof module !== 'undefined') {
  module.exports = { Calc };
}
