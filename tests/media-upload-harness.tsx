/* eslint-disable react-refresh/only-export-components -- Standalone regression entry. */
import '@/components/MediaGallery.css';
import '@/components/FluentTheme.css';
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {UploadModal} from '@/components/UploadModal';
import {PhotoUploadModal} from '@/components/PhotoUploadModal';
import {FileDropArea} from '@/components/FileDropArea';
import {DeleteConfirmationProvider} from '@/components/DeleteConfirmationProvider';
import {AuthContext} from '@/context/AuthContext';
import {supabase} from '@/lib/supabase';
import {validateMediaFile} from '@/lib/mediaValidation';
import '@/index.css';
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const session = { access_token: 'fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, user };
supabase.auth.getSession = async () => ({ data: { session }, error: null });
const okay = async () => ({ error: null });
const auth = { user, session, loading: false, configured: true, passwordSetup: null,
  signIn: okay, signUp: okay, requestRegistration: okay, completeInitialPassword: okay,
  cancelPasswordSetup: () => {}, signOut: async () => {} };
declare global { interface Window { validateMediaFile: typeof validateMediaFile } }
window.validateMediaFile = validateMediaFile;
function Harness(){
 const kind=new URLSearchParams(location.search).get('kind')==='video'?'video':'photo';
 const [open,setOpen]=useState(false),[files,setFiles]=useState<File[]|undefined>(),[completed,setCompleted]=useState(0);
 const Modal=kind==='video'?UploadModal:PhotoUploadModal;
 return <div className="fluent-app"><AuthContext.Provider value={auth}><DeleteConfirmationProvider><FileDropArea enabled={!open} mediaKind={kind} onFiles={f=>{setFiles(f);setOpen(true)}}><button onClick={()=>{setFiles(undefined);setOpen(true)}}>Open Upload</button><p data-testid="completed">{completed}</p><div data-testid="drop" style={{height:200}}>Drop here</div></FileDropArea>{open&&<Modal initialFiles={files} onClose={()=>setOpen(false)} onUploaded={()=>{setCompleted(v=>v+1);setOpen(false)}} onItemUploaded={()=>setCompleted(v=>v+1)}/>}</DeleteConfirmationProvider></AuthContext.Provider></div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
