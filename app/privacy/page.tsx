export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 bg-white text-black font-sans">
      <h1 className="text-3xl font-bold text-black mb-8">Privacy Policy for ResaRea</h1>
      <p className="text-sm text-gray-500 mb-10">Last Updated: July 14, 2026</p>

      <div className="space-y-8 leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Introduction</h2>
          <p>Welcome to ResaRea. We respect your privacy and are committed to protecting any personal data you may share with us. This Privacy Policy explains how we collect, use, and safeguard information when you use our website and automated travel deal services.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
          <p>ResaRea operates primarily as an automated travel deal aggregator and social media publisher.</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Log Data:</strong> As with most websites, our servers automatically collect information that your browser sends whenever you visit our site (e.g., IP address, browser type, pages visited).</li>
            <li><strong>API Data:</strong> We utilize third-party APIs (such as TikTok, Meta, and Google) to publish content. We do not store personal login credentials for these services beyond the standard OAuth tokens required to authorize automated posting to our own official accounts.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">3. How We Use Information</h2>
          <p>We use the collected information to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Maintain and improve the ResaRea platform.</li>
            <li>Automate the generation and publishing of travel itineraries and flight deals.</li>
            <li>Monitor website usage and prevent technical issues or abuse.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Third-Party Services</h2>
          <p>ResaRea relies on external services to fetch travel data and publish content. These include OpenAI, SerpAPI, Vercel, Meta (Facebook/Instagram), and TikTok. These third-party providers have their own privacy policies addressing how they use your information. We do not sell or share any user data with these third parties for marketing purposes.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data Security</h2>
          <p>We implement industry-standard security measures to protect against unauthorized access or alteration of data. However, no method of transmission over the internet is 100% secure, and we cannot guarantee absolute security.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Contact Us</h2>
          <p>If you have any questions about this Privacy Policy, please contact us by sending a direct message to our official TikTok account at <strong>@ResaRea4</strong>.</p>
        </section>
      </div>
    </div>
  );
}