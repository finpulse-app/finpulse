// Read-only live API verification. No signed-in tokens, emails or financial writes.
const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync(process.argv[2] || 'finpulse-v2-150.html','utf8');
const url=s.match(/const SUPABASE_URL = '([^']+)'/)[1],key=s.match(/const SUPABASE_ANON_KEY = '([^']+)'/)[1];
(async()=>{
  const headers={apikey:key,Authorization:'Bearer '+key};
  const settings=await fetch(url+'/auth/v1/settings',{headers,signal:AbortSignal.timeout(20000)});
  assert.equal(settings.status,200,'Auth settings endpoint unavailable');
  const auth=await settings.json();assert.equal(auth.external?.email,true,'Email sign-in is not enabled');
  assert.equal(typeof auth.mailer_autoconfirm,'boolean','Email confirmation configuration missing');
  console.log('PASS live Auth endpoint enables email sign-in; email confirmation required='+!auth.mailer_autoconfirm);
  for(const table of ['transactions','user_settings']){
    const r=await fetch(url+'/rest/v1/'+table+'?select=id&limit=1',{headers,signal:AbortSignal.timeout(20000)});
    const d=await r.json();
    assert(r.status===200 || r.status===401 || r.status===403,'Unexpected anonymous API status '+r.status);
    if(r.status===200)assert(Array.isArray(d) && d.length===0,'Anonymous API exposed account rows');
    console.log('PASS anonymous API cannot read '+table+'; status='+r.status);
  }
  console.log('LIVE API TOTAL pass=3 fail=0; authenticated sessions not tested');
})().catch(e=>{console.error('LIVE API FAIL: '+e.message);process.exitCode=1;});
