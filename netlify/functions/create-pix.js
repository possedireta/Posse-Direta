import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export default async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Método não permitido." }, { status: 405 });
  }

  const jwt = (request.headers.get("authorization") || "").replace(/^Bearer\s+/, "");
  if (!jwt) return Response.json({ error: "Não autenticado." }, { status: 401 });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const MP = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const SITE_URL = (process.env.SITE_URL || process.env.URL || new URL(request.url).origin).replace(/\/$/, "");

  const missing = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SERVICE) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!MP) missing.push("MERCADO_PAGO_ACCESS_TOKEN");

  if (missing.length) {
    return Response.json({
      error: "Pagamento ainda não foi configurado no servidor.",
      missing_variables: missing
    }, { status: 500 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE);
  const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !user) return Response.json({ error: "Sessão inválida." }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}
  const contestId = body?.contest_id;
  if (!contestId) return Response.json({ error: "Concurso não informado." }, { status: 400 });

  const { data: contest, error: cErr } = await admin
    .from("contests")
    .select("*")
    .eq("id", contestId)
    .eq("is_published", true)
    .single();

  if (cErr || !contest) return Response.json({ error: "Concurso não encontrado." }, { status: 404 });
  if (!contest.price_cents || contest.price_cents <= 0) {
    return Response.json({ error: "Preço do concurso não configurado." }, { status: 400 });
  }

  const { data: existing } = await admin
    .from("contest_access")
    .select("id")
    .eq("user_id", user.id)
    .eq("contest_id", contest.id)
    .eq("status", "active")
    .maybeSingle();

  if (existing) return Response.json({ error: "Você já possui acesso a este concurso." }, { status: 409 });

  const { data: purchase, error: pErr } = await admin
    .from("purchases")
    .insert({
      user_id: user.id,
      contest_id: contest.id,
      amount_cents: contest.price_cents,
      status: "pending",
      provider: "mercadopago",
      payment_method: "pix"
    })
    .select()
    .single();

  if (pErr) {
    console.error("purchase insert error", pErr);
    return Response.json({ error: "Não foi possível criar o pedido no banco." }, { status: 500 });
  }

  const paymentBody = {
    transaction_amount: Number(contest.price_cents) / 100,
    description: `Posse Direta - ${contest.title}`.slice(0, 200),
    payment_method_id: "pix",
    payer: { email: user.email },
    external_reference: purchase.id,
    metadata: {
      purchase_id: purchase.id,
      contest_id: contest.id,
      user_id: user.id
    },
    notification_url: `${SITE_URL}/.netlify/functions/payment-webhook`
  };

  const mp = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MP}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": crypto.randomUUID()
    },
    body: JSON.stringify(paymentBody)
  });

  const data = await mp.json();

  if (!mp.ok) {
    console.error("Mercado Pago Pix error:", mp.status, JSON.stringify(data));

    await admin.from("purchases")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", purchase.id);

    const cause = Array.isArray(data?.cause) && data.cause.length
      ? (data.cause[0]?.description || data.cause[0]?.code || "")
      : "";

    // Return useful but non-secret diagnostic info to the frontend.
    return Response.json({
      error: "O Mercado Pago recusou a criação do Pix.",
      mercado_pago_status: mp.status,
      mercado_pago_message: data?.message || data?.error || cause || "Erro não detalhado.",
      mercado_pago_cause: cause || undefined
    }, { status: 502 });
  }

  const td = data?.point_of_interaction?.transaction_data || {};
  if (!data?.id || !td.qr_code || !td.qr_code_base64) {
    console.error("Pix created without QR payload:", JSON.stringify({
      id: data?.id,
      status: data?.status,
      status_detail: data?.status_detail,
      has_point_of_interaction: !!data?.point_of_interaction
    }));

    return Response.json({
      error: "O pagamento foi criado, mas o Mercado Pago não retornou o QR Code.",
      status: data?.status,
      status_detail: data?.status_detail
    }, { status: 502 });
  }

  await admin.from("purchases").update({
    provider_payment_id: String(data.id),
    status: data.status === "approved" ? "approved" : "pending",
    updated_at: new Date().toISOString()
  }).eq("id", purchase.id);

  return Response.json({
    payment_id: String(data.id),
    status: data.status,
    status_detail: data.status_detail,
    qr_code: td.qr_code,
    qr_code_base64: td.qr_code_base64,
    ticket_url: td.ticket_url || null
  });
};
