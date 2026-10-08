import { loadState, publicState } from './_lib/state.js';
import { json } from './_lib/auth.js';
export async function onRequestGet({env}){
  try{return json(publicState(await loadState(env)));}
  catch(e){return json({error:e.message},503);}
}
