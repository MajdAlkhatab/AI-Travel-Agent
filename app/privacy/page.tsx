import PageLayout from '@/app/components/PageLayout';

export default function PrivacyPolicy() {
  return (
    <PageLayout>
      <h1 className="text-3xl font-bold text-black mb-8">Integritetspolicy för ResaRea</h1>
      <p className="text-sm text-gray-500 mb-10">Senast uppdaterad: 14 juli 2026</p>

      <div className="space-y-8 leading-relaxed text-gray-800">
        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Introduktion</h2>
          <p>Välkommen till ResaRea. Vi respekterar din integritet och är fast beslutna att skydda alla personuppgifter du kan komma att dela med oss. Denna integritetspolicy förklarar hur vi samlar in, använder och skyddar information när du använder vår webbplats och våra automatiserade tjänster för reseerbjudanden.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Information vi samlar in</h2>
          <p>ResaRea fungerar i första hand som en automatiserad aggregator av reseerbjudanden och publicist på sociala medier.</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Loggdata:</strong> Precis som de flesta webbplatser samlar våra servrar automatiskt in information som din webbläsare skickar när du besöker vår webbplats (t.ex. IP-adress, webbläsartyp, besökta sidor).</li>
            <li><strong>API-data:</strong> Vi använder tredjeparts-API:er (som TikTok, Meta och Google) för att publicera innehåll. Vi lagrar inga personliga inloggningsuppgifter för dessa tjänster utöver de standardmässiga OAuth-tokens som krävs för att godkänna automatiserad publicering på våra egna officiella konton.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Hur vi använder informationen</h2>
          <p>Vi använder den insamlade informationen för att:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Underhålla och förbättra ResaRea-plattformen.</li>
            <li>Automatisera genereringen och publiceringen av resplaner och flygerbjudanden.</li>
            <li>Övervaka användningen av webbplatsen och förhindra tekniska problem eller missbruk.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Tredjepartstjänster</h2>
          <p>ResaRea förlitar sig på externa tjänster för att hämta resedata och publicera innehåll. Dessa inkluderar OpenAI, SerpAPI, Vercel, Meta (Facebook/Instagram) och TikTok. Dessa tredjepartsleverantörer har sina egna integritetspolicyer som reglerar hur de använder din information. Vi säljer eller delar inte någon användardata med dessa tredje parter i marknadsföringssyfte.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Datasäkerhet</h2>
          <p>Vi implementerar branschstandardiserade säkerhetsåtgärder för att skydda mot obehörig åtkomst eller ändring av data. Ingen metod för överföring över internet är dock till 100 % säker, och vi kan inte garantera absolut säkerhet.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Kontakta oss</h2>
          <p>Om du har några frågor om denna integritetspolicy, vänligen kontakta oss genom att skicka ett direktmeddelande till vårt officiella TikTok-konto på <strong>@ResaRea4</strong>.</p>
        </section>
      </div>
    </PageLayout>
  );
}