const test = require('node:test');
const assert = require('node:assert/strict');
const { splitStructured, bytes } = require('../server/book/chunking');
test('prefers intact paragraphs near the budget; includes bounded overlap without losing coverage',()=>{
 const text=Array.from({length:30},(_,i)=>`Idea ${i}. `+'The author develops this argument. '.repeat(10)+'\n\n').join('');
 const parts=splitStructured(text,1300,150);
 assert.equal(parts.map(p=>p.source).join(''),text);
 assert.ok(parts.slice(0,-1).every(p=>p.boundary==='paragraph'));
 assert.ok(parts.slice(1).every(p=>p.overlap && bytes(p.overlap)<=150));
 assert.ok(parts.every(p=>bytes(p.source)<=1300));
});
test('line-wrapped PDF prose is cut at sentences, not arbitrary printed lines',()=>{
 const text=('The author argues that this is important,\nand supplies evidence to explain the idea. ').repeat(70);
 const parts=splitStructured(text,1100);
 assert.ok(parts.slice(0,-1).every(p=>p.boundary==='sentence'));
 assert.equal(parts.map(p=>p.source).join(''),text);
});
test('heading near the cut is preferred over a nearby sentence',()=>{
 const text='a'.repeat(850)+'\n\n2. A new idea\n'+'The next argument. '.repeat(40);
 const parts=splitStructured(text,1000);
 assert.equal(parts[0].boundary,'heading');assert.ok(parts[1].source.startsWith('2. A new idea'));
});
test('Unicode fallback and overlap never break surrogate pairs',()=>{
 const text='👩🏽‍🔬世界'.repeat(800);const parts=splitStructured(text,600,150);
 assert.equal(parts.map(p=>p.source).join(''),text);
 for(const part of parts) {assert.equal(part.source.isWellFormed(),true);assert.equal(part.overlap.isWellFormed(),true);}
});
