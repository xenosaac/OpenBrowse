export interface TabDescriptor {
  id: string;
  title: string;
  url: string;
  profileId: string;
}

export class AppBrowserShell {
  private readonly tabs = new Map<string, TabDescriptor>();

  openTab(tab: TabDescriptor): void {
    this.tabs.set(tab.id, tab);
  }

  listTabs(): TabDescriptor[] {
    return [...this.tabs.values()];
  }
}

