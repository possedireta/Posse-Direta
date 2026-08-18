import { createClient } from "@supabase/supabase-js";

export default async (request) => {
  if(request.method!=="POST") return new Response("ok",{status:200});

  const SUPABASE_URL=process.env.SUPABASE_URL;
  const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const MP=process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if(!SUPABASE_URL||!SERVICE||!MP) return new Response("server not configured",{status:500});

  let body={};try{body=await request.json();}catch{}
  const url=new URL(request.url);
  const orderId=body?.data?.id || url.searchParams.get("data.id");
  if(!orderId) return new Response("ok",{status:200});

  const admin=createClient(SUPABASE_URL,SERVICE);
  const {data:purchase}=await admin.from("purchases").select("*").eq("provider_order_id",orderId).maybeSingle();
  if(!purchase) return new Response("ok",{status:200});

  const mp=await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`,{
    headers:{"Authorization":`Bearer ${MP}`,"accept":"application/json"}
  });
  if(!mp.ok) return new Response("order lookup failed",{status:502});
  const order=await mp.json();

  const amountOk=Math.round(Number(order.total_amount||0)*100)===purchase.amount_cents;
  const approved=order.status==="processed" && order.status_detail==="accredited" && amountOk;

  if(approved){
    await admin.from("purchases").update({status:"approved",updated_at:new Date().toISOString()}).eq("id",purchase.id);
    await admin.from("contest_access").upsert({
      user_id:purchase.user_id,contest_id:purchase.contest_id,status:"active",source:"paid"
    },{onConflict:"user_id,contest_id"});
  }else if(["failed","canceled","expired","refunded"].includes(order.status)){
    const map={failed:"rejected",canceled:"cancelled",expired:"cancelled",refunded:"refunded"};
    await admin.from("purchases").update({status:map[order.status],updated_at:new Date().toISOString()}).eq("id",purchase.id);
  }

  return new Response("ok",{status:200});
};
