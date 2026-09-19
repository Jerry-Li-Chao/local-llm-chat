const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../public/markdown.js');
test('renders summary headings, emphasis, lists, tables and code',async()=>{
 const {renderMarkdown}=await load();
 const html=renderMarkdown('# Main idea\n\n**Evidence** and `code`\n\n- First\n- Second\n\n| A | B |\n| --- | --- |\n| x | y |\n\n```js\nconst x = 1;\n```');
 for(const expected of ['<h1>Main idea</h1>','<strong>Evidence</strong>','<code>code</code>','<ul>','<table>','<pre><code class="language-js">'])assert.ok(html.includes(expected),expected);
});
test('model-provided HTML and unsafe links remain inert',async()=>{
 const {renderMarkdown}=await load();const html=renderMarkdown('<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n`<script>alert(1)</script>`');
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script'));assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('&lt;img'));
});
