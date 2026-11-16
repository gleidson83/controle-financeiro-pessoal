/* =====================================================================
   app.js - TELA E EVENTOS
   Os cálculos ficam em calc.js (Calc, Invest, migrarEstado...).
   Organização:
   1. Estado   -> dados do app + salvar/carregar no localStorage
   2. Tela     -> funções que desenham cada aba (render)
   3. Investimentos -> cartões de cenário e comparação
   4. Eventos  -> o que acontece quando o usuário clica/digita
   ===================================================================== */

/* ---------------------------------------------------------------------
   Pequenos utilitários de tela
   --------------------------------------------------------------------- */
// Protege contra HTML malicioso em textos digitados ou importados
function esc(texto) {
  return String(texto).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function mesHoje() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
}
function hojeISO() {
  const h = new Date();
  return `${mesHoje()}-${String(h.getDate()).padStart(2, '0')}`;
}
// Data sugerida nos formulários: hoje (se for o mês atual) ou dia 01 do mês escolhido
const dataSugerida = () => (mesSelecionado === mesHoje() ? hojeISO() : `${mesSelecionado}-01`);
const $ = id => document.getElementById(id);

/* ---------------------------------------------------------------------
   1. ESTADO - todos os dados ficam neste objeto
   --------------------------------------------------------------------- */
const CHAVE_STORAGE = 'controle-financeiro-v1';
const CHAVE_BACKUP_V1 = 'controle-financeiro-v1-backup-antes-migracao';

function estadoInicial() {
  return {
    versao: VERSAO_DADOS,
    categorias: [
      { id: 'salario', nome: 'Salário', tipo: 'receita' },
      { id: 'extra', nome: 'Renda extra', tipo: 'receita' },
      { id: 'moradia', nome: 'Moradia', tipo: 'despesa' },
      { id: 'alimentacao', nome: 'Alimentação', tipo: 'despesa' },
      { id: 'transporte', nome: 'Transporte', tipo: 'despesa' },
      { id: 'lazer', nome: 'Lazer', tipo: 'despesa' },
      { id: 'saude', nome: 'Saúde', tipo: 'despesa' }
    ],
    contas: [{ id: 'conta-principal', nome: 'Conta principal', tipo: 'corrente', saldoInicial: 0 }],
    transacoes: [],     // { id, data, descricao, categoriaId, contaId, tipo, valor, recorrente }
    transferencias: [], // { id, data, origemId, destinoId, valor, descricao }
    orcamentos: {}      // { "AAAA-MM": { categoriaId: valorPrevisto } }
  };
}

// Confere se um objeto tem o formato mínimo esperado (dados antigos também passam)
function estadoValido(e) {
  return e && Array.isArray(e.categorias) && Array.isArray(e.transacoes) &&
    typeof e.orcamentos === 'object' && e.orcamentos !== null;
}

function carregar() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_STORAGE));
    if (!estadoValido(salvo)) return estadoInicial();
    if (salvo.versao !== VERSAO_DADOS) {
      // Antes de migrar, guarda uma cópia intacta dos dados antigos (segurança extra)
      if (!localStorage.getItem(CHAVE_BACKUP_V1)) localStorage.setItem(CHAVE_BACKUP_V1, JSON.stringify(salvo));
      const migrado = migrarEstado(salvo);
      localStorage.setItem(CHAVE_STORAGE, JSON.stringify(migrado));
      return migrado;
    }
    return migrarEstado(salvo); // garante campos obrigatórios mesmo na versão atual
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
   2. TELA
   --------------------------------------------------------------------- */
function avisar(msg) {
  const el = $('aviso');
  el.textContent = msg;
  el.classList.add('mostrar');
  setTimeout(() => el.classList.remove('mostrar'), 2200);
}

const nomeCategoria = id => (estado.categorias.find(c => c.id === id) || { nome: '(removida)' }).nome;
const nomeConta = id => (estado.contas.find(c => c.id === id) || { nome: '(removida)' }).nome;

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
  renderContas();
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
  const totalContas = Calc.saldosContas(estado, mesSelecionado).total;
  $('totContas').textContent = brl(totalContas);
  $('totContas').className = totalContas >= 0 ? 'positivo' : 'negativo';

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
    <td class="num">${pct(g.valor / total * 100)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="vazio">Sem despesas.</td></tr>';

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
  const lista = Calc.doMes(estado.transacoes, mesSelecionado).sort((a, b) => b.data.localeCompare(a.data));
  $('semLanc').style.display = lista.length ? 'none' : 'block';
  $('tabelaLanc').innerHTML = lista.map(t => `
    <tr>
      <td>${dataBR(t.data)}</td>
      <td>${esc(t.descricao)}${t.recorrente ? ' 🔁' : ''}</td>
      <td>${esc(nomeCategoria(t.categoriaId))}</td>
      <td>${esc(nomeConta(t.contaId))}</td>
      <td class="num ${t.tipo === 'receita' ? 'positivo' : 'negativo'}">${t.tipo === 'receita' ? '+' : '-'} ${brl(t.valor)}</td>
      <td class="num">
        <button class="btn-mini" data-editar="${t.id}" title="Editar">✏️</button>
        <button class="btn-mini" data-excluir="${t.id}" title="Excluir">🗑️</button>
      </td>
    </tr>`).join('');
  preencherSelectCategorias();
  preencherSelectContas();
}

// Mostra no select só as categorias do tipo escolhido (receita/despesa)
function preencherSelectCategorias(selecionada) {
  const tipo = $('lancTipo').value;
  const atual = selecionada || $('lancCategoria').value;
  $('lancCategoria').innerHTML = estado.categorias
    .filter(c => c.tipo === tipo)
    .map(c => `<option value="${c.id}" ${c.id === atual ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
}

// Preenche todos os selects de conta (lançamento e transferência) mantendo a escolha atual
function preencherSelectContas(selecionadaLanc) {
  const opcoes = atual => estado.contas
    .map(c => `<option value="${c.id}" ${c.id === atual ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  $('lancConta').innerHTML = opcoes(selecionadaLanc || $('lancConta').value);
  $('trOrigem').innerHTML = opcoes($('trOrigem').value);
  const destinoAtual = $('trDestino').value || (estado.contas[1] && estado.contas[1].id);
  $('trDestino').innerHTML = opcoes(destinoAtual);
}

function limparFormLanc() {
  $('formLanc').reset();
  $('lancId').value = '';
  $('lancData').value = dataSugerida();
  $('tituloFormLanc').textContent = 'Novo lançamento';
  preencherSelectCategorias();
  preencherSelectContas();
}

// ---- Contas e transferências ----
function renderContas() {
  const { lista, total } = Calc.saldosContas(estado, mesSelecionado);
  $('tabelaContas').innerHTML = lista.map(c => `
    <tr>
      <td>${esc(c.nome)}</td>
      <td>${TIPOS_CONTA[c.tipo] || esc(c.tipo)}</td>
      <td class="num">${brl(c.saldoInicial)}</td>
      <td class="num ${c.saldo >= 0 ? 'positivo' : 'negativo'}"><strong>${brl(c.saldo)}</strong></td>
      <td class="num"><button class="btn-mini" data-excluir-conta="${c.id}" title="Excluir">🗑️</button></td>
    </tr>`).join('');
  $('totalContas').textContent = brl(total);

  const transf = (estado.transferencias || [])
    .filter(tr => Calc.mesDe(tr.data) === mesSelecionado)
    .sort((a, b) => b.data.localeCompare(a.data));
  $('semTransf').style.display = transf.length ? 'none' : 'block';
  $('tabelaTransf').innerHTML = transf.map(tr => `
    <tr>
      <td>${dataBR(tr.data)}</td>
      <td>${esc(nomeConta(tr.origemId))}</td>
      <td>${esc(nomeConta(tr.destinoId))}</td>
      <td>${esc(tr.descricao || '')}</td>
      <td class="num">${brl(tr.valor)}</td>
      <td class="num"><button class="btn-mini" data-excluir-transf="${tr.id}" title="Excluir">🗑️</button></td>
    </tr>`).join('');
  if (!$('trData').value) $('trData').value = dataSugerida();
}

// ---- Orçamento ----
function renderOrcamento() {
  const orc = estado.orcamentos[mesSelecionado] || {};
  const linhas = Calc.previstoRealizado(estado.categorias, orc, estado.transacoes, mesSelecionado);
  $('tabelaOrc').innerHTML = ['receita', 'despesa'].map(tipo => {
    const titulo = `<tr><th colspan="5">${tipo === 'receita' ? 'Receitas' : 'Despesas'}</th></tr>`;
    return titulo + linhas.filter(l => l.tipo === tipo).map(l => {
      // Para despesa, gastar menos que o previsto é bom; para receita, receber mais é bom
      const bom = tipo === 'despesa' ? l.diferenca >= 0 : l.diferenca <= 0;
      const textoPct = l.percentual === null ? '—' : pct(l.percentual, 0);
      const largura = Math.min(l.percentual || 0, 100);
      let classe = '';
      if (tipo === 'despesa' && l.percentual > 100) classe = 'estourou';
      else if (tipo === 'despesa' && l.percentual >= 80) classe = 'alerta';
      return `<tr>
        <td>${esc(l.nome)}</td>
        <td class="num"><input type="number" min="0" step="0.01" inputmode="decimal" value="${l.previsto || ''}" data-orc="${l.categoriaId}" placeholder="0,00"></td>
        <td class="num">${brl(l.realizado)}</td>
        <td class="num ${l.previsto ? (bom ? 'positivo' : 'negativo') : ''}">${brl(l.diferenca)}</td>
        <td><div class="barra"><div class="${classe}" style="width:${largura}%"></div></div>${textoPct}</td>
      </tr>`;
    }).join('');
  }).join('');
}

// ---- Projeções (partem do saldo total das contas) ----
function renderProjecoes() {
  const metodo = $('projMetodo').value;
  const n = Number($('projMeses').value);
  const proj = Calc.projecao(estado.transacoes, mesSelecionado, n, metodo, Calc.saldoInicialTotal(estado));
  const saldoHoje = Calc.saldosContas(estado, mesSelecionado).total;

  $('projExplicacao').textContent = (metodo === 'media'
    ? `Usa a média de receitas e despesas dos últimos 3 meses (até ${nomeMes(mesSelecionado)}).`
    : 'Soma os lançamentos marcados como recorrentes (🔁).') + ` Saldo em contas no fim de ${nomeMes(mesSelecionado)}: ${brl(saldoHoje)}.`;

  $('tabelaProj').innerHTML = proj.map(p => `
    <tr><td>${nomeMes(p.mes)}</td><td class="num">${brl(p.receitas)}</td><td class="num">${brl(p.despesas)}</td>
    <td class="num ${p.saldoMes >= 0 ? 'positivo' : 'negativo'}">${brl(p.saldoMes)}</td>
    <td class="num ${p.saldoAcumulado >= 0 ? 'positivo' : 'negativo'}"><strong>${brl(p.saldoAcumulado)}</strong></td></tr>`).join('');

  desenharGrafico('graficoProjecao', {
    type: 'line',
    data: {
      labels: [nomeMes(mesSelecionado) + ' (atual)', ...proj.map(p => nomeMes(p.mes))],
      datasets: [{ label: 'Saldo em contas projetado', data: [saldoHoje, ...proj.map(p => p.saldoAcumulado)],
        borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,.1)', fill: true, tension: 0.3 }]
    },
    options: { plugins: { legend: { display: false } } }
  });
}

// ---- Categorias ----
function renderCategorias() {
  const item = c => `<li>${esc(c.nome)} <button class="btn-mini" data-excluir-cat="${c.id}" title="Excluir">🗑️</button></li>`;
  $('listaCatReceita').innerHTML = estado.categorias.filter(c => c.tipo === 'receita').map(item).join('');
  $('listaCatDespesa').innerHTML = estado.categorias.filter(c => c.tipo === 'despesa').map(item).join('');
}

/* ---------------------------------------------------------------------
   3. INVESTIMENTOS - até 3 cenários lado a lado
   Os cenários ficam só na memória (não vão para o localStorage).
   --------------------------------------------------------------------- */
const CORES_CENARIO = ['#4f46e5', '#16a34a', '#f59e0b'];
const ROTULOS_CAMPO = {
  taxaAnual: 'Taxa anual (%)', cdi: 'CDI anual (%)', pctCdi: '% do CDI',
  ipca: 'IPCA anual (%)', jurosReal: 'Juro real anual (%)',
  conservador: 'Conservador (% a.a.)', moderado: 'Moderado (% a.a.)', otimista: 'Otimista (% a.a.)'
};
// Cópia dos valores de exemplo de um tipo (para não alterar Invest.TIPOS)
const camposPadrao = tipo => ({ ...Invest.TIPOS[tipo].campos });
const cenarios = [
  { ativo: true, tipo: 'cdi', campos: camposPadrao('cdi') },
  { ativo: true, tipo: 'poupanca', campos: camposPadrao('poupanca') },
  { ativo: false, tipo: 'acoes', campos: camposPadrao('acoes') }
];

// Desenha os 3 cartões (só quando muda o tipo; digitar taxas não redesenha, para não perder o foco)
function renderCenarios() {
  $('cenarios').innerHTML = cenarios.map((c, i) => {
    const tipos = Object.entries(Invest.TIPOS)
      .map(([id, t]) => `<option value="${id}" ${id === c.tipo ? 'selected' : ''}>${t.nome}</option>`).join('');
    const campos = Object.entries(c.campos).map(([campo, valor]) => campo === 'cenario'
      ? `<label>Cenário usado
           <select data-cen="${i}" data-campo="cenario">
             ${['conservador', 'moderado', 'otimista'].map(op => `<option value="${op}" ${op === valor ? 'selected' : ''}>${op}</option>`).join('')}
           </select></label>`
      : `<label>${ROTULOS_CAMPO[campo]} <span class="exemplo">exemplo</span>
           <input type="number" step="0.01" min="0" inputmode="decimal" value="${valor}" data-cen="${i}" data-campo="${campo}"></label>`
    ).join('');
    return `<div class="caixa cenario ${c.ativo ? '' : 'inativo'}" style="--cor:${CORES_CENARIO[i]}">
      <label class="linha-ativo"><input type="checkbox" data-cen="${i}" data-campo="ativo" ${c.ativo ? 'checked' : ''} ${i === 0 ? 'disabled' : ''}> Cenário ${i + 1}</label>
      <label>Tipo <select data-cen="${i}" data-campo="tipo">${tipos}</select></label>
      ${campos}
    </div>`;
  }).join('');
}

// Lê as entradas, simula os cenários ativos e atualiza tabela e gráfico
function renderInvestimentos() {
  const prazo = Math.max(1, Math.floor(Number($('invPrazo').value) || 1));
  const meses = Math.min($('invUnidade').value === 'anos' ? prazo * 12 : prazo, 600); // limite: 50 anos
  const base = {
    valorInicial: Math.max(0, Number($('invInicial').value) || 0),
    aporte: Math.max(0, Number($('invAporte').value) || 0),
    meses
  };
  const ativos = cenarios
    .map((c, i) => ({ ...c, i }))
    .filter(c => c.ativo)
    .map(c => ({ i: c.i, sim: Invest.simular({ ...base, tipo: c.tipo, campos: c.campos }) }));

  $('tabelaInvest').innerHTML = ativos.map(({ i, sim }) => `
    <tr>
      <td><span style="color:${CORES_CENARIO[i]}">●</span> ${i + 1}. ${esc(sim.nome)}</td>
      <td class="num">${pct(sim.taxaAnual, 2)}</td>
      <td class="num">${brl(sim.final.investido)}</td>
      <td class="num positivo">${brl(sim.final.juros)}</td>
      <td class="num negativo">${brl(sim.final.ir)}</td>
      <td class="num"><strong>${brl(sim.final.liquido)}</strong></td>
    </tr>`).join('');

  // No gráfico, mostra no máximo ~60 pontos para não ficar pesado em prazos longos
  const passo = Math.max(1, Math.ceil(meses / 60));
  const pontos = [];
  for (let m = 0; m <= meses; m += passo) pontos.push(m);
  if (pontos[pontos.length - 1] !== meses) pontos.push(meses);
  desenharGrafico('graficoInvest', {
    type: 'line',
    data: {
      labels: pontos.map(m => (m % 12 === 0 ? `${m / 12} a` : `${m} m`)),
      datasets: ativos.map(({ i, sim }) => ({
        label: `${i + 1}. ${sim.nome}`, data: pontos.map(m => sim.evolucao[m].liquido),
        borderColor: CORES_CENARIO[i], backgroundColor: CORES_CENARIO[i], tension: 0.2, pointRadius: 0
      }))
    },
    options: { plugins: { legend: { position: 'bottom' } }, interaction: { mode: 'index', intersect: false } }
  });
}

/* ---------------------------------------------------------------------
   Dados de exemplo (para a apresentação em sala)
   --------------------------------------------------------------------- */
function gerarExemplo() {
  const e = estadoInicial();
  e.contas = [
    { id: 'corrente', nome: 'Conta corrente', tipo: 'corrente', saldoInicial: 1500 },
    { id: 'carteira', nome: 'Carteira', tipo: 'carteira', saldoInicial: 100 },
    { id: 'cartao', nome: 'Cartão de crédito', tipo: 'cartao', saldoInicial: 0 },
    { id: 'reserva', nome: 'Reserva', tipo: 'investimento', saldoInicial: 2000 }
  ];
  for (let i = 3; i >= 0; i--) {
    const mes = Calc.somarMeses(mesSelecionado, -i);
    const add = (dia, descricao, categoriaId, contaId, tipo, valor, recorrente = false) =>
      e.transacoes.push({ id: novoId(), data: `${mes}-${dia}`, descricao, categoriaId, contaId, tipo, valor, recorrente });
    const transf = (dia, origemId, destinoId, valor, descricao) =>
      e.transferencias.push({ id: novoId(), data: `${mes}-${dia}`, origemId, destinoId, valor, descricao });
    add('05', 'Salário', 'salario', 'corrente', 'receita', 4500, true);
    add('10', 'Aluguel', 'moradia', 'corrente', 'despesa', 1400, true);
    add('12', 'Mercado', 'alimentacao', 'cartao', 'despesa', 650 + i * 40);
    add('15', 'Combustível', 'transporte', 'cartao', 'despesa', 300 + i * 15);
    add('18', 'Feira', 'alimentacao', 'carteira', 'despesa', 80);
    add('20', 'Cinema', 'lazer', 'cartao', 'despesa', 80 + i * 20);
    if (i % 2 === 0) add('22', 'Freela', 'extra', 'corrente', 'receita', 800);
    transf('06', 'corrente', 'carteira', 100, 'Saque');
    transf('25', 'corrente', 'cartao', 1030 + i * 75, 'Pagamento da fatura');
    transf('26', 'corrente', 'reserva', 300, 'Guardar na reserva');
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
      if (botao.dataset.aba === 'investimentos') renderInvestimentos(); // gráfico precisa da aba visível
    });
  });

  // Troca de mês (filtro geral)
  $('mesAtual').addEventListener('change', e => {
    if (!e.target.value) return;
    mesSelecionado = e.target.value;
    $('trData').value = '';
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
      contaId: $('lancConta').value,
      tipo: $('lancTipo').value,
      valor: Calc.arred(Number($('lancValor').value)),
      recorrente: $('lancRecorrente').checked
    };
    if (!dados.categoriaId) return avisar('Cadastre uma categoria antes.');
    if (!dados.contaId) return avisar('Cadastre uma conta antes.');
    if (!(dados.valor > 0)) return avisar('Informe um valor maior que zero.');
    const id = $('lancId').value;
    if (id) {
      Object.assign(estado.transacoes.find(x => x.id === id), dados);
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
      preencherSelectContas(t.contaId);
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

  // --- Contas ---
  $('formConta').addEventListener('submit', e => {
    e.preventDefault();
    const nome = $('contaNome').value.trim();
    if (!nome) return avisar('Informe o nome da conta.');
    if (estado.contas.some(c => normalizar(c.nome) === normalizar(nome))) return avisar('Já existe uma conta com esse nome.');
    estado.contas.push({ id: novoId(), nome, tipo: $('contaTipo').value, saldoInicial: Calc.arred(Number($('contaSaldo').value) || 0) });
    salvar();
    $('formConta').reset();
    renderTudo();
    avisar('Conta criada!');
  });
  $('tabelaContas').addEventListener('click', e => {
    const botao = e.target.closest('[data-excluir-conta]');
    if (!botao) return;
    const id = botao.dataset.excluirConta;
    if (estado.contas.length === 1) return avisar('É preciso ter pelo menos uma conta.');
    if (Calc.contaEmUso(estado, id)) return avisar('Conta em uso por lançamentos ou transferências. Não pode excluir.');
    if (!confirm('Excluir esta conta?')) return;
    estado.contas = estado.contas.filter(c => c.id !== id);
    salvar();
    renderTudo();
  });

  // --- Transferências ---
  $('formTransf').addEventListener('submit', e => {
    e.preventDefault();
    const tr = {
      id: novoId(),
      data: $('trData').value,
      origemId: $('trOrigem').value,
      destinoId: $('trDestino').value,
      valor: Calc.arred(Number($('trValor').value)),
      descricao: $('trDescricao').value.trim()
    };
    const erro = Calc.validarTransferencia(estado, tr);
    if (erro) return avisar(erro);
    estado.transferencias.push(tr);
    salvar();
    $('trValor').value = '';
    $('trDescricao').value = '';
    renderTudo();
    avisar('Transferência registrada!');
  });
  $('tabelaTransf').addEventListener('click', e => {
    const botao = e.target.closest('[data-excluir-transf]');
    if (!botao || !confirm('Excluir esta transferência?')) return;
    estado.transferencias = estado.transferencias.filter(tr => tr.id !== botao.dataset.excluirTransf);
    salvar();
    renderTudo();
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

  // --- Investimentos ---
  ['invInicial', 'invAporte', 'invPrazo', 'invUnidade'].forEach(id => $(id).addEventListener('input', renderInvestimentos));
  $('cenarios').addEventListener('input', e => {
    const i = e.target.dataset.cen;
    const campo = e.target.dataset.campo;
    if (i === undefined) return;
    const c = cenarios[i];
    if (campo === 'tipo') {           // mudou o tipo: volta aos valores de exemplo daquele tipo
      c.tipo = e.target.value;
      c.campos = camposPadrao(c.tipo);
      renderCenarios();
    } else if (campo === 'ativo') {
      c.ativo = e.target.checked;
      renderCenarios();
    } else if (campo === 'cenario') {
      c.campos.cenario = e.target.value;
    } else {
      c.campos[campo] = Number(e.target.value) || 0;
    }
    renderInvestimentos();
  });

  // --- Categorias ---
  $('formCat').addEventListener('submit', e => {
    e.preventDefault();
    const nome = $('catNome').value.trim();
    const tipo = $('catTipo').value;
    const existe = estado.categorias.some(c => c.tipo === tipo && normalizar(c.nome) === normalizar(nome));
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
    if (estado.transacoes.some(t => t.categoriaId === id)) return avisar('Categoria em uso por lançamentos. Não pode excluir.');
    if (!confirm('Excluir esta categoria?')) return;
    estado.categorias = estado.categorias.filter(c => c.id !== id);
    Object.values(estado.orcamentos).forEach(orc => delete orc[id]);
    salvar();
    renderTudo();
  });

  // --- Dados: exportar / importar / exemplo / limpar ---
  // Exporta SÓ os dados financeiros (a chave da API fica em outra chave do localStorage)
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
        estado = migrarEstado(dados); // backups antigos (sem contas) também funcionam
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
  renderCenarios();
  renderTudo();
  renderInvestimentos();
}

document.addEventListener('DOMContentLoaded', iniciar);
