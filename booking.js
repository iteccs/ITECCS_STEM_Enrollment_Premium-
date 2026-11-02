(()=>{
'use strict';
const $=id=>document.getElementById(id);
window.__bookingEnabled=false;const today=new Date();
let year=today.getFullYear(),month=today.getMonth(),selectedDate='',selectedStart='',service='math',slotsCache=[];
let offerings={math:{name:'Private Mathematics Tutoring',duration:60,price:100},advanced:{name:'Advanced Mathematics & Scientific Computing',duration:60,price:100},intro:{name:'Complimentary Introductory Consultation',duration:20,price:0}};
let tz='America/Chicago';
const $form=$('booking-form'),submit=$('pay-button');
const pad=n=>String(n).padStart(2,'0');
const dateISO=(y,m,d)=>`${y}-${pad(m+1)}-${pad(d)}`;
const localToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const readableDate=iso=>new Date(iso+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const isPast=iso=>iso<localToday();
const beyondLimit=iso=>{const end=new Date();end.setDate(end.getDate()+45);return iso>end.toISOString().slice(0,10);};
function renderCalendar(){
  $('calendar-month').textContent=new Date(Date.UTC(year,month,1)).toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
  const area=$('calendar-days');area.replaceChildren();
  const start=new Date(Date.UTC(year,month,1)).getUTCDay(),max=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  for(let i=0;i<start;i++){const blank=document.createElement('span');blank.className='blank';area.appendChild(blank);}
  for(let d=1;d<=max;d++){
    const iso=dateISO(year,month,d),day=new Date(Date.UTC(year,month,d)).getUTCDay();
    const btn=document.createElement('button');btn.type='button';btn.textContent=d;btn.setAttribute('aria-label',readableDate(iso));
    const disabled=isPast(iso)||beyondLimit(iso)||day===0;
    btn.disabled=disabled;if(!disabled)btn.className='available';if(iso===selectedDate)btn.classList.add('selected');
    btn.addEventListener('click',()=>chooseDate(iso));area.appendChild(btn);
  }
  const previous=new Date(Date.UTC(year,month,1));previous.setUTCMonth(previous.getUTCMonth()-1);
  $('previous-month').disabled=dateISO(previous.getUTCFullYear(),previous.getUTCMonth(),1)<localToday().slice(0,7)+'-01';
  const next=new Date(Date.UTC(year,month+1,1));$('next-month').disabled=dateISO(next.getUTCFullYear(),next.getUTCMonth(),1)>new Date(Date.now()+45*86400000).toISOString().slice(0,7)+'-01';
}
function updateSummary(){
  const chosen=offerings[service];$('summary-service').textContent=chosen.name;$('summary-duration').textContent=chosen.duration+' minutes';
  $('summary-total').textContent=chosen.price?'$'+chosen.price.toFixed(2):'Free';
  let txt='Not yet selected';if(selectedDate){txt=readableDate(selectedDate);const slot=slotsCache.find(x=>x.start===selectedStart);if(slot)txt+=' · '+slot.label;}
  $('summary-date').textContent=txt;
  submit.disabled=!selectedStart || !window.__bookingEnabled;submit.innerHTML=selectedStart?(chosen.price?'Continue to secure payment <span>↗</span>':'Confirm free consultation <span>↗</span>'):'Select a date and time <span>↗</span>';
}
function renderSlots(slots){
  const area=$('time-slots');area.replaceChildren();
  if(!slots.length){const p=document.createElement('p');p.className='slot-placeholder';p.textContent='No available times on this date. Please choose another day.';area.appendChild(p);return;}
  for(const s of slots){const button=document.createElement('button');button.type='button';button.textContent=s.label;if(s.start===selectedStart)button.className='selected';button.addEventListener('click',()=>{selectedStart=s.start;renderSlots(slots);updateSummary();});area.appendChild(button);}
}
async function chooseDate(iso){
  selectedDate=iso;selectedStart='';slotsCache=[];renderCalendar();updateSummary();$('selected-date-caption').textContent='— '+readableDate(iso);
  $('time-slots').innerHTML='<p class="slot-placeholder">Loading available times…</p>';
  try{const res=await fetch(`/api/slots?service=${encodeURIComponent(service)}&date=${encodeURIComponent(iso)}`);if(!res.ok)throw Error('Unable to load available appointments');const data=await res.json();if(selectedDate!==iso)return;slotsCache=data.slots||[];renderSlots(slotsCache);}catch(e){$('time-slots').textContent='Unable to load schedule. Please try again.';}
}
for(const input of document.querySelectorAll('input[name="service"]')){input.addEventListener('change',()=>{service=input.value;document.querySelectorAll('.service').forEach(el=>el.classList.toggle('active',el.dataset.service===service));updateSummary();if(selectedDate)chooseDate(selectedDate);});}
for(const [id,offset] of [['previous-month',-1],['next-month',1]])$(id).addEventListener('click',()=>{const value=new Date(Date.UTC(year,month+offset,1));year=value.getUTCFullYear();month=value.getUTCMonth();renderCalendar();});
$form.addEventListener('submit',async e=>{
  e.preventDefault();if(!selectedStart)return;const form=new FormData($form);const data={service,start:selectedStart,name:form.get('name'),email:form.get('email'),notes:[form.get('course')?'Selected ITECCS course: '+form.get('course'):'',form.get('custom-course')?'Requested topic: '+form.get('custom-course'):'',form.get('notes')||''].filter(Boolean).join('\n')};
  submit.disabled=true;submit.textContent='Securing your appointment…';$('form-message').textContent='';
  try{const resp=await fetch('/api/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await resp.json();if(!resp.ok)throw Error(result.error||'Unable to book');if(!result.url)throw Error('No checkout URL received');window.location.assign(result.url);}catch(error){$('form-message').textContent=error.message;updateSummary();if(selectedDate)chooseDate(selectedDate);}
});
if(new URLSearchParams(location.search).has('checkout')){$('form-message').textContent='Checkout was cancelled. Choose a time below to try again.';}
fetch('/api/config').then(r=>r.ok?r.json():Promise.reject()).then(c=>{
  window.__bookingEnabled=!!c.bookingEnabled;if(c.timezone)tz=c.timezone;if(c.offerings)offerings=c.offerings;
  if(!offerings.intro){document.querySelector('[data-service="intro"]').remove();}
  $('time-zone').textContent=tz+' time';
  if(!c.bookingEnabled){$('form-message').textContent='Online bookings are being prepared. Please contact ITECCS to arrange a session.';submit.disabled=true;}else if(!c.paymentsConfigured){$('form-message').textContent='Paid online bookings will be available once secure Stripe payments are activated.';}
  const t=localToday().split('-');year=Number(t[0]);month=Number(t[1])-1;renderCalendar();updateSummary();
}).catch(()=>{renderCalendar();updateSummary();$('form-message').textContent='Preview mode: Start the booking server to see live availability and checkout.';});
renderCalendar();updateSummary();
})();
