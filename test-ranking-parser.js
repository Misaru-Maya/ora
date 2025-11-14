const header1 = '[1] [(ranking)] [Light Pink] Please rank the following different color combinations from most preferred to least preferred. Example: 1 = most preferred, 2 = second most preferred... ';
const header2 = '[1] [(ranking)] [Light Pink] Please rank the following different color combinations from most preferred to least preferred. Example: 1 = most preferred, 2 = second most preferred... : Dark / Light';
const header3 = '[1] [(ranking)] [Patina Green] Please rank the following different color combinations from most preferred to least preferred. Example: 1 = most preferred, 2 = second most preferred... : Bright / Light';

const QUESTION_HEADER_RE = /^\[\s*(?:Q)?(\d+)\s*\]\s*(?:\[\(\s*([^)]+?)\s*\)\]|\(\s*([^)]+?)\s*\))\s*(.*)$/i;

function extractBaseAndOption(header) {
  let base = header;
  let option = undefined;
  const lower = header.toLowerCase();
  const isLikelyMulti = lower.includes('(multi') || lower.includes('(ranking');

  if (isLikelyMulti) {
    const lastColonIndex = header.lastIndexOf(':');
    if (lastColonIndex > 0) {
      const afterColon = header.slice(lastColonIndex + 1).trim();
      if (afterColon && afterColon.length > 0 && !afterColon.includes('Example')) {
        option = afterColon.trim();
        base = header.slice(0, lastColonIndex).replace(/["\s]+$/, '').trim();
      }
    }
  }

  return { base: base.trim(), option };
}

function stripQuotes(value) {
  if (!value) return value;
  let result = value;
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith('"') && result.endsWith('"'))) {
    result = result.slice(1, -1);
  }
  return result.trim();
}

function parseQuestionHeader(header) {
  const { base, option } = extractBaseAndOption(header);
  const match = base.match(QUESTION_HEADER_RE);
  if (!match) return null;

  const qid = `Q${match[1]}`;
  const rawType = (match[2] || match[3] || '').toLowerCase();
  const questionText = stripQuotes((match[4] || '').trim());

  return { qid, rawType, questionText, option };
}

console.log('Header 1 (base):');
console.log(parseQuestionHeader(header1));
console.log('\nHeader 2 (with option):');
console.log(parseQuestionHeader(header2));
console.log('\nHeader 3 (different product):');
console.log(parseQuestionHeader(header3));
