from pathlib import Path
p=Path('outputs/merged500/build.mjs');s=p.read_text(encoding='utf-8')
s=s.replace('w.recalculate();',"""for(let k=0;k<2;k++){const kb=['original','preprocessed'][k],col=['B','C'][k];for(let i=0;i<7;i++){const vals=d.questions.filter(r=>r[2]===kb&&r[7]===metrics[i]&&typeof r[8]==='number').map(r=>r[8]);summary.getRange(`${col}${9+i*2}`).values=[[vals.reduce((a,b)=>a+b,0)/vals.length]];}}
w.recalculate();""")
p.write_text(s,encoding='utf-8')
