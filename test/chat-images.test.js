const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const crypto=require('node:crypto').webcrypto;
test('Storage bridge capabilities, validation, private bucket, upload and signed read',async()=>{
 let handler,action='upload',uploaded=false,consumed=false,bytes,storageCalls=0;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 const id='11111111-1111-4111-8111-111111111111',token='a'.repeat(64);
 const mock=async(url,o={})=>{
  if(url.includes('/chat_image_tickets?')){if(consumed)return Response.json([]);consumed=true;return Response.json([{image_id:id,action}]);}
  if(url.includes('select=*&id='))return Response.json([{id,mime:'image/png',size:png.length,uploaded}]);
  if(url.includes('chat_messages=is.null'))return Response.json([]);
  if(url.includes('/chat_images?id=')){uploaded=true;return new Response(null,{status:204});}
  storageCalls++;
  if(url.endsWith('/bucket/chat-images'))return Response.json({public:false});
  if(url.includes('/object/sign/'))return Response.json({signedURL:'/object/sign/chat-images/'+id+'?token=short-lived'});
  if(url.endsWith('/object/chat-images/'+id)){bytes=o.body;return Response.json({Key:id});}
  throw Error('Unexpected request');
 };
 vm.runInNewContext(fs.readFileSync('supabase/functions/chat-images/index.ts','utf8'),{Deno:{env:{get:n=>n==='SUPABASE_URL'?'https://example.supabase.co':n==='SUPABASE_SECRET_KEYS'?'{"default":"test"}':undefined},serve:h=>handler=h},fetch:mock,Response,Request,crypto,TextEncoder,Uint8Array,AbortSignal,Date});
 const req=(body=png,t=token,origin='https://lopezcotoacademy.vercel.app')=>new Request('https://example.invalid',{method:'POST',headers:{'x-image-ticket':t,Origin:origin},body});
 assert.equal((await handler(req(png,''))).status,401);
 assert.equal((await handler(req(png,token,'https://evil.invalid'))).status,403);
 assert.equal(storageCalls,0);
 assert.equal((await handler(req(Buffer.from('<html>')))).status,400);
 assert.equal((await handler(req())).status,403); // Ticket is single use even on invalid payload.
 consumed=false;
 assert.equal((await handler(req())).status,200);assert.deepEqual(Buffer.from(bytes),png);assert.equal(uploaded,true);
 assert.equal((await handler(req())).status,403);
 consumed=false;action='read';
 const read=await handler(req());assert.equal(read.status,200);assert.match((await read.json()).url,/object\/sign\/chat-images/);
 consumed=false;action='upload';uploaded=false;
 assert.equal((await handler(req(Buffer.alloc(5242881)))).status,413);
});
