// API completa en una sola función de Cloudflare Pages. Bindings: DB (D1). Secretos: MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, SESSION_SECRET, ADMIN_HASH
const J=(d,s=200,h={})=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json',...h}});
const enc=s=>new TextEncoder().encode(s),hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha=async s=>hex(await crypto.subtle.digest('SHA-256',enc(s)));
const sign=async(k,m)=>hex(await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',enc(k),{name:'HMAC',hash:'SHA-256'},false,['sign']),enc(m)));
const same=(a,b)=>a.length===b.length&&[...a].reduce((r,c,i)=>r|(c.charCodeAt(0)^b.charCodeAt(i)),0)===0;
const hh=m=>String(m/60|0).padStart(2,'0')+String(m%60).padStart(2,'0');
const clean=(s,n)=>String(s||'').trim().slice(0,n);
const hasFullName=name=>name.trim().split(/\s+/).length>=2;
const localPhoneDigits=phone=>/^[\d\s()-]+$/.test(phone)?phone.replace(/\D/g,''):'';
const hasValidLocalPhone=phone=>/^11\d{8}$/.test(localPhoneDigits(phone));
const settingKeys=['whatsapp','deposit_pct','open','close','step','closed_days','pending_minutes','transfer_minutes','antimicotico_extra_price','bank_alias','bank_cbu','bank_titular','bank_banco','policy'];
const settingDefaults={whatsapp:'5491136009440',deposit_pct:'15',open:'9',close:'19',step:'30',closed_days:'0',pending_minutes:'30',transfer_minutes:'1440',antimicotico_extra_price:'2500',bank_alias:'COMPLETAR.ALIAS',bank_cbu:'COMPLETAR',bank_titular:'COMPLETAR',bank_banco:'COMPLETAR',policy:'Podés reprogramar con 24 h de anticipación. La seña no es reembolsable salvo cancelación del local.'};
const clockMinutes=value=>{const legacy=/^\d{1,2}$/.test(String(value));if(legacy)return Number(value)<24?Number(value)*60:null;const m=/^(\d{2}):(\d{2})$/.exec(String(value));return m&&Number(m[1])<24&&Number(m[2])<60?Number(m[1])*60+Number(m[2]):null};
const clockText=value=>{const minutes=clockMinutes(value);return minutes===null?'':`${String(minutes/60|0).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`};
const settingInteger=(value,label,min,max=Number.MAX_SAFE_INTEGER)=>{
 const text=String(value);if(!/^\d+$/.test(text))return `${label} debe ser un número entero.`;
 const number=Number(text);if(!Number.isSafeInteger(number)||number<min||number>max)return `${label} debe estar entre ${min} y ${max}.`;
 return null
};
function validateSetting(key,value){
 if(typeof value!=='string'&&typeof value!=='number')return `El valor de "${key}" debe ser texto o un número.`;
 const text=String(value);
 if(key==='deposit_pct')return settingInteger(text,'El porcentaje de seña',0,100);
 if(key==='antimicotico_extra_price')return settingInteger(text,'El precio adicional',0);
 if(key==='open'||key==='close')return /^\d{2}:\d{2}$/.test(text)&&clockMinutes(text)!==null?null:`"${key}" debe tener formato HH:MM.`;
 if(key==='whatsapp')return /^54\d{8,13}$/.test(text)?null:'WhatsApp debe incluir el código de país argentino 54 y contener solo dígitos.';
 if(key==='step')return settingInteger(text,'El intervalo entre turnos',1,180);
 if(key==='pending_minutes'||key==='transfer_minutes')return settingInteger(text,'El plazo de pago',1);
 if(key==='closed_days')return /^(?:[0-6](?:,[0-6])*)?$/.test(text)&&new Set(text?text.split(','):[]).size===(text?text.split(',').length:0)?null:'Los días cerrados deben ser números del 0 al 6, separados por comas.';
 const limits={bank_alias:100,bank_cbu:100,bank_titular:120,bank_banco:120,policy:2000};
 return text.length<=limits[key]?null:`"${key}" supera el máximo de ${limits[key]} caracteres.`
}
function parseAppointmentStart(date,time,step){
 if(!/^\d{4}-\d\d-\d\d$/.test(date))return null;
 const parsedDate=new Date(date+'T12:00:00Z');
 if(Number.isNaN(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==date)return null;
 const match=/^(\d{2}):(\d{2})$/.exec(time);
 if(!match)return null;
 const hour=Number(match[1]),minute=Number(match[2]),start=hour*60+minute;
 return hour<24&&minute<60&&Number.isInteger(step)&&step>0&&start%step===0?start:null
}
function serviceSelectionFromNames(names,catalog){
 const serviceIds=[];let treatmentQuantity=1;
 for(const part of String(names||'').split(', ')){
  const service=catalog.find(s=>part===s.name||(s.id==='p5'&&part.startsWith(s.name+' (')));
  if(!service)continue;
  serviceIds.push(service.id);
  if(service.id==='p5'){const quantity=part.match(/\((\d+) dedos?\)$/);if(quantity)treatmentQuantity=Number(quantity[1])}
 }
 return{serviceIds,treatmentQuantity}
}
async function selectedServices(DB,ids,treatmentQuantity,c){
 const extraPrice=Number(c.antimicotico_extra_price??2500);
 if(ids.includes('p5')&&(!Number.isInteger(treatmentQuantity)||treatmentQuantity<1||treatmentQuantity>10||!Number.isSafeInteger(extraPrice)||extraPrice<=0))return null;
 const rows=(await DB.prepare(`SELECT * FROM services WHERE active=1 AND id IN(${ids.map(()=>'?').join(',')})`).bind(...ids).all()).results;
 if(rows.length!==ids.length)return null;
 return{
  rows,
  total:rows.reduce((sum,row)=>sum+row.price+(row.id==='p5'?(treatmentQuantity-1)*extraPrice:0),0),
  duration:rows.reduce((sum,row)=>sum+row.minutes,0),
  names:rows.map(row=>row.id==='p5'?`${row.name} (${treatmentQuantity} ${treatmentQuantity===1?'dedo':'dedos'})`:row.name).join(', ')
 }
}
async function settings(DB){return Object.fromEntries((await DB.prepare('SELECT key,value FROM settings').all()).results.map(r=>[r.key,r.value]))}
async function editableSettings(DB){
 const current=await settings(DB),result={};
 for(const key of settingKeys)result[key]=current[key]??settingDefaults[key];
 result.open=clockText(result.open);result.close=clockText(result.close);
 return result
}
async function cleanup(DB){const t=Date.now();await DB.batch([DB.prepare("DELETE FROM slots WHERE booking_id IN(SELECT id FROM bookings WHERE status IN('Pendiente de pago','Pendiente de validación') AND expires_at<?)").bind(t),DB.prepare("UPDATE bookings SET status='Vencido' WHERE status IN('Pendiente de pago','Pendiente de validación') AND expires_at<?").bind(t)])}
async function avail(DB,c,date,dur,excludeBookingId=null){const step=+c.step,open=clockMinutes(c.open),close=clockMinutes(c.close);
 if(c.closed_days.split(',').includes(String(new Date(date+'T12:00:00Z').getUTCDay())))return[];
 const usedQuery=excludeBookingId?DB.prepare('SELECT start_min m FROM slots WHERE date=? AND booking_id<>?').bind(date,excludeBookingId):DB.prepare('SELECT start_min m FROM slots WHERE date=?').bind(date);
 const used=new Set((await usedQuery.all()).results.map(r=>r.m));
 (await DB.prepare('SELECT start_min a,end_min b FROM blocks WHERE date=?').bind(date).all()).results.forEach(b=>{for(let m=b.a;m<b.b;m+=step)used.add(m)});
 const n=new Date(Date.now()-10800000),today=n.toISOString().slice(0,10),nm=n.getUTCHours()*60+n.getUTCMinutes(),out=[];
 if(date<today)return[];
 for(let m=open;m+dur<=close;m+=step){if(date===today&&m<=nm)continue;let ok=true;for(let x=m;x<m+dur;x+=step)if(used.has(x)){ok=false;break}if(ok)out.push(m)}return out}
const free=async(DB,id)=>DB.batch([DB.prepare('DELETE FROM slots WHERE booking_id=?').bind(id)]);
async function admin(req,env){const m=(req.headers.get('cookie')||'').match(/s=(\d+)\.([a-f0-9]+)/);return !!m&&+m[1]>Date.now()&&same(m[2],await sign(env.SESSION_SECRET,m[1]))}
async function validMercadoPagoSignature(req,paymentId,secret){
 const signature=req.headers.get('x-signature')||'',requestId=req.headers.get('x-request-id')||'',parts={};
 if(!signature||!requestId)return false;
 for(const item of signature.split(',')){
  const separator=item.indexOf('=');if(separator<1)return false;
  const name=item.slice(0,separator).trim(),value=item.slice(separator+1).trim();
  if(name==='ts'||name==='v1'){if(parts[name]!==undefined)return false;parts[name]=value}
 }
 if(!/^\d+$/.test(parts.ts||'')||! /^[a-f0-9]{64}$/i.test(parts.v1||''))return false;
 const manifest=`id:${String(paymentId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
 return same(await sign(secret,manifest),parts.v1.toLowerCase())
}
export async function onRequest({request:req,env,params}){
 const DB=env.DB,url=new URL(req.url),p=(params.path||[]).join('/'),M=req.method;
 try{
 if(p==='config'){await cleanup(DB);const c=await settings(DB);const s=(await DB.prepare('SELECT id,category,name,description,price,minutes FROM services WHERE active=1').all()).results;
  const{bank_alias,bank_cbu,bank_titular,bank_banco,whatsapp,deposit_pct,step,closed_days,policy}=c;return J({whatsapp,deposit_pct,open:clockText(c.open),close:clockText(c.close),step,closed_days,policy,transfer_minutes:c.transfer_minutes??'1440',antimicotico_extra_price:c.antimicotico_extra_price??'2500',bank:{alias:bank_alias,cbu:bank_cbu,titular:bank_titular,banco:bank_banco},services:s})}
 if(p==='availability'){await cleanup(DB);const d=url.searchParams.get('date')||'',dur=+url.searchParams.get('minutes')||0;if(!/^\d{4}-\d\d-\d\d$/.test(d)||dur<=0)return J({error:'Datos inválidos'},400);
  return J({slots:(await avail(DB,await settings(DB),d,dur)).map(hh)})}
 if(p==='bookings'&&M==='POST'){await cleanup(DB);const b=await req.json(),c=await settings(DB);
  const name=clean(b.name,80),phoneInput=clean(b.phone,30),date=clean(b.date,10),t=clean(b.time,4),ids=Array.isArray(b.serviceIds)?[...new Set(b.serviceIds)].slice(0,10):[],treatmentQuantity=ids.includes('p5')?Number(b.treatmentQuantity??1):1,extraPrice=Number(c.antimicotico_extra_price??2500);
  if(!hasFullName(name))return J({error:'Ingresá nombre y apellido.'},400);
  if(!hasValidLocalPhone(phoneInput))return J({error:'Ingresá el teléfono con 11 y el número, sin 549 (por ejemplo, 11 3600-9440).'},400);
  if(!/^\d{4}-\d\d-\d\d$/.test(date)||!/^\d{4}$/.test(t)||!ids.length)return J({error:'Completá todos los datos'},400);
  const phone=`549${localPhoneDigits(phoneInput)}`;
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
 if(p==='mp/webhook'){
  if(!env.MP_WEBHOOK_SECRET)return J({error:'El webhook de Mercado Pago no está configurado.'},500);
  let b;try{const body=await req.text();b=body?JSON.parse(body):{}}catch(error){return J({error:'El cuerpo de la notificación no es válido.'},400)}
  if(!b||typeof b!=='object'||Array.isArray(b))return J({error:'El cuerpo de la notificación no es válido.'},400);
  const urlPaymentId=url.searchParams.get('data.id'),bodyPaymentId=b.data?.id==null?'':String(b.data.id);
  if(urlPaymentId&&bodyPaymentId&&urlPaymentId.toLowerCase()!==bodyPaymentId.toLowerCase())return J({error:'El ID de pago de la notificación no coincide.'},400);
  const pid=urlPaymentId||bodyPaymentId||url.searchParams.get('id');
  if(!pid)return J({error:'Falta el ID del pago en la notificación.'},400);
  if(!(await validMercadoPagoSignature(req,pid,env.MP_WEBHOOK_SECRET)))return J({error:'La firma de la notificación no es válida.'},401);
  if(b.type==='payment'||url.searchParams.get('topic')==='payment'||url.searchParams.get('type')==='payment'){
   const r=await fetch('https://api.mercadopago.com/v1/payments/'+encodeURIComponent(pid),{headers:{authorization:'Bearer '+env.MP_ACCESS_TOKEN}});if(!r.ok)return J({error:'No se pudo consultar el pago en Mercado Pago.'},502);
   const pay=await r.json(),bk=await DB.prepare('SELECT * FROM bookings WHERE id=?').bind(pay.external_reference||'').first();
   if(bk){await DB.prepare('INSERT OR REPLACE INTO payments VALUES(?,?,?,?,?,?)').bind(String(pid),bk.id,'mercadopago',pay.status,pay.transaction_amount,Date.now()).run();
    if(pay.status==='approved'&&Number(pay.transaction_amount)===Number(bk.deposit)&&pay.currency_id==='ARS'&&bk.status!=='Cancelado'){
     if(bk.status==='Vencido'){const s=[];for(let x=bk.start_min;x<bk.start_min+bk.duration;x+=30)s.push(DB.prepare('INSERT OR IGNORE INTO slots VALUES(?,?,?)').bind(bk.date,x,bk.id));await DB.batch(s)}
     await DB.prepare("UPDATE bookings SET status='Confirmado',pay_status='approved',mp_payment_id=?,expires_at=NULL WHERE id=?").bind(String(pid),bk.id).run()}
    else if(pay.status==='rejected')await DB.prepare("UPDATE bookings SET pay_status='rejected' WHERE id=?").bind(bk.id).run()}}
  return J({ok:true})}
 if(p==='admin/login'&&M==='POST'){const{password}=await req.json(),h=await sha(env.SESSION_SECRET+clean(password,200));
  if(!same(h,env.ADMIN_HASH||'x'))return J({error:'Clave incorrecta'},401);const e=Date.now()+12*3600e3;
  return J({ok:true},200,{'set-cookie':`s=${e}.${await sign(env.SESSION_SECRET,String(e))}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`})}
 if(p.startsWith('admin/')){if(!(await admin(req,env)))return J({error:'No autorizado'},401);
  if(p==='admin/settings'&&M==='GET')return J(await editableSettings(DB));
  if(p==='admin/settings'&&M==='PUT'){
   let values;try{values=await req.json()}catch(error){return J({error:'El cuerpo de la solicitud no es un JSON válido.'},400)}
   if(!values||typeof values!=='object'||Array.isArray(values))return J({error:'Enviá un objeto con los ajustes que querés actualizar.'},400);
   const keys=Object.keys(values),unknown=keys.find(key=>!settingKeys.includes(key));
   if(unknown)return J({error:`La clave "${unknown}" no está permitida.`},400);
   const current=await editableSettings(DB),next={...current,...values};
   for(const key of keys){const error=validateSetting(key,values[key]);if(error)return J({error},400)}
   if(clockMinutes(next.close)<=clockMinutes(next.open))return J({error:'El horario de cierre debe ser posterior al de apertura.'},400);
   const updates=keys.map(key=>DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,String(values[key])));
   if(updates.length)await DB.batch(updates);
   return J(await editableSettings(DB))
  }
  if(p==='admin/services'&&M==='GET')return J((await DB.prepare('SELECT id,category,name,description,price,minutes,active FROM services ORDER BY category,name').all()).results);
  const serviceMatch=p.match(/^admin\/services\/([\w-]+)$/);
  if(serviceMatch&&M==='PUT'){
   let values;try{values=await req.json()}catch(error){return J({error:'El cuerpo de la solicitud no es un JSON válido.'},400)}
   if(!values||typeof values!=='object'||Array.isArray(values))return J({error:'Enviá los datos del servicio como un objeto.'},400);
   const allowed=['name','description','price','minutes','active'],unknown=Object.keys(values).find(key=>!allowed.includes(key));
   if(unknown)return J({error:`El campo "${unknown}" no está permitido.`},400);
   if(allowed.some(key=>!Object.prototype.hasOwnProperty.call(values,key)))return J({error:'Completá nombre, descripción, precio, duración y estado del servicio.'},400);
   if(typeof values.name!=='string'||!values.name.trim()||values.name.trim().length>100)return J({error:'El nombre debe tener entre 1 y 100 caracteres.'},400);
   if(typeof values.description!=='string'||values.description.length>1000)return J({error:'La descripción debe tener hasta 1000 caracteres.'},400);
   const priceError=settingInteger(values.price,'El precio',0),minutesError=settingInteger(values.minutes,'La duración',1,1440);
   if(priceError)return J({error:priceError},400);
   if(minutesError)return J({error:minutesError},400);
   if(typeof values.active!=='boolean')return J({error:'El estado activo debe ser verdadero o falso.'},400);
   const result=await DB.prepare('UPDATE services SET name=?,description=?,price=?,minutes=?,active=? WHERE id=?').bind(values.name.trim(),values.description,Number(values.price),Number(values.minutes),values.active?1:0,serviceMatch[1]).run();
   if(!result.meta.changes)return J({error:'No se encontró el servicio.'},404);
   return J(await DB.prepare('SELECT id,category,name,description,price,minutes,active FROM services WHERE id=?').bind(serviceMatch[1]).first())
  }
  if(p==='admin/bookings'&&M==='GET'){
   await cleanup(DB);
   const[catalog,rows]=await Promise.all([DB.prepare('SELECT id,name FROM services').all(),DB.prepare('SELECT * FROM bookings ORDER BY date DESC,start_min DESC LIMIT 300').all()]);
   return J(rows.results.map(b=>({...b,...serviceSelectionFromNames(b.services,catalog.results)})))
  }
  if(p==='admin/bookings'&&M==='POST'){
   await cleanup(DB);const b=await req.json(),c=await settings(DB),name=clean(b.name,80),phone=clean(b.phone,30),date=clean(b.date,10),time=clean(b.time,5),ids=Array.isArray(b.serviceIds)?[...new Set(b.serviceIds.filter(id=>typeof id==='string'))].slice(0,10):[],quantity=ids.includes('p5')?Number(b.treatmentQuantity??1):1,step=+c.step,start=parseAppointmentStart(date,time,step);
   if(name.length<3||phone.replace(/\D/g,'').length<8||!ids.length||start===null)return J({error:'Completá nombre, teléfono, servicios, fecha y horario válidos'},400);
   const selected=await selectedServices(DB,ids,quantity,c);if(!selected)return J({error:'Servicio o cantidad inválidos'},400);
   if(!(await avail(DB,c,date,selected.duration)).includes(start))return J({error:'Ese horario ya no está disponible'},409);
   const pct=+c.deposit_pct,deposit=Math.round(selected.total*pct/100),id=crypto.randomUUID(),now=Date.now();
   const q=[DB.prepare("INSERT INTO bookings(id,name,phone,email,notes,date,start_min,duration,services,total,deposit_pct,deposit,balance,pay_method,pay_status,status,mp_payment_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,name,phone,clean(b.email,100),clean(b.notes,300),date,start,selected.duration,selected.names,selected.total,pct,deposit,selected.total-deposit,'manual','pending','Pendiente de validación',null,null,now)];
   for(let x=start;x<start+selected.duration;x+=step)q.push(DB.prepare('INSERT INTO slots(date,start_min,booking_id) VALUES(?,?,?)').bind(date,x,id));
   try{await DB.batch(q)}catch(error){if(String(error.message).includes('UNIQUE constraint failed: slots.date, slots.start_min'))return J({error:'Ese horario se acaba de ocupar'},409);throw error}
   return J({id,status:'Pendiente de validación',deposit,total:selected.total},201)
  }
  const m=p.match(/^admin\/bookings\/([\w-]+)\/(edit|confirm|cancel)$/);
  if(m&&M==='POST'){
   if(m[2]==='confirm')await DB.prepare("UPDATE bookings SET status='Confirmado',pay_status='approved',expires_at=NULL WHERE id=? AND status IN('Pendiente de validación','Pendiente de pago')").bind(m[1]).run();
   else if(m[2]==='cancel'){await free(DB,m[1]);await DB.prepare("UPDATE bookings SET status='Cancelado' WHERE id=?").bind(m[1]).run()}
   else{
    const b=await req.json(),c=await settings(DB),booking=await DB.prepare('SELECT * FROM bookings WHERE id=?').bind(m[1]).first();
    if(!booking)return J({error:'No se encontró el turno'},404);
    if(['Cancelado','Vencido'].includes(booking.status))return J({error:'No se puede editar un turno cancelado o vencido'},409);
    const name=clean(b.name,80),phone=clean(b.phone,30),date=clean(b.date,10),time=clean(b.time,5),ids=Array.isArray(b.serviceIds)?[...new Set(b.serviceIds.filter(id=>typeof id==='string'))].slice(0,10):[],quantity=ids.includes('p5')?Number(b.treatmentQuantity??1):1,step=+c.step,start=parseAppointmentStart(date,time,step);
    if(name.length<3||phone.replace(/\D/g,'').length<8||!ids.length||start===null)return J({error:'Completá nombre, teléfono, servicios, fecha y horario válidos'},400);
    const selected=await selectedServices(DB,ids,quantity,c);if(!selected)return J({error:'Servicio o cantidad inválidos'},400);
    if(!(await avail(DB,c,date,selected.duration,m[1])).includes(start))return J({error:'Ese horario ya no está disponible'},409);
    const depositPaid=booking.pay_status==='approved',preserveDeposit=depositPaid||booking.pay_method==='mp'||booking.status==='Pendiente de validación'&&booking.pay_method==='transfer',pct=preserveDeposit?booking.deposit_pct:+c.deposit_pct,deposit=preserveDeposit?booking.deposit:Math.round(selected.total*pct/100),balance=selected.total-deposit;
    if(!depositPaid&&deposit>selected.total)return J({error:'El importe de seña pendiente supera el nuevo total. Cancelá el turno y cargalo nuevamente para evitar un cobro incorrecto.'},409);
    const q=[DB.prepare('DELETE FROM slots WHERE booking_id=?').bind(m[1])];
    for(let x=start;x<start+selected.duration;x+=step)q.push(DB.prepare('INSERT INTO slots(date,start_min,booking_id) VALUES(?,?,?)').bind(date,x,m[1]));
    q.push(DB.prepare('UPDATE bookings SET name=?,phone=?,email=?,notes=?,date=?,start_min=?,duration=?,services=?,total=?,deposit_pct=?,deposit=?,balance=? WHERE id=?').bind(name,phone,clean(b.email,100),clean(b.notes,300),date,start,selected.duration,selected.names,selected.total,pct,deposit,balance,m[1]));
    try{await DB.batch(q)}catch(error){if(String(error.message).includes('UNIQUE constraint failed: slots.date, slots.start_min'))return J({error:'Ese horario se acaba de ocupar'},409);throw error}
    return J({ok:true,total:selected.total,deposit,balance})
   }
   return J({ok:true})
  }}
 return J({error:'No encontrado'},404)}catch(e){return J({error:'Error del servidor'},500)}}
