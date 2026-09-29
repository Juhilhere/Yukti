import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { countdown } from '../lib/format';

const WARN_MS = 2 * 60 * 1000;
const ACTIVITY_REFRESH_MS = 60 * 1000;

/** Warns 2 minutes before session idle expiry; user activity (throttled) refreshes the session. */
export function IdleWatcher() {
  const { me, refresh, logout } = useAuth();
  const [now, setNow] = useState(Date.now());
  const lastRefresh = useRef(Date.now());
  const expiredRef = useRef(false);

  const idleAt = me?.session?.idle_expires_at ? new Date(me.session.idle_expires_at).getTime() : NaN;
  const absAt = me?.session?.abs_expires_at ? new Date(me.session.abs_expires_at).getTime() : NaN;
  const expiry = Math.min(isNaN(idleAt) ? Infinity : idleAt, isNaN(absAt) ? Infinity : absAt);
  const remaining = expiry - now;
  const warn = isFinite(expiry) && remaining <= WARN_MS && remaining > 0;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { expiredRef.current = false; }, [expiry]);

  // user activity extends the session (throttled), but not while the warning is visible
  useEffect(() => {
    const onAct = () => {
      if (warn) return;
      if (Date.now() - lastRefresh.current < ACTIVITY_REFRESH_MS) return;
      lastRefresh.current = Date.now();
      void refresh();
    };
    window.addEventListener('keydown', onAct);
    window.addEventListener('mousedown', onAct);
    return () => { window.removeEventListener('keydown', onAct); window.removeEventListener('mousedown', onAct); };
  }, [refresh, warn]);

  useEffect(() => {
    if (!isFinite(expiry) || remaining > 0 || expiredRef.current) return;
    expiredRef.current = true;
    toast.warn('Session expired', 'You were signed out after inactivity.');
    void logout(false);
  }, [remaining, expiry, logout]);

  if (!me) return null;
  const absolute = isFinite(absAt) && absAt <= idleAt;
  return (
    <Modal open={warn} onClose={() => { lastRefresh.current = Date.now(); void refresh(); }} width={420}
      title={<span className="flex items-center gap-2"><Clock size={15} className="text-amber" /> Session about to expire</span>}
      footer={<>
        <button className="btn" onClick={() => void logout(false)}>Log out now</button>
        {!absolute && <button className="btn btn-primary" onClick={() => { lastRefresh.current = Date.now(); void refresh(); }}>Stay signed in</button>}
      </>}>
      <div className="space-y-2 text-center">
        <div className="font-mono text-[34px] font-semibold text-amber">{countdown(new Date(expiry).toISOString(), now)}</div>
        <div className="text-muted">
          {absolute
            ? 'Your session reaches its maximum lifetime and will end. Please sign in again afterwards.'
            : 'For plant security you will be signed out after inactivity. Choose “Stay signed in” to continue.'}
        </div>
      </div>
    </Modal>
  );
}
