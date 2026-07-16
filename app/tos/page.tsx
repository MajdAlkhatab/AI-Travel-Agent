export default function TermsOfService() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 bg-white text-black font-sans">
      <h1 className="text-3xl font-bold text-black mb-8">Terms of Service for TripHunter</h1>
      <p className="text-sm text-gray-500 mb-10">Last Updated: July 14, 2026</p>

      <div className="space-y-8 leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Acceptance of Terms</h2>
          <p>By accessing or using TripHunter, you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, you may not use our service.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Description of Service</h2>
          <p>TripHunter is an automated platform that aggregates public travel data, flight prices, and hotel deals, generating AI-powered itineraries and publishing them to social media platforms.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Accuracy of Information</h2>
          <p>While we strive to provide the best and most accurate travel deals, all prices, flight availability, and hotel discounts are subject to change without notice. TripHunter does not guarantee that the prices displayed on our website or social media channels will remain available by the time you attempt to book. We are not a booking agent and hold no liability for price fluctuations or booking errors.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Acceptable Use</h2>
          <p>You agree not to misuse the TripHunter platform. You shall not:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Attempt to reverse engineer, scrape, or overload our APIs or servers.</li>
            <li>Use our platform to distribute spam or malicious content.</li>
            <li>Interfere with the automated social media publishing features of the application.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Third-Party Links and Integrations</h2>
          <p>Our service contains links to third-party booking websites (e.g., airlines, hotels) and integrates with social media networks. We do not control these external sites and are not responsible for their content, policies, or the transactions you execute with them.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Limitation of Liability</h2>
          <p>To the maximum extent permitted by law, TripHunter and its developers shall not be liable for any indirect, incidental, special, or consequential damages resulting from your use of the service or reliance on the travel deals provided.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Changes to Terms</h2>
          <p>We reserve the right to modify or replace these Terms at any time. Continued use of TripHunter after any such changes constitutes your consent to such changes.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Contact Us</h2>
          <p>If you have any questions about these Terms, please contact us by sending a direct message to our official TikTok account at <strong>@triphunter4</strong>.</p>
        </section>
      </div>
    </div>
  );
}