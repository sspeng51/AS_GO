from pathlib import Path
p=Path('outputs/merged500/build.mjs');s=p.read_text(encoding='utf-8');s=s.replace('const w=Workbook.create();',"for(const rows of [d.questions,d.evidence])for(const r of rows)for(let i=0;i<r.length;i++)if(typeof r[i]==='string'&&r[i].startsWith('='))r[i]=\"'\"+r[i];const w=Workbook.create();");p.write_text(s,encoding='utf-8')
