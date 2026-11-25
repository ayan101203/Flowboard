import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { getBoard, sendOperation } from './api';
import { acceptSnapshot, projectBoard } from './model';
import type { Operation, Snapshot } from './model';
type Pending = {key:number;op:Operation};
type State = {base:Snapshot;pending:Pending[];loaded:boolean};
type Action = {type:'snapshot';snapshot:Snapshot} | {type:'enqueue';item:Pending} | {type:'settle';key:number;snapshot?:Snapshot};
function reducer(state:State,action:Action):State {
  if(action.type==='snapshot') return {...state,loaded:true,base:acceptSnapshot(state.base,action.snapshot)};
  if(action.type==='enqueue') return {...state,pending:[...state.pending,action.item]};
  return {...state,base:action.snapshot?acceptSnapshot(state.base,action.snapshot):state.base,pending:state.pending.filter(p=>p.key!==action.key)};
}
export function useBoard() {
  const [state,dispatch]=useReducer(reducer,{base:{revision:-1,tasks:[]},pending:[],loaded:false});
  const [connection,setConnection]=useState<'connecting'|'live'|'offline'>('connecting');
  const [error,setError]=useState('');
  const queue=useRef<Promise<void>>(Promise.resolve()); const counter=useRef(0);
  const refresh=useCallback(async()=>{try { dispatch({type:'snapshot',snapshot:await getBoard()}); } catch(e) { setError(e instanceof Error?e.message:'Unable to load board'); }},[]);
  useEffect(()=>{
    let active=true;
    getBoard().then(snapshot=>{if(active) dispatch({type:'snapshot',snapshot});}).catch(e=>{if(active) setError(e.message);});
    const events=new EventSource('/api/events');
    events.onopen=()=>{if(active) setConnection('live');};
    events.onmessage=event=>{if(!active) return;try{const snapshot=JSON.parse(event.data) as Snapshot; if(Number.isSafeInteger(snapshot.revision)&&Array.isArray(snapshot.tasks)) dispatch({type:'snapshot',snapshot});}catch{setError('Received an invalid live update');}};
    events.onerror=()=>{if(active) setConnection('offline');};
    return()=>{active=false;events.close();};
  },[]);
  const mutate=useCallback((op:Operation)=>{
    const key=++counter.current; dispatch({type:'enqueue',item:{key,op}});setError('');
    queue.current=queue.current.then(async()=>{
      try { const snapshot=await sendOperation(op); dispatch({type:'settle',key,snapshot}); }
      catch(e) { dispatch({type:'settle',key});setError(`${e instanceof Error?e.message:'Request failed'} — your change was rolled back.`); await refresh(); }
    });
  },[refresh]);
  const tasks=useMemo(()=>projectBoard(state.base,state.pending.map(p=>p.op)),[state]);
  return {tasks,loaded:state.loaded,connection,error,clearError:()=>setError(''),pendingIds:new Set(state.pending.map(p=>p.op.id)),pendingCount:state.pending.length,mutate,refresh};
}
