// js/utils.js

// -----------------------------------------------------
// FORMATAÇÃO DE DATAS
// -----------------------------------------------------
export function formatDate(date) {
    if (!date) return '';
    const d = (date && typeof date.toDate === 'function')
        ? date.toDate()
        : new Date(date);

    return d.toLocaleDateString('pt-BR');
}

export function formatDateUTC(dateInput) {
    if (!dateInput) return '-';

    let d;
    if (dateInput && typeof dateInput.toDate === 'function') {
        d = dateInput.toDate();
    } else {
        d = new Date(dateInput);
    }

    if (isNaN(d.getTime())) return 'Data Inválida';

    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();

    return `${day}/${month}/${year}`;
}

export function parseDateBR(dateString) {
    if (!dateString) return null;

    const parts = dateString.split('/');
    if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    return null;
}


// -----------------------------------------------------
// CHAVES DE DATA PARA AGRUPAMENTO DE AGENDAMENTOS
// -----------------------------------------------------
export function getTodayDateKey() {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

export function formatDateKey(dateInput) {
    if (!dateInput) return '';

    const d =
        typeof dateInput.toDate === 'function'
            ? dateInput.toDate()
            : new Date(dateInput);

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();

    return `${day}-${month}-${year}`;
}


// -----------------------------------------------------
// STATUS
// -----------------------------------------------------
export function mapStatusToLabel(status) {
    const labels = {
        link_enviado: '🟡 Link enviado',
        link_agendado: '🟣 Link agendado',
        em_negociacao: '🟠 Em negociação',
    };

    return labels[status] || '';
}


// -----------------------------------------------------
// MODAIS
// -----------------------------------------------------
export function openModal(title, message) {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;

    overlay.classList.remove('modal-hidden');
    overlay.style.display = 'flex';
}

export function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    overlay.style.display = 'none';
}
