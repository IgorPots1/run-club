import { createBrowserClient } from '@supabase/ssr'

// #region agent log
fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b47950'},body:JSON.stringify({sessionId:'b47950',runId:'build-import-graph',hypothesisId:'H1',location:'lib/supabase.ts:3',message:'browser supabase module evaluated',data:{hasWindow:typeof window!=='undefined',factory:'createBrowserClient'},timestamp:Date.now()})}).catch(()=>{});
// #endregion

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)
