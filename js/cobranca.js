// js/cobranca.js
console.log("--> Carregando módulo cobrança...");

import { db, auth } from './firebase.js'; 
import {
  collection, getDocs, query, orderBy, addDoc,
  updateDoc, doc, arrayUnion, deleteDoc, where // <--- 'where' adicionado aqui
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
// 1. CARREGAR E FILTRAR
// -------------------------
export async function loadCobrancaData() {
  const container = document.getElementById('cobranca-list');
  if (container) container.innerHTML = '<div class="loader"></div>';

  try {
    const q = query(collection(db, COBRANCA_COLLECTION), orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);

    window.cobrancaList = [];
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      
      let dataJuridico = null;
      if (data.Data1Jur?.toDate) dataJuridico = data.Data1Jur.toDate();
      else if (typeof data.Data1Jur === 'string' && data.Data1Jur.trim() !== '') dataJuridico = new Date(data.Data1Jur);

      const expirado = dataJuridico && hoje >= dataJuridico;

      if (data.Status === 'Ativo' && !expirado) {
        window.cobrancaList.push({ id: docSnap.id, ...data });
      }
    });

    const kpiEl = document.getElementById('total-active-count');
    if (kpiEl) kpiEl.textContent = window.cobrancaList.length;

    renderCobrancaList(window.cobrancaList);

  } catch (error) {
    console.error("Erro ao carregar cobrança:", error);
    if (container) container.innerHTML = '<p>Erro ao carregar dados.</p>';
  }
}
window.loadCobrancaData = loadCobrancaData;

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

// -------------------------
// 2. RENDERIZAR LISTA
// -------------------------
export function renderCobrancaList(data) {
  const container = document.getElementById('cobranca-list');
  if (!container) return;

  container.innerHTML = '';

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="empty-msg">Nenhum aluno encontrado.</p>';
    return;
  }

  // Ordenação por data de criação
  const sortedData = data.sort((a, b) => {
    const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
    const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
    return tB - tA;
  });

  sortedData.forEach(aluno => {
    const dataLimite = aluno.Data1Jur ? formatDateUTC(aluno.Data1Jur) : 'N/A';
    
    // Status
    const statusTipo = aluno.StatusExtra?.tipo || "nenhum";
    const safeClass = String(statusTipo).replace(/_/g, '-').replace(/\s+/g, '-').toLowerCase();
    const statusLabelHtml = aluno.StatusExtra?.tipo
      ? `<p class="extra-status">${mapStatusToLabel(aluno.StatusExtra.tipo)}</p>`
      : '';

    const ligaCount = aluno.LigaEtapa || 0;
    const msgCount = aluno.TemplateEtapa || 0;

    const card = document.createElement('div');
    card.className = `cobranca-card status-${safeClass}`;

    card.innerHTML = `
      <div class="card-info">
        <h3>${aluno.Nome}</h3>
        <p style="margin-top:10px;"><strong>Curso:</strong> ${aluno.Curso || '-'}</p>
        <p><strong>Valor:</strong> ${aluno.Valor || '-'} | <strong>Venc:</strong> ${aluno.Vencimento || '-'}</p>
        <p style="margin-top:5px; font-size:12px; color:#555;">
           📞 Ligações: <strong>${ligaCount}</strong> | 💬 Templates: <strong>${msgCount}</strong>
        </p>
        <p class="limit-date">⚠️ Jurídico em: ${dataLimite}</p>
        ${statusLabelHtml}
      </div>
      <div class="card-actions">
        <button class="btn-actions-open" onclick="window.openActionsModal('${aluno.id}')">⚡ Ações</button>
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
  if (!raw) return alert('Cole os dados primeiro.');
  
  try {
    const count = await processImportRaw(raw);
    window.closeImportModal();
    alert(`${count} alunos importados!`);
    loadCobrancaData();
  } catch (err) {
    console.error('Erro import:', err);
    alert('Erro ao importar.');
  }
};

// -------------------------
// 4. MODAL DE AÇÕES (DETALHES)
// -------------------------
export function openActionsModal(docId) {
  const aluno = window.cobrancaList.find(a => a.id === docId);
  if (!aluno) return;

  currentActionStudentId = docId;
  
  // Dados básicos
  document.getElementById('actions-student-name').textContent = aluno.Nome;
  document.getElementById('actions-student-details').innerHTML = `
    <p><strong>Email:</strong> ${aluno.Email || '-'}</p>
    <p><strong>Telefone:</strong> ${aluno.Telefone || '-'}</p>
    <p><strong>CPF:</strong> ${aluno.CPF || '-'}</p>
    <p><strong>Valor:</strong> ${aluno.Valor || '-'} (${aluno.FormaPag || '-'})</p>
  `;

  // Status
  const select = document.getElementById("extra-status-select");
  if (select) select.value = aluno.StatusExtra?.tipo || '';

  // Propostas
  const props = aluno.Propostas || {};
  for(let i=1; i<=4; i++) {
      const el = document.getElementById(`prop-${i}`);
      if(el) el.value = props[`p${i}`] || '';
  }

  updateStageButtons(aluno);

  // Header Color
  const modalHeader = document.querySelector('.actions-header');
  if (modalHeader) {
    modalHeader.className = 'actions-header';
    const statusExtra = aluno.StatusExtra?.tipo || '';
    if (statusExtra) {
      const safeClass = statusExtra.replace(/_/g, '-').replace(/\s+/g, '-').toLowerCase();
      modalHeader.classList.add(`header-status-${safeClass}`);
    }
  }

  // Show
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
  if (!currentActionStudentId) return;
  const sel = document.getElementById('extra-status-select');
  const value = sel ? sel.value : '';
  const userEmail = getCurrentUserEmail();

  try {
    await updateDoc(doc(db, COBRANCA_COLLECTION, currentActionStudentId), {
      StatusExtra: { tipo: value, atualizadoEm: new Date(), por: userEmail },
      UltimoResponsavel: userEmail
    });
    
    const idx = window.cobrancaList.findIndex(a => a.id === currentActionStudentId);
    if (idx > -1) {
      window.cobrancaList[idx].StatusExtra = { tipo: value };
      renderCobrancaList(window.cobrancaList);
      
      const modalHeader = document.querySelector('.actions-header');
      modalHeader.className = 'actions-header';
      if(value) {
          const safe = value.replace(/_/g, '-').toLowerCase();
          modalHeader.classList.add(`header-status-${safe}`);
      }
    }
  } catch (error) { console.error(error); }
};

window.registerPayment = async function() {
  if (!currentActionStudentId) return;
  const dateVal = document.getElementById('payment-date')?.value;
  const originVal = document.getElementById('payment-origin')?.value;
  const userEmail = getCurrentUserEmail();

  if (!dateVal || !originVal) return alert("Preencha data e origem.");
  if (!confirm("Confirmar pagamento e remover da lista?")) return;

  try {
    await updateDoc(doc(db, COBRANCA_COLLECTION, currentActionStudentId), {
      Status: 'Pago',
      DataPagamento: new Date(dateVal),
      OrigemPagamento: originVal,
      BaixadoPor: userEmail
    });
    alert("Pagamento registrado!");
    closeActionsModal();
    loadCobrancaData();
  } catch (error) { alert("Erro: " + error.message); }
};

window.archiveStudent = async function(docId) {
  if (!confirm("Remover aluno permanentemente?")) return;
  try {
    await deleteDoc(doc(db, COBRANCA_COLLECTION, docId));
    loadCobrancaData();
  } catch (error) { alert("Erro ao excluir: " + error.message); }
};

// -------------------------
// 8. EXPORTAR ATIVOS (SEM STATUS EXTRA)
// -------------------------
window.exportActiveCobranca = function() {
    if (!window.cobrancaList || window.cobrancaList.length === 0) {
        return alert("Não há dados carregados para exportar.");
    }

    const dataToExport = window.cobrancaList.filter(aluno => {
        const temStatus = aluno.StatusExtra && aluno.StatusExtra.tipo && aluno.StatusExtra.tipo !== "";
        return !temStatus; 
    });

    if (dataToExport.length === 0) {
        return alert("Nenhum aluno ativo 'sem status' encontrado para exportação.");
    }

    let csvContent = "Telefone;Nome;Email;Valor\n";

    dataToExport.forEach(row => {
        const clean = (txt) => (txt ? String(txt).replace(/;/g, " ") : "");
        csvContent += `${clean(row.Telefone)};${clean(row.Nome)};${clean(row.Email)};${clean(row.Valor)}\n`;
    });

    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    link.setAttribute("href", url);
    link.setAttribute("download", `Alunos_Ativos_SemStatus_${hoje}.csv`);
    
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

        const valor = item.Valor || '-';
        const responsavel = item.BaixadoPor || '<span style="color:#999; font-style:italic;">Não registrado</span>';

        tr.innerHTML = `
            <td><strong>${dataBaixa}</strong></td>
            <td>${item.Nome}</td>
            <td>${valor}</td>
            <td>${item.OrigemPagamento || '-'}</td>
            <td style="color: #198754; font-weight: 600;">${responsavel}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Expor globalmente para o HTML acessar
window.loadPaymentsList = loadPaymentsList;

console.log("--> Módulo cobrança carregado com sucesso!");

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