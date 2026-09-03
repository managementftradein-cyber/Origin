window.TCCUser = {
  client: null, user: null,
  async init() {
    if (!window.supabase?.createClient) throw Error('Supabase JavaScript library did not load. Check browser internet access.');
    const r = await fetch('/api/config', { cache: 'no-store', headers: { Accept: 'application/json' } });
    let c = {}; try { c = await r.json() } catch (_) {}
    if (!r.ok) throw Error(c.error || `Unable to load configuration (${r.status}).`);
    if (!c.url || !c.anonKey) throw Error('Supabase public configuration is missing.');
    this.client = window.supabase.createClient(c.url, c.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const s = await this.client.auth.getSession();
    this.user = s.data.session?.user || null;
    this.client.auth.onAuthStateChange((_event, session) => { this.user = session?.user || null; });
    return this.user;
  },
  async signup(email, password) {
    if (!this.client) await this.init();
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail || !password) throw Error('Enter an email and password.');
    if (password.length < 6) throw Error('Password must be at least 6 characters.');
    const r = await this.client.auth.signUp({ email: cleanEmail, password });
    if (r.error) throw Error(r.error.message || 'Could not create your account.');
    this.user = r.data.session?.user || r.data.user || null;
    return this.user;
  },
  async login(email, password) {
    if (!this.client) await this.init();
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail || !password) throw Error('Enter your email and password.');
    const r = await this.client.auth.signInWithPassword({ email: cleanEmail, password });
    if (r.error) {
      const m = String(r.error.message || '');
      if (/invalid login credentials/i.test(m)) throw Error('Incorrect email or password.');
      if (/email not confirmed/i.test(m)) throw Error('Please confirm your email address first — check your inbox.');
      if (/banned|suspended/i.test(m)) throw Error('Your account has been suspended. Contact your department head or the church office for help.');
      throw Error(m || 'Sign-in failed.');
    }
    const s = await this.client.auth.getSession();
    this.user = s.data.session?.user || null;
    return this.user;
  },
  async token() {
    if (!this.client) await this.init();
    const s = await this.client.auth.getSession();
    if (s.error) throw s.error;
    return s.data.session?.access_token || '';
  },
  async logout() { if (this.client) await this.client.auth.signOut(); this.user = null; }
};
