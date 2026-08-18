import { createClient } from "@supabase/supabase-js";

export default async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Método não permitido." }, { status: 405 });
  }

  const jwt = (request.headers.get("authorization") || "").replace(/^Bearer\s+/, "");
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const MP = process.env.MERCADO_PAGO_ACCESS_TOKEN;

  if (!jwt) return Response.json({ error: "Não autenticado." }, { status: 401 });
  if (!SUPABASE_URL || !SERVICE || !MP) {
    return Response.json({ error: "Servidor de pagamento não configurado." }, { status: 500 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE);
  const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !user) return Response.json({ error: "Sessão inválida." }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}
  const paymentId = body?.payment_id || body?.order_id;
  if (!paymentId) return Response.json({ error: "Pagamento não informado." }, { status: 400 });

  const { data: purchase } = await admin
    .from("purchases")
    .select("*")
    .eq("provider_payment_id", String(paymentId))
    .eq("user_id", user.id)
    .maybeSingle();

  if (!purchase) return Response.json({ error: "Pagamento não encontrado." }, { status: 404 });

  const mp = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { "Authorization": `Bearer ${MP}` }
  });

  const payment = await mp.json();
  if (!mp.ok) return Response.json({ error: "Não foi possível consultar o Pix." }, { status: 502 });

  const paidCents = Math.round(Number(payment.transaction_amount || 0) * 100);
  const amountOk = paidCents === purchase.amount_cents;
  const approved = payment.status === "approved" && amountOk;

  if (approved) {
    await admin.from("purchases").update({
      status: "approved",
      updated_at: new Date().toISOString()
    }).eq("id", purchase.id);

    await admin.from("contest_access").upsert({
      user_id: purchase.user_id,
      contest_id: purchase.contest_id,
      status: "active",
      source: "paid"
    }, { onConflict: "user_id,contest_id" });
  } else if (["rejected","cancelled","refunded"].includes(payment.status)) {
    const map = { rejected:"rejected", cancelled:"cancelled", refunded:"refunded" };
    await admin.from("purchases").update({
      status: map[payment.status],
      updated_at: new Date().toISOString()
    }).eq("id", purchase.id);
  }

  return Response.json({
    approved,
    status: payment.status,
    status_detail: payment.status_detail
  });
};
