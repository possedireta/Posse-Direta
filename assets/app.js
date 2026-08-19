import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = id => document.getElementById(id);
const configured = !SUPABASE_URL.startsWith("COLE_") && !SUPABASE_ANON_KEY.startsWith("COLE_");
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let session = null;
let profile = null;
let activeMaterialId = null;
let adminPage = "dashboard";
let cache = { contests: [], access: [], disciplines: [], subjects: [], materials: [], progress: [], favorites: [], profiles: [], purchases: [], dailyQuestions: [], freeQuizzes: [] };
let state = { page: "home", contestId: null, disciplineId: null, subjectId: null, query: "" };

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
        navigate("home");
    } else {
        state.page = "home";
        show("auth");
    }
};

$("freeLoginBtn").onclick = () => {
    state.page = "home";
    show("auth");
};

$("loginForm").onsubmit = async e => {
    e.preventDefault();
    if (!configured) return toast("Configure o Supabase.", "error");
    const { error } = await supabase.auth.signInWithPassword({ email: $("loginEmail").value.trim(), password: $("loginPassword").value });
    if (error) toast(error.message, "error");
};

$("signupForm").onsubmit = async e => {
    e.preventDefault();
    if (!configured) return toast("Configure o Supabase.", "error");
    const { data, error } = await supabase.auth.signUp({ email: $("signupEmail").value.trim(), password: $("signupPassword").value, options: { data: { full_name: $("signupName").value.trim() } } });
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

async function logout() { await supabase?.auth.signOut() }
$("logoutButton").onclick = logout;
$("adminLogout").onclick = logout;

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
        setTimeout(async () => { await loadStudent(); render(); }, 2500);
    }
}

if (configured) {
    supabase.auth.onAuthStateChange((_e, s) => setTimeout(() => boot(s), 0));
    const { data: { session: s } } = await supabase.auth.getSession();
    await boot(s);
} else {
    show("auth");
    setTimeout(() => toast("Configure o Supabase em assets/config.js.", "error"), 300);
}

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

document.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => {
    if (b.dataset.nav === "free") {
        state.page = "free";
        history.pushState({}, "", `${location.pathname}?gratis=1`);
        openFreeQuestions();
        if (innerWidth < 820) setMenu(false);
        return;
    }
    navigate(b.dataset.nav);
});

$("searchInput").oninput = e => {
    const q = e.target.value.trim();
    navigate(q ? "search" : "home", { query: q });
};

function progressContest(cid) {
    const dids = cache.disciplines.filter(d => d.contest_id === cid).map(d => d.id);
    const sids = cache.subjects.filter(s => dids.includes(s.contest_discipline_id)).map(s => s.id);
    const mats = cache.materials.filter(m => sids.includes(m.subject_id));
    const done = mats.filter(m => isDone(m.id)).length;
    return { done, total: mats.length, p: mats.length ? Math.round(done / mats.length * 100) : 0 };
}

function contestCard(c) {
    const a = accessFor(c.id), locked = !hasAccess(c.id), p = progressContest(c.id);
    return `<article class="contest-card"><div class="contest-cover"><span class="contest-org">${esc(c.institution || c.exam_board || "CONCURSO PÚBLICO")}</span><h3>${esc(c.title)}</h3></div><div class="contest-body">${locked ? '<span class="access-badge locked">🔒 Acesso pago</span>' : `<span class="access-badge active">✓ Acesso ${a?.source === "free" ? "gratuito" : "liberado"}</span>`}<p>${esc(c.description || "")}</p><div class="contest-info">${c.exam_board ? `<span class="pill">Banca: ${esc(c.exam_board)}</span>` : ""}${c.exam_date ? `<span class="pill">Prova: ${fmtDate(c.exam_date)}</span>` : ""}</div>${locked ? `<div class="contest-price">${money(c.price_cents)}<small>acesso a este concurso</small></div>` : `<div class="contest-price">${p.p}%<small>do conteúdo concluído</small></div>`}<div class="contest-actions"><button class="btn primary" onclick="window.openContest('${c.id}')">${locked ? "Ver concurso" : "Entrar no concurso"}</button></div></div></article>`;
}

function contestQuizzes(cid) {
    const dids = cache.disciplines.filter(d => d.contest_id === cid).map(d => d.id);
    const sids = cache.subjects.filter(x => dids.includes(x.contest_discipline_id)).map(x => x.id);
    return cache.materials.filter(m => m.type === "quiz" && m.is_simulator === true && sids.includes(m.subject_id));
}

window.openSimulators = id => navigate("simulators", { contestId: id });

function simulatorsPage() {
    const c = contest(state.contestId);
    if (!c || !hasAccess(c.id)) return navigate("catalog");
    const qs = contestQuizzes(c.id);
    $("mainContent").innerHTML = `<button class="back-btn" onclick="window.openContest('${c.id}')">← ${esc(c.title)}</button><div class="page-head"><div><span class="eyebrow dark">Treino de prova</span><h1>Simulados</h1><p>Todos os simulados e listas de questões disponíveis neste concurso.</p></div><div><strong>${qs.length} disponível(is)</strong></div></div><div class="simulator-grid">${qs.map((m, i) => { const s = subject(m.subject_id), d = discipline(s?.contest_discipline_id); return `<article class="simulator-card"><div class="simulator-icon">📝</div><div><span class="eyebrow dark">SIMULADO ${String(i + 1).padStart(2, "0")}</span><h3>${esc(m.title)}</h3><p>${esc(m.description || `${d?.name || ""}${s?.name ? ` • ${s.name}` : ""}`)}</p><button class="btn primary" onclick="window.openMaterial('${m.id}')">Começar simulado</button></div></article>` }).join("") || '<div class="empty">Nenhum simulado publicado para este concurso.</div>'}</div>`;
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
    $("mainContent").innerHTML = `<section class="welcome"><div class="welcome-card"><span class="eyebrow light">POSSE DIRETA CONCURSOS</span><h1>Prepare-se para o concurso certo.</h1><p>Escolha uma preparação específica e acesse somente o conteúdo daquele concurso.</p><div class="welcome-actions"><button class="btn primary" onclick="window.goCatalog()">Ver concursos</button><button class="btn secondary" onclick="window.goMine()">Meus concursos</button></div></div><div class="goal-card"><span class="eyebrow dark">Sua conta</span><h3>${esc(profile.full_name || "Aluno")}</h3><p>Você possui acesso a <strong>${mine.length}</strong> concurso(s).</p><div class="small-note">O acesso pode ser comprado ou concedido gratuitamente pelo administrador.</div></div></section>${mine.length ? `<section class="section"><div class="section-head"><div><span class="eyebrow dark">Continue estudando</span><h2>Meus concursos</h2></div></div><div class="contest-grid">${mine.slice(0, 3).map(contestCard).join("")}</div></section>` : ""}<section class="section"><div class="section-head"><div><span class="eyebrow dark">Catálogo</span><h2>Concursos disponíveis</h2><p>Cada concurso é um produto separado.</p></div></div><div class="contest-grid">${cache.contests.map(contestCard).join("") || '<div class="empty">Nenhum concurso publicado.</div>'}</div></section>`;
}

window.goCatalog = () => navigate("catalog");
window.goMine = () => navigate("mycontests");
window.openContest = id => navigate("contest", { contestId: id });

function catalog() {
    $("mainContent").innerHTML = `<div class="page-head"><div><span class="eyebrow dark">Catálogo</span><h1>Concursos disponíveis</h1><p>O pagamento libera apenas a preparação selecionada.</p></div></div><div class="contest-grid">${cache.contests.map(contestCard).join("") || '<div class="empty">Nenhum concurso disponível.</div>'}</div>`;
}

function myContests() {
    const mine = cache.contests.filter(c => hasAccess(c.id));
    $("mainContent").innerHTML = `<div class="page-head"><div><span class="eyebrow dark">Área do aluno</span><h1>Meus concursos</h1></div></div><div class="contest-grid">${mine.map(contestCard).join("") || '<div class="empty">Você ainda não possui acesso a nenhum concurso.</div>'}</div>`;
}

function contestPage() {
    const c = contest(state.contestId);
    if (!c) return navigate("catalog");
    const allowed = hasAccess(c.id), discs = cache.disciplines.filter(d => d.contest_id === c.id);
    $("mainContent").innerHTML = `<button class="back-btn" onclick="window.goCatalog()">← Concursos</button><section class="contest-header"><span class="eyebrow light">${esc(c.institution || "CONCURSO")}</span><h1>${esc(c.title)}</h1><p>${esc(c.description || "")}</p><div class="contest-info">${c.exam_board ? `<span class="pill">Banca: ${esc(c.exam_board)}</span>` : ""}${c.exam_date ? `<span class="pill">Prova: ${fmtDate(c.exam_date)}</span>` : ""}</div></section>${allowed ? `<section class="simulator-banner"><div><span class="eyebrow light">TREINO DE PROVA</span><h2>Simulados do concurso</h2><p>Resolva provas completas e listas de questões deste concurso.</p></div><div class="simulator-count"><b>${contestQuizzes(c.id).length}</b><span>simulado(s)</span></div><div class="simulator-actions"><button class="btn free" onclick="window.openSimulators('${c.id}')">Abrir simulados</button></div></section><div class="page-head"><div><span class="eyebrow dark">Conteúdo completo</span><h1>Disciplinas</h1></div><div><strong>${progressContest(c.id).p}% concluído</strong></div></div><div class="discipline-grid">${discs.map(disciplineCard).join("") || '<div class="empty">Nenhuma disciplina cadastrada.</div>'}</div>` : `<div class="locked-content"><img src="assets/logo-pd.png"><h2>Conteúdo bloqueado</h2><p>Libere <strong>${esc(c.title)}</strong> para acessar todas as disciplinas, PDFs, vídeos e questões desse concurso.</p><div class="purchase-box"><div><h3>Acesso completo</h3><p>Pagamento único para esta preparação específica.</p></div><div><div class="purchase-price">${money(c.price_cents)}<small>pagamento único</small></div><div class="payment-buttons"><button class="btn primary" onclick="window.buyContest('${c.id}')">Mercado Pago</button><button class="btn pix-button" onclick="window.buyPix('${c.id}')">Pagar com Pix</button></div></div></div></div>`}`;
}

function disciplineCard(d) {
    const subs = cache.subjects.filter(s => s.contest_discipline_id === d.id);
    return `<article class="discipline-card" onclick="window.openDiscipline('${d.id}')"><div class="disc-top"><div class="disc-icon">${esc(d.icon || "PD")}</div></div><h3>${esc(d.name)}</h3><p>${esc(d.description || "")}</p><div class="disc-meta"><span>${subs.length} matérias</span></div></article>`;
}

window.openDiscipline = id => {
    const d = discipline(id);
    if (!d || !hasAccess(d.contest_id)) return toast("Você não possui acesso a este concurso.", "error");
    navigate("discipline", { disciplineId: id });
};

function disciplinePage() {
    const d = discipline(state.disciplineId);
    if (!d || !hasAccess(d.contest_id)) return navigate("catalog");
    const c = contest(d.contest_id), subs = cache.subjects.filter(s => s.contest_discipline_id === d.id);
    $("mainContent").innerHTML = `<button class="back-btn" onclick="window.openContest('${c.id}')">← ${esc(c.title)}</button><div class="page-head"><div><span class="eyebrow dark">Disciplina</span><h1>${esc(d.name)}</h1><p>${esc(d.description || "")}</p></div></div><div class="topic-grid">${subs.map((s, i) => `<article class="topic-card" onclick="window.openSubject('${s.id}')"><span class="topic-number">${String(i + 1).padStart(2, "0")}</span><h3>${esc(s.name)}</h3><p>${esc(s.description || "")}</p></article>`).join("") || '<div class="empty">Nenhuma matéria cadastrada.</div>'}</div>`;
}

window.openSubject = id => {
    const s = subject(id), d = discipline(s?.contest_discipline_id);
    if (!s || !d || !hasAccess(d.contest_id)) return toast("Conteúdo bloqueado.", "error");
    navigate("subject", { subjectId: id });
};

function subjectPage() {
    const s = subject(state.subjectId), d = discipline(s?.contest_discipline_id), c = contest(d?.contest_id);
    if (!s || !d || !c || !hasAccess(c.id)) return navigate("catalog");
    const mats = cache.materials.filter(m => m.subject_id === s.id);
    $("mainContent").innerHTML = `<button class="back-btn" onclick="window.openDiscipline('${d.id}')">← ${esc(d.name)}</button><div class="page-head"><div><span class="eyebrow dark">Matéria</span><h1>${esc(s.name)}</h1><p>${esc(s.description || "")}</p></div></div><div class="material-list">${mats.map(materialCard).join("") || '<div class="empty">Nenhum material publicado.</div>'}</div>`;
}

function materialCard(m) {
    return `<article class="material-card ${isDone(m.id) ? "completed" : ""}"><div class="material-type-icon ${m.type}">${m.type === "pdf" ? "PDF" : m.type === "video" ? "▶" : "✓"}</div><div class="material-main"><h3>${esc(m.title)}</h3><p>${esc(m.description || "")}</p></div><div class="material-actions"><button class="fav-btn ${isFav(m.id) ? "active" : ""}" onclick="window.toggleFav('${m.id}',event)">☆</button><button class="complete-btn ${isDone(m.id) ? "active" : ""}" onclick="window.toggleDone('${m.id}',event)">✓</button><button class="btn primary small" onclick="window.openMaterial('${m.id}')">${m.type === "pdf" ? "Abrir" : m.type === "video" ? "Assistir" : "Responder"}</button></div></article>`;
}

window.toggleFav = async (id, e) => {
    e?.stopPropagation();
    if (isFav(id)) await supabase.from("favorites").delete().eq("user_id", session.user.id).eq("material_id", id);
    else await supabase.from("favorites").insert({ user_id: session.user.id, material_id: id });
    await loadStudent();
    render();
};

window.toggleDone = async (id, e) => {
    e?.stopPropagation();
    await supabase.from("user_progress").upsert({ user_id: session.user.id, material_id: id, completed: !isDone(id), updated_at: new Date().toISOString() }, { onConflict: "user_id,material_id" });
    await loadStudent();
    render();
};

window.openMaterial = async id => {
    const m = cache.materials.find(x => x.id === id), s = subject(m?.subject_id), d = discipline(s?.contest_discipline_id);
    if (!m || !d || !hasAccess(d.contest_id)) return toast("Acesso não autorizado.", "error");
    activeMaterialId = id;
    if (m.type === "pdf") {
        const { data, error } = await supabase.storage.from("materials").createSignedUrl(m.storage_path, 600);
        if (error) return toast(error.message, "error");
        window.open(data.signedUrl, "_blank");
    } else if (m.type === "video") openVideo(m);
    else openQuiz(m);
};

async function openQuiz(m) {
    if (m.storage_path) {
        const { data, error } = await supabase.storage.from("materials").createSignedUrl(m.storage_path, 600);
        if (error) return toast(error.message, "error");
        const r = await fetch(data.signedUrl);
        $("quizFrame").srcdoc = await r.text();
        $("quizViewerTitle").textContent = m.title;
        $("quizViewer").classList.remove("hidden");
        document.body.style.overflow = "hidden";
    } else window.open(m.external_url, "_blank");
}

$("closeQuizViewer").onclick = () => { $("quizFrame").srcdoc = ""; $("quizViewer").classList.add("hidden"); document.body.style.overflow = ""; };
$("markQuizComplete").onclick = async () => { if (activeMaterialId) await window.toggleDone(activeMaterialId); $("closeQuizViewer").click(); };

function embed(url) {
    try {
        const u = new URL(url);
        if (u.hostname.includes("youtube.com")) return `https://www.youtube.com/embed/${u.searchParams.get("v")}`;
        if (u.hostname === "youtu.be") return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
        if (u.hostname.includes("vimeo.com")) return `https://player.vimeo.com/video/${u.pathname.split("/").filter(Boolean).pop()}`;
    } catch { }
    return url;
}

function openVideo(m) {
    $("videoTitle").textContent = m.title;
    $("videoFrame").src = embed(m.external_url);
    $("videoViewer").classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

$("closeVideoViewer").onclick = () => { $("videoViewer").classList.add("hidden"); $("videoFrame").src = ""; document.body.style.overflow = ""; };
$("markVideoComplete").onclick = async () => { if (activeMaterialId) await window.toggleDone(activeMaterialId); $("closeVideoViewer").click(); };

window.buyContest = async contestId => {
    try {
        const token = (await supabase.auth.getSession()).data.session?.access_token, r = await fetch("/.netlify/functions/create-checkout", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }, body: JSON.stringify({ contest_id: contestId }) }), data = await r.json();
        if (!r.ok) throw new Error(data.error || "Não foi possível iniciar o pagamento.");
        location.href = data.checkout_url;
    } catch (e) { toast(e.message, "error"); }
};

function favoritesPage() {
    const mats = cache.favorites.map(f => cache.materials.find(m => m.id === f.material_id)).filter(Boolean).filter(m => { const d = discipline(subject(m.subject_id)?.contest_discipline_id); return d && hasAccess(d.contest_id) });
    $("mainContent").innerHTML = `<div class="page-head"><div><span class="eyebrow dark">Sua lista</span><h1>Favoritos</h1></div></div><div class="material-list">${mats.map(materialCard).join("") || '<div class="empty">Nenhum favorito.</div>'}</div>`;
}

function progressPage() {
    const mine = cache.contests.filter(c => hasAccess(c.id));
    $("mainContent").innerHTML = `<div class="page-head"><div><span class="eyebrow dark">Desempenho</span><h1>Meu progresso</h1></div></div><div class="progress-subjects">${mine.map(c => { const p = progressContest(c.id); return `<div class="progress-row"><div class="progress-row-top"><b>${esc(c.title)}</b><span>${p.done}/${p.total} • ${p.p}%</span></div><div class="progress-bar"><span style="width:${p.p}%"></span></div></div>` }).join("") || '<div class="empty">Nenhum concurso liberado.</div>'}</div>`;
}

function profilePage() {
    $("mainContent").innerHTML = `<div class="page-head"><div><span class="eyebrow dark">Conta</span><h1>Meu perfil</h1></div></div><div class="profile-card"><form id="profileForm" class="form"><label>Nome</label><input id="pName" value="${esc(profile.full_name || "")}"><label>E-mail</label><input value="${esc(profile.email || "")}" disabled><button class="btn primary">Salvar</button></form></div>`;
    $("profileForm").onsubmit = async e => {
        e.preventDefault();
        const { data, error } = await supabase.from("profiles").update({ full_name: $("pName").value.trim() }).eq("id", session.user.id).select().single();
        if (error) return toast(error.message, "error");
        profile = data;
        $("userName").textContent = data.full_name;
        $("userInitials").textContent = initials(data.full_name);
        toast("Perfil atualizado.", "success");
    };
}

function searchPage() {
    const q = (state.query || "").toLowerCase(), cs = cache.contests.filter(c => (c.title + " " + (c.institution || "") + " " + (c.exam_board || "")).toLowerCase().includes(q)), ss = cache.subjects.filter(s => (s.name + " " + (s.description || "")).toLowerCase().includes(q)).filter(s => { const d = discipline(s.contest_discipline_id); return d && hasAccess(d.contest_id) });
    $("mainContent").innerHTML = `<div class="page-head"><div><span class="eyebrow dark">Busca</span><h1>Resultados para “${esc(state.query)}”</h1></div></div><div class="search-result-grid">${cs.map(c => `<article class="search-result" onclick="window.openContest('${c.id}')"><small>Concurso</small><h3>${esc(c.title)}</h3></article>`).join("")}${ss.map(s => `<article class="search-result" onclick="window.openSubject('${s.id}')"><small>Matéria</small><h3>${esc(s.name)}</h3></article>`).join("")}${!cs.length && !ss.length ? '<div class="empty">Nada encontrado.</div>' : ""}</div>`;
}

function localISODate() {
    const d = new Date(), pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function openFreeQuestions() {
    if (!configured) return toast("Configure o Supabase.", "error");
    show("free");
    $("freeLoginBtn").classList.toggle("hidden", !!session);
    $("freeQuestionsContent").innerHTML = '<div class="free-empty">Carregando as questões gratuitas...</div>';
    const today = localISODate();
    const { data, error } = await supabase.from("free_quizzes").select("*").eq("publish_date", today).eq("is_published", true).order("created_at", { ascending: false }).limit(1);
    if (error) { $("freeQuestionsContent").innerHTML = `<div class="free-empty">Não foi possível carregar as questões. ${esc(error.message)}</div>`; return; }
    const q = data?.[0];
    if (!q) { $("freeQuestionsContent").innerHTML = '<div class="free-empty"><h2>As questões de hoje ainda não foram publicadas.</h2><p>Volte mais tarde para fazer o treino gratuito do dia.</p></div>'; return; }
    const { data: urlData } = supabase.storage.from("free-quizzes").getPublicUrl(q.storage_path);
    $("freeQuestionsContent").innerHTML = `<section class="free-html-card"><div class="free-html-head"><div><span class="eyebrow dark">QUESTÕES DE HOJE</span><h2>${esc(q.title)}</h2>${q.description ? `<p>${esc(q.description)}</p>` : ""}</div></div><iframe id="freeQuizFrame" class="free-quiz-frame" title="${esc(q.title)}"></iframe></section>`;
    try {
        const r = await fetch(urlData.publicUrl);
        if (!r.ok) throw new Error("Arquivo HTML não encontrado.");
        $("freeQuizFrame").srcdoc = await r.text();
    } catch (e) {
        $("freeQuestionsContent").innerHTML = `<div class="free-empty">Erro ao abrir o arquivo HTML: ${esc(e.message)}</div>`;
    }
}

window.openFreeQuestions = openFreeQuestions;

$("adminButton").onclick = async () => { if (profile.role !== "admin") return; await loadAdmin(); show("admin"); renderAdmin(); };
$("backToSite").onclick = async () => { await loadStudent(); show("app"); render(); };

async function loadAdmin() {
    const [c, d, s, m, a, p, u, q] = await Promise.all([
        supabase.from("contests").select("*").order("position"),
        supabase.from("contest_disciplines").select("*").order("position"),
        supabase.from("subjects").select("*").order("position"),
        supabase.from("materials").select("*").order("position"),
        supabase.from("contest_access").select("*").order("created_at", { ascending: false }),
        supabase.from("purchases").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("free_quizzes").select("*").order("publish_date", { ascending: false }).order("created_at", { ascending: false })
    ]);
    cache.contests = c.data || [];
    cache.disciplines = d.data || [];
    cache.subjects = s.data || [];
    cache.materials = m.data || [];
    cache.access = a.data || [];
    cache.purchases = p.data || [];
    cache.profiles = u.data || [];
    cache.freeQuizzes = q.error ? [] : (q.data || []);
}

document.querySelectorAll("[data-admin]").forEach(b => b.onclick = () => { adminPage = b.dataset.admin; renderAdmin(); });

const header = (t, b = "") => `<div class="admin-title-row"><h1>${t}</h1>${b}</div>`;
const table = (h, rows) => `<div class="table-wrap"><table class="table"><thead><tr>${h.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const acts = (e, d) => `<div class="table-actions"><button class="btn secondary small" onclick="${e}">Editar</button><button class="btn danger small" onclick="${d}">Excluir</button></div>`;

function renderAdmin() {
    document.querySelectorAll("[data-admin]").forEach(b => b.classList.toggle("active", b.dataset.admin === adminPage));
    const titles = { dashboard: "Visão geral", contests: "Concursos", disciplines: "Disciplinas", subjects: "Matérias", materials: "Materiais", dailyquestions: "Questões grátis", access: "Acessos", purchases: "Pagamentos", users: "Usuários" };
    $("adminPageTitle").textContent = titles[adminPage];
    if (adminPage === "dashboard") $("adminContent").innerHTML = header("Visão geral") + `<div class="admin-stats"><div class="admin-stat"><b>${cache.contests.length}</b><span>Concursos</span></div><div class="admin-stat"><b>${cache.profiles.length}</b><span>Usuários</span></div><div class="admin-stat"><b>${cache.access.filter(a => a.status === "active").length}</b><span>Acessos ativos</span></div><div class="admin-stat"><b>${cache.purchases.filter(p => p.status === "approved").length}</b><span>Compras aprovadas</span></div></div>`;
    else if (adminPage === "contests") adminContests();
    else if (adminPage === "disciplines") adminDisciplines();
    else if (adminPage === "subjects") adminSubjects();
    else if (adminPage === "materials") adminMaterials();
    else if (adminPage === "dailyquestions") adminDailyQuestions();
    else if (adminPage === "access") adminAccess();
    else if (adminPage === "purchases") adminPurchases();
    else adminUsers();
}

function adminContests() {
    $("adminContent").innerHTML = header("Concursos", `<button class="btn primary" onclick="window.editContest()">+ Novo concurso</button>`) + table(["Concurso", "Instituição", "Preço", "Publicado", "Ações"], cache.contests.map(c => [`<strong>${esc(c.title)}</strong>`, esc(c.institution || ""), money(c.price_cents), c.is_published ? "Sim" : "Não", acts(`window.editContest('${c.id}')`, `window.del('contests','${c.id}')`)]));
}

function adminDisciplines() {
    $("adminContent").innerHTML = header("Disciplinas", `<button class="btn primary" onclick="window.editDiscipline()">+ Nova disciplina</button>`) + table(["Disciplina", "Concurso", "Ordem", "Ações"], cache.disciplines.map(d => [`<strong>${esc(d.name)}</strong>`, esc(contest(d.contest_id)?.title || ""), d.position, acts(`window.editDiscipline('${d.id}')`, `window.del('contest_disciplines','${d.id}')`)]));
}

function adminSubjects() {
    $("adminContent").innerHTML = header("Matérias", `<button class="btn primary" onclick="window.editSubject()">+ Nova matéria</button>`) + table(["Matéria", "Disciplina", "Concurso", "Ações"], cache.subjects.map(s => { const d = discipline(s.contest_discipline_id); return [`<strong>${esc(s.name)}</strong>`, esc(d?.name || ""), esc(contest(d?.contest_id)?.title || ""), acts(`window.editSubject('${s.id}')`, `window.del('subjects','${s.id}')`)] }));
}

function adminMaterials() {
    $("adminContent").innerHTML = header("Materiais", `<button class="btn primary" onclick="window.editMaterial()">+ Novo material</button>`) + table(["Título", "Tipo", "Matéria", "Ações"], cache.materials.map(m => [`<strong>${esc(m.title)}</strong>`, (m.type === "quiz" && m.is_simulator) ? "Simulado" : m.type, esc(subject(m.subject_id)?.name || ""), acts(`window.editMaterial('${m.id}')`, `window.deleteMaterial('${m.id}')`)]));
}

function adminDailyQuestions() {
    $("adminContent").innerHTML = header("Questões grátis em HTML", `<button class="btn primary" onclick="window.editFreeQuiz()">+ Adicionar HTML</button>`) + `<div class="admin-section"><p class="help">Envie um arquivo HTML com as questões, no mesmo padrão dos arquivos usados nas matérias. O arquivo publicado para a data ficará acessível sem login e sem compra.</p></div>` + table(["Data", "Título", "Arquivo", "Status", "Ações"], cache.freeQuizzes.map(q => [fmtDate(q.publish_date), `<strong>${esc(q.title)}</strong>`, esc(q.storage_path || ""), q.is_published ? "Publicado" : "Oculto", acts(`window.editFreeQuiz('${q.id}')`, `window.deleteFreeQuiz('${q.id}')`)]));
}

function adminAccess() {
    $("adminContent").innerHTML = header("Acessos", `<button class="btn primary" onclick="window.grantAccess()">+ Liberar acesso grátis</button>`) + table(["Usuário", "Concurso", "Origem", "Status", "Ação"], cache.access.map(a => { const u = cache.profiles.find(x => x.id === a.user_id); return [`<strong>${esc(u?.full_name || u?.email || a.user_id)}</strong>`, esc(contest(a.contest_id)?.title || ""), `<span class="access-source ${a.source}">${a.source === "free" ? "Grátis" : "Pago"}</span>`, a.status, `<button class="btn danger small" onclick="window.revokeAccess('${a.id}')">Revogar</button>`] }));
}

function adminPurchases() {
    $("adminContent").innerHTML = header("Pagamentos") + table(["Usuário", "Concurso", "Valor", "Status", "Pagamento"], cache.purchases.map(p => { const u = cache.profiles.find(x => x.id === p.user_id); return [esc(u?.email || p.user_id), esc(contest(p.contest_id)?.title || ""), money(p.amount_cents), p.status, esc(p.provider_payment_id || "—")] }));
}

function adminUsers() {
    $("adminContent").innerHTML = header("Usuários") + table(["Nome", "E-mail", "Perfil", "Acessos"], cache.profiles.map(u => [`<strong>${esc(u.full_name || "")}</strong>`, esc(u.email || ""), u.role, cache.access.filter(a => a.user_id === u.id && a.status === "active").length]));
}

function modal(t, b) {
    $("modalTitle").textContent = t;
    $("modalBody").innerHTML = b;
    $("modal").classList.add("open");
}

function closeModal() {
    $("modal").classList.remove("open");
}

$("modalClose").onclick = closeModal;
$("modal").onclick = e => { if (e.target === $("modal")) closeModal(); };

window.editContest = id => {
    const c = contest(id) || {};
    modal(id ? "Editar concurso" : "Novo concurso", `<form id="cForm" class="form"><label>Nome do concurso</label><input id="cTitle" required value="${esc(c.title || "")}"><div class="form-row"><div><label>Instituição</label><input id="cInst" value="${esc(c.institution || "")}"></div><div><label>Banca</label><input id="cBoard" value="${esc(c.exam_board || "")}"></div></div><label>Descrição</label><textarea id="cDesc">${esc(c.description || "")}</textarea><div class="form-row"><div><label>Preço (R$)</label><input id="cPrice" type="number" step="0.01" value="${((c.price_cents || 0) / 100).toFixed(2)}"></div><div><label>Data da prova</label><input id="cDate" type="date" value="${c.exam_date || ""}"></div></div><div class="form-row"><div><label>Ordem</label><input id="cPos" type="number" value="${c.position ?? 0}"></div><div><label>Status</label><select id="cPub"><option value="true" ${c.is_published !== false ? "selected" : ""}>Publicado</option><option value="false" ${c.is_published === false ? "selected" : ""}>Oculto</option></select></div></div><button class="btn primary">Salvar concurso</button></form>`);
    $("cForm").onsubmit = async e => {
        e.preventDefault();
        const p = { title: $("cTitle").value.trim(), institution: $("cInst").value.trim(), exam_board: $("cBoard").value.trim(), description: $("cDesc").value.trim(), price_cents: Math.round(Number($("cPrice").value || 0) * 100), exam_date: $("cDate").value || null, position: Number($("cPos").value || 0), is_published: $("cPub").value === "true" };
        const q = id ? supabase.from("contests").update(p).eq("id", id) : supabase.from("contests").insert(p);
        const { error } = await q;
        if (error) return toast(error.message, "error");
        closeModal();
        await loadAdmin();
        renderAdmin();
        toast("Concurso salvo.", "success");
    };
};

window.editDiscipline = id => {
    const d = discipline(id) || {};
    modal(id ? "Editar disciplina" : "Nova disciplina", `<form id="dForm" class="form"><label>Concurso</label><select id="dContest" required><option value="">Selecione</option>${cache.contests.map(c => `<option value="${c.id}" ${c.id === d.contest_id ? "selected" : ""}>${esc(c.title)}</option>`).join("")}</select><label>Nome</label><input id="dName" required value="${esc(d.name || "")}"><label>Descrição</label><textarea id="dDesc">${esc(d.description || "")}</textarea><div class="form-row"><div><label>Sigla</label><input id="dIcon" value="${esc(d.icon || "")}"></div><div><label>Ordem</label><input id="dPos" type="number" value="${d.position ?? 0}"></div></div><button class="btn primary">Salvar</button></form>`);
    $("dForm").onsubmit = async e => {
        e.preventDefault();
        const p = { contest_id: $("dContest").value, name: $("dName").value.trim(), description: $("dDesc").value.trim(), icon: $("dIcon").value.trim(), position: Number($("dPos").value || 0), is_active: true };
        const q = id ? supabase.from("contest_disciplines").update(p).eq("id", id) : supabase.from("contest_disciplines").insert(p);
        const { error } = await q;
        if (error) return toast(error.message, "error");
        closeModal();
        await loadAdmin();
        renderAdmin();
        toast("Disciplina salva.", "success");
    };
};

window.editSubject = id => {
    const s = subject(id) || {};
    modal(id ? "Editar matéria" : "Nova matéria", `<form id="sForm" class="form"><label>Disciplina</label><select id="sDisc" required><option value="">Selecione</option>${cache.disciplines.map(d => `<option value="${d.id}" ${d.id === s.contest_discipline_id ? "selected" : ""}>${esc(contest(d.contest_id)?.title || "")} — ${esc(d.name)}</option>`).join("")}</select><label>Nome</label><input id="sName" required value="${esc(s.name || "")}"><label>Descrição</label><textarea id="sDesc">${esc(s.description || "")}</textarea><label>Ordem</label><input id="sPos" type="number" value="${s.position ?? 0}"><button class="btn primary">Salvar</button></form>`);
    $("sForm").onsubmit = async e => {
        e.preventDefault();
        const p = { contest_discipline_id: $("sDisc").value, name: $("sName").value.trim(), description: $("sDesc").value.trim(), position: Number($("sPos").value || 0), is_active: true };
        const q = id ? supabase.from("subjects").update(p).eq("id", id) : supabase.from("subjects").insert(p);
        const { error } = await q;
        if (error) return toast(error.message, "error");
        closeModal();
        await loadAdmin();
        renderAdmin();
        toast("Matéria salva.", "success");
    };
};

window.editMaterial = id => {
    const m = cache.materials.find(x => x.id === id) || {};
    modal(id ? "Editar material" : "Novo material", `<form id="mForm" class="form"><label>Matéria</label><select id="mSubject" required><option value="">Selecione</option>${cache.subjects.map(s => { const d = discipline(s.contest_discipline_id); return `<option value="${s.id}" ${s.id === m.subject_id ? "selected" : ""}>${esc(contest(d?.contest_id)?.title || "")} — ${esc(d?.name || "")} — ${esc(s.name)}</option>` }).join("")}</select><div class="form-row"><div><label>Tipo</label><select id="mType"><option value="pdf" ${m.type === "pdf" ? "selected" : ""}>PDF</option><option value="video" ${m.type === "video" ? "selected" : ""}>Vídeo</option><option value="quiz" ${m.type === "quiz" ? "selected" : ""}>Questões HTML</option></select></div><div><label>Ordem</label><input id="mPos" type="number" value="${m.position ?? 0}"></div></div><label>Título</label><input id="mTitle" required value="${esc(m.title || "")}"><label>Descrição</label><textarea id="mDesc">${esc(m.description || "")}</textarea><div id="fileArea"><label>Arquivo</label><input id="mFile" type="file" accept=".pdf,.html,.htm"></div><div id="urlArea"><label>Link externo</label><input id="mUrl" type="url" value="${esc(m.external_url || "")}"></div><div id="simulatorArea" class="check-row"><input id="mSimulator" type="checkbox" ${m.is_simulator ? "checked" : ""}><label for="mSimulator">Exibir na área de simulados deste concurso</label></div><button class="btn primary">Salvar</button></form>`);
    const sync = () => { $("fileArea").classList.toggle("hidden", $("mType").value === "video"); $("urlArea").classList.toggle("hidden", $("mType").value !== "video"); $("simulatorArea").classList.toggle("hidden", $("mType").value !== "quiz"); };
    $("mType").onchange = sync;
    sync();
    $("mForm").onsubmit = async e => {
        e.preventDefault();
        const type = $("mType").value;
        let path = m.type === type ? m.storage_path : null, url = type === "video" ? $("mUrl").value.trim() : null;
        const f = $("mFile").files[0];
        if (type !== "video" && f) {
            const np = `${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`, ct = type === "pdf" ? "application/pdf" : "text/html; charset=utf-8";
            const { error } = await supabase.storage.from("materials").upload(np, f, { contentType: ct });
            if (error) return toast(error.message, "error");
            if (m.storage_path) await supabase.storage.from("materials").remove([m.storage_path]);
            path = np;
        }
        if (type !== "video" && !path) return toast("Selecione o arquivo.", "error");
        const p = { subject_id: $("mSubject").value, type, title: $("mTitle").value.trim(), description: $("mDesc").value.trim(), storage_path: path, external_url: url, position: Number($("mPos").value || 0), is_published: true, is_simulator: type === "quiz" && $("mSimulator").checked };
        const q = id ? supabase.from("materials").update(p).eq("id", id) : supabase.from("materials").insert(p);
        const { error } = await q;
        if (error) return toast(error.message, "error");
        closeModal();
        await loadAdmin();
        renderAdmin();
        toast("Material salvo.", "success");
    };
};

window.editFreeQuiz = id => {
    const q = cache.freeQuizzes.find(x => x.id === id) || {};
    modal(id ? "Editar questões grátis" : "Adicionar questões grátis", `<form id="fqForm" class="form"><div class="form-row"><div><label>Data de publicação</label><input id="fqDate" type="date" required value="${q.publish_date || localISODate()}"></div><div><label>Status</label><select id="fqPublished"><option value="true" ${q.is_published !== false ? "selected" : ""}>Publicado</option><option value="false" ${q.is_published === false ? "selected" : ""}>Oculto</option></select></div></div><label>Título</label><input id="fqTitle" required value="${esc(q.title || "10 questões gratuitas do dia")}"><label>Descrição</label><textarea id="fqDesc">${esc(q.description || "")}</textarea><label>Arquivo HTML ${id ? "(deixe vazio para manter o atual)" : ""}</label><input id="fqFile" type="file" accept=".html,text/html" ${id ? "" : "required"}><p class="help">Use o mesmo arquivo .html interativo que você usa nas matérias do concurso.</p><button class="btn primary">Salvar e publicar</button></form>`);
    $("fqForm").onsubmit = async e => {
        e.preventDefault();
        let path = q.storage_path || null;
        const f = $("fqFile").files[0];
        if (f) {
            if (!f.name.toLowerCase().endsWith(".html")) return toast("Selecione um arquivo HTML.", "error");
            const np = `${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
            const { error } = await supabase.storage.from("free-quizzes").upload(np, f, { contentType: "text/html; charset=utf-8" });
            if (error) return toast(error.message, "error");
            if (q.storage_path) await supabase.storage.from("free-quizzes").remove([q.storage_path]);
            path = np;
        }
        if (!path) return toast("Selecione o arquivo HTML.", "error");
        const payload = { publish_date: $("fqDate").value, title: $("fqTitle").value.trim(), description: $("fqDesc").value.trim(), storage_path: path, is_published: $("fqPublished").value === "true" };
        const req = id ? supabase.from("free_quizzes").update(payload).eq("id", id) : supabase.from("free_quizzes").insert(payload);
        const { error } = await req;
        if (error) return toast(error.message, "error");
        closeModal();
        await loadAdmin();
        renderAdmin();
        toast("Arquivo HTML salvo.", "success");
    };
};

window.deleteFreeQuiz = async id => {
    const q = cache.freeQuizzes.find(x => x.id === id);
    if (!confirm("Excluir estas questões gratuitas?")) return;
    if (q?.storage_path) await supabase.storage.from("free-quizzes").remove([q.storage_path]);
    const { error } = await supabase.from("free_quizzes").delete().eq("id", id);
    if (error) return toast(error.message, "error");
    await loadAdmin();
    renderAdmin();
    toast("Arquivo excluído.", "success");
};

window.grantAccess = () => {
    modal("Liberar acesso gratuitamente", `<form id="grantForm" class="form"><label>Usuário</label><select id="gUser" required><option value="">Selecione</option>${cache.profiles.map(u => `<option value="${u.id}">${esc(u.full_name || u.email)} — ${esc(u.email || "")}</option>`).join("")}</select><label>Concurso</label><select id="gContest" required><option value="">Selecione</option>${cache.contests.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join("")}</select><p class="help">Libera o mesmo conteúdo de um comprador, sem cobrança.</p><button class="btn primary">Liberar acesso grátis</button></form>`);
    $("grantForm").onsubmit = async e => {
        e.preventDefault();
        const { error } = await supabase.from("contest_access").upsert({ user_id: $("gUser").value, contest_id: $("gContest").value, status: "active", source: "free", granted_by: session.user.id }, { onConflict: "user_id,contest_id" });
        if (error) return toast(error.message, "error");
        closeModal();
        await loadAdmin();
        renderAdmin();
        toast("Acesso gratuito liberado.", "success");
    };
};

window.revokeAccess = async id => {
    if (!confirm("Revogar este acesso?")) return;
    await supabase.from("contest_access").update({ status: "revoked" }).eq("id", id);
    await loadAdmin();
    renderAdmin();
};

window.del = async (t, id) => {
    if (!confirm("Excluir este item?")) return;
    const { error } = await supabase.from(t).delete().eq("id", id);
    if (error) return toast(error.message, "error");
    await loadAdmin();
    renderAdmin();
};

window.deleteMaterial = async id => {
    const m = cache.materials.find(x => x.id === id);
    if (!confirm("Excluir material?")) return;
    if (m?.storage_path) await supabase.storage.from("materials").remove([m.storage_path]);
    await supabase.from("materials").delete().eq("id", id);
    await loadAdmin();
    renderAdmin();
};

function updateSearch() {
    $("searchInput").placeholder = innerWidth <= 520 ? "Buscar..." : "Buscar concurso ou matéria...";
}

updateSearch();
addEventListener("resize", () => {
    updateSearch();
    if (innerWidth >= 820) setMenu(false);
});

let pixPollTimer = null;
let pixOrderId = null;
let pixContestId = null;
let pixTicketUrl = null;

function closePixViewer() {
    if (pixPollTimer) { clearInterval(pixPollTimer); pixPollTimer = null; }
    $("pixViewer").classList.add("hidden");
    document.body.style.overflow = "";
    pixOrderId = null; pixContestId = null; pixTicketUrl = null;
}
$("closePixViewer").onclick = closePixViewer;

window.buyPix = async contestId => {
    try {
        pixContestId = contestId;
        const c = contest(contestId);
        $("pixTitle").textContent = `Pix — ${c?.title || "Concurso"}`;
        $("pixViewer").classList.remove("hidden");
        $("pixLoading").classList.remove("hidden");
        $("pixContent").classList.add("hidden");
        $("pixSuccess").classList.add("hidden");
        document.body.style.overflow = "hidden";
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const r = await fetch("/.netlify/functions/create-pix", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }, body: JSON.stringify({ contest_id: contestId }) });
        const data = await r.json();
        if (!r.ok) { const detail = data.mercado_pago_message ? ` ${data.mercado_pago_message}` : ""; throw new Error((data.error || "Não foi possível gerar o Pix.") + detail); }
        pixOrderId = data.payment_id;
        pixTicketUrl = data.ticket_url || null;
        $("pixQrImage").src = `data:image/png;base64,${data.qr_code_base64}`;
        $("pixCopyCode").value = data.qr_code || "";
        $("pixLoading").classList.add("hidden");
        $("pixContent").classList.remove("hidden");
        $("pixStatus").className = "pix-status waiting";
        $("pixStatus").textContent = "Aguardando pagamento";
        $("openPixTicket").classList.toggle("hidden", !pixTicketUrl);
        startPixPolling();
    } catch (e) {
        closePixViewer();
        toast(e.message || "Erro ao gerar Pix.", "error");
    }
};

$("copyPixBtn").onclick = async () => {
    const code = $("pixCopyCode").value;
    try {
        await navigator.clipboard.writeText(code);
        $("copyPixBtn").textContent = "Copiado!";
        setTimeout(() => $("copyPixBtn").textContent = "Copiar", 1800);
    } catch {
        $("pixCopyCode").select();
        document.execCommand("copy");
        toast("Código Pix copiado.", "success");
    }
};

$("openPixTicket").onclick = () => { if (pixTicketUrl) window.open(pixTicketUrl, "_blank"); };

function startPixPolling() {
    if (pixPollTimer) clearInterval(pixPollTimer);
    checkPixStatus();
    pixPollTimer = setInterval(checkPixStatus, 5000);
}

async function checkPixStatus() {
    if (!pixOrderId) return;
    try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const r = await fetch("/.netlify/functions/check-pix-status", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }, body: JSON.stringify({ payment_id: pixOrderId }) });
        const data = await r.json();
        if (!r.ok) return;
        if (data.approved) {
            if (pixPollTimer) { clearInterval(pixPollTimer); pixPollTimer = null; }
            $("pixContent").classList.add("hidden");
            $("pixSuccess").classList.remove("hidden");
            await loadStudent();
        } else if (data.status === "failed" || data.status === "canceled" || data.status === "expired") {
            $("pixStatus").textContent = "Pagamento não concluído";
        }
    } catch { }
}

$("pixSuccessClose").onclick = () => {
    const cid = pixContestId;
    closePixViewer();
    if (cid) window.openContest(cid);
};