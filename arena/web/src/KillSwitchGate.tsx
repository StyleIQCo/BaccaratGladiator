// THE ROLLBACK GATE. Reads /arena/config/flags.json (served no-store) before any
// WebSocket connects. If disabled, renders the maintenance notice + a link back
// to the classic game — instantly, without a code deploy. This is what makes
// "flip the flag → arena is gone for everyone" work.
import { useEffect, useState, type ReactNode } from 'react';

interface Flags {
  enabled: boolean;
  maintenanceMessage: string;
  classicGameUrl: string;
  features: Record<string, boolean>;
  /** true → render the mock-driven Demo Hub instead of the live table
   *  (used while the arena backend isn't hosted; flips off without a build) */
  demoMode?: boolean;
}

export function KillSwitchGate({ children }: { children: (flags: Flags) => ReactNode }) {
  const [flags, setFlags] = useState<Flags | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    // cache:no-store so a stale CDN copy can never keep a killed arena alive.
    fetch('/arena/config/flags.json', { cache: 'no-store' })
      .then(r => r.json()).then(setFlags).catch(() => setErrored(true));
  }, []);

  // Fail SAFE: if flags can't load, treat the arena as OFF.
  if (errored) return <Maintenance message="Arena is unavailable right now." classicGameUrl="/" />;
  if (!flags) return <div className="arena-boot">Loading the Arena…</div>;
  if (!flags.enabled) return <Maintenance message={flags.maintenanceMessage} classicGameUrl={flags.classicGameUrl} />;

  return <>{children(flags)}</>;
}

function Maintenance({ message, classicGameUrl }: { message: string; classicGameUrl: string }) {
  return (
    <div className="arena-maintenance">
      <h1>The Grand Arena</h1>
      <p>{message}</p>
      <a href={classicGameUrl}>← Back to the classic tables</a>
    </div>
  );
}
