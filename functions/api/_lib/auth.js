const enc = new TextEncoder();
const dec = new TextDecoder();

function b64u(bytes){
  let s='';
  const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  for(let i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unb64u(s){
  s=s.replace(/-/g,'+').replace(/_/g,'/');
  while(s.length%4)s+='=';
  const bin=atob(s); const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}
export async function sha256(text){
  return b64u(await crypto.subtle.digest('SHA-256',enc.encode(text)));
}
export async function hashPassword(password,salt=crypto.randomUUID()){
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2$100000$${salt}$${b64u(bits)}`;
}
export async function verifyPassword(password,stored){
  const [scheme,it,salt,hash]=String(stored||'').split('$');
  if(scheme!=='pbkdf2'||!salt||!hash)return false;
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:Number(it)||100000,hash:'SHA-256'},key,256));
  return b64u(bits)===hash;
}
async function sign(value,secret){
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return b64u(await crypto.subtle.sign('HMAC',key,enc.encode(value)));
}
export async function createSession(user,secret){
  if(!secret)throw new Error('MJPTTI_AUTH_SECRET is not configured');
  const payload=b64u(enc.encode(JSON.stringify({sub:user.id,username:user.username,role:user.role,name:user.name,exp:Date.now()+8*60*60*1000})));
  return `${payload}.${await sign(payload,secret)}`;
}
export async function readSession(request,env){
  const cookie=request.headers.get('Cookie')||'';
  const m=cookie.match(/(?:^|;\s*)mjptti_session=([^;]+)/);
  if(!m||!env.MJPTTI_AUTH_SECRET)return null;
  const [payload,sig]=m[1].split('.');
  if(!payload||!sig)return null;
  const expected=await sign(payload,env.MJPTTI_AUTH_SECRET);
  if(sig!==expected)return null;
  try{
    const data=JSON.parse(dec.decode(unb64u(payload)));
    if(!data.exp||data.exp<Date.now())return null;
    return data;
  }catch{return null;}
}
export function sessionCookie(token){return `mjptti_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`}
export const clearCookie='mjptti_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
export function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}})}
export function requireAuth(request,env){return readSession(request,env);}
