import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@opensea/satellite-ui';
import { App } from './App';
import './index.css';

// PrintServer é um painel admin dark (bg-slate-900).
// colorMode='dark' garante que o titlebar do AppWindow combine com o aesthetic.
const root = createRoot(document.getElementById('root')!);
root.render(
  <ThemeProvider as="fragment" colorMode="dark">
    <App />
  </ThemeProvider>,
);
