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
const user={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.test'};
supabase.auth.getSession=async()=>({data:{session:{access_token:'fixture',user}},error:null}) as any;
(window as any).validateMediaFile=validateMediaFile;
function Harness(){
 const kind=new URLSearchParams(location.search).get('kind')==='video'?'video':'photo';
 const [open,setOpen]=useState(false),[files,setFiles]=useState<File[]|undefined>(),[completed,setCompleted]=useState(0);
 const Modal=kind==='video'?UploadModal:PhotoUploadModal;
 return <AuthContext.Provider value={{user} as any}><DeleteConfirmationProvider><FileDropArea enabled={!open} mediaKind={kind} onFiles={f=>{setFiles(f);setOpen(true)}}><button onClick={()=>{setFiles(undefined);setOpen(true)}}>Open Upload</button><p data-testid="completed">{completed}</p><div data-testid="drop" style={{height:200}}>Drop here</div></FileDropArea>{open&&<Modal initialFiles={files} onClose={()=>setOpen(false)} onUploaded={()=>{setCompleted(v=>v+1);setOpen(false)}} onItemUploaded={()=>setCompleted(v=>v+1)}/>}</DeleteConfirmationProvider></AuthContext.Provider>
}
createRoot(document.getElementById('root')!).render(<Harness/>);
