// js/cobranca.js
import { db, auth } from './firebase.js'; 
import {
  collection, getDocs, query, orderBy, addDoc,
  updateDoc, doc, arrayUnion, deleteDoc, where, deleteField, writeBatch, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { formatDateUTC, parseDateBR, mapStatusToLabel } from './utils.js';

export const COBRANCA_COLLECTION = 'controle_3_cobranca';
window.COBRANCA_COLLECTION = COBRANCA_COLLECTION; 

// Cache local
window.cobrancaList = [];
let currentActionStudentId = null; 

// --- HELPER: PEGAR USUÁRIO ATUAL ---
function getCurrentUserEmail() {
    if (auth.currentUser) return auth.currentUser.email;
    return window.currentUser?.email || "Sistema";
}

// -------------------------
// 1. CARREGAR E FILTRAR (LÓGICA NOVA)
// -------------------------
export async function loadCobrancaData() {
  const container = document.getElementById('cobranca-list');
  if (container) container.innerHTML = '<div class="loader"></div>';

  try {
    const q = query(collection(db, COBRANCA_COLLECTION), orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);

    const rawList = [];
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0); // Zera hora para cálculo de dias

    // Loop inicial para processar dados e checar Tags
    querySnapshot.forEach((docSnap) => {
        let aluno = { id: docSnap.id, ...docSnap.data() };

        // ============================================================
        // ⏰ "FAXINEIRO": VERIFICA SE A TAG EXPIROU (3 DIAS)
        // ============================================================
        // Normaliza o nome da tag para verificar
        const tagAtual = aluno.StatusExtra?.tipo || aluno.StatusExtra;

        // LISTA DE EXCEÇÕES: Tags que NUNCA expiram
        const tagsPermanentes = ['Link agendado', 'Jurídica'];

        // Só entra na verificação se tiver tag, tiver data E NÃO FOR PERMANENTE
        if (tagAtual && aluno.DataTag && !tagsPermanentes.includes(tagAtual)) {
            
            const dataTag = aluno.DataTag.toDate ? aluno.DataTag.toDate() : new Date(aluno.DataTag);
            const diffTempo = new Date() - dataTag;
            const diasPassados = diffTempo / (1000 * 60 * 60 * 24);

            if (diasPassados >= 3) {
                console.log(`Tag expirada: ${tagAtual} para ${aluno.Nome}. Limpando...`);

                aluno.StatusExtra = null;
                aluno.DataTag = null;

                const docRef = doc(db, COBRANCA_COLLECTION, aluno.id);
                updateDoc(docRef, {
                    StatusExtra: deleteField(),
                    DataTag: deleteField()
                }).catch(err => console.error("Erro ao remover tag:", err));
            }
        }
        // ============================================================

        rawList.push(aluno);
    });

    // --- FILTRO: JANELA DE 31 A 45 DIAS ---
    window.cobrancaList = rawList.filter(aluno => {
        // 1. Se já pagou, remove
        if (aluno.Status === 'Pago') return false;

        // 2. Se não tem vencimento, mostra por segurança
        if (!aluno.Vencimento) return true;

        // 3. Cálculo de dias de atraso
        const dataVenc = parseDateBR(aluno.Vencimento); // Certifique-se que essa função existe
        if (!dataVenc) return true; 
        
        dataVenc.setHours(0, 0, 0, 0);
        
        const diffTime = hoje - dataVenc;
        const diasAtraso = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Salva para exibir no card
        aluno.diasAtrasoCalculado = diasAtraso;

        // REGRA: Mostrar apenas entre 31 e 45 dias (Jurídico é >= 45)
        return diasAtraso >= 31 && diasAtraso < 45;
    });

    // Atualiza contador KPI
    const kpiEl = document.getElementById('total-active-count');
    if (kpiEl) kpiEl.textContent = window.cobrancaList.length;

    renderCobrancaList(window.cobrancaList);

  } catch (error) {
    console.error("Erro ao carregar cobrança:", error);
    if (container) container.innerHTML = '<p>Erro ao carregar dados.</p>';
  }
}
window.loadCobrancaData = loadCobrancaData;

// -------------------------
// 2. RENDERIZAR LISTA
// -------------------------
export function filterCobranca() {
    const term = document.getElementById('cobranca-search').value.toLowerCase();
    if (!term) {
        renderCobrancaList(window.cobrancaList);
        return;
    }
    const filtered = window.cobrancaList.filter(aluno => 
        (aluno.Nome && aluno.Nome.toLowerCase().includes(term)) ||
        (aluno.CPF && aluno.CPF.includes(term)) ||
        (aluno.Email && aluno.Email.toLowerCase().includes(term))
    );
    renderCobrancaList(filtered);
}
window.filterCobranca = filterCobranca;

export function renderCobrancaList(data) {
  const container = document.getElementById('cobranca-list');
  if (!container) return;

  container.innerHTML = '';

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="empty-msg">Nenhum aluno na fase de 3ª Cobrança!</p>';
    return;
  }

  // --- NOVO: LÓGICA DE AGRUPAMENTO POR CPF ---
  const groupedMap = {};

  data.forEach(item => {
    const key = item.CPF || item.Email || item.Nome; // Prioridade para CPF como chave única
    
    if (!groupedMap[key]) {
      // Cria o primeiro registro do aluno no mapa
      groupedMap[key] = {
        ...item,
        listaCursos: [{
          id: item.id,
          nome: item.Curso,
          valor: item.Valor,
          vencimento: item.Vencimento
        }],
        todosIds: [item.id] // Guarda todos os IDs aleatórios do Firebase
      };
    } else {
      // Se o aluno já existe (duplicado por curso), adicionamos o curso à lista
      groupedMap[key].listaCursos.push({
        id: item.id,
        nome: item.Curso,
        valor: item.Valor,
        vencimento: item.Vencimento
      });
      groupedMap[key].todosIds.push(item.id);

      // Mantém no card principal os dados do curso mais atrasado para o cronômetro/badge
      if ((item.diasAtrasoCalculado || 0) > (groupedMap[key].diasAtrasoCalculado || 0)) {
        groupedMap[key].diasAtrasoCalculado = item.diasAtrasoCalculado;
        groupedMap[key].Data1Jur = item.Data1Jur;
        groupedMap[key].DataTag = item.DataTag;
        groupedMap[key].StatusExtra = item.StatusExtra;
      }
      
      // Soma contadores de ligações e mensagens de todos os cursos
      groupedMap[key].LigaEtapa = (groupedMap[key].LigaEtapa || 0) + (item.LigaEtapa || 0);
      groupedMap[key].TemplateEtapa = (groupedMap[key].TemplateEtapa || 0) + (item.TemplateEtapa || 0);
    }
  });

  // Converte o mapa de volta para array e ordena
  const groupedArray = Object.values(groupedMap);
  const sortedData = groupedArray.sort((a, b) => {
    return (a.diasAtrasoCalculado || 0) - (b.diasAtrasoCalculado || 0);
  });

  // --- FIM DA LÓGICA DE AGRUPAMENTO ---

  sortedData.forEach(aluno => {
      // Badge de dias (mantido)
      const diasLabel = aluno.diasAtrasoCalculado 
          ? `<span style="background:#fff3cd; color:#856404; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:bold; margin-left:5px;">${aluno.diasAtrasoCalculado} dias</span>`
          : '';
      
      const dataLimite = aluno.Data1Jur ? (typeof formatDateUTC === 'function' ? formatDateUTC(aluno.Data1Jur) : aluno.Data1Jur) : 'N/A';

      // Lógica do cronômetro (mantida exatamente como a sua)
      const tagNome = aluno.StatusExtra?.tipo || aluno.StatusExtra || null;
      const safeClass = String(tagNome || "nenhum").replace(/_/g, '-').replace(/\s+/g, '-').toLowerCase();
      let timeLabelHtml = '';
      const tagsPermanentes = ['Link agendado', 'Jurídica'];

      if (tagNome && aluno.DataTag && !tagsPermanentes.includes(tagNome)) {
          const dataTag = aluno.DataTag.toDate ? aluno.DataTag.toDate() : new Date(aluno.DataTag);
          const agora = new Date();
          const diffDias = (agora - dataTag) / (1000 * 60 * 60 * 24);
          const diasRestantes = 3 - diffDias;
          let textoTempo = '';
          if (diasRestantes < 0) textoTempo = '(expirando...)';
          else if (diasRestantes < 1) textoTempo = `(${Math.ceil(diasRestantes * 24)}h rest.)`;
          else textoTempo = `(${Math.ceil(diasRestantes)}d rest.)`;
          timeLabelHtml = `<span style="font-size:0.85em; opacity:1; margin-left:6px; color:#333; font-weight:bold;">${textoTempo}</span>`;
      }

      const labelTag = typeof mapStatusToLabel === 'function' ? mapStatusToLabel(tagNome) : tagNome;
      const statusLabelHtml = tagNome ? `<p class="extra-status">${labelTag} ${timeLabelHtml}</p>` : '';

      // --- NOVO: GERADOR DA LISTA DE CURSOS PARA O CARD ---
      const cursosHTML = aluno.listaCursos.map(c => `
        <div style="border-left: 2px solid #eee; padding-left: 8px; margin-bottom: 4px;">
           <span style="font-size:13px; display:block;"><strong>Curso:</strong> ${c.nome || '-'}</span>
           <span style="font-size:12px; color:#666;">Valor: ${c.valor || '-'} | Venc: ${c.vencimento || '-'}</span>
        </div>
      `).join('');

      const card = document.createElement('div');
      card.className = `cobranca-card status-${safeClass}`;
  
      card.innerHTML = `
        <div class="card-info">
          <div style="display:flex; justify-content:space-between; align-items:start;">
             <h3>${aluno.Nome}</h3>
             ${aluno.listaCursos.length > 1 ? `<span style="background:#e7f1ff; color:#007bff; font-size:10px; padding:2px 6px; border-radius:10px; font-weight:bold;">${aluno.listaCursos.length} CURSOS</span>` : ''}
          </div>
          
          <div style="margin: 10px 0;">
            ${cursosHTML}
          </div>

          <p style="margin-top:5px; font-size:12px; color:#555;">
              📞 Total Ligações: <strong>${aluno.LigaEtapa || 0}</strong> | 💬 Total Templates: <strong>${aluno.TemplateEtapa || 0}</strong> ${diasLabel}
          </p>
          <p class="limit-date">⚠️ Jurídico em: ${dataLimite}</p>
          ${statusLabelHtml}
        </div>
        <div class="card-actions">
          <button class="btn-actions-open" onclick='window.openActionsModal(${JSON.stringify(aluno)})'>⚡ Ações</button>
          <div class="small-actions">
            <button class="icon-btn trash-icon admin-only" onclick="window.archiveStudent('${aluno.id}')">🗑️</button>
          </div>
        </div>
      `;
      container.appendChild(card);
  });
}
window.renderCobrancaList = renderCobrancaList;

// -------------------------
// 3. MODAL DE IMPORTAÇÃO
// -------------------------
export function openImportModal() {
    const overlay = document.getElementById('import-modal-overlay');
    if(overlay) {
        overlay.classList.remove('modal-hidden');
        overlay.style.display = 'flex';
    }
}
window.openImportModal = openImportModal;

export function closeImportModal() {
    const overlay = document.getElementById('import-modal-overlay');
    if(overlay) overlay.classList.add('modal-hidden');
}
window.closeImportModal = closeImportModal;

export async function processImportRaw(rawData) {
  if (!rawData) return 0;
  const lines = rawData.trim().split('\n');
  let successCount = 0;

  const promises = lines.map(async (row) => {
    const cols = row.split('\t');
    if (cols.length < 3) return;

    const data3Cob = parseDateBR(cols[8]?.trim());
    const data1Jur = parseDateBR(cols[9]?.trim());

    const alunoData = {
      Nome: cols[0]?.trim() || '',
      Email: cols[1]?.trim() || '',
      CPF: cols[2]?.trim() || '',
      Telefone: cols[3]?.trim() || '',
      Curso: cols[4]?.trim() || '',
      FormaPag: cols[5]?.trim() || '',
      Valor: cols[6]?.trim() || '',
      Vencimento: cols[7]?.trim() || '',
      Data3Cob: data3Cob || new Date(),
      Data1Jur: data1Jur || new Date(),
      LigaEtapa: 0,
      TemplateEtapa: 0,
      Status: 'Ativo',
      createdAt: new Date()
    };

    await addDoc(collection(db, COBRANCA_COLLECTION), alunoData);
    successCount++;
  });

  await Promise.all(promises);
  return successCount;
}

window.processImport = async function () {
  const raw = document.getElementById('import-data')?.value || '';
  if (!raw) return Swal.fire('Ops!', 'Cole os dados primeiro.', 'warning');
  
  // Fecha o modal de input para focar no loading
  window.closeImportModal();

  // Loading
  Swal.fire({
      title: 'Importando...',
      html: 'Processando linhas do Excel.',
      didOpen: () => Swal.showLoading()
  });
  
  try {
    const count = await processImportRaw(raw);
    
    // Sucesso com detalhes
    Swal.fire({
        title: 'Importação Concluída!',
        text: `${count} novos alunos foram adicionados.`,
        icon: 'success'
    });
    
    loadCobrancaData();
  } catch (err) {
    console.error(err);
    Swal.fire('Erro na Importação', 'Verifique o formato das colunas.', 'error');
  }
};

async function salvarTagParaTodosOsCursos(alunoAgrupado, novaTag) {
  const batch = writeBatch(db);
  const userEmail = getCurrentUserEmail();
  const ids = alunoAgrupado.todosIds || [alunoAgrupado.id];

  ids.forEach(docId => {
    const docRef = doc(db, COBRANCA_COLLECTION, docId);
    
    if (novaTag) {
      batch.update(docRef, {
        StatusExtra: { tipo: novaTag, atualizadoEm: new Date(), por: userEmail },
        UltimoResponsavel: userEmail,
        DataTag: new Date(),
        HistoricoLogs: arrayUnion({
          tipo: "tag",
          detalhe: `Tag "${novaTag}" adicionada via card agrupado`,
          responsavel: userEmail,
          timestamp: new Date().toISOString()
        })
      });
    } else {
      batch.update(docRef, {
        StatusExtra: deleteField(),
        DataTag: deleteField(),
        UltimoResponsavel: userEmail,
        HistoricoLogs: arrayUnion({
          tipo: "tag",
          detalhe: `Tag removida via card agrupado`,
          responsavel: userEmail,
          timestamp: new Date().toISOString()
        })
      });
    }
  });

  return await batch.commit();
}

// -------------------------
// 4. MODAL DE AÇÕES (DETALHES)
// -------------------------
// Variável global para armazenar os dados do grupo atual que está sendo editado
let currentGroupedStudent = null;

export function openActionsModal(alunoObjeto) {
  // alunoObjeto agora é o objeto completo que enviamos via JSON.stringify no renderCobrancaList
  if (!alunoObjeto) return;

  // Armazenamos o objeto completo e a lista de IDs para o salvamento em lote posterior
  currentGroupedStudent = alunoObjeto;
  window.currentActionStudentId = alunoObjeto.id; // Mantemos compatibilidade com funções antigas que usem apenas o ID principal

  // 1. Preenche Dados básicos (Campos compartilhados)
  document.getElementById('actions-student-name').textContent = alunoObjeto.Nome;
  
  // Calculamos o valor total somado de todos os cursos para exibição no topo
  const totalCursos = alunoObjeto.listaCursos.length;
  
  // Criamos o HTML para listar todos os cursos e seus respectivos valores/vencimentos
  const cursosListaHtml = alunoObjeto.listaCursos.map(curso => `
    <div style="background: #f8f9fa; border-left: 3px solid var(--primary-blue); padding: 8px 12px; margin-bottom: 8px; border-radius: 4px;">
      <p style="margin:0; font-size: 14px;"><strong>Curso:</strong> ${curso.nome || '-'}</p>
      <p style="margin:0; font-size: 12px; color: #666;">Valor: ${curso.valor || '-'} | Vencimento: ${curso.vencimento || '-'}</p>
    </div>
  `).join('');

  document.getElementById('actions-student-details').innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
        <p style="margin:0;"><strong>Email:</strong> ${alunoObjeto.Email || '-'}</p>
        <p style="margin:0;"><strong>Telefone:</strong> ${alunoObjeto.Telefone || '-'}</p>
        <p style="margin:0;"><strong>CPF:</strong> ${alunoObjeto.CPF || '-'}</p>
        <p style="margin:0;"><strong>Total de Cursos:</strong> ${totalCursos}</p>
    </div>
    <div style="margin-top: 10px;">
        <p style="margin-bottom: 8px;"><strong>Detalhamento dos Contratos:</strong></p>
        ${cursosListaHtml}
    </div>
  `;

  // 2. Preenche o Select com o Status Atual (pegando a tag mais recente/urgente do grupo)
  const tagAtual = alunoObjeto.StatusExtra?.tipo || alunoObjeto.StatusExtra || '';
  const select = document.getElementById("extra-status-select");
  if (select) select.value = tagAtual;

  // 2.1 Preenche os cursos do aluno e permite alteração do valor pago!
  const checkboxContainer = document.getElementById('course-checkbox-list');
  if (checkboxContainer) {
      checkboxContainer.innerHTML = alunoObjeto.listaCursos.map(curso => {
          // Limpamos o valor (R$ 1.500,00 -> 1500.00) para o input numérico
          const valorNumerico = curso.valor ? parseFloat(curso.valor.replace(/[^\d,.-]/g, '').replace('.', '').replace(',', '.')) : 0;

          return `
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; background: #fff; padding: 5px 10px; border-radius: 5px;">
                  <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                      <input type="checkbox" class="course-payment-check" value="${curso.id}" id="chk-${curso.id}" checked>
                      <label for="chk-${curso.id}" style="font-size: 13px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">
                          ${curso.nome}
                      </label>
                  </div>
                  <div style="display: flex; align-items: center; gap: 4px;">
                      <span style="font-size: 12px; font-weight: bold; color: #28a745;">R$</span>
                      <input type="text" 
                            class="course-payment-amount" 
                            data-id="${curso.id}" 
                            value="${valorNumerico.toLocaleString('pt-BR', {minimumFractionDigits: 2})}" 
                            style="width: 90px; padding: 3px; border: 1px solid #ccc; border-radius: 4px; text-align: right; font-weight: bold; color: #28a745;">
                  </div>
              </div>
          `;
      }).join('');
  }

  // 3. Preenche Propostas (usa as propostas do registro principal do grupo)
  const props = alunoObjeto.Propostas || {};
  for(let i=1; i<=4; i++) {
      const el = document.getElementById(`prop-${i}`);
      if(el) el.value = props[`p${i}`] || '';
  }

  // 4. Atualiza botões de etapa (passando o objeto agrupado)
  if (typeof updateStageButtons === 'function') {
      updateStageButtons(alunoObjeto);
  }

  // 5. Atualiza a cor do cabeçalho do Modal (Visual)
  const modalHeader = document.querySelector('.actions-header');
  if (modalHeader) {
      modalHeader.className = 'actions-header'; 
      if(tagAtual) {
          const safe = String(tagAtual).replace(/[\s_]+/g, '-').toLowerCase();
          modalHeader.classList.add(`header-status-${safe}`);
      }
  }

  // 6. Exibe o Modal
  const overlay = document.getElementById('actions-modal-overlay');
  if (overlay) {
    overlay.classList.remove('modal-hidden');
    overlay.style.display = 'flex';
  }
}
window.openActionsModal = openActionsModal;

export function closeActionsModal() {
  const overlay = document.getElementById("actions-modal-overlay");
  if (overlay) overlay.classList.add("modal-hidden");
}
window.closeActionsModal = closeActionsModal;

// -------------------------
// 5. ETAPAS (LIGAÇÃO / TEMPLATE) COM LOG
// -------------------------
export function updateStageButtons(aluno) {
  const callBtn = document.getElementById("btn-next-call");
  const tempBtn = document.getElementById("btn-next-template");
  const infoTxt = document.getElementById("last-action-info");

  const callStep = (aluno.LigaEtapa || 0) + 1;
  const tempStep = (aluno.TemplateEtapa || 0) + 1;

  if (callBtn) callBtn.textContent = `📞 Ligar #${callStep}`;
  if (tempBtn) tempBtn.textContent = `💬 Template #${tempStep}`;
  
  // Exibe quem fez a última ação
  if (infoTxt && aluno.UltimaAcao) {
      const date = aluno.UltimaAcao.toDate ? aluno.UltimaAcao.toDate() : new Date(aluno.UltimaAcao);
      const responsavel = aluno.UltimoResponsavel || 'Sistema';
      infoTxt.innerHTML = `Última: ${date.toLocaleString('pt-BR')}<br><small>Por: ${responsavel}</small>`;
  } else if (infoTxt) {
      infoTxt.textContent = '';
  }
}
window.updateStageButtons = updateStageButtons;

export async function nextCallStage() {
  if (!currentActionStudentId) return;
  const aluno = window.cobrancaList.find(a => a.id === currentActionStudentId);
  if (!aluno) return;

  const novaEtapa = (aluno.LigaEtapa || 0) + 1;
  const userEmail = getCurrentUserEmail(); 
  
  try {
    const alunoRef = doc(db, COBRANCA_COLLECTION, currentActionStudentId);
    await updateDoc(alunoRef, {
      LigaEtapa: novaEtapa,
      UltimaAcao: new Date(),
      UltimoResponsavel: userEmail,
      HistoricoLogs: arrayUnion({
        tipo: 'ligacao',
        detalhe: `Ligação #${novaEtapa} realizada`,
        responsavel: userEmail,
        timestamp: new Date().toISOString()
      })
    });

    aluno.LigaEtapa = novaEtapa;
    aluno.UltimaAcao = new Date();
    aluno.UltimoResponsavel = userEmail;
    
    updateStageButtons(aluno);
    renderCobrancaList(window.cobrancaList);

  } catch (err) {
    console.error(err);
    alert("Erro ao salvar etapa.");
  }
}
window.nextCallStage = nextCallStage;

export async function nextTemplateStage() {
  if (!currentActionStudentId) return;
  const aluno = window.cobrancaList.find(a => a.id === currentActionStudentId);
  if (!aluno) return;

  const novaEtapa = (aluno.TemplateEtapa || 0) + 1;
  const userEmail = getCurrentUserEmail();
  
  try {
    const alunoRef = doc(db, COBRANCA_COLLECTION, currentActionStudentId);
    await updateDoc(alunoRef, {
      TemplateEtapa: novaEtapa,
      UltimaAcao: new Date(),
      UltimoResponsavel: userEmail,
      HistoricoLogs: arrayUnion({
        tipo: 'template',
        detalhe: `Template #${novaEtapa} enviado`,
        responsavel: userEmail,
        timestamp: new Date().toISOString()
      })
    });

    aluno.TemplateEtapa = novaEtapa;
    aluno.UltimaAcao = new Date();
    aluno.UltimoResponsavel = userEmail;
    
    updateStageButtons(aluno);
    renderCobrancaList(window.cobrancaList);

  } catch (err) {
    console.error(err);
    alert("Erro ao salvar etapa.");
  }
}
window.nextTemplateStage = nextTemplateStage;

// -------------------------
// 6. PROPOSTAS COM LOG DE QUEM DIGITOU
// -------------------------
window.saveProposal = async function(index) {
  if (!currentActionStudentId) return;
  
  const textArea = document.getElementById(`prop-${index}`);
  const newText = textArea ? textArea.value : '';
  
  const aluno = window.cobrancaList.find(a => a.id === currentActionStudentId);
  if(!aluno.Propostas) aluno.Propostas = {};
  
  const oldText = aluno.Propostas[`p${index}`] || '';
  if (newText === oldText) return;

  aluno.Propostas[`p${index}`] = newText;
  const userEmail = getCurrentUserEmail();

  try {
      await updateDoc(doc(db, COBRANCA_COLLECTION, currentActionStudentId), { 
          Propostas: aluno.Propostas,
          HistoricoLogs: arrayUnion({
              tipo: 'proposta',
              detalhe: `Editou Proposta ${index}`,
              conteudo: newText.substring(0, 50) + "...", 
              responsavel: userEmail,
              timestamp: new Date().toISOString()
          })
      });
      console.log(`Proposta ${index} salva por ${userEmail}`);
  } catch(e) { console.error(e); }
};

// -------------------------
// 7. STATUS EXTRA & PAGAMENTO
// -------------------------
window.saveExtraStatus = async function () {
  // 1. Verifica se há um aluno selecionado (seja agrupado ou individual)
  const alunoParaAtualizar = currentGroupedStudent || (currentActionStudentId ? { id: currentActionStudentId, todosIds: [currentActionStudentId] } : null);

  if (!alunoParaAtualizar) return;
  
  const sel = document.getElementById('extra-status-select');
  const value = sel ? sel.value : '';

  try {
    // 2. CHAMADA DA FUNÇÃO (Isso ativa a função que estava apagada!)
    await salvarTagParaTodosOsCursos(alunoParaAtualizar, value);

    // 3. Sincroniza a memória local para o card atualizar na tela sem F5
    const ids = alunoParaAtualizar.todosIds || [alunoParaAtualizar.id];
    ids.forEach(id => {
      const idx = window.cobrancaList.findIndex(a => a.id === id);
      if (idx > -1) {
        if (value) {
          window.cobrancaList[idx].StatusExtra = { tipo: value };
          window.cobrancaList[idx].DataTag = new Date();
        } else {
          delete window.cobrancaList[idx].StatusExtra;
          delete window.cobrancaList[idx].DataTag;
        }
      }
    });

    // 4. Atualiza a lista visual e o cabeçalho do modal
    renderCobrancaList(window.cobrancaList);
    
    const modalHeader = document.querySelector('.actions-header');
    if (modalHeader) {
      modalHeader.className = 'actions-header';
      if (value) {
        const safe = value.replace(/[\s_]+/g, '-').toLowerCase();
        modalHeader.classList.add(`header-status-${safe}`);
      }
    }

    window.showToast(value ? "Status atualizado em todos os cursos!" : "Status removido!");

  } catch (error) { 
    console.error("Erro ao processar salvamento:", error); 
    window.showToast("Erro ao atualizar os cursos.", "error");
  }
};

window.registerPayment = async function() {
    if (!currentGroupedStudent) return;

    // 1. Captura os cursos marcados
    const checkboxes = document.querySelectorAll('.course-payment-check:checked');
    
    if (checkboxes.length === 0) {
        return Swal.fire('Atenção', 'Selecione pelo menos um curso para baixar.', 'warning');
    }

    const dateVal = document.getElementById('payment-date')?.value;
    const originVal = document.getElementById('payment-origin')?.value;
    const userEmail = getCurrentUserEmail();

    if (!dateVal || !originVal) {
        return Swal.fire('Campos Obrigatórios', 'Preencha a data e a origem.', 'warning');
    }

    const result = await Swal.fire({
        title: 'Confirmar Baixa?',
        text: "Os valores editados serão registrados como o pagamento final destes cursos.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#28a745',
        confirmButtonText: 'Sim, registrar!'
    });

    if (!result.isConfirmed) return;

    try {
        Swal.fire({ title: 'Processando...', didOpen: () => Swal.showLoading() });

        const [ano, mes, dia] = dateVal.split('-').map(Number);
        const dataCorreta = new Date(ano, mes - 1, dia, 12, 0, 0);

        const batch = writeBatch(db);
        
        // 2. Iterar pelos itens selecionados para pegar o valor de cada input
        checkboxes.forEach(cb => {
            const docId = cb.value;
            // Busca o input de valor correspondente a este curso (pelo data-id)
            const inputValor = document.querySelector(`.course-payment-amount[data-id="${docId}"]`);
            const valorFinal = inputValor ? inputValor.value : "0,00";

            const docRef = doc(db, COBRANCA_COLLECTION, docId);
            batch.update(docRef, {
                Status: 'Pago',
                DataPagamento: dataCorreta,
                OrigemPagamento: originVal,
                ValorPago: `R$ ${valorFinal}`, // Registramos o valor que foi efetivamente pago
                BaixadoPor: userEmail,
                HistoricoLogs: arrayUnion({
                    tipo: "pagamento",
                    detalhe: `Baixa com valor ajustado: R$ ${valorFinal} (${originVal})`,
                    responsavel: userEmail,
                    timestamp: new Date().toISOString()
                })
            });
        });

        await batch.commit();
        
        closeActionsModal();
        Swal.fire('Sucesso!', 'Baixa(s) realizada(s) com os valores informados.', 'success');
        
        if (typeof loadCobrancaData === 'function') loadCobrancaData();

    } catch (error) { 
        console.error(error);
        Swal.fire('Erro', 'Falha ao processar pagamento.', 'error');
    }
};

async function setExtraTag(studentId, tagName) {
    try {
        const docRef = doc(db, COBRANCA_COLLECTION, studentId);
        
        await updateDoc(docRef, {
            StatusExtra: tagName, // A tag (ex: "Promessa Pagamento")
            DataTag: new Date()   // <--- O PULO DO GATO: Salva o momento exato
        });

        if(window.showToast) window.showToast("Tag aplicada!", "success");
        loadCobrancaData(); // Recarrega a tela
    } catch (e) {
        console.error(e);
    }
}

window.archiveStudent = async function(docId) {
  // 1. Substituindo o confirm nativo pelo SweetAlert2
  const result = await Swal.fire({
      title: 'Tem certeza?',
      text: "Você não poderá reverter isso!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545', // Vermelho (perigo)
      cancelButtonColor: '#6c757d',  // Cinza
      confirmButtonText: 'Sim, excluir!',
      cancelButtonText: 'Cancelar'
  });

  // 2. Se o usuário NÃO confirmou, paramos aqui.
  if (!result.isConfirmed) return;

  try {
    // Exibe loading enquanto deleta
    Swal.fire({ title: 'Excluindo...', didOpen: () => Swal.showLoading() });
    
    await deleteDoc(doc(db, COBRANCA_COLLECTION, docId));
    
    // Sucesso!
    Swal.fire(
      'Excluído!',
      'O registro foi removido.',
      'success'
    );
    
    loadCobrancaData();
  } catch (error) { 
      // Erro
      Swal.fire('Erro!', error.message, 'error');
  }
};

// -------------------------
// 8. EXPORTAR ATIVOS (SEM STATUS EXTRA)
// -------------------------
window.exportActiveCobranca = function() {
    // 1. Verificações de segurança (Mantido da antiga)
    if (!window.cobrancaList || window.cobrancaList.length === 0) {
        if(window.showToast) window.showToast("Não há dados carregados para exportar.", "warning");
        else alert("Não há dados carregados.");
        return;
    }

    // 2. Filtro (Mantido da antiga: Pega apenas quem NÃO tem StatusExtra)
    const dataToExport = window.cobrancaList.filter(aluno => {
        const temStatus = aluno.StatusExtra && aluno.StatusExtra.tipo && aluno.StatusExtra.tipo !== "";
        return !temStatus; 
    });

    if (dataToExport.length === 0) {
        if(window.showToast) window.showToast("Nenhum contato sem tag encontrado.", "info");
        else alert("Nenhum contato encontrado.");
        return;
    }

    // 3. Cabeçalho novo solicitado (Separado por vírgula)
    let csvContent = "number,info_1,info_2,info_3\n";

    dataToExport.forEach(row => {
        // --- LÓGICA DE TRATAMENTO DO TELEFONE (NOVA) ---
        let phone = (row.Telefone || "").toString().replace(/\D/g, ""); // Remove tudo que não é número

        // A. Remove o 55 do início se o número for longo (maior que 11 dígitos, ex: 55419...)
        if (phone.startsWith("55") && phone.length > 11) {
            phone = phone.substring(2);
        }

        // B. Verifica se precisa do 9º dígito
        // Se após limpar ficou com 10 dígitos (Ex: 41 8888 7777), insere o 9 na 3ª posição
        if (phone.length === 10) {
            const ddd = phone.substring(0, 2);
            const numero = phone.substring(2);
            phone = `${ddd}9${numero}`;
        }
        // -----------------------------------------------

        // Função auxiliar para limpar vírgulas dos textos (pois a vírgula agora é separador)
        const clean = (txt) => (txt ? String(txt).replace(/,/g, " ") : "");

        // Mapeamento das colunas
        const number = phone;
        const info1  = clean(row.Nome);             // info_1: Nome
        const info2  = clean(row.Email || "");      // info_2: Email
        const info3  = clean(row.Curso || "");      // info_3: Curso

        // Monta a linha
        csvContent += `${number},${info1},${info2},${info3}\n`;
    });

    // 4. Download do Arquivo (Mantido o BOM \ufeff para o Excel ler acentos corretamente)
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    
    link.setAttribute("href", url);
    // Nome do arquivo atualizado para identificar que é mailing
    link.setAttribute("download", `Mailing_Cobranca_${hoje}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// ==============================================================
// 9. RELATÓRIO DE PAGAMENTOS (NOVA FUNCIONALIDADE)
// ==============================================================

window.openPaymentsModal = function() {
    const overlay = document.getElementById('payments-modal-overlay');
    if(overlay) {
        overlay.classList.remove('modal-hidden');
        overlay.style.display = 'flex';
        loadPaymentsList(); 
    }
}

window.closePaymentsModal = function() {
    const overlay = document.getElementById('payments-modal-overlay');
    if(overlay) overlay.classList.add('modal-hidden');
}

async function loadPaymentsList() {
    const tbody = document.getElementById('payments-table-body');
    const countEl = document.getElementById('total-payments-count');
    
    if(tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center"><div class="loader-small"></div> Carregando...</td></tr>';

    try {
        // Busca apenas onde Status == 'Pago'
        const q = query(
            collection(db, COBRANCA_COLLECTION), 
            where("Status", "==", "Pago")
        );
        
        const snap = await getDocs(q);
        let list = [];
        
        snap.forEach(doc => {
            list.push({ id: doc.id, ...doc.data() });
        });

        list.sort((a, b) => {
            const dA = a.DataPagamento ? (a.DataPagamento.toDate ? a.DataPagamento.toDate() : new Date(a.DataPagamento)) : new Date(0);
            const dB = b.DataPagamento ? (b.DataPagamento.toDate ? b.DataPagamento.toDate() : new Date(b.DataPagamento)) : new Date(0);
            return dB - dA;
        });

        if(countEl) countEl.textContent = list.length;
        renderPaymentsTable(list);

    } catch (err) {
        console.error("Erro ao carregar pagamentos:", err);
        if(tbody) tbody.innerHTML = '<tr><td colspan="5" style="color:red; text-align:center;">Erro ao buscar dados.</td></tr>';
    }
}

function renderPaymentsTable(list) {
    const tbody = document.getElementById('payments-table-body');
    if(!tbody) return;
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">Nenhum pagamento registrado ainda.</td></tr>';
        return;
    }

    list.forEach(item => {
        const tr = document.createElement('tr');
        
        let dataBaixa = "-";
        if(item.DataPagamento) {
            const d = item.DataPagamento.toDate ? item.DataPagamento.toDate() : new Date(item.DataPagamento);
            dataBaixa = d.toLocaleDateString('pt-BR');
        }

        // LÓGICA DE PRIORIDADE: Prioriza o valor ajustado (ValorPago)
        const valorExibido = item.ValorPago || item.Valor || '-';
        
        // Estilização extra para identificar quando o valor foi alterado
        const estiloValor = item.ValorPago ? 'color: #28a745; font-weight: 700;' : 'font-weight: 600;';

        const responsavel = item.BaixadoPor || '<span style="color:#999; font-style:italic;">Não registrado</span>';

        tr.innerHTML = `
        <td><strong>${dataBaixa}</strong></td>
        <td>${item.Nome}</td>
        <td style="${estiloValor}">${valorExibido}</td>
        <td>
            <span style="background: #e9ecef; padding: 4px 10px; border-radius: 4px; font-size: 12px; white-space: nowrap; display: inline-block; line-height: 1.2;">
                ${item.OrigemPagamento || '-'}
            </span>
        </td>
        <td style="color: #198754; font-weight: 600;">${responsavel}</td>
    `;
    tbody.appendChild(tr);
    });
}

window.openSchedulingForGrouped = async function() {
    if (!currentGroupedStudent || !currentGroupedStudent.listaCursos) {
        return Swal.fire('Erro', 'Dados do aluno não encontrados.', 'error');
    }

    const cursos = currentGroupedStudent.listaCursos;

    // 1. Caso o aluno só tenha 1 curso, vai direto para o agendamento
    if (cursos.length === 1) {
        proceedToScheduling(cursos[0]);
        return;
    }

    // 2. Caso tenha mais de um, abre o Swal para seleção
    const optionsHtml = cursos.map((c, idx) => `
        <div style="text-align: left; margin-bottom: 12px; padding: 12px; border: 1px solid #e0e0e0; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 10px;" 
             onclick="document.getElementById('radio-sched-${idx}').checked = true">
            <input type="radio" name="swal-course-choice" id="radio-sched-${idx}" value="${idx}" ${idx === 0 ? 'checked' : ''} style="cursor:pointer; width: 18px; height: 18px;">
            <label for="radio-sched-${idx}" style="cursor:pointer; flex: 1;">
                <strong style="display:block; font-size: 14px; color: #333;">${c.nome}</strong>
                <span style="font-size: 12px; color: #6A1B9A; font-weight: 700;">Valor: ${c.valor}</span>
            </label>
        </div>
    `).join('');

    const { value: selectedIndex } = await Swal.fire({
        title: 'Selecionar Curso',
        text: 'Para qual destes cursos você deseja agendar o link?',
        html: `<div style="margin-top: 15px;">${optionsHtml}</div>`,
        showCancelButton: true,
        confirmButtonText: 'Continuar para Agendamento',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#6A1B9A',
        preConfirm: () => {
            const selected = document.querySelector('input[name="swal-course-choice"]:checked');
            if (!selected) {
                Swal.showValidationMessage('Selecione um curso para continuar');
                return false;
            }
            return selected.value;
        }
    });

    if (selectedIndex !== undefined) {
        proceedToScheduling(cursos[selectedIndex]);
    }
};

// Expor globalmente para o HTML acessar
window.loadPaymentsList = loadPaymentsList;

// -------------------------
// 10. EXPORTAR PAGAMENTOS (EXCEL)
// -------------------------
window.exportPaymentsExcel = async function() {
    // 1. Busca os dados atualizados (Status = Pago)
    try {
        const q = query(
            collection(db, COBRANCA_COLLECTION), 
            where("Status", "==", "Pago")
        );
        const snap = await getDocs(q);
        
        if (snap.empty) return alert("Não há pagamentos para exportar.");

        let list = [];
        snap.forEach(doc => list.push(doc.data()));

        // 2. Ordena por DataPagamento
        list.sort((a, b) => {
            const dA = a.DataPagamento ? (a.DataPagamento.toDate ? a.DataPagamento.toDate() : new Date(a.DataPagamento)) : new Date(0);
            const dB = b.DataPagamento ? (b.DataPagamento.toDate ? b.DataPagamento.toDate() : new Date(b.DataPagamento)) : new Date(0);
            return dB - dA;
        });

        // 3. Monta Tabela HTML para o Excel
        let table = `
            <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
            <head><meta charset="UTF-8"></head>
            <body>
            <table border="1">
                <thead>
                    <tr style="background-color: #198754; color: white;">
                        <th>NOME</th>
                        <th>E-MAIL</th>
                        <th>CPF</th>
                        <th>TELEFONE</th>
                        <th>CURSO</th>
                        <th>FORMA DE PG</th>
                        <th>VALOR</th>
                        <th>VENCIMENTO</th>
                        <th>DATA 3° COB</th>
                        <th>DATA 1° JUR.</th>
                        <th>DATA DO PAGAMENTO</th>
                        <th>RESPONSÁVEL PELO LINK</th>
                        <th>CLASSIFICAÇÃO DO PAGAMENTO</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // Helper para formatar data
        const fmt = (d) => {
            if (!d) return '-';
            const dateObj = d.toDate ? d.toDate() : new Date(d);
            return isNaN(dateObj) ? '-' : dateObj.toLocaleDateString('pt-BR');
        };

        list.forEach(item => {
            table += `
                <tr>
                    <td>${item.Nome || '-'}</td>
                    <td>${item.Email || '-'}</td>
                    <td style="mso-number-format:'@'">${item.CPF || '-'}</td> <td style="mso-number-format:'@'">${item.Telefone || '-'}</td>
                    <td>${item.Curso || '-'}</td>
                    <td>${item.FormaPag || '-'}</td>
                    <td>${item.Valor || '-'}</td>
                    <td>${item.Vencimento || '-'}</td>
                    <td>${fmt(item.Data3Cob)}</td>
                    <td>${fmt(item.Data1Jur)}</td>
                    <td>${fmt(item.DataPagamento)}</td>
                    <td>${item.BaixadoPor || '-'}</td>
                    <td>${item.OrigemPagamento || '-'}</td>
                </tr>
            `;
        });

        table += `</tbody></table></body></html>`;

        // 4. Download
        const blob = new Blob([table], { type: 'application/vnd.ms-excel' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
        a.download = `Relatorio_Pagamentos_3Cob_${hoje}.xls`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

    } catch (err) {
        console.error("Erro export:", err);
        alert("Erro ao exportar pagamentos.");
    }
};

// =========================================================
// 10. EXPORTAR ALUNOS PENDENTES (Sem Tag E Sem Ligação Recente)
// =========================================================
window.exportNoAnswerStudents = function() {
    // 1. Pergunta o intervalo
    const horasInput = prompt("Exportar alunos SEM TAG e que NÃO receberam ligação nas últimas X horas:", "3");
    if (horasInput === null) return; 

    const horas = parseFloat(horasInput.replace(',', '.'));
    if (isNaN(horas) || horas < 0) return alert("Digite um número válido.");

    const agora = new Date();
    // Define o corte: Tudo antes de (Agora - 3h) é considerado "antigo"
    const tempoCorte = new Date(agora.getTime() - (horas * 60 * 60 * 1000));

    // 2. Filtra a lista
    const listaParaExportar = window.cobrancaList.filter(aluno => {
        
        // CONDICÃO A: NÃO PODE TER TAG (Status Extra)
        // Se tiver tag (Acordo, Recado, etc), ele já foi tratado -> SAI DA LISTA
        const temTag = aluno.StatusExtra && aluno.StatusExtra.tipo && aluno.StatusExtra.tipo !== "";
        if (temTag) return false; 

        // CONDICÃO B: NÃO PODE TER LOG RECENTE
        const logs = aluno.HistoricoLogs || [];
        
        // Verifica se existe ALGUM log de 'ligacao' feito DEPOIS do tempo de corte
        const teveLigacaoRecente = logs.some(log => {
            if (log.tipo !== 'ligacao') return false;
            const dataLog = new Date(log.timestamp); 
            return dataLog > tempoCorte; // Retorna TRUE se for recente (ex: 1h atrás)
        });

        // Se teve ligação recente -> SAI DA LISTA (já mexeram nele)
        if (teveLigacaoRecente) return false;

        // Se chegou aqui: Não tem Tag E Não tem Ligação Recente -> ENTRA NA LISTA
        return true;
    });

    if (listaParaExportar.length === 0) {
        return alert(`Nenhum aluno pendente encontrado (Sem tag e sem ligação nas últimas ${horas}h).`);
    }

    // 3. Confirmação
    if(!confirm(`Encontrei ${listaParaExportar.length} alunos que não foram trabalhados nas últimas ${horas}h e estão sem tag.\nBaixar Excel?`)) return;

    // 4. Gera Excel
    let table = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"></head>
        <body>
        <table border="1">
            <thead>
                <tr style="background-color: #ff9800; color: white;"> <th>NOME</th>
                    <th>TELEFONE</th>
                    <th>E-MAIL</th>
                    <th>VALOR</th>
                    <th>VENCIMENTO</th>
                    <th>DIAS ATRASO</th>
                    <th>ÚLTIMA AÇÃO (ANTIGA)</th>
                </tr>
            </thead>
            <tbody>
    `;

    listaParaExportar.forEach(item => {
        let ultimaAcaoStr = 'Nunca';
        if (item.UltimaAcao) {
            const d = item.UltimaAcao.toDate ? item.UltimaAcao.toDate() : new Date(item.UltimaAcao);
            ultimaAcaoStr = d.toLocaleString('pt-BR');
        }

        table += `
            <tr>
                <td>${item.Nome || '-'}</td>
                <td style="mso-number-format:'@'">${item.Telefone || '-'}</td>
                <td>${item.Email || '-'}</td>
                <td>${item.Valor || '-'}</td>
                <td>${item.Vencimento || '-'}</td>
                <td>${item.diasAtrasoCalculado || '-'}</td>
                <td>${ultimaAcaoStr}</td>
            </tr>
        `;
    });

    table += `</tbody></table></body></html>`;

    const blob = new Blob([table], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Nome sugestivo: Pendentes_3h.xls
    const nomeArquivo = `Pendentes_${horas}h_${agora.getHours()}h${agora.getMinutes()}.xls`;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

// Função para levar dados da Cobrança para a Agenda
window.bridgeToAgenda = async function() {
    // 1. Segurança: Verifica se temos o aluno agrupado em memória
    // Usamos o objeto que criamos no openActionsModal para ter acesso a todos os cursos
    const aluno = currentGroupedStudent || (window.cobrancaList ? window.cobrancaList.find(a => a.id === currentActionStudentId) : null);
    
    if (!aluno) {
        return Swal.fire('Erro', 'Dados do aluno não encontrados para importação.', 'error');
    }

    const cursos = aluno.listaCursos || [{ nome: aluno.Curso, valor: aluno.Valor }];
    let cursoSelecionado = cursos[0];

    // 2. Lógica de Seleção: Se houver mais de um curso, pergunta qual agendar
    if (cursos.length > 1) {
        const optionsHtml = cursos.map((c, idx) => `
            <div style="text-align: left; margin-bottom: 10px; padding: 10px; border: 1px solid #ddd; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 10px;" 
                 onclick="document.getElementById('swal-radio-${idx}').checked = true">
                <input type="radio" name="selectedCourseIdx" id="swal-radio-${idx}" value="${idx}" ${idx === 0 ? 'checked' : ''}>
                <label for="swal-radio-${idx}" style="flex: 1; cursor: pointer;">
                    <strong style="display:block; font-size: 14px;">${c.nome}</strong>
                    <span style="font-size: 12px; color: #666;">Valor: ${c.valor}</span>
                </label>
            </div>
        `).join('');

        const { value: index } = await Swal.fire({
            title: 'Escolha o Curso',
            text: 'Para qual curso você deseja gerar o agendamento?',
            html: `<div style="margin-top:15px;">${optionsHtml}</div>`,
            showCancelButton: true,
            confirmButtonText: 'Confirmar e Ir',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#6A1B9A',
            preConfirm: () => {
                const picked = document.querySelector('input[name="selectedCourseIdx"]:checked');
                return picked ? picked.value : null;
            }
        });

        if (index === undefined) return; // Usuário cancelou
        cursoSelecionado = cursos[index];
    }

    // 3. Execução da Transição (Seu código original adaptado)
    
    // A. Fecha o Modal de Ações e o Overlay
    const actionsOverlay = document.getElementById('actions-modal-overlay');
    if (actionsOverlay) {
        actionsOverlay.classList.add('modal-hidden');
        actionsOverlay.style.display = 'none';
    }

    // B. Troca de Aba (Sidebar)
    const tabBtn = document.querySelector('button[onclick*="tab-agendamento"]') || 
                   document.querySelector('[data-target="tab-agendamento"]');
    
    if (tabBtn) {
        tabBtn.click();
    } else {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
        const tabTarget = document.getElementById('tab-agendamento');
        if (tabTarget) tabTarget.classList.remove('hidden');
    }

    // C. Preenchimento do Formulário (#link-schedule-form)
    // Usamos um pequeno timeout para garantir que a aba carregou no DOM
    setTimeout(() => {
        const form = document.getElementById('link-schedule-form');
        if (form) {
            const campos = {
                'Nome': aluno.Nome,
                'Email': aluno.Email,
                'Curso': cursoSelecionado.nome,
                'Telefone': aluno.Telefone
            };

            for (const [name, value] of Object.entries(campos)) {
                const input = form.querySelector(`[name="${name}"]`);
                if (input) input.value = value || '';
            }
            
            // Foca no campo de Motivo
            const inpMotivo = form.querySelector('[name="Motivo"]');
            if (inpMotivo) inpMotivo.focus();
        }

        if(window.showToast) window.showToast(`Dados de ${cursoSelecionado.nome} importados!`, "success");
    }, 300);
};