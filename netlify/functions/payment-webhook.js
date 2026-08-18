import { createClient } from "@supabase/supabase-js";
export default async (request)=>{
  if(request.method!=="POST") return new Response("ok");
  const U=Netlify.env.get("SUPABASE_URL"),S=Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),MP=Netlify.env.get("MERCADO_PAGO_ACCESS_TOKEN");
  if(!U||!S||!MP) return new Response("server not configured",{status:500});
  const admin=createClient(U,S);let body={};try{body=await request.json()}catch{}
  const paymentId=body?.data?.id||new URL(request.url).searchParams.get("data.id");if(!paymentId)return new Response("ok");
  const r=await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`,{headers:{Authorization:`Bearer ${MP}`}});if(!r.ok)return new Response("lookup failed",{status:502});const payment=await r.json();
  const purchaseId=payment.external_reference||payment.metadata?.purchase_id;if(!purchaseId)return new Response("ok");
  const {data:p}=await admin.from("purchases").select("*").eq("id",purchaseId).maybeSingle();if(!p)return new Response("ok");
  const approved=payment.status==="approved"&&Math.round(Number(payment.transaction_amount||0)*100)===p.amount_cents;
  await admin.from("purchases").update({status:approved?"approved":payment.status==="rejected"?"rejected":"pending",provider_payment_id:String(payment.id),updated_at:new Date().toISOString()}).eq("id",p.id);
  if(approved) await admin.from("contest_access").upsert({user_id:p.user_id,contest_id:p.contest_id,status:"active",source:"paid"},{onConflict:"user_id,contest_id"});
  return new Response("ok");
};
