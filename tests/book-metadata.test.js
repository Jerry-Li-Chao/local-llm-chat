const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestMetadata, validateMetadata } = require('../server/book/metadata');
const { promptFor } = require('../server/book/engine');
test('PDF metadata takes precedence over filename but requires review',()=>{
 const result=suggestMetadata('Title: Real Book\nAuthor: A Writer\n','file.pdf');
 assert.equal(result.bookTitle,'Real Book');assert.equal(result.author,'A Writer');assert.equal(result.metadataConfirmed,false);
 assert.equal(suggestMetadata('Title: Untitled\n','My_Book.pdf').bookTitle,'My Book');
});
test('title is mandatory and identity has bounded size',()=>{
 assert.throws(()=>validateMetadata({bookTitle:''}));assert.throws(()=>validateMetadata({bookTitle:'a'.repeat(601)}));
 assert.equal(validateMetadata({bookTitle:' Tim Cook ',author:'Leander Kahney'}).bookTitle,'Tim Cook');
});
test('all task types distinguish book identity from section headings',()=>{
 const parent={id:'parent',title:'Front matter',start:1,end:11};
 const job={bookTitle:'Tim Cook: The Genius Who Took Apple to the Next Level',author:'Leander Kahney',metadataConfirmed:true,name:'book.pdf',tasks:[parent]};
 for(const kind of ['section','chapter','book']) {
  const prompt=promptFor(job,{kind,title:'Killing It',parentId:'parent'},'A quoted epigraph.');
  assert.ok(prompt.includes('"bookTitle":"Tim Cook: The Genius Who Took Apple to the Next Level"'));
  assert.ok(prompt.includes('"author":"Leander Kahney"'));assert.ok(prompt.includes('"pdfPages":"1-11"'));
  assert.ok(prompt.includes('Current task / section heading: Killing It'));
  assert.ok(prompt.includes('An epigraph attribution is not evidence'));
 }
});
