import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Isolated fixture origin: the browser regression mocks every backend request.
// Never point this harness at a production Supabase project.
const server=await createServer({
  configFile:false,root:process.cwd(),plugins:[react()],
  resolve:{alias:{'@':path.resolve('src')}},
  define:{
    'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://reaction-test.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('fixture-anon-key'),
  },
  server:{host:'127.0.0.1',port:5203,strictPort:true},
  optimizeDeps:{exclude:['lucide-react']},
});
await server.listen();server.printUrls();
