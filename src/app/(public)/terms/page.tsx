import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Terms of use', description: 'The terms clubs agree to when they use RingPortal.' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms apply to every club that registers with RingPortal and to the staff who use the club’s login. By registering, the person registering confirms they are authorised
        to accept these terms for their club. RingPortal is operated by [operator legal name] (“we”).
      </p>

      <h2>Who can use RingPortal</h2>
      <ul>
        <li>RingPortal is for amateur boxing clubs currently registered with England Boxing.</li>
        <li>We verify each club’s affiliation before it can see other clubs, list boxers to them or propose bouts. We may suspend a club whose affiliation lapses or cannot be confirmed.</li>
        <li>A club is responsible for everything done with its login. Keep the password private and tell us at once if you think it has been misused.</li>
      </ul>

      <h2>Boxer information</h2>
      <ul>
        <li>Only list boxers who are members of your club and who have agreed to be listed. For under-18s, you must hold parent or guardian consent before listing them.</li>
        <li>Keep each boxer’s weight, record and availability accurate and up to date.</li>
        <li>Record medical information only where it is needed to arrange bouts safely.</li>
      </ul>

      <h2>Bouts and safety</h2>
      <ul>
        <li>
          RingPortal helps clubs find and agree bouts. It does not sanction bouts. Every bout must still meet England Boxing rules, including medicals, weigh-ins, age and experience
          limits, and official matching. RingPortal’s matching suggestions are a starting point, not a ruling that a bout is allowed.
        </li>
        <li>Each club remains responsible for its boxers’ welfare and for checking that a proposed opponent is a safe and permitted match.</li>
      </ul>

      <h2>Conduct</h2>
      <ul>
        <li>Be respectful in messages. Do not harass, threaten or discriminate against anyone, or share other people’s personal information outside RingPortal.</li>
        <li>Do not try to access another club’s information, test the service’s security without our written permission, or use automated tools to collect data.</li>
        <li>You can report a conversation or block a club at any time. We review reports and may suspend clubs that break these terms.</li>
      </ul>

      <h2>Our service</h2>
      <ul>
        <li>We work to keep RingPortal available and secure but cannot promise it will always be uninterrupted or error-free. We may change, pause or withdraw features, and will give notice of significant changes where we can.</li>
      </ul>

      <h2>Price</h2>
      <ul>
        <li>
          RingPortal is free for registered clubs. If we introduce paid memberships, we will tell clubs at least 30 days before any charge applies, and no club will be charged
          unless it chooses to sign up and agrees to the price first. [Owner to confirm.]
        </li>
      </ul>

      <h2>Ending your use</h2>
      <ul>
        <li>A club can stop using RingPortal and ask us to close its account at any time.</li>
        <li>We may suspend or close a club’s account if it breaks these terms, if its England Boxing affiliation lapses, or to protect boxers or other clubs. Where it is safe to do so, we will tell the club why.</li>
      </ul>

      <h2>Our responsibility to you</h2>
      <ul>
        <li>Nothing in these terms limits our liability for death or personal injury caused by our negligence, for fraud, or for anything else that cannot be limited by law.</li>
        <li>
          RingPortal is a tool to help clubs arrange bouts. We are not responsible for decisions clubs make using it, for the conduct of clubs or their members, or for whether a bout
          is safe or permitted. Those remain the clubs’ responsibility under England Boxing rules.
        </li>
        <li>We are not liable for loss of profit, revenue or opportunity, or for any indirect or consequential loss.</li>
        <li>Otherwise, our total liability to a club in any 12 months is limited to [£100, or the fees the club paid us in that period if higher]. [Owner or solicitor to confirm.]</li>
      </ul>

      <h2>Changes to these terms</h2>
      <ul>
        <li>
          We will tell clubs about changes to these terms by email and when they next sign in, at least 30 days before the changes take effect, unless a change is needed sooner
          for legal or safety reasons. If a change is significant, we will ask the club to accept the new terms before it carries on using RingPortal.
        </li>
      </ul>

      <h2>Law</h2>
      <ul>
        <li>These terms are governed by the law of England and Wales, and the courts of England and Wales have jurisdiction over any dispute.</li>
      </ul>

      <h2>Privacy</h2>
      <p>How we use personal information is explained in the <Link href="/privacy">privacy notice</Link>.</p>

      <h2>Contact</h2>
      <p>[Contact email for account and safeguarding questions.]</p>
    </LegalPage>
  );
}
