(()=>{
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const configs={
 news:{title:'TCC News',resource:'news',fields:[
  ['title','Title','input'],['excerpt','Excerpt','textarea'],['content','Content','textarea'],['image_url','Featured image URL','input'],['published','Published','check']
 ],cols:['title','published','created_at']},
 prophetic:{title:'Prophetic Room',resource:'prophetic_words',fields:[
  ['title','Title','input'],['content','Content','textarea'],['scripture','Scripture','input'],['image_url','Image URL','input'],['published','Published','check']
 ],cols:['title','scripture','published']},
 events:{title:'Events',resource:'events',fields:[
  ['title','Title','input'],['description','Description','textarea'],['location','Location','input'],['date','Date / time','input']
 ],cols:['title','date','location']},
 sermons:{title:'Sermons',resource:'sermons',fields:[
  ['title','Title','input'],['speaker','Speaker','input'],['date','Date','input'],['video_url','Video URL','input'],['description','Description','textarea']
 ],cols:['title','speaker','date']},
 announcements:{title:'Announcements',resource:'announcements',fields:[
  ['title','Title','input'],['body','Announcement','textarea']
 ],cols:['title','created_at']},
 ministries:{title:'Ministries',resource:'departments',fields:[
  ['name','Name','input'],['description','Description','textarea'],['icon','Icon','input'],['contact_email','Contact email','input'],['display_order','Display order','input'],['is_active','Active','check']
 ],cols:['name','display_order','is_active']},
 communityPosts:{title:'Community Posts',resource:'community_posts',fields:[
  ['body','Post','textarea'],['is_hidden','Hidden from feed','check']
 ],cols:['body','is_hidden','created_at']},
 communityComments:{title:'Community Comments',resource:'community_comments',fields:[
  ['body','Comment','textarea'],['is_hidden','Hidden from feed','check']
 ],cols:['body','is_hidden','created_at']}
};
const resourceMap={news:'news',prophetic:'prophetic_words',events:'events',sermons:'sermons',announcements:'announcements',ministries:'departments',prayers:'prayer_requests',messages:'visitors',subscribers:'subscribers',giving:'giving_records'};
let cache={};

function toast(msg,type='success'){
 const t=$('#toast');if(!t)return;t.textContent=msg;t.className=`toast show ${type}`;
 clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.className='toast',3000);
}
async function api(resource,method='GET',body=null){
 const token=await TCCAdmin.token();
 if(!token) throw Error('Your admin session has expired. Please sign in again.');
 const opt={method,headers:{Authorization:`Bearer ${token}`}};
 if(body){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}
 const r=await fetch(`/api/admin?resource=${encodeURIComponent(resource)}`,opt);
 let d={};try{d=await r.json()}catch(_){}
 if(!r.ok)throw Error(d.error||`Request failed (${r.status})`);
 return d;
}
function showLogin(message=''){
 let x=$('#tccLogin');
 if(x){if(message)$('#tccLoginMsg').textContent=message;return}
 x=document.createElement('div');x.id='tccLogin';
 x.style='position:fixed;inset:0;background:#080808;z-index:99999;display:grid;place-items:center;padding:20px';
 x.innerHTML=`<div class="login-card"><h1 class="login-brand">TCC ADMIN</h1><p class="login-sub">Sign in to the Christocentric Church control center.</p>
 <form id="tccLoginForm"><div class="field"><label>Email</label><input name="email" type="email" required autocomplete="username" placeholder="Admin email"></div>
 <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password" placeholder="Password"></div>
 <button class="btn red" type="submit">SIGN IN</button><div id="tccLoginMsg" style="color:#d9c991;margin-top:12px;line-height:1.5"></div></form></div>`;
 document.body.appendChild(x);
 $('#tccLoginForm').onsubmit=async e=>{
  e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;b.textContent='SIGNING IN…';
  try{await TCCAdmin.login(f.email.value,f.password.value);x.remove();await boot()}catch(err){$('#tccLoginMsg').textContent=err.message;b.disabled=false;b.textContent='SIGN IN'}
 };
 if(message)$('#tccLoginMsg').textContent=message;
}
function go(p){
 if(!$('#'+p))p='dashboard';
 $$('.page').forEach(x=>x.classList.remove('active'));$('#'+p).classList.add('active');
 $$('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.p===p));
 const names={dashboard:'Dashboard',analytics:'Analytics',hero:'Hero & About',news:'TCC News',prophetic:'Prophetic Room',live:'Live Control',events:'Events',sermons:'Sermons',announcements:'Announcements',ministries:'Ministries',gallery:'Gallery & Media',communityPosts:'Community Posts',communityComments:'Community Comments',roles:'Community Roles',prayers:'Prayer Requests',messages:'Contact Messages',subscribers:'Subscribers',giving:'Giving',settings:'Church Settings',admins:'Administrators'};
 $('#title').textContent=names[p]||p;
 history.replaceState(null,'','#'+p);
 load(p);
 if(innerWidth<=900){$('#side').classList.remove('open');$('#scrim').classList.remove('open')}
}
function table(rows,page,filter=''){
 const el=$(`#table-${page}`);if(!el)return;
 const c=configs[page];cache[page]=rows;
 const q=filter.trim().toLowerCase();
 const filtered=q?rows.filter(r=>Object.values(r).some(v=>String(v??'').toLowerCase().includes(q))):rows;
 if(!filtered.length){el.innerHTML='<div class="empty">'+(rows.length?'No records match your search.':'No records yet. Use the button above to create one.')+'</div>';return}
 el.innerHTML=`<div class="table-wrap"><table><thead><tr>${c.cols.map(k=>`<th>${esc(k.replaceAll('_',' '))}</th>`).join('')}<th>Actions</th></tr></thead><tbody>`+
 filtered.map(r=>`<tr>${c.cols.map(k=>`<td>${esc(r[k])}</td>`).join('')}<td><button class="btn" data-edit="${esc(r.id)}">Edit</button> <button class="btn danger" data-del="${esc(r.id)}">Delete</button></td></tr>`).join('')+
 '</tbody></table></div>';
 $$(`#table-${page} [data-edit]`).forEach(b=>b.onclick=()=>openEditor(page,b.dataset.edit,rows.find(r=>r.id===b.dataset.edit)));
 $$(`#table-${page} [data-del]`).forEach(b=>b.onclick=async()=>{
  if(!confirm('Delete this record?'))return;
  try{await api(c.resource,'DELETE',{id:b.dataset.del});toast('Deleted successfully');await loadContent(page)}catch(e){toast(e.message,'error')}
 });
}
async function loadContent(page){
 const el=$(`#table-${page}`);if(el)el.innerHTML='<div class="loading">Loading…</div>';
 try{const d=await api(configs[page].resource);table(d.items||[],page)}catch(e){if(el)el.innerHTML=`<div class="errorbox">${esc(e.message)}</div>`}
}
function openEditor(page,id,row={}){
 const c=configs[page],m=$('#modal'),f=$('#editor');if(!m||!f)return;
 $('#modalTitle').textContent=(id?'Edit ':'New ')+c.title;
 f.innerHTML=c.fields.map(([n,label,type])=>{
  const v=row[n]??'';
  if(type==='textarea')return `<div class="field"><label>${esc(label)}</label><textarea name="${n}">${esc(v)}</textarea></div>`;
  if(type==='check')return `<label class="switch"><input type="checkbox" name="${n}" ${v?'checked':''}> ${esc(label)}</label>`;
  const inputType=n==='date'?'date':'text';
  return `<div class="field"><label>${esc(label)}</label><input name="${n}" type="${inputType}" value="${esc(v)}"></div>`;
 }).join('')+'<button class="btn red" type="submit">Save Changes</button>';
 m.classList.add('open');
 f.onsubmit=async e=>{
  e.preventDefault();const data={};
  c.fields.forEach(([n])=>{const x=f.elements[n];if(x)data[n]=x.type==='checkbox'?x.checked:x.value});
  try{await api(c.resource,id?'PATCH':'POST',id?{id,data}:{data});m.classList.remove('open');toast(id?'Changes saved':'Created successfully');await loadContent(page)}catch(err){toast(err.message,'error')}
 };
}
async function loadHero(){
 try{
  const d=await api('settings'),s=(d.items||[])[0]||{};
  ['hero_eyebrow','hero_title','hero_body','hero_interval_seconds'].forEach(n=>{const x=$('#heroForm').elements[n];if(x)x.value=s[n]??''});
  ['about_label','about_heading','about_body','about_quote','about_image_url'].forEach(n=>{const x=$('#aboutForm').elements[n];if(x)x.value=s[n]??''});
 }catch(e){toast(e.message,'error')}
}
function localDateTimeValue(iso){if(!iso)return '';try{const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}catch(_){return ''}}
function isoFromLocalDateTime(v){if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString()}
async function saveSettings(form){
 const data={};[...form.elements].forEach(x=>{if(x.name)data[x.name]=x.type==='checkbox'?x.checked:x.value});
 if(data.launch_date!==undefined)data.launch_date=isoFromLocalDateTime(data.launch_date);
 try{await api('settings','POST',{data});toast('Saved successfully')}catch(e){toast(e.message,'error')}
}
async function loadLive(){
 try{
  const d=await api('live_status'),s=(d.items||[])[0]||{},f=$('#liveForm');
  ['title','description','stream_url','embed_url'].forEach(n=>{if(f.elements[n])f.elements[n].value=s[n]??''});
  f.elements.is_live.checked=!!s.is_live;$('#liveStatus').textContent=s.is_live?'LIVE NOW':'OFFLINE';$('#liveBadge').classList.toggle('live',!!s.is_live);
 }catch(e){$('#liveStatus').textContent='ERROR';toast(e.message,'error')}
}
async function loadGallery(){
 const el=$('#galleryGrid');el.innerHTML='<div class="loading">Loading media…</div>';
 try{
  const d=await api('gallery'),rows=d.items||[];
  if(!rows.length){el.innerHTML='<div class="empty">No photos yet. Upload your first image.</div>';return}
  el.innerHTML=rows.map(r=>`<article class="media"><img src="${esc(r.url)}" alt="${esc(r.caption||'')}"><div class="media-body"><div class="media-title">${esc(r.caption||'Untitled')}</div><div class="media-meta">${esc(r.category||'Gallery')}</div><button class="btn danger" data-gdel="${esc(r.id)}">Delete</button></div></article>`).join('');
  $$('[data-gdel]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this media record?'))return;try{await api('gallery','DELETE',{id:b.dataset.gdel});toast('Photo removed');await loadGallery()}catch(e){toast(e.message,'error')}});
 }catch(e){el.innerHTML=`<div class="errorbox">${esc(e.message)}</div>`}
}
async function upload(file){
 if(!file)return;if(file.size>5*1024*1024){toast('Image must be 5MB or smaller.','error');return}
 const category=prompt('Category: type Hero for a homepage background, or Gallery','Hero')||'Gallery';
 const reader=new FileReader();
 reader.onload=async()=>{
  try{
   const token=await TCCAdmin.token(),parts=String(reader.result).split(',');
   const r=await fetch('/api/upload',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({contentType:file.type,dataBase64:parts[1],caption:file.name,category})});
   let d={};try{d=await r.json()}catch(_){}
   if(!r.ok)throw Error(d.error||`Upload failed (${r.status})`);
   toast('Photo uploaded successfully');await loadGallery();
  }catch(e){toast(e.message,'error')}
 };reader.readAsDataURL(file);
}
async function loadGivingAccounts(){
 const el=$('#table-givingAccounts'); if(!el)return; el.innerHTML='<div class="loading">Loading…</div>';
 try{
  const d=await api('giving_accounts'); const rows=d.items||[];
  if(!rows.length){el.innerHTML='<div class="empty">No offering accounts yet. Click “Add Account” to publish one.</div>';return}
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Label</th><th>Bank</th><th>Account Name</th><th>Account Number</th><th>Currency</th><th>Active</th><th>Actions</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.label||'Offering')}</td><td>${esc(r.bank_name||'—')}</td><td>${esc(r.account_name||'—')}</td><td>${esc(r.account_number||'—')}</td><td>${esc(r.currency||'—')}</td><td>${r.is_active?'Yes':'No'}</td><td><button class="btn" data-ga-edit="${esc(r.id)}">Edit</button> <button class="btn danger" data-ga-del="${esc(r.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-ga-edit]').forEach(b=>b.onclick=()=>openGivingAccountEditor(rows.find(r=>r.id===b.dataset.gaEdit)));
  $$('[data-ga-del]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this offering account? It will disappear from the public Give page.'))return;try{await api('giving_accounts','DELETE',{id:b.dataset.gaDel});toast('Offering account deleted');await loadGivingAccounts()}catch(e){toast(e.message,'error')}});
 }catch(e){el.innerHTML=`<div class="errorbox">${esc(e.message)}</div>`}
}
function openGivingAccountEditor(row={}){
 const m=$('#modal'),f=$('#editor'); if(!m||!f)return;
 $('#modalTitle').textContent=row.id?'Edit Offering Account':'Add Offering Account';
 const fields=[['label','Display label','text'],['bank_name','Bank name','text'],['account_name','Account name','text'],['account_number','Account number','text'],['sort_code','Sort code / branch code','text'],['currency','Currency','text'],['instructions','Instructions','textarea'],['display_order','Display order','number']];
 f.innerHTML=fields.map(([n,l,t])=>t==='textarea'?`<div class="field"><label>${l}</label><textarea name="${n}">${esc(row[n]??'')}</textarea></div>`:`<div class="field"><label>${l}</label><input name="${n}" type="${t}" value="${esc(row[n]??(n==='currency'?'NGN':n==='display_order'?'0':''))}" ${n==='bank_name'||n==='account_name'||n==='account_number'?'required':''}></div>`).join('')+`<label class="switch"><input type="checkbox" name="is_active" ${(!row.id || row.is_active !== false)?'checked':''}> Publish this account on the public Give page</label><button class="btn red" type="submit">Save Account</button>`;
 m.classList.add('open');
 f.onsubmit=async e=>{e.preventDefault();const data={};fields.forEach(([n])=>{const x=f.elements[n];if(x)data[n]=x.type==='number'?Number(x.value||0):x.value});data.is_active=f.elements.is_active.checked;try{await api('giving_accounts',row.id?'PATCH':'POST',row.id?{id:row.id,data}:{data});m.classList.remove('open');toast(row.id?'Account updated':'Account published');await loadGivingAccounts()}catch(err){toast(err.message,'error')}};
}

async function privatePage(p){
 const el=$(`#table-${p}`);el.innerHTML='<div class="loading">Loading…</div>';
 try{
  const d=await api(resourceMap[p]),rows=d.items||[];
  if(!rows.length){el.innerHTML='<div class="empty">No records yet.</div>';return}
  const keys=Object.keys(rows[0]).slice(0,7);
  el.innerHTML=`<div class="table-wrap"><table><thead><tr>${keys.map(k=>`<th>${esc(k.replaceAll('_',' '))}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>'<tr>'+keys.map(k=>`<td>${esc(r[k])}</td>`).join('')+'</tr>').join('')}</tbody></table></div>`;
 }catch(e){el.innerHTML=`<div class="errorbox">${esc(e.message)}</div>`}
}
async function dashboard(){
 for(const [id,r] of [['cnews','news'],['cevents','events'],['cprayers','prayer_requests'],['cmessages','visitors']]){
  try{$('#'+id).textContent=(await api(r)).items?.length??0}catch(_){$('#'+id).textContent='—'}
 }
}
async function analytics(){
 for(const [id,r] of [['cvisitors','visitors'],['csubs','subscribers'],['cgiving','giving_records'],['cgallery','gallery'],['ccommunity','community_posts']]){
  try{$('#'+id).textContent=(await api(r)).items?.length??0}catch(_){$('#'+id).textContent='—'}
 }
}
async function loadSettings(){
 try{
  const d=await api('settings'),s=(d.items||[])[0]||{};
  ['church_name','email','phone','location','map_url','logo_url'].forEach(n=>{const x=$('#settingsForm').elements[n];if(x)x.value=s[n]??''});
  const lf=$('#launchForm'); if(lf){lf.elements.launch_enabled.checked=!!s.launch_enabled;lf.elements.launch_date.value=localDateTimeValue(s.launch_date);lf.elements.launch_timezone.value=s.launch_timezone||'Africa/Lagos';lf.elements.launch_title.value=s.launch_title||'THE ORIGIN IS NEAR';lf.elements.launch_subtitle.value=s.launch_subtitle||'Christ at the centre. Everything else follows.';lf.elements.launch_complete_title.value=s.launch_complete_title||'WE ARE LIVE';lf.elements.launch_complete_body.value=s.launch_complete_body||'Welcome to The Christocentric Church.';}
  ['facebook_url','instagram_url','youtube_url','spotify_url'].forEach(n=>{const x=$('#socialForm').elements[n];if(x)x.value=s[n]??''});
 }catch(e){toast(e.message,'error')}
}
async function rolesApi(type,method='GET',body=null){
 const token=await TCCAdmin.token();
 if(!token) throw Error('Your admin session has expired. Please sign in again.');
 const opt={method,headers:{Authorization:`Bearer ${token}`}};
 if(body){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}
 const r=await fetch(`/api/roles?type=${encodeURIComponent(type)}`,opt);
 let d={};try{d=await r.json()}catch(_){}
 if(!r.ok)throw Error(d.error||`Request failed (${r.status})`);
 return d;
}
const fmtDate=iso=>{if(!iso)return'—';try{return new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}catch(_){return'—'}};
let allDepartments=[],allMembersCache=[];

async function loadDeptHeads(){
 const el=$('#table-deptHeads');
 try{
  const d=await rolesApi('department-heads');const rows=d.items||[];
  if(!rows.length){el.innerHTML='<div class="empty">No department heads assigned yet.</div>';return}
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Actions</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.display_name||'—')}</td><td>${esc(r.email||'—')}</td><td>${esc(r.department_name||'—')}</td><td><button class="btn danger" data-removehead="${esc(r.id)}">Remove Head Status</button></td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-removehead]').forEach(b=>b.onclick=async()=>{
   if(!confirm('Remove department head status from this member?'))return;
   try{await rolesApi('remove-head','POST',{profile_id:b.dataset.removehead});toast('Head status removed');await loadRoles()}catch(e){toast(e.message,'error')}
  });
 }catch(e){el.innerHTML=`<div class="errorbox">${esc(e.message)}</div>`}
}

async function loadAllInvites(){
 const el=$('#table-allInvites');
 try{
  const inv=await rolesApi('invites');const rows=inv.items||[];
  if(!rows.length){el.innerHTML='<div class="empty">No invite links generated yet.</div>';return}
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Department</th><th>For</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.department_name||'—')}</td><td>${esc(r.applicant_name||r.applicant_email||'—')}</td><td>${esc(r.status)}</td><td>${fmtDate(r.created_at)}</td><td>${r.status==='pending'?`<button class="btn" data-copyinv="${esc(r.token)}">Copy Link</button> <button class="btn danger" data-revokeinv="${esc(r.id)}">Revoke</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-copyinv]').forEach(b=>b.onclick=async()=>{
   const url=`${location.origin}/community.html?invite=${b.dataset.copyinv}`;
   try{await navigator.clipboard.writeText(url);toast('Invite link copied')}catch(_){prompt('Copy this invite link:',url)}
  });
  $$('[data-revokeinv]').forEach(b=>b.onclick=async()=>{
   if(!confirm('Revoke this invite link?'))return;
   try{await rolesApi('revoke-invite','POST',{id:b.dataset.revokeinv});toast('Invite revoked');await loadAllInvites()}catch(e){toast(e.message,'error')}
  });
 }catch(e){el.innerHTML=`<div class="errorbox">${esc(e.message)}</div>`}
}

function renderAllMembers(rows,filter=''){
 const el=$('#table-allMembers');
 const q=filter.trim().toLowerCase();
 const filtered=q?rows.filter(r=>[r.display_name,r.email,r.department_name,r.role].some(v=>String(v??'').toLowerCase().includes(q))):rows;
 if(!filtered.length){el.innerHTML='<div class="empty">'+(rows.length?'No members match your search.':'No members yet.')+'</div>';return}
 const deptOptions=allDepartments.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
 el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Status</th><th>Actions</th></tr></thead><tbody>${filtered.map(r=>`<tr>
  <td>${esc(r.display_name||'—')}</td><td>${esc(r.email||'—')}</td>
  <td>${r.role==='department_head'?'Department Head':'Member'}</td>
  <td>${esc(r.department_name||'—')}</td>
  <td>${r.is_suspended?'Suspended':'Active'}</td>
  <td style="white-space:nowrap">
   ${r.role!=='department_head'?`<select data-makehead="${esc(r.id)}" style="background:#080808;color:#eee;border:1px solid #292929;border-radius:6px;padding:6px"><option value="">Make head of…</option>${deptOptions}</select>`:''}
   ${r.is_suspended?`<button class="btn" data-unsuspend="${esc(r.id)}">Reinstate</button>`:`<button class="btn danger" data-suspend="${esc(r.id)}">Suspend</button>`}
  </td>
 </tr>`).join('')}</tbody></table></div>`;
 $$('[data-makehead]').forEach(s=>s.onchange=async()=>{
  if(!s.value)return;
  try{await rolesApi('assign-head','POST',{profile_id:s.dataset.makehead,department_id:s.value});toast('Assigned as department head');await loadRoles()}catch(e){toast(e.message,'error');s.value=''}
 });
 $$('[data-suspend]').forEach(b=>b.onclick=async()=>{
  if(!confirm('Suspend this member? They will be blocked from signing in to the community platform.'))return;
  try{await rolesApi('suspend','POST',{profile_id:b.dataset.suspend});toast('Member suspended');await loadRoles()}catch(e){toast(e.message,'error')}
 });
 $$('[data-unsuspend]').forEach(b=>b.onclick=async()=>{
  try{await rolesApi('unsuspend','POST',{profile_id:b.dataset.unsuspend});toast('Member reinstated');await loadRoles()}catch(e){toast(e.message,'error')}
 });
}

async function loadAllMembers(){
 const el=$('#table-allMembers');
 try{
  const d=await rolesApi('all-members');allMembersCache=d.items||[];
  renderAllMembers(allMembersCache);
 }catch(e){el.innerHTML=`<div class="errorbox">${esc(e.message)}</div>`}
}

async function loadRoles(){
 try{
  if(!allDepartments.length){const d=await api('departments');allDepartments=d.items||[];
   $('#roleInviteDept').innerHTML=allDepartments.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
  }
 }catch(e){/* department list best-effort */}
 loadDeptHeads();loadAllInvites();loadAllMembers();loadActiveMeetings();
 const search=$('[data-search="allMembers"]');
 if(search)search.oninput=()=>renderAllMembers(allMembersCache,search.value);
}

async function meetingsApi(type,method='GET',body=null){
 const token=await TCCAdmin.token();
 if(!token) throw Error('Your admin session has expired. Please sign in again.');
 const opt={method,headers:{Authorization:`Bearer ${token}`}};
 if(body){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}
 const r=await fetch(`/api/meetings?type=${encodeURIComponent(type)}`,opt);
 let d={};try{d=await r.json()}catch(_){}
 if(!r.ok)throw Error(d.error||`Request failed (${r.status})`);
 return d;
}

async function loadActiveMeetings(){
 const el=$('#table-activeMeetings');
 try{
  const d=await meetingsApi('active');const rows=d.items||[];
  if(!rows.length){el.innerHTML='<div class="empty">No live meetings right now.</div>';return}
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Title</th><th>Department</th><th>Started</th><th>Actions</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.title)}</td><td>${esc(r.department_name)}</td><td>${fmtDate(r.started_at)}</td><td><button class="btn" data-joinmeet="${esc(r.id)}">Join</button> <button class="btn danger" data-endmeet="${esc(r.id)}">End</button></td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-joinmeet]').forEach(b=>b.onclick=async()=>{
   try{const d=await meetingsApi('join','POST',{meeting_id:b.dataset.joinmeet});window.open(d.join_url,'_blank','noopener')}catch(e){toast(e.message,'error')}
  });
  $$('[data-endmeet]').forEach(b=>b.onclick=async()=>{
   if(!confirm('End this meeting for everyone?'))return;
   try{await meetingsApi('end','POST',{meeting_id:b.dataset.endmeet});toast('Meeting ended');await loadActiveMeetings()}catch(e){toast(e.message,'error')}
  });
 }catch(e){el.innerHTML=`<div class="errorbox">${esc(e.message)}</div>`}
}

function bindMeetingForm(){
 $('#meetingForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const f=e.currentTarget,btn=f.querySelector('button'),msg=$('#meetingMsg');
  btn.disabled=true;msg.textContent='Starting meeting…';
  try{
   const d=await meetingsApi('start','POST',{title:f.title.value,department_id:f.department_id.value});
   msg.textContent=`Meeting started: ${d.meeting.title}`;
   window.open(d.join_url,'_blank','noopener');
   f.title.value='';await loadActiveMeetings();
  }catch(err){msg.textContent=err.message}finally{btn.disabled=false}
 });
}

function load(p){
 if(configs[p])loadContent(p);else if(p==='dashboard')dashboard();else if(p==='analytics')analytics();else if(p==='hero')loadHero();else if(p==='live')loadLive();else if(p==='gallery')loadGallery();else if(p==='roles')loadRoles();else if(p==='giving')loadGiving();else if(['prayers','messages','subscribers'].includes(p))privatePage(p);else if(p==='settings')loadSettings();else if(p==='admins')$('#adminInfo').textContent=TCCAdmin.user?`Signed in as ${TCCAdmin.user.email}`:'Not signed in';
}
async function loadGiving(){
 loadGivingAccounts();
 const el=$('#table-giving'); if(!el)return; el.innerHTML='<div class="loading">Loading…</div>';
 try{
  const d=await api('giving_records'),rows=d.items||[];
  if(!rows.length){el.innerHTML='<div class="empty">No giving records yet.</div>';return}
  const keys=['donor_name','amount','currency','reference','status','created_at'];
  el.innerHTML=`<div class="table-wrap"><table><thead><tr>${keys.map(k=>`<th>${esc(k.replaceAll('_',' '))}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>'<tr>'+keys.map(k=>`<td>${esc(r[k])}</td>`).join('')+'</tr>').join('')}</tbody></table></div>`;
 }catch(e){el.innerHTML=`<div class="errorbox">${esc(e.message)}</div>`}
}

function bind(){
 $$('[data-p]').forEach(b=>b.onclick=()=>go(b.dataset.p));
 $$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
 $$('[data-create]').forEach(b=>b.onclick=()=>openEditor(b.dataset.create,null,{}));
 $$('[data-search]').forEach(i=>i.oninput=()=>table(cache[i.dataset.search]||[],i.dataset.search,i.value));
 $('#closeModal')?.addEventListener('click',()=>$('#modal').classList.remove('open'));
 $('#modal')?.addEventListener('click',e=>{if(e.target.id==='modal')$('#modal').classList.remove('open')});
 $('#viewSite')?.addEventListener('click',()=>location.href='/');
 $('#logout')?.addEventListener('click',async()=>{await TCCAdmin.logout();location.reload()});
 $('#menu')?.addEventListener('click',()=>{$('#side').classList.add('open');$('#scrim').classList.add('open')});
 $('#scrim')?.addEventListener('click',()=>{$('#side').classList.remove('open');$('#scrim').classList.remove('open')});
 $('#heroForm')?.addEventListener('submit',e=>{e.preventDefault();saveSettings(e.target)});
 $('#aboutForm')?.addEventListener('submit',e=>{e.preventDefault();saveSettings(e.target)});
 $('#settingsForm')?.addEventListener('submit',e=>{e.preventDefault();saveSettings(e.target)});
 $('#launchForm')?.addEventListener('submit',e=>{e.preventDefault();saveSettings(e.target)});
 $('#socialForm')?.addEventListener('submit',e=>{e.preventDefault();saveSettings(e.target)});
 $('#liveForm')?.addEventListener('submit',async e=>{e.preventDefault();const data={};[...e.currentTarget.elements].forEach(x=>{if(x.name)data[x.name]=x.type==='checkbox'?x.checked:x.value});try{await api('live_status','POST',{data});toast('Live settings saved');await loadLive()}catch(x){toast(x.message,'error')}});
 $('#roleInviteForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const f=e.currentTarget,btn=f.querySelector('button'),msg=$('#roleInviteMsg');
  if(!f.department_id.value){msg.textContent='Choose a department first.';return}
  btn.disabled=true;msg.textContent='Generating…';
  try{
   const d=await rolesApi('create-invite','POST',{department_id:f.department_id.value,applicant_name:f.applicant_name.value,applicant_email:f.applicant_email.value});
   msg.innerHTML=`Link ready: <b>${esc(d.invite_url)}</b>`;
   try{await navigator.clipboard.writeText(d.invite_url);toast('Invite link created & copied')}catch(_){toast('Invite link created')}
   f.applicant_name.value='';f.applicant_email.value='';await loadAllInvites();
  }catch(err){msg.textContent=err.message}finally{btn.disabled=false}
 });
 $('#newGivingAccount')?.addEventListener('click',()=>openGivingAccountEditor({}));
 bindMeetingForm();
 $('#uploadBtn')?.addEventListener('click',()=>$('#fileInput').click());
 $('#fileInput')?.addEventListener('change',e=>{if(e.target.files[0])upload(e.target.files[0]);e.target.value=''});
}
async function boot(){
 try{
  const u=await TCCAdmin.init();if(!u){showLogin();return}
  $('#app').classList.remove('hidden');bind();go(location.hash.slice(1)||'dashboard');
 }catch(e){console.error(e);showLogin(e.message)}
}
boot();
})();