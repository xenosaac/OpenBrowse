import type { PageModel } from "@openbrowse/contracts";

/**
 * Raw shape returned by the extractPageModel CDP script.
 * Every field that exists on PageModel (except `id` and `createdAt`, which are
 * synthesised by the kernel) should appear here so the mapping is explicit.
 */
export interface RawPageModelResult {
  url: string;
  title: string;
  summary: string;
  focusedElementId?: string;
  elements: Array<{
    id: string;
    role: string;
    label: string;
    value?: string;
    isActionable: boolean;
    href?: string;
    inputType?: string;
    disabled?: boolean;
    readonly?: boolean;
    boundingVisible?: boolean;
    boundingBox?: { x: number; y: number; width: number; height: number };
  }>;
  visibleText: string;
  pageType?: string;
  forms?: Array<{
    action: string;
    method: string;
    fieldCount: number;
    fields?: Array<{
      ref: string;
      label: string;
      type: string;
      required: boolean;
      currentValue: string;
    }>;
    submitRef?: string;
  }>;
  alerts?: string[];
  captchaDetected?: boolean;
  cookieBannerDetected?: boolean;
  scrollY?: number;
  activeDialog?: { label: string };
  tables?: Array<{
    caption?: string;
    headers: string[];
    rowCount: number;
    sampleRows?: string[][];
  }>;
  landmarks?: Array<{ role: string; label: string }>;
  iframeCount?: number;
  iframeSources?: string[];
}

/**
 * Pure function that maps raw CDP extraction output to a PageModel contract object.
 *
 * Extracted from ElectronBrowserKernel.capturePageModel so it can be tested
 * without Electron/CDP dependencies.  Both the main return path and the
 * cookie-banner re-extract path call this function.
 */
export function mapRawToPageModel(
  raw: RawPageModelResult,
  browserSessionId: string
): PageModel {
  return {
    id: `page_${browserSessionId}_${Date.now()}`,
    url: raw.url,
    title: raw.title,
    summary: raw.summary,
    focusedElementId: raw.focusedElementId,
    elements: raw.elements,
    visibleText: raw.visibleText,
    pageType: (raw.pageType as PageModel["pageType"]) ?? undefined,
    forms: raw.forms,
    alerts: raw.alerts,
    captchaDetected: raw.captchaDetected,
    cookieBannerDetected: raw.cookieBannerDetected,
    scrollY: raw.scrollY,
    activeDialog: raw.activeDialog,
    tables: raw.tables,
    landmarks: raw.landmarks,
    iframeCount: raw.iframeCount,
    iframeSources: raw.iframeSources,
    createdAt: new Date().toISOString(),
  };
}
