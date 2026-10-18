import fs from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';
import { downloadCourseFile } from './files.js';

const LIMITS = { entries: 10000, xmlBytes: 4 * 1024 * 1024, totalXmlBytes: 32 * 1024 * 1024, slides: 500, characters: 1000000 };
const P = new Set(['http://schemas.openxmlformats.org/presentationml/2006/main', 'http://purl.oclc.org/ooxml/presentationml/main']);
const A = new Set(['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main']);
export class PresentationReadError extends Error { constructor(message) { super(message); this.name = 'PresentationReadError'; } }

function parseXml(xml, handlers) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('PowerPoint XML with DTD/entities is not supported.');
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  parser.on('opentag', node => { if (++depth > 100) throw new Error('PowerPoint XML is too deeply nested.'); handlers.open?.(node); });
  parser.on('closetag', node => { handlers.close?.(node); depth--; });
  parser.on('text', value => handlers.text?.(value));
  parser.on('cdata', value => handlers.text?.(value));
  try { parser.write(xml).close(); } catch { throw new Error('PowerPoint XML is malformed or exceeds parser limits.'); }
}
const attribute = (node, local) => Object.values(node.attributes).find(value => value.local === local)?.value;
function relationships(xml) {
  const result = new Map();
  parseXml(xml, { open: node => {
    if (node.local !== 'Relationship') return;
    const id = attribute(node, 'Id'), target = attribute(node, 'Target'), type = attribute(node, 'Type');
    if (id && target && attribute(node, 'TargetMode') !== 'External') {
      if (result.has(id)) throw new Error('PowerPoint has duplicate relationship IDs.');
      result.set(id, { target, type });
    }
  } });
  return result;
}
function partTarget(base, target) {
  if (target.includes('\\') || /^[a-z]+:/i.test(target) || target.includes('\0')) throw new Error('Invalid PowerPoint part reference.');
  const result = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(base), target));
  if (!result.startsWith('ppt/') || result.includes('../')) throw new Error('Invalid PowerPoint part reference.');
  return result;
}
async function readParts(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 100 * 1024 * 1024) throw new Error('PowerPoint exceeds the 100 MB file limit.');
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) { reject(new Error('This file is not a readable PPTX presentation. Legacy PPT, encrypted files and folder ZIPs are unsupported.')); return; }
      const parts = new Map(); let count = 0, bytes = 0, finished = false;
      function fail(error) { if (!finished) { finished = true; zip.close(); reject(error); } }
      zip.on('error', () => fail(new Error('The PPTX archive is damaged or unsupported.')));
      zip.on('end', () => { if (!finished) { finished = true; resolve(parts); } });
      zip.on('entry', entry => {
        if (++count > LIMITS.entries) { fail(new Error('PowerPoint archive contains too many entries.')); return; }
        // Read XML parts only, never expand archives onto disk or decompress media.
        if (!/^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/(slide\d+\.xml|_rels\/slide\d+\.xml\.rels)|notesSlides\/notesSlide\d+\.xml)$/.test(entry.fileName)) { zip.readEntry(); return; }
        if (parts.has(entry.fileName) || entry.uncompressedSize > LIMITS.xmlBytes || bytes + entry.uncompressedSize > LIMITS.totalXmlBytes || entry.generalPurposeBitFlag & 1) { fail(new Error('PowerPoint XML exceeds safe limits or contains duplicate/encrypted parts.')); return; }
        zip.openReadStream(entry, async (error, stream) => {
          if (error) { fail(new Error('A PowerPoint slide could not be decompressed.')); return; }
          try {
            const chunks = []; let size = 0;
            for await (const chunk of stream) {
              size += chunk.length;
              if (size > LIMITS.xmlBytes || bytes + size > LIMITS.totalXmlBytes) throw new Error('PowerPoint XML exceeds the reading size limit.');
              chunks.push(chunk);
            }
            bytes += size; parts.set(entry.fileName, Buffer.concat(chunks).toString('utf8')); zip.readEntry();
          } catch { fail(new Error('PowerPoint XML is damaged or exceeds the reading size limit.')); }
        });
      });
      zip.readEntry();
    });
  });
}
function slideText(xml, notes = false) {
  const paragraphs = []; let paragraph = '', textDepth = 0, shape = null, title = '', hidden = false, pictures = 0;
  parseXml(xml, {
    open(node) {
      if (P.has(node.uri) && node.local === 'sld') hidden = attribute(node, 'show') === '0' || attribute(node, 'show') === 'false';
      if (P.has(node.uri) && node.local === 'pic') pictures++;
      if (P.has(node.uri) && node.local === 'sp') shape = { type: '', text: [] };
      if (P.has(node.uri) && node.local === 'ph' && shape) shape.type = attribute(node, 'type') || '';
      if (A.has(node.uri) && node.local === 'p') paragraph = '';
      if (A.has(node.uri) && node.local === 't') textDepth++;
      if (A.has(node.uri) && node.local === 'br') paragraph += '\n';
      if (A.has(node.uri) && node.local === 'tab') paragraph += '\t';
    },
    text(value) { if (textDepth) paragraph += value; },
    close(node) {
      if (A.has(node.uri) && node.local === 't') textDepth--;
      if (A.has(node.uri) && node.local === 'p') {
        const value = paragraph.trim();
        if (value && !(notes && ['sldImg', 'sldNum', 'hdr', 'ftr', 'dt'].includes(shape?.type))) { paragraphs.push(value); shape?.text.push(value); }
        paragraph = '';
      }
      if (P.has(node.uri) && node.local === 'sp') {
        if (shape && ['title', 'ctrTitle'].includes(shape.type)) title ||= shape.text.join('\n');
        shape = null;
      }
    },
  });
  return { text: paragraphs.join('\n'), title, hidden, pictures };
}
async function extractPptxParts(buffer) {
  const parts = await readParts(buffer);
  if (!parts.has('ppt/presentation.xml') || !parts.has('ppt/_rels/presentation.xml.rels')) throw new Error('This file is not a PPTX presentation. Open the Moodle folder and select an individual .pptx file.');
  const links = relationships(parts.get('ppt/_rels/presentation.xml.rels'));
  const ids = [];
  parseXml(parts.get('ppt/presentation.xml'), { open: node => {
    if (P.has(node.uri) && node.local === 'sldId') {
      const rel = Object.values(node.attributes).find(attr => attr.local === 'id' && /relationships$/.test(attr.uri));
      if (rel) ids.push(rel.value);
    }
  } });
  if (ids.length > LIMITS.slides || !ids.length) throw new Error('Presentation has no slides or exceeds the 500-slide reading limit.');
  let characters = 0;
  const slides = ids.map((id, index) => {
    const rel = links.get(id);
    if (!rel || !/\/slide$/.test(rel.type || '')) throw new Error('The presentation slide order is incomplete.');
    const name = partTarget('ppt/presentation.xml', rel.target);
    if (!parts.has(name)) throw new Error('A slide listed in the presentation is missing.');
    const slide = slideText(parts.get(name));
    let notes = '';
    const relName = path.posix.join(path.posix.dirname(name), '_rels', path.posix.basename(name) + '.rels');
    if (parts.has(relName)) {
      const note = [...relationships(parts.get(relName)).values()].find(item => /\/notesSlide$/.test(item.type || ''));
      if (note) { const noteName = partTarget(name, note.target); if (parts.has(noteName)) notes = slideText(parts.get(noteName), true).text; }
    }
    characters += slide.text.length + notes.length;
    if (characters > LIMITS.characters) throw new Error('Presentation text exceeds the one-million-character reading limit.');
    return { number: index + 1, ...slide, notes };
  });
  return { slides, totalSlides: slides.length, limitations: 'Extracted text and speaker notes only. Images, diagrams, embedded charts, equations and animations are not visually interpreted. Empty slide text may indicate image-only content.' };
}
export async function extractPptx(buffer) {
  try { return await extractPptxParts(buffer); }
  catch (error) { throw new PresentationReadError(error.message); }
}
const presentations = new Map();
export async function readCourseSlides(courseId, activityId, fileId) {
  const result = await downloadCourseFile(courseId, activityId, fileId);
  const key = `${result.file.path}:${result.file.sha256}`;
  let presentation = presentations.get(key);
  if (!presentation) {
    presentation = await extractPptx(await fs.readFile(result.file.path));
    if (presentations.size >= 8) presentations.delete(presentations.keys().next().value);
    presentations.set(key, presentation);
  }
  return { ...result, presentation };
}
