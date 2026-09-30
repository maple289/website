import React from 'react';
import {createRoot} from 'react-dom/client';
import {AuthContext} from '@/context/AuthContext';
import {DeleteConfirmationProvider} from '@/components/DeleteConfirmationProvider';
import {VideoProcessingJobs} from '@/components/VideoProcessingJobs';
import {supabase} from '@/lib/supabase';
import '@/index.css';
import '@/components/MediaGallery.css';
const user={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.test'};
supabase.auth.getSession=async()=>({data:{session:{access_token:'fixture',user}},error:null}) as any;
createRoot(document.getElementById('root')!).render(
  <AuthContext.Provider value={{user} as any}><DeleteConfirmationProvider>
    <main className="media-page"><div className="mg-page">
      <VideoProcessingJobs searchTerm="" visibleIds={[]} />
    </div></main>
  </DeleteConfirmationProvider></AuthContext.Provider>
);
