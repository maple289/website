import React from 'react';
import { createRoot } from 'react-dom/client';
import { TemporarySharePage } from '@/components/TemporarySharePage';
import '@/index.css';
createRoot(document.getElementById('root')!).render(<TemporarySharePage token={'a'.repeat(64)} />);
