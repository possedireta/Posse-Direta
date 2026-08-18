export default async () => {
  const vars = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    MERCADO_PAGO_ACCESS_TOKEN: !!process.env.MERCADO_PAGO_ACCESS_TOKEN,
    SITE_URL: !!process.env.SITE_URL,
    NETLIFY_URL_AUTOMATIC: !!process.env.URL
  };
  const configured = vars.SUPABASE_URL && vars.SUPABASE_SERVICE_ROLE_KEY && vars.MERCADO_PAGO_ACCESS_TOKEN;
  return Response.json({configured, variables_present: vars, note: "Esta função nunca retorna os valores secretos."},{status:configured?200:500});
};
