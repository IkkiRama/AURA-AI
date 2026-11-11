import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { FloatingPanel } from './app/panels';
import { isDesktop } from './app/platform';
import './styles.css';

const panel = new URLSearchParams(location.search).get('panel');
const isPanel = isDesktop && (panel === 'prompt' || panel === 'answer');
document.documentElement.classList.toggle('is-floating', isPanel);
createRoot(document.getElementById('root')!).render(isPanel ? <FloatingPanel panel={panel} /> : <App />);
