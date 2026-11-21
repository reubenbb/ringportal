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
        <li>We work to keep RingPortal available and secure but cannot promise it will always be uninterrupted or error-free.</li>
        <li>[Insert pricing and payment terms once memberships launch.]</li>
        <li>[Insert limitation of liability, governing law (England and Wales) and how we will tell clubs about changes to these terms.]</li>
      </ul>

      <h2>Privacy</h2>
      <p>How we use personal information is explained in the <Link href="/privacy">privacy notice</Link>.</p>

      <h2>Contact</h2>
      <p>[Contact email for account and safeguarding questions.]</p>
    </LegalPage>
  );
}
