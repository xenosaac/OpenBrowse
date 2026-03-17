export function Footer() {
  return (
    <footer className="py-12 px-6 border-t border-border/50">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-muted-foreground">
            © 2026 OpenBrowse. All rights reserved.
          </div>
          
          <div className="flex gap-8 text-sm">
            <a href="#" className="text-muted-foreground hover:text-emerald-400 transition-colors">
              Documentation
            </a>
            <a href="#" className="text-muted-foreground hover:text-emerald-400 transition-colors">
              Privacy
            </a>
            <a href="#" className="text-muted-foreground hover:text-emerald-400 transition-colors">
              Terms
            </a>
            <a href="#" className="text-muted-foreground hover:text-emerald-400 transition-colors">
              Contact
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
