import React from 'react';
import {createRoot} from 'react-dom/client';
import type {Session} from '@supabase/supabase-js';
import App from '@/App';
import {supabase} from '@/lib/supabase';
import '@/index.css';
const guest=new URLSearchParams(location.search).has('guest');
const session=guest?null:{access_token:'fixture',refresh_token:'fixture',token_type:'bearer',expires_in:3600,
  user:{id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.test'}} as Session;
supabase.auth.getSession=async()=>({data:{session},error:null});
supabase.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe(){}}}}) as ReturnType<typeof supabase.auth.onAuthStateChange>;
createRoot(document.getElementById('root')!).render(<App />);
