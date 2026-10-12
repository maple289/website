// Loopback-only frontend with explicitly synthetic API configuration.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const server=await createServer({configFile:false,root:process.cwd(),envPrefix:[],plugins:[react()],resolve:{alias:{'@':path.resolve('src')}},
define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://audit-fixture.supabase.invalid'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('fixture-anon-key')},
server:{host:'127.0.0.1',port:5226,strictPort:true},optimizeDeps:{exclude:['lucide-react']}});
await server.listen();console.log('Isolated audit fixture server: 127.0.0.1:5226');
