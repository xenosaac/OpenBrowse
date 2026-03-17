export function Footer() {
  return (
    <footer className="py-12 px-6 border-t border-border/50">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-muted-foreground">
            © 2026 OpenBrowse · MIT License
          </div>

          <div className="flex gap-8 text-sm">
            <a href="https://github.com/xenosaac/OpenBrowse" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-emerald-400 transition-colors">
              GitHub
            </a>
            <a href="https://github.com/xenosaac?tab=repositories" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-emerald-400 transition-colors">
              Contact
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
