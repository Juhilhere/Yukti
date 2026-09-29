import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Bug, HelpCircle, KeyRound, Keyboard, Lock, MessageSquare, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { useSystem } from '../lib/queries';
import { SUPPORT_EMAIL } from '../lib/contact';
import { uiStore } from '../lib/queries';
import { Badge, Card, Kbd, PageHeader, ProvenanceBadges, StatusChip, rich } from '../components/ui';

function Item({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[170px_1fr] items-start gap-3 py-1.5">
      <div className="flex flex-wrap items-center gap-1">{term}</div>
      <div className="text-[12.5px] text-muted">{children}</div>
    </div>
  );
}

const b = (c: string) => <b className="text-text">{c}</b>;
const bPlain = (c: string) => <b>{c}</b>;

export default function Help() {
  const t = useT();
  const { isLlmAdmin } = useAuth();
  const VERSION_LABEL = useSystem().data?.version ?? '0.3.0';
  const link = (to: string) => (c: string) => <Link className="text-cyan hover:underline" to={to}>{c}</Link>;
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={t('page.help')} icon={<HelpCircle size={18} />} subtitle={t('help.subtitle')} />
      <div className="grid gap-4 p-5 xl:grid-cols-2">
        <Card title={t('help.ask.title')} icon={<MessageSquare size={14} className="text-cyan" />}>
          <ul className="list-disc space-y-1.5 pl-4 text-[12.5px] text-muted">
            <li>{rich(t('help.ask.specific'), { b })}</li>
            <li>{t('help.ask.oneQuestion')}</li>
            <li>{rich(t('help.ask.knowledge'), { b })}</li>
            <li>{t('help.ask.languages')}</li>
            <li>{rich(t('help.ask.citation'), { cite: (c) => <span className="rounded bg-cyan/15 px-1 font-mono text-[10.5px] font-semibold text-cyan">{c}</span> })}</li>
            <li>{t('help.ask.advisory')}</li>
          </ul>
        </Card>

        <Card title={t('help.chips.title')} icon={<BookOpen size={14} className="text-cyan" />}>
          <div className="divide-y divide-border">
            <Item term={<><StatusChip status="CURRENT" /><StatusChip status="SUPERSEDED" /></>}>{t('help.chips.revision')}</Item>
            <Item term={<StatusChip status="KNOWN" />}>{t('help.chips.known')}</Item>
            <Item term={<StatusChip status="CONFLICTING" />}>{rich(t('help.chips.conflicting'), { b: bPlain })}</Item>
            <Item term={<StatusChip status="MISSING" />}>{t('help.chips.missing')}</Item>
            <Item term={<><Badge tone="ok">{t('help.chips.allow')}</Badge><Badge tone="amber">{t('help.chips.review')}</Badge><Badge tone="danger">{t('help.chips.deny')}</Badge></>}>{t('help.chips.policy')}</Item>
            <Item term={<ProvenanceBadges isExample />}>{t('badge.example.tip')}</Item>
            <Item term={<ProvenanceBadges isPublic />}>{t('help.chips.public')}</Item>
          </div>
        </Card>

        <Card title={t('help.access.title')} icon={<KeyRound size={14} className="text-amber" />}>
          <div className="space-y-2 text-[12.5px] text-muted">
            <p>{rich(t('help.access.withheld'), { amber: (c) => <b className="text-amber">{c}</b> })}</p>
            <p>{rich(t('help.access.how', { btn: t('btn.requestAccess') }), { b, bp: bPlain, inbox: link('/inbox') })}</p>
          </div>
        </Card>

        <Card title={t('help.privacy.title')} icon={<ShieldCheck size={14} className="text-ok" />}>
          <ul className="list-disc space-y-1.5 pl-4 text-[12.5px] text-muted">
            <li>{rich(t('help.privacy.onprem'), { b })}</li>
            <li>{rich(t('help.privacy.audit'), { b })}</li>
            <li>{rich(t('help.privacy.sessions'), { account: link('/account') })}</li>
            <li>{rich(t('help.privacy.rate'), { up: () => <ThumbsUp size={11} className="inline" />, down: () => <ThumbsDown size={11} className="inline" /> })}</li>
          </ul>
        </Card>

        <Card title={t('help.keys.title')} icon={<Keyboard size={14} className="text-cyan" />}>
          <div className="space-y-1.5 text-[12.5px]">
            <div className="flex justify-between"><span className="text-muted">{t('help.keys.send')}</span><span><Kbd>Enter</Kbd></span></div>
            <div className="flex justify-between"><span className="text-muted">{t('help.keys.newLine')}</span><span><Kbd>Shift+Enter</Kbd></span></div>
            <div className="flex justify-between"><span className="text-muted">{t('btn.newChat')}</span><span><Kbd>Ctrl+N</Kbd></span></div>
            {isLlmAdmin && <div className="flex justify-between"><span className="text-muted">{t('help.keys.loader')}</span><span><Kbd>Ctrl+L</Kbd></span></div>}
            <div className="text-[11.5px] text-faint">{rich(t('help.keys.enterNote'), { settings: link('/settings') })}</div>
          </div>
        </Card>

        <Card title={t('help.more.title')} icon={<Lock size={14} className="text-muted" />}>
          <p className="text-[12.5px] text-muted">{t('help.more.body')}</p>
        </Card>

        <Card title={t('help.report.title', 'Something not working?')} icon={<Bug size={14} className="text-amber" />}>
          <div className="space-y-2 text-[12.5px] text-muted">
            <p>{t('help.report.body', 'Tell the Yukti team what happened. Answer two short questions; Yukti adds the technical details for you and opens your email app with everything filled in.')}</p>
            <button className="btn btn-primary" onClick={() => uiStore.openReport()}><Bug size={13} />{t('report.title', 'Report a problem')}</button>
            <p className="text-[11.5px] text-faint">{t('help.report.email', 'Or email us directly:')} <span className="font-mono">{SUPPORT_EMAIL}</span> {' · v'}{VERSION_LABEL}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
