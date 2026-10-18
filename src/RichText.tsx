import { createElement, type ReactNode } from "react";

// Render a small, inert Markdown subset. Raw HTML and embedded links remain text;
// trusted Moodle source buttons are rendered separately by the caller.
function inline(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part);
}
export function RichText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const key = index;
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) { blocks.push(createElement(`h${Math.min(heading[1].length + 1, 4)}`, { key }, inline(heading[2]))); index++; continue; }
    if (line.includes("|") && index + 1 < lines.length && cells(lines[index + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const headers = cells(line); index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(cells(lines[index++]));
      blocks.push(<div key={key} className="text-table"><table><thead><tr>{headers.map((cell, i) => <th key={i}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{headers.map((_, j) => <td key={j}>{inline(row[j] || "")}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      const items: ReactNode[] = [];
      while (index < lines.length && pattern.test(lines[index])) {
        const value = lines[index++].replace(pattern, ""); const check = value.match(/^\[([ xX])\]\s*(.*)$/);
        items.push(<li key={index}>{check ? <span className="text-check"><input type="checkbox" checked={check[1].toLowerCase() === "x"} readOnly disabled aria-label={check[2]} />{inline(check[2])}</span> : inline(value)}</li>);
      }
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>); continue;
    }
    if (/^>\s?/.test(line)) { blocks.push(<blockquote key={key}>{inline(line.replace(/^>\s?/, ""))}</blockquote>); index++; continue; }
    const paragraph = [line]; index++;
    while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|\s*[-*]\s|\s*\d+[.)]\s|>)/.test(lines[index]) && !(lines[index].includes("|") && lines[index + 1] && cells(lines[index + 1]).every(cell => /^:?-{3,}:?$/.test(cell)))) paragraph.push(lines[index++]);
    blocks.push(<p key={key}>{inline(paragraph.join("\n"))}</p>);
  }
  return <div className="rich-text">{blocks}</div>;
}
