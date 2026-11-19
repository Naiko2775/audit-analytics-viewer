import './styles/base.css';
import './styles/v02.css';
import { start } from './ui/app.ts';
import type { Audit } from './core/types.ts';

const el = document.getElementById('audit-data');
start(JSON.parse(el?.textContent || '{}') as Audit);
