// js/juridico.js
import { db, auth } from "./firebase.js";
import { collection, addDoc, getDocs, query } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { parseDateBR, formatDateUTC } from "./utils.js";

// --- VARIÁVEIS EXCLUSIVAS DO JURÍDICO ---
window.juridicoAppointments = [];
let juridicoDate = new Date(); // Data independente para navegar no jurídico
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// 1. INICIALIZAÇÃO DO FORMULÁRIO
export function initJuridicoForm() {
    const form = document.getElementById("juridico-form");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const msg = document.getElementById("juridico-message") || { textContent: "" };
        const formData = new FormData(form);
        const data = {};
        formData.forEach((v, k) => data[k] = v.trim());

        const dataAcao = parseDateBR(data.DataAcao);
        if (!dataAcao) return alert("Data inválida.");
        
        data.DataAcao = dataAcao;
        data.createdAt = new Date();
        data.createdBy = auth.currentUser?.email || "sistema";
        data.DataGerarLink = dataAcao; // Compatibilidade

        msg.textContent = "Salvando...";
        msg.style.color = "#6A1B9A";

        try {
            await addDoc(collection(db, "juridico_agendamentos"), data);
            alert("Salvo com sucesso!");
            form.reset();
            loadJuridicoData();
        } catch (err) {
            console.error(err);
            alert("Erro ao salvar.");
        }
    });
}

// 2. CARREGAMENTO
export async function loadJuridicoData() {
    const view = document.getElementById("juridico-calendar-view");
    if (view) view.innerHTML = '<div class="loader"></div>';

    try {
        const q = query(collection(db, "juridico_agendamentos"));
        const snapshot = await getDocs(q);
        window.juridicoAppointments = [];
        snapshot.forEach(doc => window.juridicoAppointments.push({ id: doc.id, ...doc.data() }));
        
        renderJuridicoCalendar();
    } catch (err) {
        console.error(err);
        if (view) view.innerHTML = "Erro ao carregar.";
    }
}

// 3. RENDERIZAÇÃO (USANDO juridicoDate)
export function renderJuridicoCalendar() {
    const container = document.getElementById("juridico-calendar-view");
    if (!container) return;

    // USA A VARIÁVEL LOCAL 'juridicoDate'
    const year = juridicoDate.getFullYear();
    const month = juridicoDate.getMonth();
    
    const titleEl = document.getElementById("juridicoMonthDisplay");
    if (titleEl) titleEl.textContent = `${MONTHS[month]} ${year}`;

    // Mapeamento
    const appointmentsMap = {};
    window.juridicoAppointments.forEach((item) => {
        let d;
        if (item.DataAcao?.toDate) d = item.DataAcao.toDate();
        else if (typeof item.DataAcao === "string") d = parseDateBR(item.DataAcao);

        if (d && !isNaN(d) && d.getMonth() === month && d.getFullYear() === year) {
            const key = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
            if (!appointmentsMap[key]) appointmentsMap[key] = [];
            appointmentsMap[key].push({ id: item.id, name: item.Nome ? item.Nome.split(' ')[0] : "Processo" });
        }
    });

    // Grid
    let html = '<div class="calendar-header-row">';
    ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].forEach(d => html += `<div class="day-label">${d}</div>`);
    html += '</div><div class="calendar-grid">';

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) html += `<div class="calendar-day empty-day"></div>`;

    for (let day = 1; day <= daysInMonth; day++) {
        const key = `${day}/${month + 1}/${year}`;
        const apps = appointmentsMap[key] || [];
        
        const namesHtml = apps.map(a => 
            `<span class="app-link juridico-link" onclick="window.showDetailsGeneric('${a.id}', 'juridico')">${a.name}</span>`
        ).join("");

        html += `<div class="calendar-day ${apps.length ? "scheduled-day" : ""}">
                    <div class="day-number">${day}</div>
                    <div class="appointment-names">${namesHtml}</div>
                 </div>`;
    }
    html += "</div>";
    container.innerHTML = html;
}

// 4. NAVEGAÇÃO (FUNÇÃO EXPOSTA)
window.changeJuridicoMonth = function(delta) {
    juridicoDate.setMonth(juridicoDate.getMonth() + delta);
    renderJuridicoCalendar();
}

// Exposição Global
window.initJuridicoForm = initJuridicoForm;
window.loadJuridicoData = loadJuridicoData;
window.renderJuridicoCalendar = renderJuridicoCalendar;