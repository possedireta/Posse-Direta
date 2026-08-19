import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// ==========================================
// 1. CONFIGURAÇÃO E ESTADO GLOBAL
// ==========================================
const $ = id => document.getElementById(id);
const configured = !SUPABASE_URL.startsWith("COLE_") && !SUPABASE_ANON_KEY.startsWith("COLE_");
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let session = null;
let profile = null;
let activeMaterialId = null;
let adminPage = "dashboard";

let cache = {
    contests: [], access: [], disciplines: [], subjects: [], 
    materials: [], progress: [], favorites: [], profiles: [], 
    purchases: [], dailyQuestions: []
};

let state = { 
    page: "home", contestId: null, disciplineId: null, 
    subjectId: null, query: "" 
};

// ==========================================
// 2. UTILITÁRIOS E FUNÇÕES AUXILIARES
// ==========================================
const esc = (s = "") => String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const money = c => (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const initials = n => (n || "").trim().split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase() || "").join("") || "PD";
const fmtDate = v => v ? new Date(v + "T12:00:00").toLocaleDateString("pt-BR") : "";

function toast(msg, type = "") {
    const e = $("toast");
    e.textContent = msg;
    e.className = `toast show ${type}`;
    clearTimeout(window.__t);
    window.__t = setTimeout(() => e.className = "toast", 3300);
}

function show(v) {
    $("authView").classList.toggle("hidden", v !== "auth");
    $("appView").classList.toggle("hidden", v !== "app");
    $("adminView").classList.toggle("hidden", v !== "admin");
    $("freeView").classList.toggle("hidden", v !== "free");
}

const contest = id => cache.contests.find(x => x.id === id);
const discipline = id => cache.disciplines.find(x => x.id === id);
const subject = id => cache.subjects.find(x => x.id === id);
const hasAccess = id => cache.access.some(a => a.contest_id === id && a.status === "active" && (!a.expires_at || new Date(a.expires_at) > new Date()));
const accessFor = id => cache.access.find(a => a.contest_id === id && a.status === "active");
const isDone = id => cache.progress.some(x => x.material_id === id && x.completed);
const isFav = id => cache.favorites.some(x => x.material_id === id);

// ==========================================
// 3. AUTENTICAÇÃO E NAVEGAÇÃO PÚBLICA
// ==========================================
$("loginTab").onclick = () => {
    $("loginTab").classList.add("active");
    $("signupTab").classList.remove("active");
    $("loginForm").classList.remove("hidden");
    $("signupForm").classList.add("hidden");
};

$("signupTab").onclick = () => {
    $("signupTab").classList.add("active");
    $("loginTab").classList.remove("active");
    $("signupForm").classList.remove("hidden");
    $("loginForm").classList.add("hidden");
};

$("publicFreeBtn").onclick = () => {
    history.pushState({}, "", `${location.pathname}?gratis=1`);
    openFreeQuestions();
};

$("freeBackBtn").onclick = () => {
    history.pushState({}, "", location.pathname);
    if (session) {
        show("app");
        render();
    } else {
        show("auth");
    }
};

$("freeLoginBtn").onclick = () => show("auth");

$("loginForm").onsubmit = async e => {
    e.preventDefault();
    if (!configured) return toast("Configure o Supabase.", "error");
    
    const { error } = await supabase.auth.signInWithPassword({
        email: $("loginEmail").value.trim(),
        password: $("loginPassword").value
    });
    
    if (error) toast(error.message, "error");
};

$("signupForm").onsubmit = async e => {
    e.preventDefault();
    if (!configured) return toast("Configure o Supabase.", "error");
    
    const { data, error } = await supabase.auth.signUp({
        email: $("signupEmail").value.trim(),
        password: $("signupPassword").value,
        options: { data: { full_name: $("signupName").value.trim() } }
    });
    
    if (error) return toast(error.message, "error");
    toast(data.session ? "Conta criada." : "Conta criada. Confirme seu e-mail.", "success");
};

$("forgotBtn").onclick = async () => {
    const email = $("loginEmail").value.trim();
    if (!email) return toast("Digite seu e-mail.", "error");
    
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    if (error) return toast(error.message, "error");
    toast("Instruções enviadas.", "success");
};

async function logout() { await supabase?.auth.signOut(); }
$("logoutButton").onclick = logout;
$("adminLogout").onclick = logout;

// ==========================================
// 4. CARREGAMENTO DE DADOS (ALUNO)
// ==========================================
async function loadStudent() {
    const [c, a, d, s, m, p, f] = await Promise.all([
        supabase.from("contests").select("*").eq("is_published", true).order("position"),
        supabase.from("contest_access").select("*").eq("user_id", session.user.id),
        supabase.from("contest_disciplines").select("*").eq("is_active", true).order("position"),
        supabase.from("subjects").select("*").eq("is_active", true).order("position"),
        supabase.from("materials").select("*").eq("is_published", true).order("position"),
        supabase.from("user_progress").select("*").eq("user_id", session.user.id),
        supabase.from("favorites").select("*").eq("user_id", session.user.id)
    ]);
    
    cache.contests = c.data || [];
    cache.access = a.data || [];
    cache.disciplines = d.data || [];
    cache.subjects = s.data || [];
    cache.materials = m.data || [];
    cache.progress = p.data || [];
    cache.favorites = f.data || [];
}

async function boot(s) {
    session = s;
    const wantsFree = new URLSearchParams(location.search).get("gratis") === "1";
    
    if (!s) {
        profile = null;
        if (wantsFree) await openFreeQuestions();
        else show("auth");
        return;
    }
    
    const { data, error } = await supabase.from("profiles").select("*").eq("id", s.user.id).single();
    if (error) return toast("Erro ao carregar perfil.", "error");
    
    profile = data;
    $("userName").textContent = profile.full_name || s.user.email;
    $("userInitials").textContent = initials(profile.full_name || s.user.email);
    $("adminButton").classList.toggle("hidden", profile.role !== "admin");
    
    await loadStudent();
    
    if (wantsFree) {
        await openFreeQuestions();
        return;
    }
    
    show("app");
    navigate("home");
    
    const q = new URLSearchParams(location.search);
    if (q.get("payment") === "success") {
        history.replaceState({}, document.title, location.pathname);
        toast("Pagamento recebido. Aguarde a confirmação do acesso.", "success");
        setTimeout(async () => {
            await loadStudent();
            render();
        }, 2500);
    }
}

// Inicialização
if (configured) {
    supabase.auth.onAuthStateChange((_e, s) => setTimeout(() => boot(s), 0));
    const { data: { session: s } } = await supabase.auth.getSession();
    await boot(s);
} else {
    show("auth");
    setTimeout(() => toast("Configure o Supabase em assets/config.js.", "error"), 300);
}

// ==========================================
// 5. NAVEGAÇÃO INTERNA E MENU LATERAL
// ==========================================
function setMenu(open) {
    document.querySelector(".app-sidebar")?.classList.toggle("open", open);
    $("mobileSidebarOverlay")?.classList.toggle("open", open);
    if (innerWidth < 820) document.body.style.overflow = open ? "hidden" : "";
}

$("mobileMenuBtn").onclick = () => setMenu(!document.querySelector(".app-sidebar")?.classList.contains("open"));
$("mobileSidebarOverlay").onclick = () => setMenu(false);

function navigate(page, extra = {}) {
    state = { ...state, page, ...extra };
    document.querySelectorAll("[data-nav]").forEach(b => b.classList.toggle("active", b.dataset.nav === page));
    render();
    if (innerWidth < 820) setMenu(false);
    scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => navigate(b.dataset.nav));
$("searchInput").oninput = e => {
    const q = e.target.value.trim();
    navigate(q ? "search" : "home", { query: q });
};

// ==========================================
// 6. COMPONENTES E RENDERIZAÇÃO DE TELA
// ==========================================
function progressContest(cid) {
    const dids = cache.disciplines.filter(d => d.contest_id === cid).map(d => d.id);
    const sids = cache.subjects.filter(s => dids.includes(s.contest_discipline_id)).map(s => s.id);
    const mats = cache.materials.filter(m => sids.includes(m.subject_id));
    const done = mats.filter(m => isDone(m.id)).length;
    return { done, total: mats.length, p: mats.length ? Math.round((done / mats.length) * 100) : 0 };
}

function contestCard(c) {
    const a = accessFor(c.id);
    const locked = !hasAccess(c.id);
    const p = progressContest(c.id);
    
    return `
    <article class="contest-card">
        <div class="contest-cover">
            <span class="contest-org">${esc(c.institution || c.exam_board || "CONCURSO PÚBLICO")}</span>
            <h3>${esc(c.title)}</h3>
        </div>
        <div class="contest-body">
            ${locked ? '<span class="access-badge locked">🔒 Acesso pago</span>' : `<span class="access-badge active">✓ Acesso ${a?.source === "free" ? "gratuito" : "liberado"}</span>`}
            <p>${esc(c.description || "")}</p>
            <div class="contest-info">
                ${c.exam_board ? `<span class="pill">Banca: ${esc(c.exam_board)}</span>` : ""}
                ${c.exam_date ? `<span class="pill">Prova: ${fmtDate(c.exam_date)}</span>` : ""}
            </div>
            ${locked ? 
                `<div class="contest-price">${money(c.price_cents)}<small>acesso a este concurso</small></div>` : 
                `<div class="contest-price">${p.p}%<small>do conteúdo concluído</small></div>`}
            <div class="contest-actions">
                <button class="btn primary" onclick="window.openContest('${c.id}')">${locked ? "Ver concurso" : "Entrar no concurso"}</button>
            </div>
        </div>
    </article>`;
}

function render() {
    if (state.page === "home") home();
    else if (state.page === "catalog") catalog();
    else if (state.page === "mycontests") myContests();
    else if (state.page === "contest") contestPage();
    else if (state.page === "discipline") disciplinePage();
    else if (state.page === "subject") subjectPage();
    else if (state.page === "favorites") favoritesPage();
    else if (state.page === "progress") progressPage();
    else if (state.page === "profile") profilePage();
    else if (state.page === "free") openFreeQuestions();
    else if (state.page === "simulators") simulatorsPage();
    else if (state.page === "search") searchPage();
}

function home() {
    const mine = cache.contests.filter(c => hasAccess(c.id));
    $("mainContent").innerHTML = `
    <section class="welcome">
        <div class="welcome-card">
            <span class="eyebrow light">POSSE DIRETA CONCURSOS</span>
            <h1>Prepare-se para o concurso certo.</h1>
            <p>Escolha uma preparação específica e acesse somente o conteúdo daquele concurso.</p>
            <div class="welcome-actions">
                <button class="btn primary" onclick="window.goCatalog()">Ver concursos</button>
                <button class="btn secondary" onclick="window.goMine()">Meus concursos</button>
            </div>
        </div>
        <div class="goal-card">
            <span class="eyebrow dark">Sua conta</span>
            <h3>${esc(profile.full_name || "Aluno")}</h3>
            <p>Você possui acesso a <strong>${mine.length}</strong> concurso(s).</p>
            <div class="small-note">O acesso pode ser comprado ou concedido gratuitamente pelo administrador.</div>
        </div>
    </section>
    ${mine.length ? `
    <section class="section">
        <div class="section-head">
            <div><span class="eyebrow dark">Continue estudando</span><h2>Meus concursos</h2></div>
        </div>
        <div class="contest-grid">${mine.slice(0, 3).map(contestCard).join("")}</div>
    </section>` : ""}
    <section class="section">
        <div class="section-head">
            <div>
                <span class="eyebrow dark">Catálogo</span>
                <h2>Concursos disponíveis</h2>
                <p>Cada concurso é um produto separado.</p>
            </div>
        </div>
        <div class="contest-grid">${cache.contests.map(contestCard).join("") || '<div class="empty">Nenhum concurso publicado.</div>'}</div>
    </section>`;
}

// ... Atalhos Globais
window.goCatalog = () => navigate("catalog");
window.goMine = () => navigate("mycontests");
window.openContest = id => navigate("contest", { contestId: id });
window.openSimulators = id => navigate("simulators", { contestId: id });

// ==========================================
// 7. PÁGINAS INTERNAS
// ==========================================
function catalog() {
    $("mainContent").innerHTML = `
    <div class="page-head">
        <div>
            <span class="eyebrow dark">Catálogo</span>
            <h1>Concursos disponíveis</h1>
            <p>O pagamento libera apenas a preparação selecionada.</p>
        </div>
    </div>
    <div class="contest-grid">${cache.contests.map(contestCard).join("") || '<div class="empty">Nenhum concurso disponível.</div>'}</div>`;
}

function myContests() {
    const mine = cache.contests.filter(c => hasAccess(c.id));
    $("mainContent").innerHTML = `
    <div class="page-head">
        <div><span class="eyebrow dark">Área do aluno</span><h1>Meus concursos</h1></div>
    </div>
    <div class="contest-grid">${mine.map(contestCard).join("") || '<div class="empty">Você ainda não possui acesso a nenhum concurso.</div>'}</div>`;
}

function contestPage() {
    const c = contest(state.contestId);
    if (!c) return navigate("catalog");
    
    const allowed = hasAccess(c.id);
    const discs = cache.disciplines.filter(d => d.contest_id === c.id);
    
    $("mainContent").innerHTML = `
    <button class="back-btn" onclick="window.goCatalog()">← Concursos</button>
    <section class="contest-header">
        <span class="eyebrow light">${esc(c.institution || "CONCURSO")}</span>
        <h1>${esc(c.title)}</h1>
        <p>${esc(c.description || "")}</p>
        <div class="contest-info">
            ${c.exam_board ? `<span class="pill">Banca: ${esc(c.exam_board)}</span>` : ""}
            ${c.exam_date ? `<span class="pill">Prova: ${fmtDate(c.exam_date)}</span>` : ""}
        </div>
    </section>
    ${allowed ? `
    <section class="simulator-banner">
        <div>
            <span class="eyebrow light">TREINO DE PROVA</span>
            <h2>Simulados do concurso</h2>
            <p>Resolva provas completas e listas de questões deste concurso.</p>
        </div>
        <div class="simulator-count">
            <b>${contestQuizzes(c.id).length}</b><span>simulado(s)</span>
        </div>
        <div class="simulator-actions">
            <button class="btn free" onclick="window.openSimulators('${c.id}')">Abrir simulados</button>
        </div>
    </section>
    <div class="page-head">
        <div><span class="eyebrow dark">Conteúdo completo</span><h1>Disciplinas</h1></div>
        <div><strong>${progressContest(c.id).p}% concluído</strong></div>
    </div>
    <div class="discipline-grid">${discs.map(disciplineCard).join("") || '<div class="empty">Nenhuma disciplina cadastrada.</div>'}</div>
    ` : `
    <div class="locked-content">
        <img src="assets/logo-pd.png">
        <h2>Conteúdo bloqueado</h2>
        <p>Libere <strong>${esc(c.title)}</strong> para acessar todas as disciplinas, PDFs, vídeos e questões desse concurso.</p>
        <div class="purchase-box">
            <div>
                <h3>Acesso completo</h3>
                <p>Pagamento único para esta preparação específica.</p>
            </div>
            <div>
                <div class="purchase-price">${money(c.price_cents)}<small>pagamento único</small></div>
                <div class="payment-buttons">
                    <button class="btn primary" onclick="window.buyContest('${c.id}')">Mercado Pago</button>
                    <button class="btn pix-button" onclick="window.buyPix('${c.id}')">Pagar com Pix</button>
                </div>
            </div>
        </div>
    </div>`}`;
}

// ... Outras Páginas e Interações
window.openMaterial = async id => {
    const m = cache.materials.find(x => x.id === id);
    const s = subject(m?.subject_id);
    const d = discipline(s?.contest_discipline_id);
    
    if (!m || !d || !hasAccess(d.contest_id)) return toast("Acesso não autorizado.", "error");
    activeMaterialId = id;
    
    if (m.type === "pdf") {
        const { data, error } = await supabase.storage.from("materials").createSignedUrl(m.storage_path, 600);
        if (error) return toast(error.message, "error");
        window.open(data.signedUrl, "_blank");
    } else if (m.type === "video") {
        openVideo(m);
    } else {
        openQuiz(m);
    }
};

window.toggleFav = async (id, e) => {
    e?.stopPropagation();
    if (isFav(id)) {
        await supabase.from("favorites").delete().eq("user_id", session.user.id).eq("material_id", id);
    } else {
        await supabase.from("favorites").insert({ user_id: session.user.id, material_id: id });
    }
    await loadStudent();
    render();
};

window.toggleDone = async (id, e) => {
    e?.stopPropagation();
    await supabase.from("user_progress").upsert({
        user_id: session.user.id,
        material_id: id,
        completed: !isDone(id),
        updated_at: new Date().toISOString()
    }, { onConflict: "user_id,material_id" });
    
    await loadStudent();
    render();
};

window.buyContest = async contestId => {
    try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const r = await fetch("/.netlify/functions/create-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ contest_id: contestId })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Não foi possível iniciar o pagamento.");
        location.href = data.checkout_url;
    } catch (e) {
        toast(e.message, "error");
    }
};

// ==========================================
// 8. QUESTÕES GRATUITAS DIÁRIAS
// ==========================================
function localISODate() {
    const d = new Date(), pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function openFreeQuestions() {
    if (!configured) return toast("Configure o Supabase.", "error");
    show("free");
    $("freeLoginBtn").classList.toggle("hidden", !!session);
    $("freeQuestionsContent").innerHTML = '<div class="free-empty">Carregando as questões de hoje...</div>';
    
    const { data, error } = await supabase.from("daily_questions")
        .select("*").eq("publish_date", localISODate()).eq("is_published", true).order("position").limit(10);
        
    if (error) {
        $("freeQuestionsContent").innerHTML = `<div class="free-empty">Não foi possível carregar as questões. ${esc(error.message)}</div>`;
        return;
    }
    
    cache.dailyQuestions = data || [];
    renderFreeQuestions();
}

// ==========================================
// 9. PAINEL DO ADMINISTRADOR
// ==========================================
$("adminButton").onclick = async () => {
    if (profile.role !== "admin") return;
    await loadAdmin();
    show("admin");
    renderAdmin();
};

$("backToSite").onclick = async () => {
    await loadStudent();
    show("app");
    render();
};

async function loadAdmin() {
    const [c, d, s, m, a, p, u, q] = await Promise.all([
        supabase.from("contests").select("*").order("position"),
        supabase.from("contest_disciplines").select("*").order("position"),
        supabase.from("subjects").select("*").order("position"),
        supabase.from("materials").select("*").order("position"),
        supabase.from("contest_access").select("*").order("created_at", { ascending: false }),
        supabase.from("purchases").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("daily_questions").select("*").order("publish_date", { ascending: false }).order("position")
    ]);
    
    cache.contests = c.data || [];
    cache.disciplines = d.data || [];
    cache.subjects = s.data || [];
    cache.materials = m.data || [];
    cache.access = a.data || [];
    cache.purchases = p.data || [];
    cache.profiles = u.data || [];
    cache.dailyQuestions = q.data || [];
}

// ... Utilitários da Tabela do Admin
const header = (t, b = "") => `<div class="admin-title-row"><h1>${t}</h1>${b}</div>`;
const table = (h, rows) => `<div class="table-wrap"><table class="table"><thead><tr>${h.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const acts = (e, d) => `<div class="table-actions"><button class="btn secondary small" onclick="${e}">Editar</button><button class="btn danger small" onclick="${d}">Excluir</button></div>`;

// Interface Responsiva Básica
function updateSearch() {
    $("searchInput").placeholder = innerWidth <= 520 ? "Buscar..." : "Buscar concurso ou matéria...";
}
updateSearch();
addEventListener("resize", () => {
    updateSearch();
    if (innerWidth >= 820) setMenu(false);
});


/* PIX DIRETO */
let pixPollTimer=null;
let pixOrderId=null;
let pixContestId=null;
let pixTicketUrl=null;

function closePixViewer(){
  if(pixPollTimer){clearInterval(pixPollTimer);pixPollTimer=null;}
  $("pixViewer").classList.add("hidden");
  document.body.style.overflow="";
  pixOrderId=null;pixContestId=null;pixTicketUrl=null;
}
$("closePixViewer").onclick=closePixViewer;

window.buyPix=async contestId=>{
  try{
    pixContestId=contestId;
    const c=contest(contestId);
    $("pixTitle").textContent=`Pix — ${c?.title||"Concurso"}`;
    $("pixViewer").classList.remove("hidden");
    $("pixLoading").classList.remove("hidden");
    $("pixContent").classList.add("hidden");
    $("pixSuccess").classList.add("hidden");
    document.body.style.overflow="hidden";

    const token=(await supabase.auth.getSession()).data.session?.access_token;
    const r=await fetch("/.netlify/functions/create-pix",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body:JSON.stringify({contest_id:contestId})
    });
    const data=await r.json();
    if(!r.ok){const detail=data.mercado_pago_message?` ${data.mercado_pago_message}`:"";throw new Error((data.error||"Não foi possível gerar o Pix.")+detail);}

    pixOrderId=data.payment_id;
    pixTicketUrl=data.ticket_url||null;
    $("pixQrImage").src=`data:image/png;base64,${data.qr_code_base64}`;
    $("pixCopyCode").value=data.qr_code||"";
    $("pixLoading").classList.add("hidden");
    $("pixContent").classList.remove("hidden");
    $("pixStatus").className="pix-status waiting";
    $("pixStatus").textContent="Aguardando pagamento";

    $("openPixTicket").classList.toggle("hidden",!pixTicketUrl);
    startPixPolling();
  }catch(e){
    closePixViewer();
    toast(e.message||"Erro ao gerar Pix.","error");
  }
};

$("copyPixBtn").onclick=async()=>{
  const code=$("pixCopyCode").value;
  try{
    await navigator.clipboard.writeText(code);
    $("copyPixBtn").textContent="Copiado!";
    setTimeout(()=>$("copyPixBtn").textContent="Copiar",1800);
  }catch{
    $("pixCopyCode").select();
    document.execCommand("copy");
    toast("Código Pix copiado.","success");
  }
};
$("openPixTicket").onclick=()=>{if(pixTicketUrl)window.open(pixTicketUrl,"_blank");};

function startPixPolling(){
  if(pixPollTimer)clearInterval(pixPollTimer);
  checkPixStatus();
  pixPollTimer=setInterval(checkPixStatus,5000);
}
async function checkPixStatus(){
  if(!pixOrderId)return;
  try{
    const token=(await supabase.auth.getSession()).data.session?.access_token;
    const r=await fetch("/.netlify/functions/check-pix-status",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body:JSON.stringify({payment_id:pixOrderId})
    });
    const data=await r.json();
    if(!r.ok)return;
    if(data.approved){
      if(pixPollTimer){clearInterval(pixPollTimer);pixPollTimer=null;}
      $("pixContent").classList.add("hidden");
      $("pixSuccess").classList.remove("hidden");
      await loadStudent();
    }else if(data.status==="failed"||data.status==="canceled"||data.status==="expired"){
      $("pixStatus").textContent="Pagamento não concluído";
    }
  }catch{}
}
$("pixSuccessClose").onclick=()=>{
  const cid=pixContestId;
  closePixViewer();
  if(cid)window.openContest(cid);
};

