// Custom auth: random 256-bit, hashed, expiring, single-use database capabilities.
// Only the authenticated Express backend can issue them; no public table policies.
const LIMIT=5*1024*1024, BUCKET='chat-images';
const ORIGIN='https://lopezcotoacademy.vercel.app';
const base=Deno.env.get('SUPABASE_URL');
const key=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const headers={apikey:key,...(key?.startsWith('eyJ')?{Authorization:'Bearer '+key}:{})};
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'content-type,x-image-ticket','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
const json=(body,status=200)=>Response.json(body,{status,headers:cors});
async function call(path,options={}){
 const r=await fetch(base+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error('Storage operation failed');
 return r.status===204?null:r.json();
}
function imageType(b){
 if(b.length>=24&&b.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i])&&String.fromCharCode(...b.slice(12,16))==='IHDR')return 'image/png';
 if(b.length>=4&&b[0]===255&&b[1]===216&&b[2]===255&&b.at(-2)===255&&b.at(-1)===217)return 'image/jpeg';
 if(b.length>=16&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')return 'image/webp';
 return null;
}
async function readLimited(req){
 const reader=req.body?.getReader();if(!reader)throw new Error('Empty body');
 const chunks=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT){await reader.cancel();return null;}chunks.push(value);}
 const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
async function bucket(){
 const r=await fetch(base+'/storage/v1/bucket/'+BUCKET,{headers});
 if(r.ok){const b=await r.json();if(b.public)throw new Error('Bucket must be private');return;}
 if(r.status!==400&&r.status!==404)throw new Error('Bucket unavailable');
 try{await call('/storage/v1/bucket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:BUCKET,name:BUCKET,public:false,file_size_limit:LIMIT,allowed_mime_types:['image/png','image/jpeg','image/webp']})});}
 catch(e){const retry=await fetch(base+'/storage/v1/bucket/'+BUCKET,{headers});if(!retry.ok||(await retry.json()).public)throw e;}
}
async function cleanup(){
 // Expired, unsent attachments cannot be attached after 24 hours.
 const cutoff=new Date(Date.now()-86400000).toISOString();
 const old=await call('/rest/v1/chat_images?select=id,chat_messages(image_id)&chat_messages=is.null&created_at=lt.'+encodeURIComponent(cutoff)+'&limit=5');
 for(const row of old){
  const linked=await call('/rest/v1/chat_messages?select=image_id&image_id=eq.'+row.id);
  if(linked.length)continue;
  await call('/storage/v1/object/'+BUCKET,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[row.id]})});
  await call('/rest/v1/chat_images?id=eq.'+row.id,{method:'DELETE'});
 }
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return json({error:'Método no permitido'},405);
 if(req.headers.get('origin')&&req.headers.get('origin')!==ORIGIN)return json({error:'Origen no permitido'},403);
 const token=req.headers.get('x-image-ticket')||'';
 if(!/^[0-9a-f]{64}$/.test(token))return json({error:'Acceso no autorizado'},401);
 try{
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),v=>v.toString(16).padStart(2,'0')).join('');
  const tickets=await call('/rest/v1/chat_image_tickets?token_hash=eq.'+digest+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString()),{method:'DELETE',headers:{Prefer:'return=representation'}});
  const t=tickets[0];if(!t)return json({error:'Permiso vencido; vuelve a intentar'},403);
  const images=await call('/rest/v1/chat_images?select=*&id=eq.'+t.image_id);
  const img=images[0];if(!img)return json({error:'Imagen no encontrada'},404);
  if(t.action==='read'){
   if(!img.uploaded)return json({error:'Imagen no disponible'},404);
   const signed=await call('/storage/v1/object/sign/'+BUCKET+'/'+img.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:120})});
   return json({url:base+'/storage/v1'+signed.signedURL});
  }
  if(img.uploaded)return json({error:'La imagen ya se cargó'},409);
  const b=await readLimited(req);
  if(!b)return json({error:'La imagen supera 5 MB'},413);
  if(b.length!==img.size||imageType(b)!==img.mime)return json({error:'Imagen inválida. Usa PNG, JPG o WebP'},400);
  await bucket();
  await call('/storage/v1/object/'+BUCKET+'/'+img.id,{method:'POST',headers:{'Content-Type':img.mime,'x-upsert':'false'},body:b});
  await call('/rest/v1/chat_images?id=eq.'+img.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploaded:true})});
  // Best effort cleanup must never turn a successful upload into an error.
  try{await cleanup();}catch{}
  return json({ok:true,id:img.id});
 }catch{return json({error:'No se pudo guardar o abrir la imagen. Vuelve a intentar.'},503);}
});
