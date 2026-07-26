const { inflateRawSync } = require('node:zlib');

function decodeXml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    if (code[0] === '#') {
      const radix = code[1].toLowerCase() === 'x' ? 16 : 10;
      const digits = radix === 16 ? code.slice(2) : code.slice(1);
      return String.fromCodePoint(Number.parseInt(digits, radix));
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code.toLowerCase()];
  });
}

function extractZipEntry(archive, targetName) {
  const searchStart = Math.max(0, archive.length - 65_557);
  let eocdOffset = -1;

  for (let offset = archive.length - 22; offset >= searchStart; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('The SPY holdings workbook is not a valid ZIP archive.');

  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  let centralOffset = archive.readUInt32LE(eocdOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(centralOffset) !== 0x02014b50) break;
    const compression = archive.readUInt16LE(centralOffset + 10);
    const compressedSize = archive.readUInt32LE(centralOffset + 20);
    const fileNameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    const fileName = archive.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString();

    if (fileName === targetName) {
      if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error(`The SPY holdings workbook has an invalid ${targetName} entry.`);
      }
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
      if (compression === 0) return compressed;
      if (compression === 8) return inflateRawSync(compressed);
      throw new Error(`The SPY holdings workbook uses unsupported ZIP compression ${compression}.`);
    }

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error(`The SPY holdings workbook is missing ${targetName}.`);
}

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXml(textMatch[1]))
      .join('')
  );
}

function parseWorksheet(xml, sharedStrings) {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row = {};
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cellMatch[1].match(/\br="([A-Z]+)\d+"/);
      const value = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/);
      if (!reference || !value) continue;
      const type = cellMatch[1].match(/\bt="([^"]+)"/);
      row[reference[1]] = type?.[1] === 's' ? sharedStrings[Number(value[1])] : decodeXml(value[1]);
    }
    return row;
  });
}

function parseSpyHoldings(workbook) {
  const archive = Buffer.isBuffer(workbook) ? workbook : Buffer.from(workbook);
  const sharedStrings = parseSharedStrings(extractZipEntry(archive, 'xl/sharedStrings.xml').toString('utf8'));
  const rows = parseWorksheet(
    extractZipEntry(archive, 'xl/worksheets/sheet1.xml').toString('utf8'),
    sharedStrings
  );
  const headerIndex = rows.findIndex((row) => row.B === 'Ticker');
  if (headerIndex < 0) throw new Error('The SPY holdings workbook does not contain a Ticker column.');

  const holdings = rows.slice(headerIndex + 1)
    .map((row) => ({
      name: String(row.A || '').trim(),
      symbol: String(row.B || '').trim().toUpperCase(),
      weight: Number(row.E),
      sector: String(row.F || '').trim(),
    }))
    .filter((holding) =>
      /^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(holding.symbol) && Number.isFinite(holding.weight)
    );

  if (holdings.length < 400) {
    throw new Error('The SPY holdings workbook did not contain enough equity holdings.');
  }
  return holdings;
}

module.exports = { parseSpyHoldings };
