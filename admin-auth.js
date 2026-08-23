window.TCCAdmin={
  client:null,user:null,
  async init(){
    if(!window.supabase?.createClient) throw Error('Supabase JavaScript library did not load. Check browser internet access.');
    const r=await fetch('/api/config',{cache:'no-store',headers:{Accept:'application/json'}});
    let c={}; try{c=await r.json()}catch(_){}
    if(!r.ok) throw Error(c.error||`Unable to load Supabase configuration (${r.status}). Check Vercel environment variables.`);
    if(!c.url||!c.anonKey) throw Error('Supabase public configuration is missing in Vercel.');
    this.client=window.supabase.createClient(c.url,c.anonKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    const s=await this.client.auth.getSession();
    this.user=s.data.session?.user||null;
    return this.user;
  },
  async login(email,password){
    if(!this.client) await this.init();
    const cleanEmail=String(email||'').trim();
    if(!cleanEmail||!password) throw Error('Enter both your admin email and password.');
    const r=await this.client.auth.signInWithPassword({email:cleanEmail,password});
    if(r.error){
      const m=String(r.error.message||'');
      if(/invalid login credentials/i.test(m)) throw Error('Supabase rejected the email/password. Check the password and make sure this email exists under Authentication → Users.');
      if(/email not confirmed/i.test(m)) throw Error('This Supabase user has not confirmed their email. In Supabase → Authentication → Users, open the user and confirm the account.');
      throw Error(`Supabase sign-in failed: ${m}`);
    }
    const s=await this.client.auth.getSession();
    if(!s.data.session) throw Error('Supabase accepted the login but returned no session. Check Supabase Auth settings and the site URL.');
    this.user=s.data.session.user;
    return this.user;
  },
  async token(){
    if(!this.client) await this.init();
    const s=await this.client.auth.getSession();
    if(s.error) throw s.error;
    return s.data.session?.access_token||'';
  },
  async logout(){if(this.client) await this.client.auth.signOut();this.user=null;}
};