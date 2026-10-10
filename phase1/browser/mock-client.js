// Injected in place of the supabase-js CDN script. Forwards every call to the Node-side fake backend.
(function () {
  function builder(table) {
    const spec = { table, op: 'select', filters: [], order: null, single: false, returning: false, payload: null };
    const api = {
      select(cols) { if (spec.op !== 'select') spec.returning = true; return api; },
      insert(p) { spec.op = 'insert'; spec.payload = p; return api; },
      upsert(p,o) { spec.op = 'upsert'; spec.payload=p;spec.ignoreDuplicates=!!(o&&o.ignoreDuplicates);return api; },
      range(a,b) { spec.range=[a,b];return api; },
      update(p) { spec.op = 'update'; spec.payload = p; return api; },
      delete() { spec.op = 'delete'; return api; },
      in(c, v) { spec.filters.push([c, v, 'in']); return api; },
      eq(c, v) { spec.filters.push([c, v]); return api; },
      order(c, o) { spec.order = [c, o && o.ascending === false ? 'desc' : 'asc']; return api; },
      single() { spec.single = true; return api; },
      then(res, rej) { return window.__dbop(JSON.parse(JSON.stringify(spec))).then(res, rej); }
    };
    return api;
  }
  const session = { access_token: 'x', user: { id: 'user-A', email: 'tester@example.com' } };
  window.supabase = { createClient() { return {
    from: builder,
    rpc: async function(name,params) { if(name!=="fp_mutate_transaction")return {error:{message:"Unknown RPC"}};return window.__rpc(params); },
    auth: {
      async getSession() { return { data: { session } }; },
      onAuthStateChange(cb) { setTimeout(() => cb('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut() { return {}; }, async signInWithPassword() { return { data: { user: session.user, session }, error: null }; }, async signUp() { return { data: { user: session.user, session }, error: null }; }
    } }; } };
})();
