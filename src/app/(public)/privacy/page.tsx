import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Privacy notice', description: 'How RingPortal uses personal information.' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice">
      <p>
        RingPortal is a matchmaking service for amateur boxing clubs registered with England Boxing. This notice explains what personal information RingPortal holds, why, who can
        see it and what rights you have. It covers club staff who use RingPortal, the boxers their clubs list, and visitors to the public show calendar.
      </p>

      <h2>Who is responsible</h2>
      <p>
        RingPortal is operated by [operator legal name], [registered address] (“we”). For questions about this notice or your information, email [privacy contact email].
        [Confirm whether RingPortal is registered with the Information Commissioner’s Office, and the registration number.]
      </p>
      <p>
        Clubs decide which boxers to list and what to record about them. For boxer information, each club is responsible for having a lawful basis and, for under-18s, parent or
        guardian consent. We hold and protect that information for the club. [Confirm whether RingPortal acts as the clubs’ processor or as a joint controller, and put a data processing
        agreement in place with each club.]
      </p>

      <h2>What we hold</h2>
      <table>
        <thead>
          <tr><th>Who</th><th>Information</th><th>Why</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Club staff</td>
            <td>Login email, password (stored only as a one-way hash), the club’s name, affiliation number, region and profile details, and a record of actions taken in RingPortal.</td>
            <td>To run the club’s account, verify England Boxing affiliation, and keep the service secure (legitimate interests; performing our agreement with the club).</td>
          </tr>
          <tr>
            <td>Boxers</td>
            <td>Name, sex, date of birth, weight, competitive and skills record, availability, and any medical status or notes the club records.</td>
            <td>So the club can find suitable bouts and sparring partners (the club’s legitimate interests; for under-18s, with parent or guardian consent confirmed by the club).</td>
          </tr>
          <tr>
            <td>Messages and proposals</td>
            <td>Messages, bout proposals, sparring offers, transfer requests and reports between clubs.</td>
            <td>To let clubs arrange bouts and to handle complaints and safety reports.</td>
          </tr>
          <tr>
            <td>Everyone</td>
            <td>A pseudonymised (keyed hash) form of your IP address, used for rate limiting and security logs. We do not store raw IP addresses.</td>
            <td>To prevent abuse and keep accounts secure (legitimate interests).</td>
          </tr>
        </tbody>
      </table>
      <p>
        Medical status is health information. Clubs should record only what is needed to arrange safe bouts. [Confirm the condition relied on for this special category data.]
      </p>

      <h2>Who can see it</h2>
      <ul>
        <li>Your own club sees everything it has recorded about its boxers.</li>
        <li>
          Other verified clubs see a reduced view only: a boxer’s age (not date of birth), sex, weight, record and availability. For under-18s, only the first name and surname
          initial are shown. Dates of birth, medical status and notes are never shown to other clubs.
        </li>
        <li>The public calendar shows only show names, dates, host clubs, venues and the first part of the postcode. It never shows boxers.</li>
        <li>RingPortal administrators can see club and boxer records to verify clubs and handle reports. Every administrator view of a report and every decision is logged.</li>
      </ul>

      <h2>Service providers</h2>
      <ul>
        <li>Vercel Inc. hosts the application (servers in London; Vercel is a US company).</li>
        <li>Neon (Databricks) hosts the database in London (AWS eu-west-2).</li>
        <li>Resend sends account emails such as password resets, once email is switched on.</li>
      </ul>
      <p>[Confirm the international transfer safeguards for each provider, for example the UK Extension to the EU–US Data Privacy Framework or the UK International Data Transfer Addendum.]</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Club accounts and their boxers: while the club uses RingPortal, then [12 months] after the club closes its account. Clubs can archive boxers at any time.</li>
        <li>Messages and proposals: [24 months] after the last activity.</li>
        <li>Security and audit logs: [6 years], because they record decisions about clubs and safeguarding reports.</li>
      </ul>
      <p>[Confirm these periods. Automatic deletion for the periods above is not yet built.]</p>

      <h2>Your rights</h2>
      <p>
        You can ask for a copy of your information, ask us to correct or delete it, object to how we use it, or ask us to restrict it. A boxer or parent should usually contact the
        boxer’s club first, because the club controls the boxer’s record. You can also email us at [privacy contact email]. If you are unhappy with our response, you can complain to
        the Information Commissioner’s Office at <a href="https://ico.org.uk/make-a-complaint/" rel="noopener noreferrer">ico.org.uk</a>.
      </p>

      <h2>Cookies</h2>
      <p>RingPortal uses only the cookies it needs to work. See the <Link href="/cookies">cookie notice</Link>.</p>
    </LegalPage>
  );
}
