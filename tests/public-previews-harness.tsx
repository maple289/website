/* eslint-disable react-refresh/only-export-components -- Standalone isolated browser fixture. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session, User } from '@supabase/supabase-js';
import { AuthContext } from '@/context/AuthContext';
import { DeleteConfirmationProvider } from '@/components/DeleteConfirmationProvider';
import { ReactionProvider } from '@/components/ReactionProvider';
import { HomePage } from '@/components/HomePage';
import { PhotoLibrary } from '@/components/PhotoLibrary';
import { FileManager } from '@/components/FileManager';
import { supabase } from '@/lib/supabase';
import type { Video, Photo } from '@/lib/types';
import '@/index.css';
import '@/components/MediaGallery.css';
import '@/components/FluentTheme.css';

const owner='11111111-1111-4111-8111-111111111111';
const person={id:owner,email:'preview-fixture@example.test'} as User;
let session:Session|null=null, failed=false, nonce=0;
const video={id:'22222222-2222-4222-8222-222222222222',owner_id:owner,file_name:'Public video',visibility:'public',preview_path:`${owner}/video-previews/poster.webp`,processing_status:'ready',file_size:1024,created_at:new Date().toISOString(),duration_seconds:12} as Video;
const photo={id:'33333333-3333-4333-8333-333333333333',owner_id:owner,file_name:'Public photo',visibility:'public',storage_path:`${owner}/photos/original.png`,preview_path:`${owner}/photos/preview.webp`,thumbnail_path:`${owner}/photos/thumbnail.webp`,file_size:100,created_at:new Date().toISOString()} as Photo;
const files=[{id:'44444444-4444-4444-8444-444444444444',name:'public-image.png',path:'public-image.png',isFolder:false,size:100,mimeType:'image/png',updatedAt:'2026-10-13',favorite:false,trashedAt:null},
  {id:'55555555-5555-4555-8555-555555555555',name:'public-document.docx',path:'public-document.docx',isFolder:false,size:100,mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',updatedAt:'2026-10-13',favorite:false,trashedAt:null}];
supabase.auth.getSession=async()=>({data:{session},error:null});
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.pathname.startsWith('/rest/v1/')){
    let value:unknown=[];
    if(url.pathname.endsWith('/get_storage_base_path'))value='';
    if(url.pathname.endsWith('/videos'))value=[{...video}];
    if(url.pathname.endsWith('/photos'))value=url.searchParams.has('owner_id')?(session?[{...photo,file_name:'Owned photo',visibility:'private'}]:[]):[{...photo}];
    if(url.pathname.endsWith('/list_public_user_files'))value=files;
    if(url.pathname.endsWith('/get_media_reactions'))value=[];
    return Response.json(value,{headers:{'Cache-Control':'no-store'}});
  }
  if(url.pathname.startsWith('/storage/v1/object/sign/')&&init?.method==='POST'){
    const fail=failed;failed=false;
    return Response.json({signedURL:`/object/sign/user-images/${url.pathname.split('/user-images/')[1]}?token=fixture-${++nonce}${fail?'&fail=1':''}`});
  }
  return originalFetch(input,init);
};
const okay=async()=>({error:null});
function Harness(){
  const [signedIn,setSignedIn]=useState(false),[route,setRoute]=useState(()=>location.hash.startsWith('#/public-files')?'files':location.hash.startsWith('#/public-photos')?'photos':'videos'),[search,setSearch]=useState('');
  const change=(signed:boolean)=>{session=signed?{user:person,access_token:'fixture-token-'+Date.now()} as Session:null;setSignedIn(signed);};
  const auth={session,user:signedIn?person:null,loading:false,configured:true,passwordSetup:null,signIn:okay,signUp:okay,signOut:async()=>change(false),requestRegistration:okay,completeInitialPassword:okay,cancelPasswordSetup:()=>{}};
  return <div className="fluent-app"><AuthContext.Provider value={auth}><DeleteConfirmationProvider><ReactionProvider><nav style={{display:'flex',gap:12,padding:16,flexWrap:'wrap'}}>
    <button onClick={()=>change(!signedIn)}>{signedIn?'Fixture sign out':'Fixture sign in'}</button>
    {['videos','photos','files','owned'].map(r=><button key={r} onClick={()=>{setRoute(r);window.location.hash=r==='files'?'#/public-files':r==='photos'?'#/public-photos':'#/public-videos';}}>{r}</button>)}
    <button onClick={()=>{failed=true;video.preview_path=`${owner}/video-previews/retry-${Date.now()}.webp`;window.dispatchEvent(new CustomEvent('media-uploaded',{detail:'video'}));}}>Simulate failed video image</button>
    <output>{signedIn?'Authenticated fixture':'Anonymous fixture'}</output>
  </nav>
  {route==='videos'||route==='photos'?<HomePage tab={route} searchTerm=""/>:route==='files'?<FileManager publicOnly searchTerm={search} onSearchTermChange={setSearch}/>:signedIn?<PhotoLibrary searchTerm=""/>:<p>Private content hidden</p>}
  </ReactionProvider></DeleteConfirmationProvider></AuthContext.Provider></div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
