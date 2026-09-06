const {sb,tables,requireAdmin}=require('./_supabase');

module.exports=async(req,res)=>{
 try{
  await requireAdmin(req);
  const resource=String(req.query.resource||'');
  if(!resource||!tables[resource]) return res.status(400).json({error:`Invalid resource: ${resource}`});
  const db=sb(),table=tables[resource];

  if(req.method==='GET'){
   let q=db.from(table).select('*');
   if(resource==='settings'||resource==='live_status') q=q.eq('id',1).maybeSingle();
   else if(resource==='gallery') q=q.order('created_at',{ascending:false}).limit(200);
   else if(resource==='departments') q=q.order('display_order',{ascending:true}).limit(200);
   else q=q.order('created_at',{ascending:false}).limit(200);
   const x=await q;if(x.error)throw x.error;
   return res.json({items:resource==='settings'||resource==='live_status'?(x.data?[x.data]:[]):(x.data||[])});
  }

  const body=req.body||{},id=body.id,data=body.data||{};
  if(req.method==='POST'){
   const payload=resource==='settings'?{...data,id:1}:resource==='live_status'?{...data,id:1,updated_at:new Date().toISOString()}:data;
   const x=resource==='settings'||resource==='live_status'
    ? await db.from(table).upsert(payload,{onConflict:'id'}).select().single()
    : await db.from(table).insert(payload).select().single();
   if(x.error)throw x.error;return res.status(201).json(x.data);
  }
  if(req.method==='PATCH'){
   if(!id)return res.status(400).json({error:'Missing id'});
   const x=await db.from(table).update(data).eq('id',id).select().single();
   if(x.error)throw x.error;return res.json(x.data);
  }
  if(req.method==='DELETE'){
   if(!id)return res.status(400).json({error:'Missing id'});
   const x=await db.from(table).delete().eq('id',id);if(x.error)throw x.error;
   return res.json({ok:true});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){console.error(e);return res.status(e.status||500).json({error:e.message||'Server error'})}
};