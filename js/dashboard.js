import { db } from './firebase.js';
import { collection, query, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { parseDateBR } from './utils.js';

let unsubscribeCobranca, unsubscribeJuridico, unsubscribeMetricas;
let chartStatus, chartMeta, chartPayment, chartMoM, chartEvolution, chart3CobEvo, chart3CobPie;
let rawRealTimeCobranca = [], rawRealTimeJuridico = [], rawHistoricalData = [];

export function initDashboard() {
    console.log("--> Iniciando Dashboard v2.1...");
    startListeners();
}

function startListeners() {
    const qCob = query(collection(db, 'controle_3_cobranca'));
    unsubscribeCobranca = onSnapshot(qCob, (snap) => {
        rawRealTimeCobranca = snap.docs.map(d => d.data());
        processAllData();
    });

    const qJur = query(collection(db, 'juridico_ligacoes'));
    unsubscribeJuridico = onSnapshot(qJur, (snap) => {
        rawRealTimeJuridico = snap.docs.map(d => d.data());
        processAllData();
    });

    const qMetricas = query(collection(db, 'metricas_diarias'));
    unsubscribeMetricas = onSnapshot(qMetricas, (snap) => {
        rawHistoricalData = [];
        snap.forEach(docSnap => {
            const dataDia = docSnap.data();
            Object.keys(dataDia).forEach(key => {
                if (key !== 'updatedAt' && typeof dataDia[key] === 'object') {
                    rawHistoricalData.push({
                        dateStr: docSnap.id,
                        etapa: key.replace(/_/g, ' '),
                        ...dataDia[key]
                    });
                }
            });
        });
        processAllData();
    });
}

function processAllData() {
    renderEvolutionChart(rawHistoricalData);
    applyDashboardFilters();
}

// 1. GRÁFICO EVOLUÇÃO (HISTÓRICO)
function renderEvolutionChart(fullData) {
    const map = {};
    fullData.forEach(d => {
        const [ano, mes] = d.dateStr.split('-');
        const key = `${mes}/${ano}`;
        if (!map[key]) map[key] = { debito: 0, pagto: 0, sortKey: `${ano}${mes}` };
        map[key].debito += (d.debitos || 0);
        map[key].pagto += (d.pagamentos || 0);
    });

    const sortedKeys = Object.keys(map).sort((a,b) => map[a].sortKey - map[b].sortKey);
    const seriesDebito = sortedKeys.map(k => map[k].debito);
    const seriesPagto = sortedKeys.map(k => map[k].pagto);

    const options = {
        series: [{ name: 'Débitos', data: seriesDebito }, { name: 'Pagamentos', data: seriesPagto }],
        chart: { type: 'bar', height: 400, toolbar: { show: false } },
        plotOptions: { bar: { horizontal: false, columnWidth: '55%', dataLabels: { position: 'top' } } },
        dataLabels: { enabled: true, offsetY: -20, style: { fontSize: '11px', colors: ['#000000ff'] }, formatter: formatCompact },
        xaxis: { categories: sortedKeys },
        yaxis: { labels: { formatter: formatCompact } },
        colors: ['#0070C0', '#A6CAEC'],
        legend: { position: 'top', horizontalAlign: 'left' },
    };

    if (chartEvolution) {
        chartEvolution.updateOptions(options);
    } else {
        chartEvolution = new ApexCharts(document.querySelector("#chart-bar-evolution"), options);
        chartEvolution.render();
    }
}

window.applyDashboardFilters = function() {
    const startVal = document.getElementById('dash-date-start')?.value;
    const endVal = document.getElementById('dash-date-end')?.value;
    let startDate = startVal ? parseDateBR(startVal) : null;
    let endDate = endVal ? parseDateBR(endVal) : null;
    if (endDate) endDate.setHours(23, 59, 59, 999);

    const filteredHistory = filterByDate(rawHistoricalData, startDate, endDate);
    
    let prevStart = null, prevEnd = null;
    if(startDate && endDate) {
        prevStart = new Date(startDate); prevStart.setMonth(prevStart.getMonth() - 1);
        prevEnd = new Date(endDate); prevEnd.setMonth(prevEnd.getMonth() - 1);
    }
    const prevHistory = filterByDate(rawHistoricalData, prevStart, prevEnd);

    const cobPagos = filterRealTime(rawRealTimeCobranca, startDate, endDate);
    const jurPagos = filterRealTime(rawRealTimeJuridico, startDate, endDate);

    calculateGeneralMetrics(filteredHistory, cobPagos, jurPagos, prevHistory);

    // Filtra histórico para 3ª Cobrança (Atual e Anterior)
    const hist3CobCurr = filteredHistory.filter(d => d.etapa.includes('3'));
    const hist3CobPrev = prevHistory.filter(d => d.etapa.includes('3'));
    renderThirdCobSection(hist3CobCurr, hist3CobPrev);
};

function filterByDate(data, start, end) {
    return data.filter(item => {
        if (!start && !end) return true;
        const d = new Date(item.dateStr + 'T12:00:00');
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
    });
}

function filterRealTime(data, start, end) {
    return data.filter(item => {
        if (item.Status !== 'Pago' || !item.DataPagamento) return false;
        const d = item.DataPagamento.toDate ? item.DataPagamento.toDate() : new Date(item.DataPagamento);
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
    });
}

window.clearDashboardFilters = function() {
    document.getElementById('dash-date-start').value = '';
    document.getElementById('dash-date-end').value = '';
    window.applyDashboardFilters();
};

function calculateGeneralMetrics(history, cobPagos, jurPagos, prevHistory) {
    let debito = 0, pagto = 0, disparos = 0;
    let mapPgto = {};

    history.forEach(d => {
        debito += (d.debitos || 0);
        pagto += (d.pagamentos || 0);
        disparos += (d.disparos || 0);
        mapPgto['Cartão'] = (mapPgto['Cartão']||0) + (d.pag_cartao||0);
        mapPgto['Pix'] = (mapPgto['Pix']||0) + (d.pag_pix||0);
        mapPgto['Boleto'] = (mapPgto['Boleto']||0) + (d.pag_boleto||0);
    });

    const sum = (arr) => arr.reduce((acc, i) => acc + (getVal(i.Valor)), 0);
    pagto += sum(cobPagos) + sum(jurPagos);

    [...cobPagos, ...jurPagos].forEach(p => {
        let f = p.OrigemPagamento || 'Outros';
        if(f.toLowerCase().includes('pix')) f='Pix';
        else if(f.toLowerCase().includes('cart')) f='Cartão';
        else if(f.toLowerCase().includes('boleto')) f='Boleto';
        mapPgto[f] = (mapPgto[f]||0)+1;
    });

    updateEl('kpi-debito-total', formatMoney(debito));
    updateEl('kpi-pagamento-total', formatMoney(pagto));
    updateEl('kpi-disparos', disparos);
    updateEl('kpi-conversao', debito>0 ? ((pagto/debito)*100).toFixed(2)+'%' : '0%');

    renderStatusChart(history);
    renderMetaChart(pagto, debito);
    renderMoMChart(history, prevHistory);
    renderPaymentChart(mapPgto);
}

// 2. SEÇÃO 3ª COBRANÇA (COMPARATIVO ATUAL X ANTERIOR)
function renderThirdCobSection(currData, prevData) {
    let debito = 0, pagto = 0, disparos = 0;
    
    // Mapa para gráfico de evolução (Semana -> Valor)
    // Estrutura: { 1: {currDeb:0...}, 2: {...}, 3: {...}, 4: {...}, 5: {...} }
    const evoMap = { 1:{}, 2:{}, 3:{}, 4:{}, 5:{} };
    
    // Inicializa o mapa
    for(let i=1; i<=5; i++) evoMap[i] = { currDeb:0, currPag:0, prevDeb:0, prevPag:0 };

    // Helper para descobrir a semana do dia
    const getWeek = (dateStr) => {
        const day = parseInt(dateStr.split('-')[2]);
        if (day <= 7) return 1;
        if (day <= 14) return 2;
        if (day <= 21) return 3;
        if (day <= 28) return 4;
        return 5;
    };

    // Processa Atual
    currData.forEach(d => {
        debito += (d.debitos || 0);
        pagto += (d.pagamentos || 0);
        disparos += (d.disparos || 0);

        const w = getWeek(d.dateStr);
        evoMap[w].currDeb += (d.debitos || 0);
        evoMap[w].currPag += (d.pagamentos || 0);
    });

    // Processa Anterior
    prevData.forEach(d => {
        const w = getWeek(d.dateStr);
        evoMap[w].prevDeb += (d.debitos || 0);
        evoMap[w].prevPag += (d.pagamentos || 0);
    });

    updateEl('kpi-3cob-debito', formatMoney(debito));
    updateEl('kpi-3cob-pago', formatMoney(pagto));
    updateEl('kpi-3cob-disparos', disparos);
    updateEl('kpi-3cob-conv', debito>0 ? ((pagto/debito)*100).toFixed(2)+'%' : '0%');

    // Monta Séries
    const weeks = [1, 2, 3, 4, 5];
    const categories = weeks.map(w => `Semana ${w}`);
    
    const seriesCurr = weeks.map(w => {
        const i = evoMap[w];
        return i.currDeb > 0 ? ((i.currPag / i.currDeb) * 100).toFixed(1) : 0;
    });
    
    const seriesPrev = weeks.map(w => {
        const i = evoMap[w];
        return i.prevDeb > 0 ? ((i.prevPag / i.prevDeb) * 100).toFixed(1) : 0;
    });

    const optionsEvo = {
        series: [
            { name: 'Mês Passado', data: seriesPrev },
            { name: 'Mês Atual', data: seriesCurr }
        ],
        chart: { type: 'line', height: 300, toolbar: { show: false } },
        dataLabels: { enabled: true, formatter: (v) => v + '%' }, // Rótulos ativados
        stroke: { curve: 'smooth', width: 3 },
        xaxis: { categories: categories },
        colors: ['#adb5bd', '#0070C0'],
        yaxis: { labels: { formatter: (v) => v + '%' } },
        legend: { position: 'top' },
        // REMOVIDO TÍTULO INTERNO PARA EVITAR DUPLICIDADE COM O HTML
        title: { text: undefined } 
    };

    if (chart3CobEvo) {
        chart3CobEvo.updateOptions({ xaxis: { categories: categories } });
        chart3CobEvo.updateSeries(optionsEvo.series);
    } else {
        chart3CobEvo = new ApexCharts(document.querySelector("#chart-3cob-evolution-line"), optionsEvo);
        chart3CobEvo.render();
    }

    // Gráfico Pizza (Mantido)
    const optionsPie = {
        series: [Math.max(0, debito - pagto), pagto],
        chart: { type: 'donut', height: 300 },
        labels: ['Em Aberto', 'Recuperado'],
        colors: ['#34495e', '#2ecc71'],
        legend: { position: 'bottom' },
        dataLabels: { enabled: true, formatter: (val) => val.toFixed(1) + "%" }
    };

    if (chart3CobPie) { chart3CobPie.updateSeries(optionsPie.series); } 
    else { chart3CobPie = new ApexCharts(document.querySelector("#chart-3cob-pie"), optionsPie); chart3CobPie.render(); }
}

// 3. COMPARATIVO MoM GERAL (Com Rótulos de Dados)
function renderMoMChart(curr, prev) {
    const calc = (list) => {
        const m = {};
        list.forEach(d => {
            const n = d.etapa;
            if(!m[n]) m[n]={d:0,p:0};
            m[n].d+=d.debitos; m[n].p+=d.pagamentos;
        });
        const res = {};
        Object.keys(m).forEach(k => res[k] = m[k].d>0 ? ((m[k].p/m[k].d)*100).toFixed(1) : 0);
        return res;
    };
    const cMap = calc(curr);
    const pMap = calc(prev);
    const allCats = [...new Set([...Object.keys(cMap), ...Object.keys(pMap)])].sort();
    
    const sC = allCats.map(k=>cMap[k]||0);
    const sP = allCats.map(k=>pMap[k]||0);

    const opts = {
        series: [
            { name: 'Mês Passado', data: sP },
            { name: 'Mês Atual', data: sC }
        ],
        chart: { type: 'line', height: 350, toolbar: { show: false } },
        stroke: { curve: 'smooth', width: 3 },
        colors: ['#adb5bd', '#007bff'],
        // RÓTULOS DE DADOS ATIVADOS
        dataLabels: { 
            enabled: true, 
            formatter: (val) => val + "%",
            style: { fontSize: '10px' },
            background: { enabled: true, foreColor: '#000', borderRadius: 2 }
        },
        xaxis: { categories: allCats },
        yaxis: { labels: { formatter: (val) => val + "%" } },
        legend: { position: 'top' }
    };
    if(chartMoM){ chartMoM.updateOptions({xaxis:{categories:allCats}}); chartMoM.updateSeries(opts.series); }
    else{ chartMoM=new ApexCharts(document.querySelector("#chart-line-mom"), opts); chartMoM.render(); }
}

// ... (Funções auxiliares mantidas) ...
function renderStatusChart(history) { /* igual */
    const porEtapa = {};
    history.forEach(d => {
        const n = d.etapa || 'Outros';
        if(!porEtapa[n]) porEtapa[n]={deb:0, pag:0};
        porEtapa[n].deb += d.debitos; porEtapa[n].pag += d.pagamentos;
    });
    const cats = Object.keys(porEtapa).sort();
    const sDeb = cats.map(c=>porEtapa[c].deb);
    const sPag = cats.map(c=>porEtapa[c].pag);
    
    const opts = {
        series: [{name:'Débitos',data:sDeb}, {name:'Pagamentos',data:sPag}],
        chart: {type:'bar', height:350, toolbar:{show:false}},
        plotOptions:{bar:{horizontal:true, dataLabels:{position:'top'}}},
        dataLabels:{enabled:true, formatter:v=>"R$ "+v.toLocaleString('pt-BR',{maximumFractionDigits:0}), offsetX:30, style:{colors:['#333']}},
        colors:['#007bff','#28a745'],
        xaxis:{categories:cats}
    };
    if(chartStatus){ chartStatus.updateOptions({xaxis:{categories:cats}}); chartStatus.updateSeries(opts.series); }
    else{ chartStatus=new ApexCharts(document.querySelector("#chart-bar-status"), opts); chartStatus.render(); }
}

function renderMetaChart(a, t) { /* igual */
    const p = t>0 ? Math.round((a/t)*100) : 0;
    const opts = { series:[p], chart:{type:'radialBar', height:340}, plotOptions:{radialBar:{hollow:{size:'65%'}, dataLabels:{value:{offsetY:10, fontSize:'30px', show:true, formatter:v=>v+'%'}}}}, fill:{colors:['#28a745']}, labels:['Recuperação'] };
    document.getElementById('meta-text-display').innerText = `${formatMoney(a)} / ${formatMoney(t)}`;
    if(chartMeta) chartMeta.updateSeries([p]); else { chartMeta=new ApexCharts(document.querySelector("#chart-gauge-meta"), opts); chartMeta.render(); }
}

function renderPaymentChart(map) { /* igual */
    Object.keys(map).forEach(k=>{if(map[k]===0)delete map[k]});
    const opts = { series:Object.values(map), labels:Object.keys(map), chart:{type:'donut', height:320}, colors:['#008FFB', '#00E396', '#FEB019', '#FF4560'] };
    if(chartPayment){ chartPayment.updateOptions({labels:Object.keys(map)}); chartPayment.updateSeries(Object.values(map)); }
    else{ chartPayment=new ApexCharts(document.querySelector("#chart-pie-payment"), opts); chartPayment.render(); }
}

function getVal(v) { return typeof v==='string'?parseFloat(v.replace('R$','').replace(/\./g,'').replace(',','.')):(v||0); }
function formatMoney(v) { return v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function formatCompact(v) { if(v>=1000000)return "R$ "+(v/1000000).toLocaleString('pt-BR',{maximumFractionDigits:2})+" Mi"; if(v>=1000)return "R$ "+(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:0})+" Mil"; return "R$ "+v; }
function updateEl(id, v) { const e=document.getElementById(id); if(e)e.textContent=v; }

export function stopDashboard() {
    if(unsubscribeCobranca) unsubscribeCobranca();
    if(unsubscribeJuridico) unsubscribeJuridico();
    if(unsubscribeMetricas) unsubscribeMetricas();
}