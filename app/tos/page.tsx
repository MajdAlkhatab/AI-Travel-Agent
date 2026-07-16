import PageLayout from '@/app/components/PageLayout';

export default function TermsOfService() {
  return (
    <PageLayout>
      <h1 className="text-3xl font-bold text-black mb-8">Användarvillkor för ResaRea</h1>
      <p className="text-sm text-gray-500 mb-10">Senast uppdaterad: 14 juli 2026</p>

      <div className="space-y-8 leading-relaxed text-gray-800">
        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Godkännande av villkor</h2>
          <p>Genom att använda ResaRea godkänner du att vara bunden av dessa användarvillkor. Om du inte håller med om någon del av dessa villkor får du inte använda vår tjänst.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Beskrivning av tjänsten</h2>
          <p>ResaRea är en automatiserad plattform som samlar in offentlig resedata, flygpriser och hotellerbjudanden, genererar AI-drivna resplaner och publicerar dem på sociala medieplattformar.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Informationens riktighet</h2>
          <p>Även om vi strävar efter att tillhandahålla de bästa och mest exakta reseerbjudandena, kan alla priser, flygtillgänglighet och hotellrabatter ändras utan föregående meddelande. ResaRea garanterar inte att de priser som visas på vår webbplats eller i våra sociala mediekanaler kommer att finnas kvar när du försöker boka. Vi är ingen bokningsagent och tar inget ansvar för prisfluktuationer eller bokningsfel.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Acceptabel användning</h2>
          <p>Du förbinder dig att inte missbruka ResaRea-plattformen. Du får inte:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Försöka bakåtkompilera (reverse engineer), skrapa (scrape) eller överbelasta våra API:er eller servrar.</li>
            <li>Använda vår plattform för att distribuera skräppost eller skadligt innehåll.</li>
            <li>Störa de automatiserade funktionerna för publicering på sociala medier i applikationen.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Länkar och integrationer med tredje part</h2>
          <p>Vår tjänst innehåller länkar till tredje parts bokningswebbplatser (t.ex. flygbolag, hotell) och integreras med sociala nätverk. Vi kontrollerar inte dessa externa webbplatser och ansvarar inte för deras innehåll, policyer eller de transaktioner du utför med dem.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Ansvarsbegränsning</h2>
          <p>I den utsträckning som lagen tillåter ska ResaRea och dess utvecklare inte hållas ansvariga för några indirekta, tillfälliga, särskilda eller följdskador som uppstår på grund av din användning av tjänsten eller din tillit till de reseerbjudanden som tillhandahålls.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Ändringar av villkoren</h2>
          <p>Vi förbehåller oss rätten att ändra eller ersätta dessa villkor när som helst. Fortsatt användning av ResaRea efter sådana ändringar utgör ditt samtycke till dessa ändringar.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Kontakta oss</h2>
          <p>Om du har några frågor om dessa villkor, vänligen kontakta oss genom att skicka ett direktmeddelande till vårt officiella TikTok-konto på <strong>@ResaRea4</strong>.</p>
        </section>
      </div>
    </PageLayout>
  );
}