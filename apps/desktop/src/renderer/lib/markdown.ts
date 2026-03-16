/** Inline markdown: **bold**, `code` */
function inline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>');
}

/** Lightweight markdown -> HTML for planner outcome summaries. */
export function renderMarkdownHtml(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lines = md.split("\n");
  const out: string[] = [];
  let inTable = false;
  let headerDone = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Table rows
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^[-:]+$/.test(c))) {
        headerDone = true;
        continue;
      }
      if (!inTable) {
        out.push('<table style="width:100%;border-collapse:collapse;margin:6px 0;font-size:13px">');
        inTable = true;
        headerDone = false;
      }
      const tag = !headerDone ? "th" : "td";
      const cellStyle = 'style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,0.1);text-align:left"';
      out.push("<tr>" + cells.map((c) => `<${tag} ${cellStyle}>${inline(escape(c))}</${tag}>`).join("") + "</tr>");
      if (!headerDone) headerDone = true;
      continue;
    }
    if (inTable) {
      out.push("</table>");
      inTable = false;
      headerDone = false;
    }

    if (!trimmed) {
      out.push("<br/>");
      continue;
    }
    if (trimmed.startsWith("### ")) {
      out.push(`<div style="font-weight:600;font-size:13px;margin-top:8px;color:#6ee7b7">${inline(escape(trimmed.slice(4)))}</div>`);
    } else if (trimmed.startsWith("## ")) {
      out.push(`<div style="font-weight:700;font-size:14px;margin-top:10px;color:#e8e8f0">${inline(escape(trimmed.slice(3)))}</div>`);
    } else if (/^[-*] /.test(trimmed)) {
      out.push(`<div style="padding-left:12px;margin:2px 0">\u2022 ${inline(escape(trimmed.slice(2)))}</div>`);
    } else {
      out.push(`<div style="margin:2px 0">${inline(escape(trimmed))}</div>`);
    }
  }
  if (inTable) out.push("</table>");
  return out.join("");
}
