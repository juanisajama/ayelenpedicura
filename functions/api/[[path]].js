// API completa en una sola función de Cloudflare Pages. Bindings: DB (D1). Secretos: MP_ACCESS_TOKEN, SESSION_SECRET, ADMIN_HASH
const J=(d,s=200,h={})=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json',...h}});
const enc=s=>new TextEncoder().encode(s),hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha=async s=>hex(await crypto.subtle.digest('SHA-256',enc(s)));
const sign=async(k,m)=>hex(await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',enc(k),{name:'HMAC',hash:'SHA-256'},false,['sign']),enc(m)));
const same=(a,b)=>a.length===b.length&&[...a].reduce((r,c,i)=>r|(c.charCodeAt(0)^b.charCodeAt(i)),0)===0;
const hh=m=>String(m/60|0).padStart(2,'0')+String(m%60).padStart(2,'0');
const clean=(s,n)=>String(s||'').trim().slice(0,n);
async function settings(DB){return Object.fromEntries((await DB.prepare('SELECT key,value FROM settings').all()).results.map(r=>[r.key,r.value]))}
async function cleanup(DB){const t=Date.now();await DB.batch([DB.prepare("DELETE FROM slots WHERE booking_id IN(SELECT id FROM bookings WHERE status IN('Pendiente de pago','Pendiente de validación') AND expires_at<?)").bind(t),DB.prepare("UPDATE bookings SET status='Vencido' WHERE status IN('Pendiente de pago','Pendiente de validación') AND expires_at<?").bind(t)])}
async function avail(DB,c,date,dur){const step=+c.step,open=+c.open*60,close=+c.close*60;
 if(c.closed_days.split(',').includes(String(new Date(date+'T12:00:00Z').getUTCDay())))return[];
 const used=new Set((await DB.prepare('SELECT start_min m FROM slots WHERE date=?').bind(date).all()).results.map(r=>r.m));
 (await DB.prepare('SELECT start_min a,end_min b FROM blocks WHERE date=?').bind(date).all()).results.forEach(b=>{for(let m=b.a;m<b.b;m+=step)used.add(m)});
 const n=new Date(Date.now()-10800000),today=n.toISOString().slice(0,10),nm=n.getUTCHours()*60+n.getUTCMinutes(),out=[];
 if(date<today)return[];
 for(let m=open;m+dur<=close;m+=step){if(date===today&&m<=nm)continue;let ok=true;for(let x=m;x<m+dur;x+=step)if(used.has(x)){ok=false;break}if(ok)out.push(m)}return out}
const free=async(DB,id)=>DB.batch([DB.prepare('DELETE FROM slots WHERE booking_id=?').bind(id)]);
async function admin(req,env){const m=(req.headers.get('cookie')||'').match(/s=(\d+)\.([a-f0-9]+)/);return !!m&&+m[1]>Date.now()&&same(m[2],await sign(env.SESSION_SECRET,m[1]))}
export async function onRequest({request:req,env,params}){
 const DB=env.DB,url=new URL(req.url),p=(params.path||[]).join('/'),M=req.method;
 try{
 if(p==='config'){await cleanup(DB);const c=await settings(DB);const s=(await DB.prepare('SELECT id,category,name,description,price,minutes FROM services WHERE active=1').all()).results;
  const{bank_alias,bank_cbu,bank_titular,bank_banco,whatsapp,deposit_pct,open,close,step,closed_days,policy}=c;return J({whatsapp,deposit_pct,open,close,step,closed_days,policy,antimicotico_extra_price:c.antimicotico_extra_price??'2500',bank:{alias:bank_alias,cbu:bank_cbu,titular:bank_titular,banco:bank_banco},services:s})}
 if(p==='availability'){await cleanup(DB);const d=url.searchParams.get('date')||'',dur=+url.searchParams.get('minutes')||0;if(!/^\d{4}-\d\d-\d\d$/.test(d)||dur<=0)return J({error:'Datos inválidos'},400);
  return J({slots:(await avail(DB,await settings(DB),d,dur)).map(hh)})}
 if(p==='bookings'&&M==='POST'){await cleanup(DB);const b=await req.json(),c=await settings(DB);
  const name=clean(b.name,80),phone=clean(b.phone,30),date=clean(b.date,10),t=clean(b.time,4),ids=Array.isArray(b.serviceIds)?[...new Set(b.serviceIds)].slice(0,10):[],treatmentQuantity=ids.includes('p5')?Number(b.treatmentQuantity??1):1,extraPrice=Number(c.antimicotico_extra_price??2500);
  if(name.length<3||phone.replace(/\D/g,'').length<8||!/^\d{4}-\d\d-\d\d$/.test(date)||!/^\d{4}$/.test(t)||!ids.length)return J({error:'Completá todos los datos'},400);
  if(ids.includes('p5')&&(!Number.isInteger(treatmentQuantity)||treatmentQuantity<1||treatmentQuantity>10))return J({error:'Cantidad de dedos inválida'},400);
  if(ids.includes('p5')&&(!Number.isSafeInteger(extraPrice)||extraPrice<=0))return J({error:'Precio adicional inválido'},500);
  const rows=(await DB.prepare(`SELECT * FROM services WHERE active=1 AND id IN(${ids.map(()=>'?').join(',')})`).bind(...ids).all()).results;
  if(rows.length!==ids.length)return J({error:'Servicio inválido'},400);
  const total=rows.reduce((a,r)=>a+r.price+(r.id==='p5'?(treatmentQuantity-1)*extraPrice:0),0),dur=rows.reduce((a,r)=>a+r.minutes,0),pct=+c.deposit_pct,dep=Math.round(total*pct/100),start=+t.slice(0,2)*60+ +t.slice(2),step=+c.step,serviceNames=rows.map(r=>r.id==='p5'?`${r.name} (${treatmentQuantity} ${treatmentQuantity===1?'dedo':'dedos'})`:r.name).join(', ');
  if(!(await avail(DB,c,date,dur)).includes(start))return J({error:'Ese horario ya no está disponible'},409);
  const method=b.payMethod==='tr'?'transfer':'mp',id=crypto.randomUUID(),now=Date.now(),exp=now+(method==='mp'?+c.pending_minutes:+c.transfer_minutes)*60000,st=method==='mp'?'Pendiente de pago':'Pendiente de validación';
  const q=[DB.prepare('INSERT INTO bookings(id,name,phone,email,notes,date,start_min,duration,services,total,deposit_pct,deposit,balance,pay_method,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,name,phone,clean(b.email,100),clean(b.notes,300),date,start,dur,serviceNames,total,pct,dep,total-dep,method,st,exp,now)];
  for(let x=start;x<start+dur;x+=step)q.push(DB.prepare('INSERT INTO slots(date,start_min,booking_id) VALUES(?,?,?)').bind(date,x,id));
  try{await DB.batch(q)}catch(e){return J({error:'Ese horario se acaba de ocupar'},409)}
  const out={id,deposit:dep,status:st};
  if(method==='mp'){const o=url.origin,r=await fetch('https://api.mercadopago.com/checkout/preferences',{method:'POST',headers:{authorization:'Bearer '+env.MP_ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({items:[{title:'Seña de turno - Ayelen Pedicura',quantity:1,unit_price:dep,currency_id:'ARS'}],external_reference:id,notification_url:o+'/api/mp/webhook',back_urls:{success:o+'/?pago=ok',failure:o+'/?pago=error',pending:o+'/?pago=pendiente'},auto_return:'approved'})});
   const pr=await r.json();if(!r.ok||!pr.init_point){await free(DB,id);await DB.prepare("UPDATE bookings SET status='Cancelado' WHERE id=?").bind(id).run();return J({error:'No se pudo iniciar el pago'},502)}out.init_point=pr.init_point}
  return J(out,201)}
 if(p==='mp/webhook'){const b=await req.json().catch(()=>({})),pid=b.data?.id||url.searchParams.get('data.id')||url.searchParams.get('id');
  if(pid&&(b.type==='payment'||url.searchParams.get('topic')==='payment'||url.searchParams.get('type')==='payment')){
   const r=await fetch('https://api.mercadopago.com/v1/payments/'+encodeURIComponent(pid),{headers:{authorization:'Bearer '+env.MP_ACCESS_TOKEN}});if(!r.ok)return J({ok:false},500);
   const pay=await r.json(),bk=await DB.prepare('SELECT * FROM bookings WHERE id=?').bind(pay.external_reference||'').first();
   if(bk){await DB.prepare('INSERT OR REPLACE INTO payments VALUES(?,?,?,?,?,?)').bind(String(pid),bk.id,'mercadopago',pay.status,pay.transaction_amount,Date.now()).run();
    if(pay.status==='approved'&&+pay.transaction_amount>=bk.deposit&&bk.status!=='Cancelado'){
     if(bk.status==='Vencido'){const s=[];for(let x=bk.start_min;x<bk.start_min+bk.duration;x+=30)s.push(DB.prepare('INSERT OR IGNORE INTO slots VALUES(?,?,?)').bind(bk.date,x,bk.id));await DB.batch(s)}
     await DB.prepare("UPDATE bookings SET status='Confirmado',pay_status='approved',mp_payment_id=?,expires_at=NULL WHERE id=?").bind(String(pid),bk.id).run()}
    else if(pay.status==='rejected')await DB.prepare("UPDATE bookings SET pay_status='rejected' WHERE id=?").bind(bk.id).run()}}
  return J({ok:true})}
 if(p==='admin/login'&&M==='POST'){const{password}=await req.json(),h=await sha(env.SESSION_SECRET+clean(password,200));
  if(!same(h,env.ADMIN_HASH||'x'))return J({error:'Clave incorrecta'},401);const e=Date.now()+12*3600e3;
  return J({ok:true},200,{'set-cookie':`s=${e}.${await sign(env.SESSION_SECRET,String(e))}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`})}
 if(p.startsWith('admin/')){if(!(await admin(req,env)))return J({error:'No autorizado'},401);
  if(p==='admin/bookings'&&M==='GET'){await cleanup(DB);return J((await DB.prepare('SELECT * FROM bookings ORDER BY date DESC,start_min DESC LIMIT 300').all()).results)}
  const m=p.match(/^admin\/bookings\/([\w-]+)\/(confirm|cancel)$/);
  if(m&&M==='POST'){if(m[2]==='confirm')await DB.prepare("UPDATE bookings SET status='Confirmado',pay_status='approved',expires_at=NULL WHERE id=? AND status IN('Pendiente de validación','Pendiente de pago')").bind(m[1]).run();
   else{await free(DB,m[1]);await DB.prepare("UPDATE bookings SET status='Cancelado' WHERE id=?").bind(m[1]).run()}return J({ok:true})}}
 return J({error:'No encontrado'},404)}catch(e){return J({error:'Error del servidor'},500)}}
