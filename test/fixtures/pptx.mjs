import { deflateRawSync } from "node:zlib";

// Minimal genuine ZIP/OOXML fixtures, built without PowerPoint or a ZIP writer.
export function zip(entries) {
  const chunks = [], central = []; let offset = 0;
  for (const [filename, value] of Object.entries(entries)) {
    const name = Buffer.from(filename), data = Buffer.from(value), compressed = deflateRawSync(data);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    chunks.push(header, name, compressed);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, name); offset += header.length + name.length + compressed.length;
  }
  const bytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(bytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, bytes, end]);
}
const P = "http://schemas.openxmlformats.org/presentationml/2006/main", A = "http://schemas.openxmlformats.org/drawingml/2006/main", R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export function deckParts() {
  return {
    "ppt/presentation.xml": `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="300" r:id="r10"/><p:sldId id="301" r:id="r2"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r10" Type="${R}/slide" Target="slides/slide10.xml"/><Relationship Id="r2" Type="${R}/slide" Target="slides/slide2.xml"/></Relationships>`,
    "ppt/slides/slide10.xml": `<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Objects &amp; classes</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Homework: </a:t></a:r><a:r><a:t>solve 1–5</a:t></a:r><a:br/><a:r><a:t>Кыргызча</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
    "ppt/slides/slide2.xml": `<p:sld xmlns:p="${P}" xmlns:a="${A}" show="0"><p:cSld><p:spTree><p:pic/></p:spTree></p:cSld></p:sld>`,
    "ppt/slides/_rels/slide10.xml.rels": `<Relationships><Relationship Id="notes" Type="${R}/notesSlide" Target="../notesSlides/notesSlide3.xml"/></Relationships>`,
    "ppt/notesSlides/notesSlide3.xml": `<p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Discuss encapsulation &lt;carefully&gt;.</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>999</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
  };
}
