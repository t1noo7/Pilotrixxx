import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './routes/ProtectedRoute.jsx';
import DashboardLayout from './layouts/DashboardLayout.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import FleetMap from './pages/FleetMap.jsx';
import Alerts from './pages/Alerts.jsx';
import Drivers from './pages/Drivers.jsx';
import NotFound from './pages/NotFound.jsx';

export default function App() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />

            <Route
                path="/"
                element={
                    <ProtectedRoute>
                        <DashboardLayout />
                    </ProtectedRoute>
                }
            >
                <Route index element={<Overview />} />
                <Route path="map" element={<FleetMap />} />
                <Route path="alerts" element={<Alerts />} />
                <Route path="drivers" element={<Drivers />} />
            </Route>

            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
