from pathlib import Path
p=Path('outputs/merged500/build.mjs')
s=p.read_text(encoding='utf-8').replace("name+'Table'","name.replaceAll(' ','')+'Table'")
s=s.replace('const w=Workbook.create();',"for(const r of d.questions){if(r[5]==='检索异常')r[5]='Retrieval error';} const w=Workbook.create();")
s=s[:s.rfind('await (await SpreadsheetFile.exportXlsx')]+"await (await SpreadsheetFile.exportXlsx(w)).save('Merged_500.xlsx');"
p.write_text(s,encoding='utf-8')
