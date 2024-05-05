const fs = require('fs');
const cheerio = require('cheerio');

// Function to load the HTML
function loadHTML(filePath) {
  const data = fs.readFileSync(filePath, 'utf8');
  return cheerio.load(data);
}

// Function to extract the 3rd column values
function extractThirdColumnValues(filePath) {
  const $ = loadHTML(filePath);
  const thirdColumnValues = [];

  // Assuming the table is in a `table` tag
  $('table tr').each((i, row) => {
    const thirdColumn = $(row).find('td').eq(2); // 0-indexed, so 2 is the 3rd column
    if (thirdColumn && thirdColumn.text()) {
      thirdColumnValues.push(thirdColumn.text());
    }
  });

  return thirdColumnValues;
}

// Function to write JSON to file
function writeJsonToFile(json, filePath) {
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2));
}

// Usage
const values = extractThirdColumnValues('slickcharts_sp500.html');
writeJsonToFile(values, 'src/sp500.json');
console.log('JSON written to file');
