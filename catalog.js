(()=>{
  'use strict';
  const grid=document.getElementById('pathway-grid'),search=document.getElementById('course-search'),counter=document.getElementById('course-count');
  if(!grid||!search)return;
  const cards=[...grid.querySelectorAll('.pathway-card')];
  let filter='all';
  const update=()=>{
    let count=0;
    const query=search.value.toLocaleLowerCase().trim();
    for(const card of cards){
      const matchesFamily=filter==='all'||card.dataset.family===filter;
      const matchesQuery=!query||card.textContent.toLocaleLowerCase().includes(query);
      card.hidden=!(matchesFamily&&matchesQuery);if(!card.hidden)count++;
    }
    counter.textContent=`Showing ${count} of ${cards.length} curriculum pathways`;
    document.getElementById('course-empty').hidden=count>0;
  };
  for(const tab of document.querySelectorAll('.family-tab'))tab.addEventListener('click',()=>{
    filter=tab.dataset.family;
    for(const other of document.querySelectorAll('.family-tab')){
      const active=other===tab;other.classList.toggle('active',active);other.setAttribute('aria-selected',String(active));
    }
    update();
  });
  search.addEventListener('input',update);
  for(const button of document.querySelectorAll('.pathway-choose'))button.addEventListener('click',()=>{
    const card=button.closest('.pathway-card'),title=card?.querySelector('h3')?.textContent||'';
    const select=document.getElementById('course-choice');
    if(select){const match=[...select.options].find(o=>o.value.startsWith(title+': '));if(match)select.value=match.value;}
    document.getElementById('booking')?.scrollIntoView({behavior:'smooth'});
    select?.focus({preventScroll:true});
  });
  update();
})();
