import { createClient } from "@supabase/supabase-js";
export default async (request)=>{
  if(request.method!=="POST") return new Response("Method not allowed",{status:405});
  const jwt=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!jwt) return Response.json({error:"Não autenticado."},{status:401});
  const SUPABASE_URL=Netlify.env.get("SUPABASE_URL"), SERVICE=Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"), MP=Netlify.env.get("MERCADO_PAGO_ACCESS_TOKEN"), SITE=Netlify.env.get("SITE_URL")||new URL(request.url).origin;
  if(!SUPABASE_URL||!SERVICE||!MP) return Response.json({error:"Pagamento ainda não configurado no servidor."},{status:500});
  const admin=createClient(SUPABASE_URL,SERVICE), {data:{user},error:ue}=await admin.auth.getUser(jwt);
  if(ue||!user) return Response.json({error:"Sessão inválida."},{status:401});
  const {contest_id}=await request.json();
  const {data:contest,error:ce}=await admin.from("contests").select("*").eq("id",contest_id).eq("is_published",true).single();
  if(ce||!contest) return Response.json({error:"Concurso não encontrado."},{status:404});
  const {data:access}=await admin.from("contest_access").select("id").eq("user_id",user.id).eq("contest_id",contest.id).eq("status","active").maybeSingle();
  if(access) return Response.json({error:"Você já possui acesso a este concurso."},{status:409});
  const {data:purchase,error:pe}=await admin.from("purchases").insert({user_id:user.id,contest_id:contest.id,amount_cents:contest.price_cents,status:"pending",provider:"mercadopago"}).select().single();
  if(pe) return Response.json({error:"Não foi possível criar o pedido."},{status:500});
  const body={items:[{id:contest.id,title:`Posse Direta - ${contest.title}`,quantity:1,currency_id:"BRL",unit_price:Number(contest.price_cents)/100}],payer:{email:user.email},external_reference:purchase.id,metadata:{purchase_id:purchase.id,contest_id:contest.id,user_id:user.id},notification_url:`${SITE}/.netlify/functions/payment-webhook`,back_urls:{success:`${SITE}/?payment=success`,pending:`${SITE}/?payment=pending`,failure:`${SITE}/?payment=failure`},auto_return:"approved"};
  const mp=await fetch("https://api.mercadopago.com/checkout/preferences",{method:"POST",headers:{Authorization:`Bearer ${MP}`,"Content-Type":"application/json"},body:JSON.stringify(body)}), data=await mp.json();
  if(!mp.ok){await admin.from("purchases").update({status:"cancelled"}).eq("id",purchase.id);return Response.json({error:"Não foi possível abrir o Mercado Pago."},{status:502});}
  await admin.from("purchases").update({provider_preference_id:data.id,updated_at:new Date().toISOString()}).eq("id",purchase.id);
  return Response.json({checkout_url:data.init_point});
};
