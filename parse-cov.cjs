const cov = require("./coverage/coverage-final.json");

const files = Object.entries(cov)
  .filter(([k]) => !k.match(/parse-cov|vitest|config\.ts$/))
  .map(([path, data]) => {
    const sm = data.statementMap || {};
    const fm = data.fnMap || {};
    const bm = data.branchMap || {};
    
    const stmts = Object.keys(sm).length;
    const stmtsCov = Object.values(data.s || {}).filter(x => x > 0).length;
    const fns = Object.keys(fm).length;
    const fnsCov = Object.values(data.f || {}).filter(x => x > 0).length;
    const brs = Object.keys(bm).length;
    const brsCov = Object.values(data.b || {}).filter(x => x > 0).length;
    
    const shortPath = path.replace(/.*\/src\//, "src/");
    
    return {
      file: shortPath,
      stmt: stmtsCov + "/" + stmts,
      fn: fnsCov + "/" + fns,
      br: brsCov + "/" + brs,
      stmtPct: stmts ? Math.round(stmtsCov * 100 / stmts) : 0,
      fnPct: fns ? Math.round(fnsCov * 100 / fns) : 0,
      brPct: brs ? Math.round(brsCov * 100 / brs) : 0
    };
  })
  .sort((a, b) => a.file.localeCompare(b.file));

console.log("Файл                      | Stmt   | Fn    | Br");
console.log("-".repeat(50));
files.forEach(f => {
  console.log(`${f.file.padEnd(28)}| ${f.stmtPct.toString().padStart(4)}% | ${f.fnPct.toString().padStart(4)}% | ${f.brPct.toString().padStart(4)}%`);
});

const total = files.reduce((acc, f) => ({
  stmt: acc.stmt + parseInt(f.stmt.split("/")[0]),
  stmtTotal: acc.stmtTotal + parseInt(f.stmt.split("/")[1]),
  fn: acc.fn + parseInt(f.fn.split("/")[0]),
  fnTotal: acc.fnTotal + parseInt(f.fn.split("/")[1]),
  br: acc.br + parseInt(f.br.split("/")[0]),
  brTotal: acc.brTotal + parseInt(f.br.split("/")[1])
}), {stmt:0, stmtTotal:0, fn:0, fnTotal:0, br:0, brTotal:0});

console.log("-".repeat(50));
console.log(` Всего                    | ${Math.round(total.stmt*100/total.stmtTotal)}% | ${Math.round(total.fn*100/total.fnTotal)}% | ${Math.round(total.br*100/total.brTotal)}%`);