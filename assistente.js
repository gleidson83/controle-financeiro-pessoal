/* =====================================================================
   assistente.js - CHAT DO ASSISTENTE
   Dois modos:
   1. LOCAL (padrão, sem chave): regras/palavras-chave em calc.js (Assistente.responder)
   2. IA REAL (opcional): chama a API da Anthropic direto do navegador com a
      chave que o PRÓPRIO usuário colou na aba Config.
   SEGURANÇA: nenhuma chave fica no código. A chave é lida do localStorage
   deste navegador e só é enviada para api.anthropic.com.
   ===================================================================== */

/* ---------------------------------------------------------------------
   Configuração da IA (fica numa chave separada do localStorage,
   por isso NÃO entra no "Exportar JSON")
   --------------------------------------------------------------------- */
const CHAVE_CONFIG_IA = 'controle-financeiro-config-ia';

function lerConfigIA() {
  try {
    return { chave: '', modelo: 'claude-haiku-5-5', workspace: '', ativo: false, ...JSON.parse(localStorage.getItem(CHAVE_CONFIG_IA)) };
  } catch (erro) {
    return { chave: '', modelo: 'claude-haiku-5-5', workspace: '', ativo: false };
  }
}
function salvarConfigIA(config) {
  localStorage.setItem(CHAVE_CONFIG_IA, JSON.stringify(config));
}
const iaLigada = () => { const c = lerConfigIA(); return c.ativo && !!c.chave; };

/* ---------------------------------------------------------------------
   Chamada à API da Anthropic (Messages API)
   Conferido na documentação oficial (platform.claude.com/docs):
   - POST https://api.anthropic.com/v1/messages
   - headers: Authorization: Bearer <chave>, anthropic-version, content-type
   - anthropic-dangerous-direct-browser-access: true  (obrigatório para chamada direta do navegador)
   - anthropic-workspace-id: só se a chave não estiver vinculada a um workspace
   --------------------------------------------------------------------- */
const IA = {
  ENDPOINT: 'https://api.anthropic.com/v1/messages',
  VERSAO_API: '2026-10-21',
  historico: [], // conversa no formato da API: [{ role: 'user'|'assistant', content: '...' }]

  // Instruções + resumo atualizado dos dados (enviado a cada pergunta)
  instrucoes() {
    return 'Você é o assistente de um app de controle financeiro pessoal (abas: Painel, Lançamentos, Contas, ' +
      'Orçamento, Projeções, Investimentos, Categorias, Dados, Config). Responda em português do Brasil, de forma curta e clara. ' +
      'Use apenas os dados do resumo abaixo; se faltar informação, diga isso. Não invente números. ' +
      'Não faça recomendação de investimento: explique conceitos e sugira que a pessoa confira taxas e regras atuais. ' +
      'Valores em R$.\n\nRESUMO DOS DADOS DO USUÁRIO:\n' + Assistente.resumoParaIA(estado, mesSelecionado);
  },

  async perguntar(texto) {
    const config = lerConfigIA();
    IA.historico.push({ role: 'user', content: texto });
    IA.historico = IA.historico.slice(-10);                  // só as últimas mensagens
    while (IA.historico.length && IA.historico[0].role !== 'user') IA.historico.shift(); // precisa começar com "user"

    const headers = {
      'content-type': 'application/json',
      'anthropic-version': IA.VERSAO_API,
      'authorization': `Bearer ${config.chave}`,
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (config.workspace) headers['anthropic-workspace-id'] = config.workspace;

    let resposta, dados;
    try {
      resposta = await fetch(IA.ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: config.modelo, max_tokens: 2048, system: IA.instrucoes(), messages: IA.historico })
      });
      dados = await resposta.json().catch(() => ({}));
    } catch (erro) {
      IA.historico.pop(); // tira a pergunta que falhou
      throw new Error('Sem conexão com a API. Verifique a internet.');
    }
    if (!resposta.ok) {
      IA.historico.pop();
      const msg = (dados.error && dados.error.message) || `Erro HTTP ${resposta.status}`;
      throw new Error(`A API respondeu com erro: ${msg}`);
    }
    // A resposta vem em "blocos"; usamos só os de texto
    const textoResposta = (dados.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      || '(A IA não devolveu texto.)';
    IA.historico.push({ role: 'assistant', content: textoResposta });
    return textoResposta;
  }
};

/* ---------------------------------------------------------------------
   Tela do chat
   --------------------------------------------------------------------- */
// Converte **negrito** em <strong> com segurança (escapa o resto do HTML antes)
const formatarMsg = texto => esc(texto).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

function adicionarMsg(texto, quem) {
  const div = document.createElement('div');
  div.className = `msg ${quem}`;
  div.innerHTML = formatarMsg(texto);
  $('chatMensagens').appendChild(div);
  $('chatMensagens').scrollTop = $('chatMensagens').scrollHeight;
  return div;
}

function atualizarSeloModo() {
  const ligada = iaLigada();
  $('chatModo').textContent = ligada ? 'IA real (Claude)' : 'Modo local';
  $('chatModo').classList.toggle('ia', ligada);
}

async function enviarPergunta(texto) {
  texto = texto.trim();
  if (!texto) return;
  adicionarMsg(texto, 'usuario');
  if (!iaLigada()) {
    adicionarMsg(Assistente.responder(texto, estado, mesSelecionado), 'bot');
    return;
  }
  const aguarde = adicionarMsg('Pensando…', 'bot');
  try {
    aguarde.innerHTML = formatarMsg(await IA.perguntar(texto));
  } catch (erro) {
    aguarde.classList.add('erro');
    aguarde.innerHTML = formatarMsg(`${erro.message}\n\nResposta do modo local:\n${Assistente.responder(texto, estado, mesSelecionado)}`);
  }
}

/* ---------------------------------------------------------------------
   Aba Config: salvar / apagar a chave
   --------------------------------------------------------------------- */
function renderConfigIA() {
  const c = lerConfigIA();
  $('iaChave').value = '';                       // nunca mostramos a chave salva na tela
  $('iaChave').placeholder = c.chave ? 'chave salva (cole outra para trocar)' : 'cole sua chave aqui';
  $('iaModelo').value = c.modelo;
  $('iaWorkspace').value = c.workspace;
  $('iaAtivo').checked = c.ativo;
  $('iaStatus').textContent = c.chave
    ? `Chave salva neste navegador (termina em …${c.chave.slice(-4)}). IA ${c.ativo ? 'ativada' : 'desativada'}.`
    : 'Nenhuma chave salva. O assistente usa o modo local.';
  atualizarSeloModo();
}

function iniciarAssistente() {
  $('chatBotao').addEventListener('click', () => {
    $('chatPainel').hidden = !$('chatPainel').hidden;
    if (!$('chatPainel').hidden) {
      if (!$('chatMensagens').children.length) adicionarMsg(Assistente.APRESENTACAO, 'bot');
      $('chatTexto').focus();
    }
  });
  $('chatFechar').addEventListener('click', () => { $('chatPainel').hidden = true; });
  $('chatForm').addEventListener('submit', e => {
    e.preventDefault();
    const texto = $('chatTexto').value;
    $('chatTexto').value = '';
    enviarPergunta(texto);
  });
  document.querySelector('.chat-sugestoes').addEventListener('click', e => {
    const b = e.target.closest('[data-pergunta]');
    if (b) enviarPergunta(b.dataset.pergunta);
  });

  $('formIA').addEventListener('submit', e => {
    e.preventDefault();
    const atual = lerConfigIA();
    const novaChave = $('iaChave').value.trim();
    const config = {
      chave: novaChave || atual.chave,           // campo vazio = mantém a chave já salva
      modelo: $('iaModelo').value,
      workspace: $('iaWorkspace').value.trim(),
      ativo: $('iaAtivo').checked
    };
    if (config.ativo && !config.chave) return avisar('Cole uma chave para ativar a IA.');
    salvarConfigIA(config);
    IA.historico = [];
    renderConfigIA();
    avisar('Configuração salva neste navegador.');
  });
  $('btnApagarChave').addEventListener('click', () => {
    if (!confirm('Apagar a chave salva neste navegador?')) return;
    localStorage.removeItem(CHAVE_CONFIG_IA);
    IA.historico = [];
    renderConfigIA();
    avisar('Chave apagada.');
  });

  renderConfigIA();
}

document.addEventListener('DOMContentLoaded', iniciarAssistente);
