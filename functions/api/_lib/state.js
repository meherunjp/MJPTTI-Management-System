import { readSession, json } from './auth.js';

const BASE_STATE={
  auditLog:[],notificationState:{},students:[],staff:[],payments:[],expenses:[],officeAdvances:[],staffSalaries:[],salarySheets:[],attendance:[],staffAttendance:[],exams:[],examList:[],certificates:[],
  courses:['JLPT N5 & N4 Combined','JLPT N5','JLPT N4','Japanese N5','Japanese N4','JFT A2','Caregiving L2','Beautification L2','Computer Operation L3','Graphic Design'],
  batches:['Batch 9','Batch 10','Batch 11','Batch 12'],
  teachers:[{id:'TR-001',name:'Demo Trainer',phone:'01800000000',course:'Japanese N5',courses:['Japanese N5']}],
  notices:[{id:1,title:'Welcome to MJPTTI Notice Board',body:'প্রতিষ্ঠানের সকল গুরুত্বপূর্ণ নোটিশ এখানে প্রকাশ করা হবে।',date:new Date().toISOString().slice(0,10)}],
  settings:{courseMeta:{},name:'Meherun JP Technical Training Institute',motto:'Empowering Skills, Building Future',phone:'01353-082121, 01351-745050',email:'meherunjp@gmail.com',bdAddress:'Jaforpur, Chuadanga Sadar, Chuadanga-7200, Bangladesh',jpPhone:'048-991-0779',jpAddress:'486 Okawado, Matsubushi-Cho, Kitakatsushika-gun, Saitama, Japan',adminUsername:'admin',institutionName:'Meherun JP Technical Training Institute',institutionLogo:'',institutionAddress:'Jaforpur, Chuadanga Sadar, Chuadanga-7200, Bangladesh',institutionPhone:'01353-082121, 01351-745050',institutionEmail:'meherunjp@gmail.com',website:'',authorizedPerson:'',signature:'',seal:'',certificateTitle:'CERTIFICATE OF COMPLETION',certificateJapaneseTitle:'技能修了証明書',idCardTitle:'STUDENT ID CARD',idCardFooter:'PROPERTY OF MJPTTI • PLEASE RETURN IF FOUND',letterheadMotto:'EMPOWERING SKILLS, BUILDING FUTURE'}
};

function clone(x){return JSON.parse(JSON.stringify(x));}
export function sanitizeState(state){
  const out=clone(state||BASE_STATE);
  delete out.settings?.adminPassword;
  if(out.settings?.drive){delete out.settings.drive.apiKey;delete out.settings.drive.endpoint;}
  (out.teachers||[]).forEach(t=>{delete t.password});
  (out.students||[]).forEach(s=>{delete s.password});
  return out;
}
export function publicState(state){
  const s=sanitizeState(state);
  const x=s.settings||{};
  const settings={
    name:x.name||x.institutionName||'',
    institutionName:x.institutionName||x.name||'',
    motto:x.motto||'',
    phone:x.phone||x.institutionPhone||'',
    email:x.email||x.institutionEmail||'',
    bdAddress:x.bdAddress||x.institutionAddress||'',
    jpPhone:x.jpPhone||'',
    jpAddress:x.jpAddress||'',
    website:x.website||'',
    institutionLogo:x.institutionLogo||'',
    authorizedPerson:x.authorizedPerson||'',
    letterheadMotto:x.letterheadMotto||''
  };
  return {notices:s.notices||[],settings,courses:s.courses||[],batches:s.batches||[]};
}
export async function loadState(env){
  if(!env.DB)throw new Error('D1 database binding DB is not configured.');
  const row=await env.DB.prepare('SELECT data FROM app_state WHERE id=1').first();
  if(!row){
    const state=clone(BASE_STATE);
    await env.DB.prepare('INSERT INTO app_state(id,data,version,updated_at) VALUES(1,?,1,CURRENT_TIMESTAMP)').bind(JSON.stringify(state)).run();
    return state;
  }
  try{return JSON.parse(row.data)||clone(BASE_STATE)}catch{return clone(BASE_STATE)}
}
export async function saveState(env,state){
  const clean=sanitizeState(state);
  await env.DB.prepare('INSERT INTO app_state(id,data,version,updated_at) VALUES(1,?,1,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=app_state.version+1,updated_at=CURRENT_TIMESTAMP').bind(JSON.stringify(clean)).run();
  return clean;
}
export async function authOr401(request,env){const session=await readSession(request,env);return session||null;}
export {json};
