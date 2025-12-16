// js/escala.js
console.log("--> Lendo arquivo escala.js...");

import { db, auth } from './firebase.js';
import { 
    doc, getDoc, setDoc, updateDoc, serverTimestamp, arrayUnion, arrayRemove 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ESCALA_COLLECTION = "escalas_cobranca";
const SETTINGS_COLLECTION = "config_geral"; 
const TEAM_DOC_ID = "equipe_cobranca";      

// Estado local
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1; // 1-12

// Cache Multi-mês
let monthsCache = {}; 
let employeeList = []; 

const STANDARD_MAPPING = {
    'gerencia': 'Elaine',
    'analista': 'João',
    'supervisor1': 'Vanessa',
    'supervisor2': 'Carmem'
};

// ============================================================
// MAPEAMENTO DE USUÁRIOS
// ============================================================
const EMAIL_MAP = {
    'carmem.nascimento@medcof.com.br': 'Carmem',
    'dayse.santos@grupomedcof.com.br': 'Dayse',
    'elainemoraes@grupomedcof.com.br': 'Elaine',
    'janny.guimaraes@medcof.com.br': 'Janny',
    'monica.silva@grupomedcof.com.br': 'Mônica',
    'natalia.monteiro@medcof.com.br': 'Natália',
    'rozana.bezerra@medcof.com.br': 'Rozana',
    'joao.chociai@grupomedcof.com.br': 'João',
    'fabiana.luna@grupomedcof.com.br': 'Fabiana',
    'fernanda.xavier@medcof.com.br': 'Fernanda',
    'gilreania.paiva@medcof.com.br': 'Gilreânia',
    'lorrannye.gaudencio@grupomedcof.com.br': 'Lorrannye',
    'julia.araujo@medcof.com.br': 'Júlia',
    'vanessa.feijo@grupomedcof.com.br': 'Vanessa'
};

function getCurrentUserName() {
    if (!auth.currentUser || !auth.currentUser.email) return null;
    const email = auth.currentUser.email.toLowerCase().trim();
    if (EMAIL_MAP[email]) return EMAIL_MAP[email];
    const part = email.split('@')[0];
    return part.charAt(0).toUpperCase() + part.slice(1);
}

// --- DEFINIÇÕES DE LINHAS ---
const WEEKDAY_ROWS = [
    { key: 'ferias', label: 'Férias', time: '', cssClass: 'row-ferias' },
    { key: 'folga', label: 'Folga', time: '', cssClass: 'row-folga' },
    { type: 'header', label: 'MANHÃ - TURNO 1', cssClass: 'header-manha' },
    { key: 'gerencia', label: 'Gerência', time: '9h às 18h', cssClass: 'row-manha' },
    { key: 'analista', label: 'Analista Cobrança', time: '08h às 17h', cssClass: 'row-manha' },
    { key: 'supervisor1', label: 'Supervisora 1', time: '08h às 17h', cssClass: 'row-manha' },
    { key: 'atend_08_14', label: 'Atendente Financeiro', time: '08h às 14h', cssClass: 'row-manha' },
    { key: 'atend_08_16', label: 'Atendente Financeiro', time: '08h às 16h', cssClass: 'row-manha' },
    { type: 'header', label: 'TARDE - TURNO 2', cssClass: 'header-tarde' },
    { key: 'supervisor2', label: 'Supervisora 2', time: '11h às 20h', cssClass: 'row-tarde' },
    { key: 'atend_14_20', label: 'Atendente Financeiro', time: '14h às 20h', cssClass: 'row-tarde' },
    { key: 'atend_12_20', label: 'Atendente Financeiro', time: '12h às 20h', cssClass: 'row-tarde' }
];

const WEEKEND_ROWS = [
    { key: 'fds_folga', label: 'FOLGA FDS', cssClass: 'row-folga' },
    { key: 'fds_8_14', label: '8h às 14h' },
    { key: 'fds_10_16', label: '10h às 16h' },
    { key: 'fds_12_18', label: '12h às 18h' }
];

// --- AUXILIAR: DATA DE HOJE ---
// Retorna string "YYYY-MM-DD" para comparação fácil
function getTodayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// --- AUXILIAR: AJUSTE DE ALTURA ---
function adjustAllTextareas(container) {
    if(!container) return;
    setTimeout(() => {
        container.querySelectorAll('textarea').forEach(tx => {
            tx.style.height = 'auto';
            if (tx.value && tx.value.trim() !== '') {
                tx.style.height = tx.scrollHeight + "px";
            } else {
                tx.style.height = ''; 
            }
        });
    }, 50);
}

// --- INICIALIZAÇÃO ---
export function initEscala() {
    renderMonthLabel();
    loadEscala();
    loadEmployeeList(); 
    
    const prev = document.getElementById('prev-month');
    if(prev) prev.onclick = () => changeEscalaMonth(-1);
    const next = document.getElementById('next-month');
    if(next) next.onclick = () => changeEscalaMonth(1);
}

function renderMonthLabel() {
    const date = new Date(currentYear, currentMonth - 1, 1);
    const name = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    const label = document.getElementById('escala-month-label');
    if(label) label.textContent = name.charAt(0).toUpperCase() + name.slice(1);
}

// --- CARREGAMENTO ---
async function loadEscala() {
    const viewContainer = document.getElementById('escala-view-container');
    const editContainer = document.getElementById('escala-container');
    const editorWrapper = document.getElementById('escala-editor-wrapper');
    
    if (editorWrapper && editorWrapper.style.display !== 'none') {
        if(editContainer) editContainer.innerHTML = '<div class="loader"></div>';
    } else {
        if(viewContainer) viewContainer.innerHTML = '<div class="loader" style="margin-top:50px"></div>';
    }

    const keysToLoad = new Set();
    keysToLoad.add(`${currentYear}-${String(currentMonth).padStart(2, '0')}`);
    const prevDate = new Date(currentYear, currentMonth - 2, 1); 
    keysToLoad.add(`${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`);
    const nextDate = new Date(currentYear, currentMonth, 1);
    keysToLoad.add(`${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`);

    try {
        const promises = Array.from(keysToLoad).map(async (docId) => {
            if (monthsCache[docId]) return; 
            const snap = await getDoc(doc(db, ESCALA_COLLECTION, docId));
            if (snap.exists()) {
                monthsCache[docId] = snap.data();
            } else {
                monthsCache[docId] = { grid: {} };
            }
        });

        await Promise.all(promises);

        const mainDocId = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
        const mainData = monthsCache[mainDocId];

        renderAllWeeks('escala-container'); 
        
        if (!mainData || Object.keys(mainData.grid || {}).length === 0) {
             showMessage("Mês atual vazio.", "orange");
        } else {
             showMessage("Dados carregados.", "green");
        }

        window.renderEscalaView(); 

    } catch (err) {
        console.error("Erro escala:", err);
        showMessage("Erro ao carregar.", "red");
    }
}

// --- RENDERIZAÇÃO ---
function getValueFromCache(dateObj, key) {
    const y = dateObj.getFullYear();
    const m = dateObj.getMonth() + 1;
    const d = dateObj.getDate();
    const docId = `${y}-${String(m).padStart(2, '0')}`;
    return monthsCache[docId]?.grid?.[key]?.[d] || "";
}

function renderAllWeeks(containerId = "escala-container") {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = ""; 

    const year = currentYear;
    const monthIndex = currentMonth - 1; 
    const firstDayOfMonth = new Date(year, monthIndex, 1);
    const dayOfWeek = firstDayOfMonth.getDay(); 
    const startOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const startDate = new Date(year, monthIndex, 1 + startOffset);
    const lastDayOfMonth = new Date(year, monthIndex + 1, 0);
    const lastDayOfWeek = lastDayOfMonth.getDay();
    const endOffset = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
    const endDate = new Date(year, monthIndex + 1, 0 + endOffset);

    let allDates = [];
    let loopDate = new Date(startDate);
    while (loopDate <= endDate) {
        allDates.push(new Date(loopDate));
        loopDate.setDate(loopDate.getDate() + 1);
    }

    for (let i = 0; i < allDates.length; i += 7) {
        const weekDates = allDates.slice(i, i + 7);
        createWeekBlock(container, weekDates.slice(0,5), weekDates.slice(5,7));
    }
}

function createWeekBlock(container, weekdays, weekend) {
    const wrapper = document.createElement("div");
    wrapper.className = "week-wrapper"; 
    const tableWeek = document.createElement("div");
    tableWeek.className = "week-main";
    tableWeek.innerHTML = generateWeekdayHTML(weekdays);
    wrapper.appendChild(tableWeek);
    const tableWeekend = document.createElement("div");
    tableWeekend.className = "week-weekend";
    tableWeekend.innerHTML = generateWeekendHTML(weekend);
    wrapper.appendChild(tableWeekend);
    container.appendChild(wrapper);
}

// --- GERAÇÃO HTML SEMANA (COM DESTAQUE HOJE) ---
function generateWeekdayHTML(dates) {
    const todayStr = getTodayString(); // Pega "YYYY-MM-DD" de hoje

    let html = `<table class="escala-table"><thead><tr><th class="col-cargo">CARGO</th><th class="col-horario">HORÁRIO</th>`;
    
    // CABEÇALHO
    dates.forEach(dObj => {
        const d = dObj.getDate();
        const m = dObj.getMonth() + 1;
        const y = dObj.getFullYear();
        const fullDate = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        
        const dayName = dObj.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase().slice(0, 3);
        const isOutside = (m !== currentMonth);
        
        // Verifica se é hoje
        const isToday = (fullDate === todayStr);
        const todayClass = isToday ? 'today-column-header' : '';

        html += `<th class="${isOutside ? 'header-outside' : ''} ${todayClass}">${dayName}<br><small>${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}</small></th>`;
    });
    html += `</tr></thead><tbody>`;

    const myName = getCurrentUserName();

    // LINHAS
    WEEKDAY_ROWS.forEach(def => {
        if(def.type === 'header') {
            html += `<tr class="${def.cssClass}"><td colspan="${dates.length + 2}">${def.label}</td></tr>`;
        } else {
            html += `<tr class="${def.cssClass}">
                <td class="cargo-cell">${def.label}</td>
                <td class="time-cell">${def.time}</td>`;
            
            dates.forEach(dObj => {
                const d = dObj.getDate();
                const m = dObj.getMonth() + 1;
                const y = dObj.getFullYear();
                const fullDate = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

                const isOutside = (m !== currentMonth);
                const isToday = (fullDate === todayStr);
                const val = getValueFromCache(dObj, def.key);
                
                // Classes base
                let cellClasses = isOutside ? 'outside-cell' : 'normal-cell';
                if(isToday) cellClasses += ' today-column-cell'; // Adiciona destaque

                // Highlight de Nome
                const isMe = myName && val && val.toLowerCase().includes(myName.toLowerCase());
                const highlightInput = isMe ? 'user-highlight' : '';

                html += `<td class="${cellClasses}">
                    <textarea class="escala-input ${highlightInput}"
                        onblur="window.saveEscalaCell('${def.key}', ${d}, ${m}, ${y}, this.value)"
                        ondragover="window.allowDrop(event)"
                        ondrop="window.handleDrop(event, '${def.key}', ${d}, ${m}, ${y})"
                        oninput='this.style.height="auto";this.style.height=this.scrollHeight+"px"'
                        rows="1">${val}</textarea>
                </td>`;
            });
            html += `</tr>`;
        }
    });
    html += `</tbody></table>`;
    return html;
}

// --- GERAÇÃO HTML FIM DE SEMANA (COM DESTAQUE HOJE) ---
function generateWeekendHTML(dates) {
    const todayStr = getTodayString();

    let html = `<table class="escala-table weekend-table"><thead><tr><th class="col-horario-fds">HORÁRIO</th>`;
    
    dates.forEach(dObj => {
        const d = dObj.getDate();
        const m = dObj.getMonth() + 1;
        const y = dObj.getFullYear();
        const fullDate = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

        const dayName = dObj.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase().slice(0, 3);
        const isOutside = (m !== currentMonth);
        const isToday = (fullDate === todayStr);
        const todayClass = isToday ? 'today-column-header' : '';

        html += `<th class="header-weekend ${isOutside ? 'header-outside' : ''} ${todayClass}">${dayName}<br><small>${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}</small></th>`;
    });
    html += `</tr></thead><tbody>`;

    const myName = getCurrentUserName();

    WEEKEND_ROWS.forEach(def => {
        const trClass = def.cssClass || '';
        html += `<tr class="${trClass}">
            <td class="time-cell-fds">${def.label}</td>`;
        
        dates.forEach(dObj => {
            const d = dObj.getDate();
            const m = dObj.getMonth() + 1;
            const y = dObj.getFullYear();
            const fullDate = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

            const isOutside = (m !== currentMonth);
            const isToday = (fullDate === todayStr);
            const val = getValueFromCache(dObj, def.key);
            
            let cellClasses = isOutside ? 'outside-cell' : 'weekend-cell';
            if(isToday) cellClasses += ' today-column-cell';

            const isMe = myName && val && val.toLowerCase().includes(myName.toLowerCase());
            const highlightInput = isMe ? 'user-highlight' : '';

            html += `<td class="${cellClasses}">
                <textarea class="escala-input ${highlightInput}"
                    onblur="window.saveEscalaCell('${def.key}', ${d}, ${m}, ${y}, this.value)"
                    ondragover="window.allowDrop(event)"
                    ondrop="window.handleDrop(event, '${def.key}', ${d}, ${m}, ${y})"
                    oninput='this.style.height="auto";this.style.height=this.scrollHeight+"px"'
                    rows="1">${val}</textarea>
            </td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    return html;
}

window.saveEscalaCell = async function(rowKey, day, month, year, value) {
    const docId = `${year}-${String(month).padStart(2, '0')}`;
    
    // 1. Atualização Otimista (Cache Local)
    if (!monthsCache[docId]) monthsCache[docId] = { grid: {} };
    if (!monthsCache[docId].grid) monthsCache[docId].grid = {};
    if (!monthsCache[docId].grid[rowKey]) monthsCache[docId].grid[rowKey] = {};
    monthsCache[docId].grid[rowKey][day] = value;

    try {
        const docRef = doc(db, ESCALA_COLLECTION, docId);
        
        // 2. Tentativa Principal: Update (Correto para campos aninhados "grid.cargo.dia")
        try {
            await updateDoc(docRef, {
                [`grid.${rowKey}.${day}`]: value,
                lastUpdate: serverTimestamp(),
                updatedBy: auth.currentUser?.email || "Sistema"
            });
        } catch (error) {
            // 3. Fallback: Se o documento não existir (Erro not-found), cria ele do zero
            if (error.code === 'not-found') {
                const newData = { 
                    grid: { 
                        [rowKey]: { 
                            [day]: value 
                        } 
                    },
                    createdAt: serverTimestamp(),
                    lastUpdate: serverTimestamp(),
                    updatedBy: auth.currentUser?.email || "Sistema"
                };
                await setDoc(docRef, newData, { merge: true });
            } else {
                throw error; // Se for outro erro, repassa para o catch abaixo
            }
        }
        
        // Feedback visual (Toast)
        if(window.showToast) window.showToast("Escala salva!");

    } catch (err) { 
        console.error("Erro ao salvar célula:", err); 
        if(window.showToast) window.showToast("Erro ao salvar!", "error");
    }
}

window.allowDrop = function(ev) { ev.preventDefault(); ev.target.style.backgroundColor = "#e2e6ea"; }
window.handleDrop = function(ev, rowKey, day, month, year) {
    ev.preventDefault(); ev.target.style.backgroundColor = ""; 
    const droppedName = ev.dataTransfer.getData("text/plain");
    if (!droppedName) return;
    let currentValue = ev.target.value;
    let newValue = (currentValue && currentValue.trim() !== "") 
        ? (currentValue.includes(droppedName) ? currentValue : currentValue + " / " + droppedName)
        : droppedName;
    ev.target.value = newValue;
    window.saveEscalaCell(rowKey, day, month, year, newValue);
    ev.target.style.height = "auto"; 
    ev.target.style.height = ev.target.scrollHeight + "px";
}

window.renderEscalaView = function () {
    const viewContainer = document.getElementById("escala-view-container");
    if (!viewContainer) return;
    viewContainer.innerHTML = "";

    const navHeader = document.createElement("div");
    navHeader.className = "escala-controls"; 
    navHeader.style.marginBottom = "20px";
    navHeader.style.justifyContent = "center"; 
    navHeader.style.gap = "20px";

    const date = new Date(currentYear, currentMonth - 1, 1);
    const monthName = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    const formattedTitle = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    navHeader.innerHTML = `
        <button class="action-btn secondary" onclick="window.changeEscalaMonth(-1)">◀ Anterior</button>
        <span class="month-label" style="min-width: 250px; text-align: center;">${formattedTitle}</span>
        <button class="action-btn secondary" onclick="window.changeEscalaMonth(1)">Próximo ▶</button>
    `;
    viewContainer.appendChild(navHeader);

    if (Object.keys(monthsCache).length === 0) {
        const msg = document.createElement("p");
        msg.style.textAlign = "center";
        msg.style.color = "#666";
        msg.innerText = "Nenhuma escala disponível.";
        viewContainer.appendChild(msg);
        return;
    }

    const tableWrapper = document.createElement("div");
    tableWrapper.id = "escala-view-inner-wrapper";
    tableWrapper.className = "escala-readonly"; 
    viewContainer.appendChild(tableWrapper);

    renderAllWeeks("escala-view-inner-wrapper");

    viewContainer.querySelectorAll("textarea, input, select").forEach(el => {
        el.disabled = true;
        el.setAttribute("readonly", true);
        el.removeAttribute("onblur");
        el.removeAttribute("ondragover");
        el.removeAttribute("ondrop");
        el.removeAttribute("oninput");
        el.style.resize = "none";
        el.style.border = "none";
        el.style.backgroundColor = "transparent";
        el.style.cursor = "default";
        el.style.pointerEvents = "none"; 
        el.style.boxShadow = "none";
    });

    adjustAllTextareas(viewContainer);
};

window.openEscalaEditor = async function () {
    const viewContainer = document.getElementById("escala-view-container");
    const editorWrapper = document.getElementById("escala-editor-wrapper");
    const editBtn = document.getElementById("btn-open-editor");

    if (!editorWrapper) return;
    if (Object.keys(monthsCache).length === 0) await loadEscala();

    viewContainer.style.display = "none";
    editBtn.style.display = "none";
    editorWrapper.style.display = "block";

    renderAllWeeks('escala-container');
    adjustAllTextareas(document.getElementById('escala-container'));
};

window.closeEscalaEditor = function () {
    const viewContainer = document.getElementById("escala-view-container");
    const editorWrapper = document.getElementById("escala-editor-wrapper");
    const editBtn = document.getElementById("btn-open-editor");
    window.renderEscalaView();
    editorWrapper.style.display = "none";
    viewContainer.style.display = "block";
    editBtn.style.display = "inline-block";
};

window.fillStandardSchedule = async function() {
    // Confirmação segura
    const result = await Swal.fire({
        title: 'Preencher Padrão?',
        html: "Isso vai <b>sobrescrever</b> os horários de Segunda a Sexta deste mês com a equipe padrão.<br>Deseja continuar?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ffc107', // Amarelo (Atenção)
        cancelButtonColor: '#333',
        confirmButtonText: 'Sim, preencher!',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;
    const docId = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    if (!monthsCache[docId]) monthsCache[docId] = { grid: {} };
    
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const batchData = {};
    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(currentYear, currentMonth - 1, d);
        const dayOfWeek = date.getDay(); 
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            for (const [key, name] of Object.entries(STANDARD_MAPPING)) {
                batchData[`grid.${key}.${d}`] = name;
                if (!monthsCache[docId].grid[key]) monthsCache[docId].grid[key] = {};
                monthsCache[docId].grid[key][d] = name;
            }
        }
    }
    try {
        await updateDoc(doc(db, ESCALA_COLLECTION, docId), batchData);
        renderAllWeeks('escala-container'); 
    } catch(e) { 
        try {
            await setDoc(doc(db, ESCALA_COLLECTION, docId), { grid: monthsCache[docId].grid }, { merge: true });
            renderAllWeeks('escala-container');
        } catch(err) { console.error(err); }
    }
}

window.createOrDuplicateEscala = async function() {
    const docId = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    if (monthsCache[docId] && !confirm("Sobrescrever?")) return;
    let prevM = currentMonth - 1; let prevY = currentYear;
    if (prevM === 0) { prevM = 12; prevY--; }
    const prevId = `${prevY}-${String(prevM).padStart(2, '0')}`;
    let newData = { grid: {} };
    try {
        const prevSnap = await getDoc(doc(db, ESCALA_COLLECTION, prevId));
        if (prevSnap.exists() && confirm("Copiar mês anterior?")) newData.grid = prevSnap.data().grid || {};
        await setDoc(doc(db, ESCALA_COLLECTION, docId), { ...newData, createdAt: serverTimestamp() });
        monthsCache[docId] = newData; 
        loadEscala(); 
    } catch (e) { alert("Erro ao criar."); }
}

window.changeEscalaMonth = function(delta) {
    currentMonth += delta;
    if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    else if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    
    renderMonthLabel();
    loadEscala();
}

window.exportEscalaExcel = function() { alert("Pendente."); }

function showMessage(msg, color) {
    const el = document.getElementById('escala-message');
    if(el) { el.textContent = msg; el.style.color = color; setTimeout(()=>el.textContent='',2000); }
}

async function loadEmployeeList() {
    const listContainer = document.getElementById('employees-list');
    if(!listContainer) return;
    try {
        const docRef = doc(db, SETTINGS_COLLECTION, TEAM_DOC_ID);
        const snap = await getDoc(docRef);
        if (snap.exists()) { employeeList = snap.data().nomes || []; employeeList.sort(); }
        renderEmployeeSidebar();
    } catch (err) {}
}
function renderEmployeeSidebar() {
    const listContainer = document.getElementById('employees-list');
    if(!listContainer) return;
    listContainer.innerHTML = "";
    employeeList.forEach(name => {
        const item = document.createElement("div");
        item.className = "employee-chip";
        item.draggable = true; item.textContent = name;
        item.ondragstart = (ev) => { ev.dataTransfer.setData("text/plain", name); };
        listContainer.appendChild(item);
    });
}

window.loadEscalaIfNeeded = function () {
    if (Object.keys(monthsCache).length === 0) loadEscala();
};

window.initEscala = initEscala;
window.loadEscala = loadEscala;