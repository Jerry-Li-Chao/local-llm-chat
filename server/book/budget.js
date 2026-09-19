const OUTPUT = 1024;
function budgetFor(job = {}) {
  const target = job.chunkTarget ?? 6000;
  if (!Number.isInteger(target) || target < 2000 || target > 64000 || target % 1000) throw new Error('Choose a reading target from 2,000 to 64,000 tokens, in steps of 1,000.');
  const context = Math.ceil((target + OUTPUT + 512) / 1024) * 1024;
  return { target, context, input: context - OUTPUT - 512, output: OUTPUT };
}
module.exports = { budgetFor };
