import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  Activity, BookOpen, BriefcaseBusiness, ChevronRight, CloudOff, History, LayoutDashboard, MicOff, PanelTop,
  Settings, ShieldCheck, SlidersHorizontal, Sparkles, X,
} from 'lucide-react';
import { formatIdr } from '@/features/budgets/cost';
import { STAGE_LABEL } from '@/features/session/lifecycle';
import { desktop, errorMessage, isDesktop } from './platform';
import { enableWorkspacePersistence, useAura } from './store';
import { connectPanels } from './panels';
import { Workspace, type PageId } from './Workspace';

const pages = [
  { id: 'dashboard', title: 'Dashboard', icon: LayoutDashboard, description: 'Ruang persiapan interview dan diskusi.' },
  { id: 'copilot', title: 'Live Copilot', icon: Sparkles, description: 'Susun pertanyaan dan lampirkan screenshot.' },
  { id: 'intelligence', title: 'Session Intelligence', icon: Activity, description: 'Lacak tahap, jenis sesi, memori, dan biaya.' },
  { id: 'knowledge', title: 'Knowledge Base', icon: BookOpen, description: 'Kelola referensi lokal untuk jawaban.' },
  { id: 'jobs', title: 'Jobs & Profiles', icon: BriefcaseBusiness, description: 'Simpan target lowongan dan fakta profil.' },
  { id: 'prompts', title: 'Prompt Studio', icon: SlidersHorizontal, description: 'Atur format, gaya, dan panjang jawaban.' },
  { id: 'history', title: 'Session History', icon: History, description: 'Tinjau sesi yang diarsipkan.' },
  { id: 'settings', title: 'Settings', icon: Settings, description: 'Kelola provider, brankas, tampilan, dan anggaran.' },
] as const;

function initialPage(): PageId {
  const page = location.hash.slice(1);
  return pages.find((entry) => entry.id === page)?.id ?? 'dashboard';
}

export function App() {
  const [page, setPage] = useState<PageId>(initialPage);
  const state = useAura((s) => s);
  useEffect(() => {
    const stopSaving = enableWorkspacePersistence();
    const disconnect = isDesktop ? connectPanels() : undefined;
    void useAura.getState().initialize();
    const navigate = () => setPage(initialPage());
    window.addEventListener('hashchange', navigate);
    const stopListening = isDesktop ? listen<string>('aura:session-action', ({ payload }) => {
      const s = useAura.getState();
      if (payload === 'end') s.changeStage('end');
      if (payload === 'pause' || payload === 'hide') {
        if (!s.session.paused) s.pause();
        void s.setConsent(false);
        if (payload === 'hide') void s.lockVault().catch((error: unknown) => s.setNotice(errorMessage(error)));
      }
    }) : undefined;
    void stopListening?.catch((error: unknown) => useAura.getState().setNotice(errorMessage(error)));
    return () => {
      disconnect?.();
      stopSaving();
      window.removeEventListener('hashchange', navigate);
      void stopListening?.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  function goTo(next: PageId) {
    location.hash = next;
    setPage(next);
  }

  function openPanels() {
    void desktop('windows_show').catch((error: unknown) => state.setNotice(errorMessage(error)));
  }

  const current = pages.find((item) => item.id === page) ?? pages[0];
  const { session, data } = state;
  const used = session.usage.reduce((total, item) => total + item.usd, 0) * data.budget.fxUsdIdr;
  const ratio = Math.min(100, (used / Math.max(1, data.budget.limitIdr)) * 100);
  const cloudActive = session.cloudConsent && !session.paused && session.stage !== 'standby' && session.stage !== 'end';

  return <div className="app-shell">
    <aside className="app-sidebar">
      <a className="app-brand" href="#dashboard" onClick={() => goTo('dashboard')} aria-label="AURA Dashboard">
        <img src="/icons/aura.svg" alt="" /><span><strong>AURA</strong><small>INTERVIEW COMPANION</small></span>
      </a>
      <div className="app-sidebar-body">
        <p className="app-nav-label">RUANG KERJA</p>
        <nav aria-label="Navigasi utama">
          {pages.map(({ id, title, icon: Icon }) => <a key={id} href={`#${id}`} aria-label={title} onClick={() => goTo(id)} aria-current={page === id ? 'page' : undefined}>
            <Icon size={17} strokeWidth={1.8} /><span>{title}</span>{page === id && <ChevronRight className="app-nav-arrow" size={14} />}
          </a>)}
        </nav>
      </div>
      <div className="app-sidebar-foot">
        <div className="app-status-box"><ShieldCheck size={16} /><span><strong>Ruang kerja lokal</strong><small>{isDesktop ? 'AURA Desktop · v1.3' : 'Pratinjau browser · v1.3'}</small></span></div>
      </div>
    </aside>
    <div className="app-main">
      <header className="app-header">
        <div><div className="app-breadcrumb">AURA <ChevronRight size={12} /> RUANG KERJA</div><h1>{current.title}</h1><p>{current.description}</p></div>
        <div className="app-header-actions">
          <span className="app-stage"><i /> {session.paused ? 'Dijeda' : STAGE_LABEL[session.stage]}</span>
          {isDesktop && <button className="aura-button" type="button" onClick={openPanels}><PanelTop size={16} /> Panel desktop</button>}
        </div>
      </header>
      <div className={`app-main-scroll${page === 'dashboard' ? ' with-rail' : ''}`}>
        <main className="app-content" id="aura-content">
          {!isDesktop && <div className="app-browser-note"><ShieldCheck size={15} /> Pratinjau browser untuk fitur lokal. Gunakan aplikasi desktop untuk panel Windows, brankas API, dan koneksi provider.</div>}
          {state.notice && <div className="app-notice" role="status"><span>{state.notice}</span><button type="button" className="aura-button aura-icon-button" aria-label="Tutup notifikasi" onClick={() => state.setNotice(null)}><X size={15} /></button></div>}
          {state.initialized ? <Workspace page={page} goTo={goTo} openPanels={openPanels} /> : <p role="status">Membuka ruang kerja…</p>}
        </main>
        {page === 'dashboard' && <aside className="app-rail" aria-label="Status ruang kerja">
          <section className="app-rail-card"><span className="app-nav-label">STATUS SESI</span><h2>Sesi berjalan</h2>
            <div><CloudOff size={16} /><span>Cloud</span><strong>{cloudActive ? 'Diizinkan' : 'Off'}</strong></div>
            <div><MicOff size={16} /><span>Mikrofon</span><strong>Off</strong></div>
            <div><PanelTop size={16} /><span>Capture otomatis</span><strong>Off</strong></div>
          </section>
          <section className="app-rail-card"><span className="app-nav-label">ANGGARAN</span><h2>Penggunaan sesi</h2>
            <p><strong>{formatIdr(used)}</strong> dari {formatIdr(data.budget.limitIdr)}</p>
            <progress value={ratio} max={100} aria-label="Pemakaian anggaran" />
            <button type="button" className="app-text-button" onClick={() => goTo('intelligence')}>Lihat penggunaan <ChevronRight size={14} /></button>
          </section>
        </aside>}
      </div>
    </div>
  </div>;
}
