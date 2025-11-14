const fs = require('fs');
const Papa = require('papaparse');

// Read the test CSV
const csvPath = process.argv[2] || './test-ranking.csv';
console.log(`Reading CSV from: ${csvPath}\n`);

const csvContent = fs.readFileSync(csvPath, 'utf-8');
const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

const rows = parsed.data;
const headers = parsed.meta.fields || [];

console.log('=== CSV HEADERS ===');
console.log('Total columns:', headers.length);

// Find ranking columns
const rankingHeaders = headers.filter(h =>
  h.toLowerCase().includes('(ranking') ||
  h.toLowerCase().includes('[ranking')
);

console.log('\n=== RANKING COLUMNS FOUND ===');
console.log('Count:', rankingHeaders.length);
rankingHeaders.forEach((h, i) => {
  console.log(`${i + 1}. ${h}`);
});

// Sample data for each ranking column
console.log('\n=== SAMPLE DATA FROM FIRST 5 ROWS ===');
for (let i = 0; i < Math.min(5, rows.length); i++) {
  console.log(`\nRow ${i + 1}:`);
  rankingHeaders.forEach(header => {
    const value = rows[i][header];
    if (value !== null && value !== undefined && value !== '') {
      console.log(`  ${header.substring(0, 60)}... = "${value}"`);
    }
  });
}

// Calculate averages for first ranking question
if (rankingHeaders.length > 0) {
  console.log('\n=== CALCULATING AVERAGES (First Ranking Question) ===');

  // Group columns by question
  const questionPattern = /^\[([^\]]+)\]/;
  const questionGroups = new Map();

  rankingHeaders.forEach(header => {
    const match = header.match(questionPattern);
    if (match) {
      const qKey = match[1];
      if (!questionGroups.has(qKey)) {
        questionGroups.set(qKey, []);
      }
      questionGroups.get(qKey).push(header);
    }
  });

  console.log(`Found ${questionGroups.size} ranking questions\n`);

  // Process first question
  const firstQ = Array.from(questionGroups.entries())[0];
  if (firstQ) {
    const [qKey, qHeaders] = firstQ;
    console.log(`Question: ${qKey}`);
    console.log(`Options: ${qHeaders.length}\n`);

    qHeaders.forEach(header => {
      // Extract option name
      const optionMatch = header.match(/:\s*(.+?)$/);
      const option = optionMatch ? optionMatch[1].trim() : header;

      // Collect all numeric values for this option
      const values = [];
      const respondentValues = new Map();

      rows.forEach((row, idx) => {
        const value = row[header];
        if (value !== null && value !== undefined && value !== '') {
          const numValue = parseFloat(String(value));
          if (!isNaN(numValue) && numValue > 0) {
            values.push(numValue);
            // Track by respondent ID if available
            const respId = row['Respondent Id'] || row['Respondent ID'] || idx;
            if (!respondentValues.has(respId)) {
              respondentValues.set(respId, numValue);
            }
          }
        }
      });

      const avg = values.length > 0
        ? values.reduce((sum, v) => sum + v, 0) / values.length
        : 0;

      const uniqueRespondents = respondentValues.size;
      const avgPerRespondent = uniqueRespondents > 0
        ? Array.from(respondentValues.values()).reduce((sum, v) => sum + v, 0) / uniqueRespondents
        : 0;

      console.log(`${option}:`);
      console.log(`  Total values: ${values.length}`);
      console.log(`  Unique respondents: ${uniqueRespondents}`);
      console.log(`  Average (all): ${avg.toFixed(2)}`);
      console.log(`  Average (per respondent): ${avgPerRespondent.toFixed(2)}`);
      console.log(`  Sample values: ${values.slice(0, 10).join(', ')}`);
      console.log();
    });
  }
}
