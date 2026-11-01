'use strict';
const actions=new Set(['survey','submitSurvey','surveyAdmin','saveSurvey']);
const need=(yes,message)=>{if(!yes)throw Error(message);};
const text=(v,max,label)=>{need(typeof v==='string'&&v.trim().length>0&&v.length<=max,label);return v.trim();};
const responseKey=(id,user)=>JSON.stringify(['survey',id,user]);
function handle(s,actor,action,input,{now}){
 const all=s.surveys||[],current=all.at(-1),revision=s.surveyRevision||0;
 if(action==='surveyAdmin'||action==='saveSurvey')need(actor.merchant===true,'FORBIDDEN');else need(actor.merchant!==true,'FORBIDDEN');
 if(action==='surveyAdmin')return {revision,current:current||null,history:all.slice().reverse()};
 if(action==='saveSurvey'){
  need(input.revision===revision,'问卷已被其他操作更新，请重新打开后修改');
  need(typeof input.enabled==='boolean','请选择是否开放问卷');
  const title=text(input.title,60,'问卷标题限 1～60 字');
  need(Array.isArray(input.questions)&&input.questions.length>=1&&input.questions.length<=8,'请设置 1～8 道选择题');
  const questions=input.questions.map((q,i)=>{
   need(q&&['single','multiple'].includes(q.type)&&typeof q.required==='boolean','题型或必填设置无效');
   const title=text(q.title,120,'题目限 1～120 字');need(Array.isArray(q.options)&&q.options.length>=2&&q.options.length<=8,'每题请设置 2～8 个选项');
   const options=q.options.map(v=>text(v,60,'选项限 1～60 字'));need(new Set(options).size===options.length,'同一题的选项不能重复');
   return {id:'q'+(i+1),title,type:q.type,required:q.required,options};
  });
  const content=JSON.stringify({title,questions});
  if(current&&content===JSON.stringify({title:current.title,questions:current.questions}))current.enabled=input.enabled;
  else{
   need(all.length<100,'已达到 100 个问卷版本，请联系维护人员归档');
   if(current)current.enabled=false;
   all.push({id:'survey-'+(revision+1),title,questions,enabled:input.enabled,createdAt:now,total:0,counts:questions.map(q=>q.options.map(()=>0)),answered:questions.map(()=>0)});
  }
  s.surveys=all;s.surveyRevision=revision+1;return {revision:s.surveyRevision,current:all.at(-1)};
 }
 if(action==='survey'){
  if(!current||!current.enabled)return {survey:null};
  const receipt=s.keys[responseKey(current.id,actor.id)];
  return {survey:{id:current.id,title:current.title,questions:current.questions},submitted:!!receipt};
 }
 need(typeof input.id==='string'&&input.id.length<=60,'问卷编号无效');
 const key=responseKey(input.id,actor.id),saved=s.keys[key];
 // A retry after a lost response remains successful even after closing/revising.
 if(saved)return {submitted:true,submittedAt:saved.submittedAt};
 need(current&&current.enabled&&current.id===input.id,'问卷已暂停或更新，请重新打开反馈');
 need(Array.isArray(input.answers)&&input.answers.length===current.questions.length,'请检查每道题的答案');
 const answers=current.questions.map((q,i)=>{
  const a=input.answers[i];need(Array.isArray(a)&&a.every(n=>Number.isInteger(n)&&n>=0&&n<q.options.length)&&new Set(a).size===a.length,'选项无效，请重新选择');
  need(!q.required||a.length>0,'请完成必填题');need(q.type!=='single'||a.length<=1,'单选题只能选择一项');return a.slice().sort((a,b)=>a-b);
 });
 need(answers.some(a=>a.length),'请至少回答一道题');
 answers.forEach((a,i)=>{if(a.length)current.answered[i]++;a.forEach(n=>current.counts[i][n]++);});current.total++;
 s.keys[key]={submittedAt:now,answers};return {submitted:true,submittedAt:now};
}
module.exports={actions,handle,responseKey};
