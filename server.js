'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const { DateTime } = require('luxon');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TZ = process.env.BUSINESS_TIMEZONE || 'America/Chicago';
const stripeReady = /^sk_(test|live)_/.test(process.env.STRIPE_SECRET_KEY || '') && !process.env.STRIPE_SECRET_KEY.includes('REPLACE');
const webhookReady = /^whsec_/.test(process.env.STRIPE_WEBHOOK_SECRET || '') && !process.env.STRIPE_WEBHOOK_SECRET.includes('REPLACE');
const publicPaymentsReady = stripeReady && webhookReady && /^https:\/\//.test(SITE_URL);
const bookingEnabled = process.env.BOOKING_ENABLED === 'true';
const stripe = stripeReady ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const blockedDates = new Set((process.env.BLOCKED_DATES || '').split(',').map(s=>s.trim()).filter(Boolean));
const offerings = Object.freeze({
  'math': {name: 'Private Mathematics Tutoring', duration: 60, cents: 10000, kind:'paid'},
  'advanced': {name: 'Advanced Mathematics & Scientific Computing', duration: 60, cents: 10000, kind:'paid'},
  'intro': {name: 'Complimentary Introductory Consultation', duration: 20, cents: 0, kind:'free'}
});
// Business-local schedule; 0=Sunday, 1=Monday. Edit for your actual teaching availability.
const defaultWeeklySchedule = {
  1: [['18:00','21:00']],
  2: [['18:00','21:00']],
  3: [['18:00','21:00']],
  4: [['18:00','21:00']],
  5: [['17:00','20:00']],
  6: [['10:00','15:00']],
  0: []
};
let weeklySchedule = defaultWeeklySchedule;
if(process.env.WEEKLY_SCHEDULE_JSON){
  try {
    const parsed = JSON.parse(process.env.WEEKLY_SCHEDULE_JSON);
    if(!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error('Expected object');
    const time = /^([01]\d|2[0-3]):[0-5]\d$/;
    for(let n=0;n<7;n++){
      const windows = parsed[String(n)] || [];
      if(!Array.isArray(windows) || !windows.every(w=>Array.isArray(w)&&w.length===2&&w.every(t=>typeof t==='string'&&time.test(t))&&w[0]<w[1])) throw Error('Invalid hours on day '+n);
    }
    weeklySchedule = parsed;
  }catch(e){console.error('Invalid WEEKLY_SCHEDULE_JSON:',e.message);process.exit(1);}
}
const dbPath = path.join(__dirname, 'data', 'bookings.sqlite');
fs.mkdirSync(path.dirname(dbPath), {recursive:true});
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, service TEXT NOT NULL, start_utc TEXT NOT NULL, end_utc TEXT NOT NULL,
  customer_name TEXT NOT NULL, email TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('held','pending','confirmed','expired','cancelled','failed')),
  hold_expires_at TEXT, checkout_session_id TEXT UNIQUE,
  receipt_url TEXT, paid_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  confirmation_sent_at TEXT, stripe_payment_intent TEXT
);
CREATE INDEX IF NOT EXISTS idx_booking_range ON bookings(start_utc,end_utc,status);
`);
const insert = db.prepare(`INSERT INTO bookings(id,service,start_utc,end_utc,customer_name,email,notes,status,hold_expires_at,paid_cents,created_at)
VALUES(@id,@service,@start_utc,@end_utc,@customer_name,@email,@notes,@status,@hold_expires_at,@paid_cents,@created_at)`);
const getBooking = db.prepare('SELECT * FROM bookings WHERE id = ?');
// Never silently release a Stripe checkout until Stripe explicitly reports expiry or failure.
// A delayed but successful payment must not collide with a newly reserved appointment.
const cleanup = db.prepare("UPDATE bookings SET status='expired' WHERE status='held' AND checkout_session_id IS NULL AND hold_expires_at < ?");
// Explicit grouped predicate for correct interval overlap, including confirmed bookings.
const conflictQuery = db.prepare(`SELECT id FROM bookings WHERE start_utc < @end AND end_utc > @start
AND (status IN ('confirmed','pending') OR (status='held' AND hold_expires_at > @now)) LIMIT 1`);
const nowUTC = () => DateTime.utc().toISO();
const getLocalDate = (dateString) => DateTime.fromISO(dateString, {zone:TZ});
function validSlot(service, isoUTC){
  const o = offerings[service]; if(!o) return null;
  if(service==='intro' && process.env.ENABLE_FREE_INTRO==='false') return null;
  const start = DateTime.fromISO(String(isoUTC||''), {setZone:true}).toUTC();
  if(!start.isValid || start < DateTime.utc().plus({hours:12}) || start > DateTime.utc().plus({days:45})) return null;
  const end = start.plus({minutes:o.duration});
  const local = start.setZone(TZ), endLocal = end.setZone(TZ);
  if(blockedDates.has(local.toISODate()) || local.toISODate()!==endLocal.toISODate()) return null;
  const windows = weeklySchedule[local.weekday % 7] || [];
  if(!windows.some(([a,b])=>{
    const from = getLocalDate(local.toISODate()+'T'+a);
    const to = getLocalDate(local.toISODate()+'T'+b);
    return local >= from && endLocal <= to && local.minute % 20===0;
  })) return null;
  return {start:start.toISO(),end:end.toISO(),local,minutes:o.duration};
}
function slotOptions(service, dateString){
  const day = getLocalDate(dateString);
  if(!day.isValid || day.toISODate()!==dateString || blockedDates.has(dateString) || day < DateTime.now().setZone(TZ).startOf('day') || day > DateTime.now().setZone(TZ).plus({days:45})) return [];
  const windows = weeklySchedule[day.weekday%7] || [];
  const result=[];
  for (const [from,to] of windows){
    let cur = getLocalDate(dateString+'T'+from), limit = getLocalDate(dateString+'T'+to);
    while(cur.plus({minutes:offerings[service].duration}) <= limit){
      const slot=validSlot(service,cur.toUTC().toISO());
      if(slot && !conflictQuery.get({start:slot.start,end:slot.end,now:nowUTC()})) result.push({start:slot.start,label:cur.toFormat('h:mm a')});
      cur=cur.plus({minutes:20});
    }
  }
  return result;
}
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:false}));
app.get('/api/health',(req,res)=>res.json({status:'ok',bookingEnabled,paymentsReady:publicPaymentsReady,notificationEmailConfigured:!!process.env.SMTP_HOST,timezone:TZ}));
app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:90,standardHeaders:'draft-7',legacyHeaders:false}));
// Stripe requires exact, unparsed body bytes to verify webhook signatures.
app.post('/api/stripe-webhook',express.raw({type:'application/json'}),async(req,res)=>{
  if(!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Webhook not configured');
  let event;
  try {event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);}
  catch(e){return res.status(400).send('Invalid Stripe signature');}
  try {
    const session=event.data.object;
    if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) {
      if(session.payment_status==='paid') await confirmPaid(session);
    } else if(event.type==='checkout.session.expired') {
      db.prepare("UPDATE bookings SET status='expired' WHERE checkout_session_id=? AND status IN ('held','pending')").run(session.id);
    } else if(event.type==='checkout.session.async_payment_failed') {
      db.prepare("UPDATE bookings SET status='failed' WHERE checkout_session_id=? AND status IN ('held','pending')").run(session.id);
    }
  } catch(e) {console.error('Webhook handling failed:',e);return res.status(500).send('Retry later');}
  res.json({received:true});
});
app.use(express.json({limit:'30kb'}));
app.get('/api/config',(req,res)=>res.json({timezone:TZ,bookingEnabled,offerings:Object.fromEntries(Object.entries(offerings).filter(([k])=>k!=='intro'||process.env.ENABLE_FREE_INTRO!=='false').map(([id,o])=>[id,{name:o.name,duration:o.duration,price:o.cents/100}])),paymentsConfigured:publicPaymentsReady}));
app.get('/api/slots',(req,res)=>{
  const service=String(req.query.service||'math'),date=String(req.query.date||'');
  if(!bookingEnabled) return res.json({date,timezone:TZ,slots:[],message:'Bookings are not yet open. Please contact ITECCS.'});
  if(!offerings[service]|| !/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'Invalid date or service'});
  cleanup.run(nowUTC());res.json({date,timezone:TZ,slots:slotOptions(service,date)});
});
function validInput(body){
  const service=String(body.service||'');const name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase();const notes=String(body.notes||'').trim();
  if(!offerings[service] || (service==='intro'&&process.env.ENABLE_FREE_INTRO==='false')) throw Error('Invalid service');
  if(name.length<2||name.length>120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||notes.length>1000) throw Error('Please check the booking details');
  const slot=validSlot(service,body.start);if(!slot)throw Error('Selected slot is not available');
  return {service,name,email,notes,slot};
}
const reserveSlot=db.transaction((data)=>{
  const now=nowUTC();cleanup.run(now);
  if(conflictQuery.get({start:data.slot.start,end:data.slot.end,now}))throw Error('This appointment time has just been booked. Choose another time.');
  const id=crypto.randomUUID(),paid=offerings[data.service].cents;
  const free=paid===0;
  insert.run({id,service:data.service,start_utc:data.slot.start,end_utc:data.slot.end,customer_name:data.name,email:data.email,notes:data.notes,status:free?'confirmed':'held',hold_expires_at:free?null:DateTime.utc().plus({minutes:35}).toISO(),paid_cents:paid,created_at:now});
  return {id,free};
});
app.post('/api/book',async(req,res)=>{
  let reserved;
  try{
    if(!bookingEnabled)return res.status(503).json({error:'Online bookings are not yet open. Please contact ITECCS.'});
    const d=validInput(req.body);if(offerings[d.service].cents && !publicPaymentsReady)return res.status(503).json({error:'Secure payments are being configured. Please contact ITECCS to arrange your appointment.'});
    reserved=reserveSlot(d);
    if(reserved.free){await sendBookingEmail(getBooking.get(reserved.id)).catch(console.error);return res.json({url:`${SITE_URL}/confirmation.html?booking=${reserved.id}&free=1`});}
    const session=await stripe.checkout.sessions.create({
      mode:'payment',payment_method_types:['card'],customer_email:d.email,
      payment_method_collection:'always',
      client_reference_id:reserved.id,
      line_items:[{price_data:{currency:'usd',unit_amount:offerings[d.service].cents,product_data:{name:offerings[d.service].name,description:`${d.slot.local.toFormat('ccc, LLL d yyyy · h:mm a')} (${TZ}) · ${offerings[d.service].duration} minutes`}},quantity:1}],
      metadata:{booking_id:reserved.id},
      payment_intent_data:{receipt_email:d.email,metadata:{booking_id:reserved.id}},
      success_url:`${SITE_URL}/confirmation.html?booking=${reserved.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${SITE_URL}/tutoring.html?checkout=cancelled`,
      expires_at:Math.floor(DateTime.utc().plus({minutes:30}).toSeconds())
    });
    db.prepare("UPDATE bookings SET status='pending', checkout_session_id=? WHERE id=?").run(session.id,reserved.id);
    return res.json({url:session.url});
  }catch(e){if(reserved&&!reserved.free)db.prepare("UPDATE bookings SET status='failed' WHERE id=? AND status IN ('held','pending')").run(reserved.id);return res.status(400).json({error:e.message||'Unable to start booking'});}
});
async function confirmPaid(session){
  const id=session.metadata?.booking_id||session.client_reference_id;const booking=getBooking.get(id);
  if(!booking||booking.checkout_session_id!==session.id)throw Error('Unknown/mismatched booking');
  if(booking.status==='confirmed')return;
  if(['cancelled','failed'].includes(booking.status)) throw Error('Paid booking was previously cancelled/failed: manual resolution required');
  if(session.amount_total!==booking.paid_cents || session.currency!=='usd')throw Error('Payment amount mismatch');
  let receiptUrl=null;
  if(session.payment_intent){
    const pi=await stripe.paymentIntents.retrieve(session.payment_intent,{expand:['latest_charge']});
    receiptUrl=pi.latest_charge?.receipt_url||null;
  }
  db.prepare(`UPDATE bookings SET status='confirmed',hold_expires_at=NULL,receipt_url=?,stripe_payment_intent=? WHERE id=?`).run(receiptUrl,session.payment_intent||null,id);
  await sendBookingEmail(getBooking.get(id)).catch(e=>console.error('Email failed:',e.message));
}
function icsForBooking(b){
  const dt=s=>DateTime.fromISO(s).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
  const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ITECCS//Tutoring//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${b.id}@iteccs.com`,`DTSTAMP:${dt(b.created_at)}`,`DTSTART:${dt(b.start_utc)}`,`DTEND:${dt(b.end_utc)}`,`SUMMARY:${esc('ITECCS — '+offerings[b.service].name)}`,`DESCRIPTION:${esc('Booking reference: '+b.id+' | Meeting details will be arranged by ITECCS.')}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');
}
function safe(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function sendBookingEmail(b){
  if(!process.env.SMTP_HOST || !process.env.SMTP_FROM || !b || b.confirmation_sent_at) return;
  const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:Number(process.env.SMTP_PORT||587)===465,auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined});
  const local=DateTime.fromISO(b.start_utc).setZone(TZ).toFormat('EEEE, LLLL d, yyyy · h:mm a');
  const receipt=b.receipt_url?`<p><a href="${safe(b.receipt_url)}">View Stripe payment receipt</a></p>`:'';
  await transport.sendMail({from:process.env.SMTP_FROM,to:b.email,bcc:process.env.BOOKING_ADMIN_EMAIL||undefined,subject:'ITECCS booking confirmed · '+local,text:`Your ITECCS appointment is confirmed.\n${offerings[b.service].name}\n${local} (${TZ})\nBooking reference: ${b.id}\n${b.receipt_url||''}\nMeeting details will be sent separately.`,html:`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#101c31"><div style="background:#07101f;padding:25px;color:#ffcc00;font-weight:bold;font-size:22px">ITECCS · BOOKING CONFIRMATION</div><div style="padding:28px"><h2 style="color:#0b2a5b">Your session is confirmed.</h2><p>Hello ${safe(b.customer_name)},</p><p>Thank you for booking with ITECCS.</p><p><b>${safe(offerings[b.service].name)}</b><br>${safe(local)} (${safe(TZ)})<br>Reference: ${safe(b.id)}</p><p>Meeting or joining information will be provided separately.</p>${receipt}<p style="color:#66758b;font-size:12px">This is a booking confirmation. Your payment receipt is issued by Stripe.</p></div></div>`,attachments:[{filename:'ITECCS-session.ics',content:icsForBooking(b),contentType:'text/calendar'}]});
  db.prepare('UPDATE bookings SET confirmation_sent_at=? WHERE id=?').run(nowUTC(),b.id);
}
app.get('/api/confirmation/:id',async(req,res)=>{
  const id=req.params.id;const b=getBooking.get(id);if(!b)return res.status(404).json({error:'Booking not found'});
  const requestedSession=String(req.query.session_id||'');
  // Do not treat a return-URL query parameter as payment proof. Check Stripe directly.
  if(b.status==='pending' && stripe && requestedSession && requestedSession===b.checkout_session_id){
    try { const session=await stripe.checkout.sessions.retrieve(requestedSession); if(session.payment_status==='paid') await confirmPaid(session); }catch(e){console.error('Status sync:',e.message);}
  }
  const current=getBooking.get(id);
  // Identifier is a bearer secret; never expose notes, raw payment data or admin fields here.
  return res.json({id:current.id,status:current.status,service:offerings[current.service].name,start:current.start_utc,end:current.end_utc,timezone:TZ,price:current.paid_cents/100,receiptUrl:current.receipt_url});
});
app.get('/api/calendar/:id', (req,res)=>{
  const b=getBooking.get(req.params.id);if(!b || b.status!=='confirmed')return res.status(404).send('Confirmed booking not found');
  res.type('text/calendar').set('Content-Disposition','attachment; filename="ITECCS-appointment.ics"').send(icsForBooking(b));
});
app.get('/',(req,res)=>res.redirect('/tutoring.html'));
app.listen(PORT,()=>console.log(`ITECCS booking app: ${SITE_URL} | bookings ${bookingEnabled?'ON':'OFF'} | secure payments ${publicPaymentsReady?'configured':'NOT READY'}`));
