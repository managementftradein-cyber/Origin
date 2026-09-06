const {sb,requireAdmin}=require('./_supabase');
module.exports=async(req,res)=>{
 try{
  if(req.method==='GET'){
   const q=await sb().from('live_status').select('*').eq('id',1).maybeSingle();
   if(q.error)throw q.error;
   return res.json(q.data||{id:1,is_live:false,title:'TCC Live'});
  }
  if(req.method==='POST'){
   await requireAdmin(req);
   const body=req.body?.data||req.body||{};
   const q=await sb().from('live_status').upsert({...body,id:1,updated_at:new Date().toISOString()},{onConflict:'id'}).select().single();
   if(q.error)throw q.error;
   return res.json(q.data);
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){return res.status(e.status||500).json({error:e.message||'Server error'})}
};