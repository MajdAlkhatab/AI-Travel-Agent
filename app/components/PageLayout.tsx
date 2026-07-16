import Link from 'next/link';
import { Radar, Instagram, Facebook } from 'lucide-react';

export default function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      
      {/* HEADER */}
      <header className="max-w-6xl mx-auto flex items-center justify-between w-full py-8 px-6">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <div className="relative w-9 h-9 flex items-center justify-center rounded-full bg-slate-950 flex-shrink-0">
            <span className="absolute inset-0 rounded-full border border-orange-400 opacity-60" />
            <Radar size={17} className="text-orange-400" strokeWidth={2.25} />
          </div>
          <span className="text-2xl font-bold tracking-tight">
            <span className="text-slate-900">Resa</span>
            <span className="text-orange-600">Rea</span>
          </span>
        </Link>
      </header>
      
      {/* MAIN CONTENT WRAPPER */}
      <main className="flex-grow max-w-3xl mx-auto px-8 py-12 bg-white w-full shadow-sm mb-12 rounded-2xl border border-gray-100">
        {children}
      </main>

      {/* FOOTER */}
      <footer className="max-w-6xl w-full mx-auto mt-auto pt-8 pb-12 border-t border-gray-200 flex flex-col md:flex-row justify-between items-center gap-6 text-sm text-gray-500 px-6">
        <div className="flex flex-wrap justify-center items-center gap-6 font-medium">
          <Link href="/about_us" className="hover:text-orange-600 transition-colors">Om oss</Link>
          <Link href="/privacy" className="hover:text-orange-600 transition-colors">Integritetspolicy</Link>
          <Link href="/tos" className="hover:text-orange-600 transition-colors">Användarvillkor</Link>
        </div>
        
        <div className="flex items-center gap-5">
          <a href="https://www.instagram.com/resarea.se/" target="_blank" rel="noopener noreferrer" className="hover:text-pink-600 transition-colors">
            <Instagram size={22} />
          </a>
          <a href="https://www.facebook.com/ResaRea.se" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">
            <Facebook size={22} />
          </a>
        </div>
        
        <div className="text-gray-400">
          &copy; {new Date().getFullYear()} ResaRea.se. Alla rättigheter reserverade.
        </div>
      </footer>

    </div>
  );
}