import { Link, NavLink, Route, Routes } from 'react-router-dom';
import GamePage from './pages/GamePage';
import ImportPage from './pages/ImportPage';
import RacePage from './pages/RacePage';
import SettingsPage from './pages/SettingsPage';
import StatsPage from './pages/StatsPage';
import HomePage from './pages/HomePage';
import SystemPage from './pages/SystemPage';
import ComparePage from './pages/ComparePage';
import StatsVerifyPage from './pages/StatsVerifyPage';

export default function App() {
  return (
    <div className="layout">
      <header>
        <Link to="/" className="brand">
          <img src="/trotlab-logo.png" alt="" className="brand-logo" width={36} height={36} />
          <span className="brand-name">
            Trot<span>Lab</span>
          </span>
        </Link>
        <nav>
          <NavLink to="/" end>
            Spel
          </NavLink>
          <NavLink to="/import">Importera</NavLink>
          <NavLink to="/statistik">Statistik</NavLink>
          <NavLink to="/jämför">Jämför</NavLink>
          <NavLink to="/installningar">Inställningar</NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/omgang/:id" element={<GamePage />} />
        <Route path="/omgang/:id/system" element={<SystemPage />} />
        <Route path="/lopp/:id" element={<RacePage />} />
        <Route path="/statistik" element={<StatsPage />} />
        <Route path="/statistik/kusk-tranare" element={<StatsVerifyPage />} />
        <Route path="/jämför" element={<ComparePage />} />
        <Route path="/installningar" element={<SettingsPage />} />
      </Routes>
    </div>
  );
}
