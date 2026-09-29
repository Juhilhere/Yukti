import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Bug, HelpCircle, KeyRound, Keyboard, Lock, MessageSquare, ShieldCheck, ThumbsUp } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { useSystem } from '../lib/queries';
import { SUPPORT_EMAIL } from '../lib/contact';
import { CopyButton } from '../components/pages2/CopyButton';
import { Badge, Card, Kbd, PageHeader, ProvenanceBadges, StatusChip } from '../components/ui';

function Item({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[170px_1fr] items-start gap-3 py-1.5">
      <div className="flex flex-wrap items-center gap-1">{term}</div>
      <div className="text-[12.5px] text-muted">{children}</div>
    </div>
  );
}

export default function Help() {
  const t = useT();
  const { isLlmAdmin } = useAuth();
  const VERSION_LABEL = useSystem().data?.version ?? '0.3.0';
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={t('page.help')} icon={<HelpCircle size={18} />} subtitle="How to get reliable answers from Yukti" />
      <div className="grid gap-4 p-5 xl:grid-cols-2">
        <Card title="How to ask" icon={<MessageSquare size={14} className="text-cyan" />}>
          <ul className="list-disc space-y-1.5 pl-4 text-[12.5px] text-muted">
            <li>Be specific: name the <b className="text-text">equipment tag, unit or document</b> (e.g. “P-101A seal flush plan per SOP-OP-014”).</li>
            <li>One question per message works best; follow up in the same chat to keep context.</li>
            <li>Keep <b className="text-text">Knowledge on</b> (toggle under the message box) so answers are grounded in plant documents with citations. Turn it off only for general questions.</li>
            <li>You may ask in English, हिंदी or ಕನ್ನಡ.</li>
            <li>Click a citation such as <span className="rounded bg-cyan/15 px-1 font-mono text-[10.5px] font-semibold text-cyan">S1</span> to jump to the source card, then open the exact page of the document.</li>
            <li>Yukti is advisory. For safety-critical values always confirm against the controlled document and follow your permit / MOC procedures.</li>
          </ul>
        </Card>

        <Card title="What the chips mean" icon={<BookOpen size={14} className="text-cyan" />}>
          <div className="divide-y divide-border">
            <Item term={<><StatusChip status="CURRENT" /><StatusChip status="SUPERSEDED" /></>}>Revision status of a cited document. Superseded revisions are shown so you can see what changed — prefer CURRENT.</Item>
            <Item term={<StatusChip status="KNOWN" />}>Fact found consistently in your sources.</Item>
            <Item term={<StatusChip status="CONFLICTING" />}>Sources disagree. Use <b>Compare</b> to see each value, revision and date. Yukti never silently picks one.</Item>
            <Item term={<StatusChip status="MISSING" />}>Not found in any document you may read — Yukti will not guess it.</Item>
            <Item term={<><Badge tone="ok">allow</Badge><Badge tone="amber">review</Badge><Badge tone="danger">deny</Badge></>}>Policy guard decision for your question.</Item>
            <Item term={<ProvenanceBadges isExample />}>Example document prepared by Team UniMinds for demonstration — not MRPL data.</Item>
            <Item term={<ProvenanceBadges isPublic />}>Published public MRPL information (annual report, website, filings), with a link to the source.</Item>
          </div>
        </Card>

        <Card title="Requesting access" icon={<KeyRound size={14} className="text-amber" />}>
          <div className="space-y-2 text-[12.5px] text-muted">
            <p>Answers use only documents your department and clearance permit. When sources are withheld you will see an amber <b className="text-amber">“sources withheld by policy”</b> card.</p>
            <p>Click <b className="text-text">{t('btn.requestAccess')}</b>, choose the department, give a justification and duration. An approver receives it in their <Link className="text-cyan hover:underline" to="/inbox">Inbox</Link>. Approved grants are time-bound and expire automatically — see <b>Inbox → My grants</b>.</p>
          </div>
        </Card>

        <Card title="Privacy & security" icon={<ShieldCheck size={14} className="text-ok" />}>
          <ul className="list-disc space-y-1.5 pl-4 text-[12.5px] text-muted">
            <li>Yukti runs <b className="text-text">entirely on-premise</b>; no data leaves the plant network and no cloud AI is used.</li>
            <li>Every question, answer, access decision and admin change is written to a <b className="text-text">tamper-evident audit log</b>.</li>
            <li>Sessions end after inactivity. Use <Link className="text-cyan hover:underline" to="/account">Account</Link> to change your password, enable two-factor authentication (MFA) and sign out other devices.</li>
            <li>Rate answers with <ThumbsUp size={11} className="inline" /> / thumbs down — feedback helps administrators improve the system.</li>
          </ul>
        </Card>

        <Card title="Keyboard shortcuts" icon={<Keyboard size={14} className="text-cyan" />}>
          <div className="space-y-1.5 text-[12.5px]">
            <div className="flex justify-between"><span className="text-muted">Send message</span><span><Kbd>Enter</Kbd></span></div>
            <div className="flex justify-between"><span className="text-muted">New line</span><span><Kbd>Shift+Enter</Kbd></span></div>
            <div className="flex justify-between"><span className="text-muted">New chat</span><span><Kbd>Ctrl+N</Kbd></span></div>
            {isLlmAdmin && <div className="flex justify-between"><span className="text-muted">Model loader (admin)</span><span><Kbd>Ctrl+L</Kbd></span></div>}
            <div className="text-[11.5px] text-faint">“Send with Enter” can be switched to Ctrl+Enter in <Link className="text-cyan hover:underline" to="/settings">Settings</Link>.</div>
          </div>
        </Card>

        <Card title="Need more help?" icon={<Lock size={14} className="text-muted" />}>
          <p className="text-[12.5px] text-muted">For account problems (locked account, forgotten password, new role or department) contact your Yukti administrator — they can unlock your account or issue a temporary password.</p>
        </Card>

        <Card title="Report a problem with Yukti" icon={<Bug size={14} className="text-amber" />}>
          <div className="space-y-2 text-[12.5px] text-muted">
            <p>Found a bug or something that does not work? Email Team UniMinds. Describe what you did, what you expected and what happened; add a screenshot and the Yukti version (v{VERSION_LABEL}). Never include confidential plant documents or passwords.</p>
            <div className="flex items-center gap-2">
              <a className="font-mono text-cyan hover:underline" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('[Yukti] Problem report')}`}>{SUPPORT_EMAIL}</a>
              <CopyButton text={SUPPORT_EMAIL} label="Copy" />
            </div>
            <p className="text-[11.5px] text-faint">Security vulnerabilities: use the same address with the subject “[Yukti security]”.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
