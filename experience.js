(()=>{'use strict';
const courseSelect=document.getElementById('course-choice');
const custom=document.getElementById('custom-course');
const helper=document.getElementById('selected-course-helper');
const move=()=>document.getElementById('booking')?.scrollIntoView({behavior:'smooth',block:'start'});
function choose(value){if(!courseSelect)return;let found=[...courseSelect.options].find(o=>o.value===value);if(!found){found=[...courseSelect.options].find(o=>o.value.trim().toLowerCase()===value.trim().toLowerCase())}if(found){courseSelect.value=found.value;custom.value='';helper.textContent='Selected: '+found.textContent+' · Your session will focus on this course.';}else{courseSelect.value='';custom.value=value;helper.textContent='Selected topic: '+value;}document.querySelectorAll('.course-pick').forEach(b=>b.classList.toggle('chosen',b.dataset.course===value));move();setTimeout(()=>courseSelect.focus({preventScroll:true}),550);}
for(const btn of document.querySelectorAll('.course-pick'))btn.addEventListener('click',()=>choose(btn.dataset.course));
courseSelect?.addEventListener('change',()=>{custom.value='';helper.textContent=courseSelect.value?'Selected: '+courseSelect.selectedOptions[0].textContent:'Choose any course above or describe your subject.';});
custom?.addEventListener('input',()=>{if(custom.value.trim()){courseSelect.value='';helper.textContent='Custom topic: '+custom.value.trim();}});
const observer=('IntersectionObserver' in window)?new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');observer.unobserve(e.target)}})},{threshold:.09,rootMargin:'0px 0px -20px 0px'}):null;
document.querySelectorAll('.subject-card,.pathway-card,.section-intro,.catalog-head,.booking-shell,.faq-layout').forEach(el=>{el.classList.add('animate-in');if(observer)observer.observe(el);else el.classList.add('is-visible')});
const tabs=document.querySelectorAll('.family-tab');document.querySelectorAll('[data-nav-family]').forEach(a=>a.addEventListener('click',()=>{let tab=[...tabs].find(t=>t.dataset.family===a.dataset.navFamily);tab?.click();}));
})();