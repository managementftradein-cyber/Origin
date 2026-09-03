(()=>{
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmt=iso=>{if(!iso)return'—';try{return new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}catch(_){return'—'}};

function toast(msg,type='success'){
 const t=$('#toast');if(!t)return;t.textContent=msg;t.className=`toast show ${type}`;
 clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.className='toast',3500);
}
async function api(type,method='GET',body=null){
 const token=await TCCAdmin.token();
 if(!token) throw Error('Your session has expired. Please sign in again.');
 const opt={method,headers:{Authorization:`Bearer ${token}`}};
 if(body){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}
 const r=await fetch(`/api/roles?type=${encodeURIComponent(type)}`,opt);
 let d={};try{d=await r.json()}catch(_){}
 if(!r.ok)throw Error(d.error||`Request failed (${r.status})`);
 return d;
}

function showLogin(message=''){
 let x=$('#tccLogin');
 if(x){if(message)$('#tccLoginMsg').textContent=message;return}
 x=document.createElement('div');x.id='tccLogin';
 x.style='position:fixed;inset:0;background:#080808;z-index:99999;display:grid;place-items:center;padding:20px';
 x.innerHTML=`<div class="login-card"><h1 class="login-brand">TCC DEPT HEAD</h1><p class="login-sub">Sign in with your department head account.</p>
 <form id="tccLoginForm"><div class="field"><label>Email</label><input name="email" type="email" required autocomplete="username" placeholder="Email"></div>
 <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password" placeholder="Password"></div>
 <button class="btn gold" type="submit">SIGN IN</button><div id="tccLoginMsg" style="color:#d9c991;margin-top:12px;line-height:1.5"></div></form></div>`;
 document.body.appendChild(x);
 $('#tccLoginForm').onsubmit=async e=>{
  e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;b.textContent='SIGNING IN…';
  try{await TCCAdmin.login(f.email.value,f.password.value);x.remove();await boot()}catch(err){$('#tccLoginMsg').textContent=err.message;b.disabled=false;b.textContent='SIGN IN'}
 };
 if(message)$('#tccLoginMsg').textContent=message;
}

async function loadInvites(){
 const el=$('#invitesTable');
 try{
  const d=await api('invites');
  const rows=d.items||[];
  if(!rows.length){el.innerHTML='<div class="empty">No invite links yet. Generate one above.</div>';return}
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>For</th><th>Status</th><th>Created</th><th>Expires</th><th>Actions</th></tr></thead><tbody>${rows.map(r=>`<tr>
   <td>${esc(r.applicant_name||r.applicant_email||'—')}</td>
   <td><span class="pill ${r.status==='pending'?'ok':r.status==='used'?'':'bad'}">${esc(r.status)}</span></td>
   <td>${fmt(r.created_at)}</td><td>${fmt(r.expires_at)}</td>
   <td>${r.status==='pending'?`<button class="btn" data-copy="${esc(r.token)}">Copy Link</button> <button class="btn danger" data-revoke="${esc(r.id)}">Revoke</button>`:''}</td>
  </tr>`).join('')}</tbody></table></div>`;
  $$('[data-copy]').forEach(b=>b.onclick=async()=>{
   const url=`${location.origin}/community.html?invite=${b.dataset.copy}`;
   try{await navigator.clipboard.writeText(url);toast('Invite link copied')}catch(_){prompt('Copy this invite link:',url)}
  });
  $$('[data-revoke]').forEach(b=>b.onclick=async()=>{
   if(!confirm('Revoke this invite link? It will no longer work.'))return;
   try{await api('revoke-invite','POST',{id:b.dataset.revoke});toast('Invite revoked');await loadInvites()}catch(e){toast(e.message,'error')}
  });
 }catch(e){el.innerHTML=`<div class="errorbox">${esc(e.message)}</div>`}
}

async function loadMembers(){
 const el=$('#membersTable');
 try{
  const d=await api('members');
  const rows=d.items||[];
  if(!rows.length){el.innerHTML='<div class="empty">No members in this department yet.</div>';return}
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Member</th><th>Email</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead><tbody>${rows.map(r=>`<tr>
   <td>${esc(r.display_name||'—')}</td><td>${esc(r.email||'—')}</td>
   <td><span class="pill ${r.is_suspended?'bad':'ok'}">${r.is_suspended?'Suspended':'Active'}</span></td>
   <td>${fmt(r.created_at)}</td>
   <td>${r.is_suspended?`<button class="btn" data-unsuspend="${esc(r.id)}">Reinstate</button>`:`<button class="btn danger" data-suspend="${esc(r.id)}">Suspend</button>`}</td>
  </tr>`).join('')}</tbody></table></div>`;
  $$('[data-suspend]').forEach(b=>b.onclick=async()=>{
   if(!confirm('Suspend this member? They will be blocked from signing in to the community platform.'))return;
   try{await api('suspend','POST',{profile_id:b.dataset.suspend});toast('Member suspended');await loadMembers()}catch(e){toast(e.message,'error')}
  });
  $$('[data-unsuspend]').forEach(b=>b.onclick=async()=>{
   try{await api('unsuspend','POST',{profile_id:b.dataset.unsuspend});toast('Member reinstated');await loadMembers()}catch(e){toast(e.message,'error')}
  });
 }catch(e){el.innerHTML=`<div class="errorbox">${esc(e.message)}</div>`}
}

function bind(){
 $('#logout').onclick=async()=>{await TCCAdmin.logout();location.reload()};
 $('#viewSite').onclick=()=>location.href='/';
 $('#inviteForm').onsubmit=async e=>{
  e.preventDefault();const f=e.currentTarget,btn=f.querySelector('button'),msg=$('#inviteMsg');
  btn.disabled=true;msg.textContent='Generating…';
  try{
   const d=await api('create-invite','POST',{applicant_name:f.applicant_name.value,applicant_email:f.applicant_email.value});
   msg.innerHTML=`Link ready: <b>${esc(d.invite_url)}</b>`;
   try{await navigator.clipboard.writeText(d.invite_url);toast('Invite link created & copied')}catch(_){toast('Invite link created')}
   f.reset();await loadInvites();
  }catch(err){msg.textContent=err.message}finally{btn.disabled=false}
 };
}

async function boot(){
 try{
  const u=await TCCAdmin.init();if(!u){showLogin();return}
  const d=await api('my-department');
  if(d.head_admin){showLogin('Head admin accounts should use the main admin dashboard at /admin.');await TCCAdmin.logout();return}
  $('#deptName').textContent=(d.department&&d.department.name)||'your department';
  $('#deptTitle').textContent=`${(d.department&&d.department.name)||'DEPARTMENT'} — HEAD`;
  $('#app').classList.remove('hidden');
  bind();loadInvites();loadMembers();
 }catch(e){
  console.error(e);
  if(e.message&&/department head access/i.test(e.message)){showLogin('This account does not have department head access.');await TCCAdmin.logout()}
  else showLogin(e.message);
 }
}
boot();
})();
