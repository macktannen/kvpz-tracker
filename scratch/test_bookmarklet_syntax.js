const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\chadm\\.gemini\\antigravity\\scratch\\kvpz-tracker\\app.js', 'utf8');

const regex = /const code = `(.*?)`\.replace/s;
const match = content.match(regex);
if (match) {
    const raw = `javascript:${match[1]}`;
    const minified = raw.replace(/\n\s+/g, '');
    console.log("Valid?", (() => { try { eval(minified.replace('javascript:', '')); return true; } catch (e) { return e.toString(); } })());
}
