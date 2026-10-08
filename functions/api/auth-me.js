import { readSession, json } from './_lib/auth.js';
export async function onRequestGet({request,env}){const s=await readSession(request,env);return s?json({ok:true,user:{id:s.sub,username:s.username,role:s.role,name:s.name}}):json({error:'Not authenticated.'},401)}

