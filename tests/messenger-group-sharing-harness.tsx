import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Session, User } from '@supabase/supabase-js';
import { AuthContext } from '@/context/AuthContext';
import { MessengerProvider } from '@/context/MessengerContext';
import { Messenger } from '@/components/Messenger';
import { MediaContentMenu } from '@/components/MediaContentMenu';
import { VideoLibrary } from '@/components/VideoLibrary';
import { PhotoLibrary } from '@/components/PhotoLibrary';
import { DeleteConfirmationProvider } from '@/components/DeleteConfirmationProvider';
import { supabase } from '@/lib/supabase';
import type { Video, Photo } from '@/lib/types';
import '@/index.css';
import '@/components/FluentTheme.css';
import '@/components/MediaGallery.css';
const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', admin='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const role=new URLSearchParams(location.search).get('role'), user={id:role==='admin'?admin:role==='member'||role==='group-admin'?b:a} as User;
const session={user,access_token:user.id} as Session;
supabase.auth.getSession=async()=>({data:{session},error:null});supabase.realtime.setAuth=async()=>{};
supabase.channel=(()=>{
 const handlers=new Map<string,(data:{payload:unknown})=>void>();
 const receive=(event:Event)=>handlers.get('changed')?.({payload:(event as CustomEvent).detail});
 const channel={on(_type:string,filter:{event:string},callback:(data:{payload:unknown})=>void){handlers.set(filter.event,callback);return channel;},subscribe(callback:(state:string)=>void){window.addEventListener('fixture-chat-event',receive);callback('SUBSCRIBED');return channel;},unsubscribe(){window.removeEventListener('fixture-chat-event',receive);}};return channel;
}) as typeof supabase.channel;
supabase.removeChannel=async channel=>{await channel.unsubscribe();return 'ok';};
const okay=async()=>({error:null});
const auth={user,session,loading:false,configured:true,passwordSetup:null,signIn:okay,signUp:okay,requestRegistration:okay,completeInitialPassword:okay,cancelPasswordSetup:()=>{},signOut:async()=>{}};
const photo={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',owner_id:a,file_name:'Private photo.jpg',visibility:'private',storage_path:`${a}/photo.jpg`,preview_path:'',thumbnail_path:'',created_at:'2026-01-01',mime_type:'image/jpeg'} as Photo;
const video={...photo,id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',file_name:'Private video.mp4',processing_status:'ready'} as unknown as Video;
const library=new URLSearchParams(location.search).get('library');
const root=createRoot(document.getElementById('root')!);
declare global { interface Window { fixtureUnmount?: () => void } }
// Drain real provider cleanup while its document is still active. WebKit rejects
// an auth-decorated fetch first scheduled after the old document is discarded.
window.fixtureUnmount=()=>root.unmount();
root.render(<React.StrictMode><AuthContext.Provider value={auth}><DeleteConfirmationProvider><MessengerProvider><div className="fluent-app">{library==='video'?<VideoLibrary searchTerm="" />:library==='photo'?<PhotoLibrary searchTerm="" />:<><Messenger /><div className="mg-grid"><article className="mg-card h-28"><MediaContentMenu kind="video" item={video} onPreview={()=>{}} /><p>Private video.mp4</p></article><article className="mg-card h-28"><MediaContentMenu kind="photo" item={photo} onPreview={()=>{}} /><p>Private photo.jpg</p></article></div></>}</div></MessengerProvider></DeleteConfirmationProvider></AuthContext.Provider></React.StrictMode>);
