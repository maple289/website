/* eslint-disable react-refresh/only-export-components -- Isolated browser fixture. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '@/context/AuthContext';
import { DeleteConfirmationProvider } from '@/components/DeleteConfirmationProvider';
import { AdminPage } from '@/components/AdminPage';
import { supabase } from '@/lib/supabase';
import '@/index.css';
import '@/components/FluentTheme.css';
const user={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.test',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const session={access_token:'fixture',refresh_token:'fixture',token_type:'bearer',expires_in:3600,user};
supabase.auth.getSession=async()=>({data:{session},error:null});
const okay=async()=>({error:null});
const auth={user,session,loading:false,configured:true,passwordSetup:null,signIn:okay,signUp:okay,requestRegistration:okay,completeInitialPassword:okay,cancelPasswordSetup:()=>{},signOut:async()=>{}};
createRoot(document.getElementById('root')!).render(<AuthContext.Provider value={auth}><DeleteConfirmationProvider><AdminPage /></DeleteConfirmationProvider></AuthContext.Provider>);
